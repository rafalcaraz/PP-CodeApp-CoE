/**
 * Computed-tile aggregator registry.
 *
 * The connector's KQL whitelist (`where | project | take | orderby |
 * distinct | count | summarize | extend | join`) cannot `mv-expand`,
 * which means anything involving the nested `powerPlatformConnectors[].
 * operations[]` array has to be folded client-side. This module is where
 * those folds live.
 *
 * **Shape contract:** every aggregator is a pure function
 * `(agents, params?) => AggregatorOutput`. The output is a discriminated
 * union — KPI total / chart buckets / table rows / stacked-bar series —
 * matching the four viz types computed tiles can render. `TileView`
 * dispatches the output into its existing `QueryState` based on the
 * `kind` discriminator.
 *
 * **Purity matters:** these functions are unit-tested with hand-rolled
 * `AgentRow` fixtures. Keep them dependency-free (no `runQuery`, no
 * `localStorage`) so the tests stay deterministic.
 */
import type { AgentRow, ResourceConnector, ResourceConnectorOperation } from "./inventory";

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export interface KpiOutput {
  kind: "kpi";
  total: number;
  /** Optional label override that wins over `viz.kpiLabel` when set. */
  kpiLabel?: string;
}

export interface ChartBucket {
  name: string;
  value: number;
}

export interface ChartOutput {
  kind: "chart";
  /** Pre-sorted buckets ready for bar / pie consumption. */
  buckets: ChartBucket[];
}

export interface TableOutput {
  kind: "table";
  items: Array<Record<string, unknown>>;
  /** Optional total — populated when the table is filtered down to a
   *  Top-N but the underlying universe size matters for the header. */
  total?: number;
}

export interface StackedChartDatum {
  /** Category name on the X axis (or Y axis for horizontal bars). */
  category: string;
  /** Per-series counts. Keys correspond to entries in `series`. */
  [seriesName: string]: string | number;
}

export interface StackedBarOutput {
  kind: "stackedBar";
  /** Ordered list of series names — used to lay out the legend AND to
   *  index into each `StackedChartDatum`. */
  series: string[];
  data: StackedChartDatum[];
}

export type AggregatorOutput =
  | KpiOutput
  | ChartOutput
  | TableOutput
  | StackedBarOutput;

export type Aggregator = (
  agents: AgentRow[],
  params?: Record<string, unknown>
) => AggregatorOutput;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function readNumber(params: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const v = params?.[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return fallback;
}

function safeOps(c: ResourceConnector | undefined): ResourceConnectorOperation[] {
  return Array.isArray(c?.operations) ? c!.operations : [];
}

function allOperations(agent: AgentRow): Array<{ connector: ResourceConnector; op: ResourceConnectorOperation }> {
  const out: Array<{ connector: ResourceConnector; op: ResourceConnectorOperation }> = [];
  for (const c of agent.connectors ?? []) {
    for (const op of safeOps(c)) {
      out.push({ connector: c, op });
    }
  }
  return out;
}

function sortByValueDesc(buckets: ChartBucket[]): ChartBucket[] {
  return buckets.slice().sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function topNWithOther(buckets: ChartBucket[], n: number): ChartBucket[] {
  if (buckets.length <= n) return buckets;
  const head = buckets.slice(0, n - 1);
  const tail = buckets.slice(n - 1).reduce((s, b) => s + b.value, 0);
  return [...head, { name: "Other", value: tail }];
}

/** Defensive duck-typed read for fields we want to use in aggregators but
 *  don't want to add to the strongly-typed `AgentRow` (extending the type
 *  would break unrelated tests that mock the full shape). Returns 0 when
 *  the field is missing or non-numeric. */
function readDuckNumber(row: AgentRow, key: string): number {
  const v = (row as unknown as Record<string, unknown>)[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

/** Defensive duck-typed read for boolean-ish fields. */
function readDuckBool(row: AgentRow, key: string): boolean {
  return Boolean((row as unknown as Record<string, unknown>)[key]);
}

// ---------------------------------------------------------------------------
// Aggregators — Tools & Connectors
// ---------------------------------------------------------------------------

/** #1 KPI — distinct connectors referenced by any agent in the tenant. */
export const distinctConnectorsKpi: Aggregator = (agents) => {
  const set = new Set<string>();
  for (const a of agents) {
    for (const c of a.connectors ?? []) {
      if (c.connectorId) set.add(c.connectorId);
    }
  }
  return { kind: "kpi", total: set.size, kpiLabel: `across ${agents.length} agents` };
};

/** #1 (drill-through table) — per distinct connector: agent count + op count
 *  + breakdown by usedAs. Sorted by agent count desc. */
export const distinctConnectorsTable: Aggregator = (agents) => {
  type Row = {
    connectorId: string;
    agentCount: number;
    opCount: number;
    toolOps: number;
    topicToolOps: number;
    knowledgeOps: number;
  };
  const byId = new Map<string, Row>();
  for (const a of agents) {
    const seenIds = new Set<string>();
    for (const c of a.connectors ?? []) {
      const id = c.connectorId;
      if (!id) continue;
      let row = byId.get(id);
      if (!row) {
        row = {
          connectorId: id,
          agentCount: 0,
          opCount: 0,
          toolOps: 0,
          topicToolOps: 0,
          knowledgeOps: 0,
        };
        byId.set(id, row);
      }
      if (!seenIds.has(id)) {
        row.agentCount++;
        seenIds.add(id);
      }
      for (const op of safeOps(c)) {
        row.opCount++;
        switch (op.usedAs) {
          case "Tool":
            row.toolOps++;
            break;
          case "Topic Tool":
            row.topicToolOps++;
            break;
          case "Knowledge":
            row.knowledgeOps++;
            break;
        }
      }
    }
  }
  const items = Array.from(byId.values())
    .sort((a, b) => b.agentCount - a.agentCount || a.connectorId.localeCompare(b.connectorId));
  return { kind: "table", items: items as unknown as Array<Record<string, unknown>>, total: items.length };
};

/** #2 — top connectors by number of agents referencing them. */
export const topConnectorsByAgentCount: Aggregator = (agents, params) => {
  const topN = readNumber(params, "topN", 10);
  const byId = new Map<string, number>();
  for (const a of agents) {
    const seen = new Set<string>();
    for (const c of a.connectors ?? []) {
      if (!c.connectorId || seen.has(c.connectorId)) continue;
      seen.add(c.connectorId);
      byId.set(c.connectorId, (byId.get(c.connectorId) ?? 0) + 1);
    }
  }
  const buckets: ChartBucket[] = Array.from(byId.entries()).map(([name, value]) => ({ name, value }));
  return { kind: "chart", buckets: topNWithOther(sortByValueDesc(buckets), topN) };
};

/** #3 — for the top-N connectors, count of operations split by `usedAs`. */
export const connectorOpUsageTypePerConnector: Aggregator = (agents, params) => {
  const topN = readNumber(params, "topN", 8);
  type Bucket = { tool: number; topicTool: number; knowledge: number; total: number };
  const byId = new Map<string, Bucket>();
  for (const a of agents) {
    for (const c of a.connectors ?? []) {
      if (!c.connectorId) continue;
      let row = byId.get(c.connectorId);
      if (!row) {
        row = { tool: 0, topicTool: 0, knowledge: 0, total: 0 };
        byId.set(c.connectorId, row);
      }
      for (const op of safeOps(c)) {
        row.total++;
        switch (op.usedAs) {
          case "Tool":
            row.tool++;
            break;
          case "Topic Tool":
            row.topicTool++;
            break;
          case "Knowledge":
            row.knowledge++;
            break;
        }
      }
    }
  }
  const ranked = Array.from(byId.entries())
    .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
    .slice(0, topN);
  const data: StackedChartDatum[] = ranked.map(([connectorId, b]) => ({
    category: connectorId,
    Tool: b.tool,
    "Topic Tool": b.topicTool,
    Knowledge: b.knowledge,
  }));
  return { kind: "stackedBar", series: ["Tool", "Topic Tool", "Knowledge"], data };
};

/** #5 — maker-shared vs end-user connection-provider mix, across every op. */
export const makerVsEndUserMix: Aggregator = (agents) => {
  let maker = 0;
  let endUser = 0;
  let unknown = 0;
  for (const a of agents) {
    for (const { op } of allOperations(a)) {
      const p = op.connectionProvider;
      if (p === "Maker") maker++;
      else if (p === "End user") endUser++;
      else unknown++;
    }
  }
  const buckets: ChartBucket[] = [
    { name: "Maker-shared", value: maker },
    { name: "End-user", value: endUser },
  ];
  if (unknown > 0) buckets.push({ name: "Unknown", value: unknown });
  return { kind: "chart", buckets };
};

/** #19 — distribution of agents by number of distinct connector operations
 *  PLUS distinct flows (richer than just the connector count). `distinctFlows`
 *  is read defensively from the row because `AgentRow` doesn't carry it as
 *  a typed field yet; the existing AgentsList tests would break if we
 *  required it. Falls back to 0 when missing. */
export const toolRichnessHistogram: Aggregator = (agents) => {
  const buckets = new Map<string, number>();
  const order = ["0", "1-2", "3-5", "6-10", "11-20", "21+"];
  for (const k of order) buckets.set(k, 0);
  for (const a of agents) {
    const ops = a.distinctConnectorOperations ?? 0;
    const flows = readDuckNumber(a, "distinctFlows");
    const total = ops + flows;
    const bucket =
      total === 0 ? "0"
      : total <= 2 ? "1-2"
      : total <= 5 ? "3-5"
      : total <= 10 ? "6-10"
      : total <= 20 ? "11-20"
      : "21+";
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  return {
    kind: "chart",
    buckets: order.map((name) => ({ name, value: buckets.get(name) ?? 0 })),
  };
};

// ---------------------------------------------------------------------------
// Aggregators — Knowledge & Grounding
// ---------------------------------------------------------------------------

/** #7 — table of agents that use any connector as a Knowledge source. */
export const agentsUsingConnectorKnowledgeTable: Aggregator = (agents) => {
  type Row = {
    displayName: string;
    environmentId: string;
    ownerId: string;
    knowledgeSources: number;
    knowledgeConnectors: string;
    lastPublishedAt: string;
  };
  const items: Row[] = [];
  for (const a of agents) {
    const knowledgeConnectors: string[] = [];
    let count = 0;
    for (const c of a.connectors ?? []) {
      let used = false;
      for (const op of safeOps(c)) {
        if (op.usedAs === "Knowledge") {
          count++;
          used = true;
        }
      }
      if (used && c.connectorId) knowledgeConnectors.push(c.connectorId);
    }
    if (count > 0) {
      items.push({
        displayName: a.displayName,
        environmentId: a.environmentId,
        ownerId: a.ownerId,
        knowledgeSources: count,
        knowledgeConnectors: knowledgeConnectors.join(", "),
        lastPublishedAt: a.lastPublishedAt,
      });
    }
  }
  items.sort((a, b) => b.knowledgeSources - a.knowledgeSources);
  return { kind: "table", items: items as unknown as Array<Record<string, unknown>>, total: items.length };
};

/** #8 — distribution of agents by count of Knowledge-typed operations. */
export const knowledgeDiversityHistogram: Aggregator = (agents) => {
  const order = ["0", "1", "2-3", "4-6", "7+"];
  const buckets = new Map<string, number>(order.map((k) => [k, 0]));
  for (const a of agents) {
    let n = 0;
    for (const { op } of allOperations(a)) {
      if (op.usedAs === "Knowledge") n++;
    }
    const bucket =
      n === 0 ? "0"
      : n === 1 ? "1"
      : n <= 3 ? "2-3"
      : n <= 6 ? "4-6"
      : "7+";
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  return {
    kind: "chart",
    buckets: order.map((name) => ({ name, value: buckets.get(name) ?? 0 })),
  };
};

// ---------------------------------------------------------------------------
// Aggregators — Reach & Channels
// ---------------------------------------------------------------------------

/** #9a — per-channel agent count (DYNAMIC). One bucket per distinct
 *  channel string found anywhere in the data — Teams, Microsoft 365
 *  Copilot, Direct Line Channels, SharePoint, Webchat, Facebook, Slack,
 *  Telegram, etc. — sorted by frequency desc so the dominant channels
 *  rise to the top. Multi-channel agents contribute to every channel they
 *  belong to, so the column sum exceeds the agent count when many agents
 *  publish to multiple surfaces — that's the intended read. */
export const channelFrequencyBar: Aggregator = (agents, params) => {
  const topN = readNumber(params, "topN", 15);
  const counts = new Map<string, number>();
  let noChannels = 0;
  for (const a of agents) {
    const ch = a.channels ?? [];
    if (ch.length === 0) {
      noChannels++;
      continue;
    }
    const seen = new Set<string>();
    for (const c of ch) {
      const name = (c ?? "").trim();
      if (!name) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const buckets: ChartBucket[] = Array.from(counts.entries())
    .map(([name, value]) => ({ name, value }));
  const ranked = topNWithOther(sortByValueDesc(buckets), topN);
  // Surface the no-channels count as a labeled bucket so the metric tells
  // the full story (an agent in zero channels is a publishing red flag and
  // is invisible on a frequency bar otherwise).
  if (noChannels > 0) {
    ranked.push({ name: "(no channels)", value: noChannels });
  }
  return { kind: "chart", buckets: ranked };
};

/** #9b — distribution of agents by *how many* channels they're in. Tells
 *  you whether your tenant trends single-channel (siloed) or
 *  multi-channel (reusable). Bucket boundaries pick out the meaningful
 *  thresholds: 0 = unpublished surfaces; 1 = single-purpose; 2-3 = healthy
 *  multi-channel; 4+ = sprawl. */
export const channelReachHistogram: Aggregator = (agents) => {
  const order = ["0", "1", "2-3", "4+"];
  const buckets = new Map<string, number>(order.map((k) => [k, 0]));
  for (const a of agents) {
    // De-dupe channel strings before counting so a stray duplicate in
    // the array doesn't inflate the bucket.
    const distinct = new Set((a.channels ?? []).filter((c) => !!c?.trim()));
    const n = distinct.size;
    const bucket =
      n === 0 ? "0"
      : n === 1 ? "1"
      : n <= 3 ? "2-3"
      : "4+";
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  return {
    kind: "chart",
    buckets: order.map((name) => ({ name, value: buckets.get(name) ?? 0 })),
  };
};

// ---------------------------------------------------------------------------
// Aggregators — Sharing & Governance
// ---------------------------------------------------------------------------

/** #4 — rich table of agents with at least one end-user-consent-gated op,
 *  with sharing fan-out columns alongside the friction signal. */
export const consentGatedAgentsTable: Aggregator = (agents) => {
  type Row = {
    displayName: string;
    environmentId: string;
    ownerId: string;
    consentOps: number;
    endUserUsers: number;
    endUserGroups: number;
    tenantWide: string;
    editorsTotal: number;
    lastPublishedAt: string;
  };
  const items: Row[] = [];
  for (const a of agents) {
    let consentOps = 0;
    for (const { op } of allOperations(a)) {
      if (op.requiresEndUserConsent === true || op.connectionProvider === "End user") {
        consentOps++;
      }
    }
    if (consentOps === 0) continue;
    items.push({
      displayName: a.displayName,
      environmentId: a.environmentId,
      ownerId: a.ownerId,
      consentOps,
      endUserUsers: a.sharedWithViewers?.userCount ?? 0,
      endUserGroups: a.sharedWithViewers?.groupCount ?? 0,
      tenantWide: a.sharedWithViewers?.entireTenant ? "Yes" : "No",
      editorsTotal:
        (a.sharedWithEditors?.userCount ?? 0) + (a.sharedWithEditors?.groupCount ?? 0),
      lastPublishedAt: a.lastPublishedAt,
    });
  }
  items.sort((a, b) => b.consentOps - a.consentOps);
  return { kind: "table", items: items as unknown as Array<Record<string, unknown>>, total: items.length };
};

/** A — most-shared agents by *individuals* (viewer users + editor users).
 *  Excludes tenant-wide-shared agents — those are the dominant high-reach
 *  case and would otherwise drown out everything else. The "Tenant-wide
 *  shared" KPI is the right surface for that signal; this table is
 *  specifically about individually-invited reach. */
export const mostSharedIndividualsTable: Aggregator = (agents, params) => {
  const topN = readNumber(params, "topN", 20);
  type Row = {
    displayName: string;
    environmentId: string;
    viewerUsers: number;
    editorUsers: number;
    totalUsers: number;
    tenantWide: string;
    channels: string;
    ownerId: string;
  };
  const items: Row[] = agents
    .map<Row>((a) => {
      const viewerUsers = a.sharedWithViewers?.userCount ?? 0;
      const editorUsers = a.sharedWithEditors?.userCount ?? 0;
      return {
        displayName: a.displayName,
        environmentId: a.environmentId,
        viewerUsers,
        editorUsers,
        totalUsers: viewerUsers + editorUsers,
        tenantWide: a.sharedWithViewers?.entireTenant ? "Yes" : "No",
        channels: (a.channels ?? []).join(", "),
        ownerId: a.ownerId,
      };
    })
    .filter((r) => r.totalUsers > 0)
    .sort((a, b) => b.totalUsers - a.totalUsers)
    .slice(0, topN);
  return { kind: "table", items: items as unknown as Array<Record<string, unknown>>, total: items.length };
};

/** B — most-shared agents by *groups* (viewer groups + editor groups).
 *  See `mostSharedIndividualsTable` for the rationale behind excluding
 *  tenant-wide agents. */
export const mostSharedGroupsTable: Aggregator = (agents, params) => {
  const topN = readNumber(params, "topN", 20);
  type Row = {
    displayName: string;
    environmentId: string;
    viewerGroups: number;
    editorGroups: number;
    totalGroups: number;
    tenantWide: string;
    channels: string;
    ownerId: string;
  };
  const items: Row[] = agents
    .map<Row>((a) => {
      const viewerGroups = a.sharedWithViewers?.groupCount ?? 0;
      const editorGroups = a.sharedWithEditors?.groupCount ?? 0;
      return {
        displayName: a.displayName,
        environmentId: a.environmentId,
        viewerGroups,
        editorGroups,
        totalGroups: viewerGroups + editorGroups,
        tenantWide: a.sharedWithViewers?.entireTenant ? "Yes" : "No",
        channels: (a.channels ?? []).join(", "),
        ownerId: a.ownerId,
      };
    })
    .filter((r) => r.totalGroups > 0)
    .sort((a, b) => b.totalGroups - a.totalGroups)
    .slice(0, topN);
  return { kind: "table", items: items as unknown as Array<Record<string, unknown>>, total: items.length };
};

// ---------------------------------------------------------------------------
// Aggregators — Authoring quality
// ---------------------------------------------------------------------------

/** #12 — agents bucketed by `instructionsCharactersCount`. */
export const promptLengthHistogram: Aggregator = (agents) => {
  const order = ["<100", "100-500", "500-2k", "2k-4k", "4k-8k", "8k+"];
  const buckets = new Map<string, number>(order.map((k) => [k, 0]));
  for (const a of agents) {
    const n = a.instructionsCharactersCount ?? 0;
    const bucket =
      n < 100 ? "<100"
      : n < 500 ? "100-500"
      : n < 2000 ? "500-2k"
      : n < 4000 ? "2k-4k"
      : n < 8000 ? "4k-8k"
      : "8k+";
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  return {
    kind: "chart",
    buckets: order.map((name) => ({ name, value: buckets.get(name) ?? 0 })),
  };
};

// ---------------------------------------------------------------------------
// Aggregators — Authoring surface
// ---------------------------------------------------------------------------

/** #20 — `createdIn` combined with the CLI flag. CLI-authored agents go into
 *  their own slice regardless of `createdIn` so the pro-code path stands
 *  out. `isCLIAgent` is read defensively (not on the typed AgentRow yet). */
export const authoringSurfaceMix: Aggregator = (agents) => {
  const counts = new Map<string, number>();
  for (const a of agents) {
    const cli = readDuckBool(a, "isCLIAgent");
    const surface = cli ? "CLI" : (a.createdIn || "Unknown");
    counts.set(surface, (counts.get(surface) ?? 0) + 1);
  }
  const buckets: ChartBucket[] = Array.from(counts.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  return { kind: "chart", buckets };
};

// ---------------------------------------------------------------------------
// Aggregators — Lifecycle cleanup cohorts
// ---------------------------------------------------------------------------

function ageDays(iso: string, now: number): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now - t) / 86_400_000);
}

/** D1 — never-published agents bucketed by age since creation. */
export const cleanupNeverPublishedCohorts: Aggregator = (agents) => {
  const now = Date.now();
  const order = ["30-89d", "90-179d", "180-364d", "365d+"];
  const buckets = new Map<string, number>(order.map((k) => [k, 0]));
  for (const a of agents) {
    if (a.lastPublishedAt) continue;
    const age = ageDays(a.createdAt, now);
    if (age < 30) continue;
    const bucket =
      age < 90 ? "30-89d"
      : age < 180 ? "90-179d"
      : age < 365 ? "180-364d"
      : "365d+";
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  return {
    kind: "chart",
    buckets: order.map((name) => ({ name, value: buckets.get(name) ?? 0 })),
  };
};

/** D2 — published-but-stale agents bucketed by time since last publish. */
export const cleanupStalePublishedCohorts: Aggregator = (agents) => {
  const now = Date.now();
  const order = ["180-364d", "1-2y", "2y+"];
  const buckets = new Map<string, number>(order.map((k) => [k, 0]));
  for (const a of agents) {
    if (!a.lastPublishedAt) continue;
    const age = ageDays(a.lastPublishedAt, now);
    if (age < 180) continue;
    const bucket =
      age < 365 ? "180-364d"
      : age < 730 ? "1-2y"
      : "2y+";
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  return {
    kind: "chart",
    buckets: order.map((name) => ({ name, value: buckets.get(name) ?? 0 })),
  };
};

/** D3 — composite "cleanup candidates" table. Score = count of matching
 *  cleanup signals; "Reasons" column lists the signals so the reviewer
 *  can decide. Sorted by score desc then age desc. */
export const cleanupCandidatesTable: Aggregator = (agents, params) => {
  const topN = readNumber(params, "topN", 30);
  const now = Date.now();
  type Row = {
    displayName: string;
    environmentId: string;
    ownerId: string;
    ageDays: number;
    score: number;
    reasons: string;
    lastPublishedAt: string;
  };
  const ZERO_GUID = "00000000-0000-0000-0000-000000000000";
  const items: Row[] = [];
  for (const a of agents) {
    const reasons: string[] = [];
    const age = ageDays(a.createdAt, now);
    if (!a.lastPublishedAt && age >= 90) {
      reasons.push("Never published, >90d old");
    }
    if (a.lastPublishedAt && ageDays(a.lastPublishedAt, now) >= 180) {
      reasons.push("Last published >180d ago");
    }
    if (a.isQuarantined) reasons.push("Quarantined");
    if (!a.channels || a.channels.length === 0) reasons.push("No channels");
    if (a.ownerId === ZERO_GUID) reasons.push("Orphaned owner");
    if (reasons.length === 0) continue;
    items.push({
      displayName: a.displayName,
      environmentId: a.environmentId,
      ownerId: a.ownerId,
      ageDays: Math.round(age),
      score: reasons.length,
      reasons: reasons.join("; "),
      lastPublishedAt: a.lastPublishedAt,
    });
  }
  items.sort((a, b) => b.score - a.score || b.ageDays - a.ageDays);
  return {
    kind: "table",
    items: items.slice(0, topN) as unknown as Array<Record<string, unknown>>,
    total: items.length,
  };
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Stable string IDs used by `DashboardTile.computed.aggregatorId`. */
export const AGGREGATOR_IDS = {
  // Tools & Connectors
  distinctConnectorsKpi: "agents.distinctConnectorsKpi",
  distinctConnectorsTable: "agents.distinctConnectorsTable",
  topConnectorsByAgentCount: "agents.topConnectorsByAgentCount",
  connectorOpUsageTypePerConnector: "agents.connectorOpUsageTypePerConnector",
  makerVsEndUserMix: "agents.makerVsEndUserMix",
  toolRichnessHistogram: "agents.toolRichnessHistogram",
  // Knowledge & Grounding
  agentsUsingConnectorKnowledgeTable: "agents.agentsUsingConnectorKnowledgeTable",
  knowledgeDiversityHistogram: "agents.knowledgeDiversityHistogram",
  // Reach & Channels
  channelFrequencyBar: "agents.channelFrequencyBar",
  channelReachHistogram: "agents.channelReachHistogram",
  // Sharing & Governance
  consentGatedAgentsTable: "agents.consentGatedAgentsTable",
  mostSharedIndividualsTable: "agents.mostSharedIndividualsTable",
  mostSharedGroupsTable: "agents.mostSharedGroupsTable",
  // Authoring
  promptLengthHistogram: "agents.promptLengthHistogram",
  authoringSurfaceMix: "agents.authoringSurfaceMix",
  // Lifecycle cleanup
  cleanupNeverPublishedCohorts: "agents.cleanupNeverPublishedCohorts",
  cleanupStalePublishedCohorts: "agents.cleanupStalePublishedCohorts",
  cleanupCandidatesTable: "agents.cleanupCandidatesTable",
} as const;

const REGISTRY: Record<string, Aggregator> = {
  [AGGREGATOR_IDS.distinctConnectorsKpi]: distinctConnectorsKpi,
  [AGGREGATOR_IDS.distinctConnectorsTable]: distinctConnectorsTable,
  [AGGREGATOR_IDS.topConnectorsByAgentCount]: topConnectorsByAgentCount,
  [AGGREGATOR_IDS.connectorOpUsageTypePerConnector]: connectorOpUsageTypePerConnector,
  [AGGREGATOR_IDS.makerVsEndUserMix]: makerVsEndUserMix,
  [AGGREGATOR_IDS.toolRichnessHistogram]: toolRichnessHistogram,
  [AGGREGATOR_IDS.agentsUsingConnectorKnowledgeTable]: agentsUsingConnectorKnowledgeTable,
  [AGGREGATOR_IDS.knowledgeDiversityHistogram]: knowledgeDiversityHistogram,
  [AGGREGATOR_IDS.channelFrequencyBar]: channelFrequencyBar,
  [AGGREGATOR_IDS.channelReachHistogram]: channelReachHistogram,
  [AGGREGATOR_IDS.consentGatedAgentsTable]: consentGatedAgentsTable,
  [AGGREGATOR_IDS.mostSharedIndividualsTable]: mostSharedIndividualsTable,
  [AGGREGATOR_IDS.mostSharedGroupsTable]: mostSharedGroupsTable,
  [AGGREGATOR_IDS.promptLengthHistogram]: promptLengthHistogram,
  [AGGREGATOR_IDS.authoringSurfaceMix]: authoringSurfaceMix,
  [AGGREGATOR_IDS.cleanupNeverPublishedCohorts]: cleanupNeverPublishedCohorts,
  [AGGREGATOR_IDS.cleanupStalePublishedCohorts]: cleanupStalePublishedCohorts,
  [AGGREGATOR_IDS.cleanupCandidatesTable]: cleanupCandidatesTable,
};

export function getAggregator(id: string): Aggregator | null {
  return REGISTRY[id] ?? null;
}

/** For tests / validation: every registered aggregator id. */
export function listAggregatorIds(): string[] {
  return Object.keys(REGISTRY);
}
