import { registerAggregators, type Aggregator, type AggregatorOutput, type ChartBucket } from "./dashboardAggregators";
import { friendlyConnectorName } from "./inventory";
import type { EstateManagedApp } from "./dashboardManagedAppSource";

type Rows = EstateManagedApp[];
const DAY = 86_400_000;
const unique = (values: string[]) => new Set(values.filter(Boolean)).size;
const origin = (app: EstateManagedApp) => app.origin === "CopilotStudio" ? "Copilot Studio" : app.origin || "Origin unavailable";
const groupLabel = (app: EstateManagedApp) => !app.membershipKnown ? "Membership unresolved"
  : !app.groupId ? "Ungrouped" : app.groupName || "Group details unavailable";
const creatorLabel = (app: EstateManagedApp) => app.creatorName
  || app.createdBy || "Creator ID unavailable";
const byCount = (a: ChartBucket, b: ChartBucket) => b.value - a.value || a.name.localeCompare(b.name);
function top(buckets: ChartBucket[], limit = 10): ChartBucket[] {
  const sorted = buckets.sort(byCount);
  return sorted.length <= limit ? sorted : [...sorted.slice(0, limit), {
    name: "Other (remaining categories)", value: sorted.slice(limit).reduce((sum, entry) => sum + entry.value, 0),
  }];
}
function recent(rows: Rows, days: number) {
  const now = Date.parse(rows[0]?.snapshotAt ?? "");
  return rows.filter((app) => {
    const time = Date.parse(app.createdAt);
    return Number.isFinite(time) && time >= now - days * DAY && time <= now;
  });
}
function chart(rows: Rows, label: (app: EstateManagedApp) => string): AggregatorOutput {
  const counts = new Map<string, number>();
  for (const app of rows) counts.set(label(app), (counts.get(label(app)) ?? 0) + 1);
  return { kind: "chart", buckets: top([...counts].map(([name, value]) => ({ name, value }))) };
}
function environmentDistribution(rows: Rows, dimension: string): AggregatorOutput {
  const groups = new Map<string, { label: string; apps: Rows }>();
  for (const app of rows) {
    const label = dimension === "type" ? app.environmentType || "Type unavailable"
      : dimension === "managed" ? app.environmentManaged === null ? "Status unavailable"
        : app.environmentManaged ? "Managed environments" : "Non-managed environments"
      : groupLabel(app);
    const key = dimension === "group" ? !app.membershipKnown ? "unknown" : app.groupId || "ungrouped" : label;
    const bucket = groups.get(key) ?? { label, apps: [] };
    bucket.apps.push(app);
    groups.set(key, bucket);
  }
  const buckets = [...groups].map(([key, entry]) => ({
    key, label: entry.label, apps: entry.apps.length,
    envs: unique(entry.apps.map((app) => app.environmentId)),
  })).sort((a, b) => b.apps - a.apps || a.key.localeCompare(b.key));
  const shown = buckets.slice(0, 10);
  const other = buckets.slice(10);
  const labels = new Map<string, number>();
  return { kind: "stackedBar", series: ["Apps", "App-bearing environments"],
    data: [...shown, ...(other.length ? [{
      key: "other", label: "Other", apps: other.reduce((sum, b) => sum + b.apps, 0), envs: other.reduce((sum, b) => sum + b.envs, 0),
    }] : [])].map((bucket) => {
      const occurrence = (labels.get(bucket.label) ?? 0) + 1;
      labels.set(bucket.label, occurrence);
      return { category: occurrence > 1 ? `${bucket.label} (${occurrence})` : bucket.label,
        Apps: bucket.apps, "App-bearing environments": bucket.envs };
    }),
    note: "Separate bars count apps and distinct returned environment identities. Missing environment IDs contribute only to app counts; unresolved mappings remain visible." };
}
function groupsTable(rows: Rows) {
  const groups = new Map<string, Rows>();
  for (const app of rows) {
    if (!app.membershipKnown || !app.groupId) continue;
    const bucket = groups.get(app.groupId) ?? [];
    bucket.push(app);
    groups.set(app.groupId, bucket);
  }
  return [...groups].map(([groupId, apps]) => ({
    groupId, groupName: apps[0].groupName || "Group details unavailable",
    acp: apps[0].acp, apps: apps.length, environments: unique(apps.map((app) => app.environmentId)),
    reason: apps[0].acpReason,
  })).sort((a, b) => b.apps - a.apps || a.groupId.localeCompare(b.groupId));
}
export function managedAppsEstateMetric(rows: Rows, params: Record<string, unknown> = {}): AggregatorOutput {
  const metric = params.metric;
  const revised = params.presentation === 2;
  if (metric === "total") return { kind: "kpi", total: rows.length, kpiLabel: "Managed apps · all environment types" };
  if (metric === "creators") return { kind: "kpi", total: unique(rows.map((app) => app.createdBy)), kpiLabel: "Distinct returned creator identities" };
  if (metric === "environments") return { kind: "kpi", total: unique(rows.map((app) => app.environmentId)), kpiLabel: "Distinct returned environment identities",
    note: "Includes reported IDs whose environment metadata could not be mapped." };
  if (metric === "new") return { kind: "kpi", total: recent(rows, 30).length, kpiLabel: "Created in the last 30 days" };
  if (metric === "origins") return chart(rows, origin);
  if (metric === "environmentGroups" || metric === "environmentTypes" || metric === "environmentManaged") {
    if (revised && metric === "environmentGroups") {
      const items = groupsTable(rows);
      for (const [membership, label] of [[true, "Ungrouped"], [false, "Membership unresolved"]] as const) {
        const apps = rows.filter((app) => membership ? app.membershipKnown && !app.groupId : !app.membershipKnown);
        if (apps.length) items.push({ groupId: "", groupName: label, apps: apps.length,
          environments: unique(apps.map((app) => app.environmentId)), acp: membership ? "Ungrouped" : "Unable to assess",
          reason: membership ? "No group reported." : "Environment or membership mapping unavailable." });
      }
      items.sort((a, b) => b.apps - a.apps || a.groupId.localeCompare(b.groupId));
      return { kind: "table", items, total: items.length };
    }
    if (revised) {
      const label = (app: EstateManagedApp) => metric === "environmentTypes" ? app.environmentType || "Type unavailable"
        : app.environmentManaged === null ? "Status unavailable" : app.environmentManaged ? "Managed" : "Non-managed";
      const labels = [...new Set(rows.map(label))];
      return { ...chart(rows, label), details: { label: "Environment counts", items: labels.map((measure) => {
        const apps = rows.filter((app) => label(app) === measure);
        return { measure, apps: apps.length, environments: unique(apps.map((app) => app.environmentId)) };
      }) }, note: "The chart counts apps. Environment counts are distinct returned app-bearing environment identities; missing IDs are excluded from that secondary count." };
    }
    return environmentDistribution(rows, metric === "environmentTypes" ? "type" : metric === "environmentManaged" ? "managed" : "group");
  }
  if (metric === "trend") {
    const days = params.days === 30 ? 30 : 90;
    const now = Date.parse(rows[0]?.snapshotAt ?? "");
    if (!Number.isFinite(now)) return { kind: "series", series: [] };
    const counts = new Map<string, number>();
    for (const app of recent(rows, days)) {
      const key = new Date(app.createdAt).toISOString().slice(0, 10);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const first = Math.floor((now - days * DAY) / DAY) * DAY;
    return { kind: "series", series: Array.from({ length: Math.floor((now - first) / DAY) + 1 }, (_, index) => {
      const date = new Date(first + index * DAY).toISOString();
      const label = date.slice(0, 10);
      const count = counts.get(label) ?? 0;
      return { date, label, delta: count, total: count, value: count };
    }), note: `Apps created within the exact last ${days} days; unknown/invalid dates are excluded, not treated as old apps.` };
  }
  if (metric === "topCreators" || metric === "creatorsTable") {
    const creators = new Map<string, { creatorId: string; creator: string; apps: number }>();
    for (const app of rows) {
      const key = app.createdBy;
      const bucket = creators.get(key) ?? { creatorId: key, creator: creatorLabel(app), apps: 0 };
      if (app.creatorName) bucket.creator = app.creatorName;
      bucket.apps++;
      creators.set(key, bucket);
    }
    const items = [...creators.values()].sort((a, b) => b.apps - a.apps || a.creatorId.localeCompare(b.creatorId))
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
    return metric === "topCreators" ? { kind: "chart", buckets: top(items.map((entry) => ({
      name: entry.creatorId || "Creator ID unavailable", value: entry.apps,
    }))),
      note: "Counts group by creator GUID, not current owner. Click the GUID in Creator counts below for an on-demand user lookup." }
      : { kind: "table", items, total: items.length };
  }
  if (metric === "acpApps") return { ...chart(rows, (app) => app.acp),
    note: "Assignment coverage, not compliance or effective permissions. Ungrouped does not mean non-managed or unrestricted." };
  if (metric === "acpGroups") {
    const groups = groupsTable(rows);
    return { kind: "chart", buckets: ["With ACP", "Without ACP", "Unable to assess"].map((name) => ({
      name, value: groups.filter((group) => group.acp === name).length,
    })), note: "Distinct app-bearing groups with returned group IDs. Unknown environment/membership mappings are in app coverage, not invented groups." };
  }
  if (metric === "withoutAcp") {
    const items = groupsTable(rows).filter((group) => group.acp === "Without ACP");
    return { kind: "table", items, total: items.length, note: "Only complete, empty ACP assignment reads establish absence. Open a group or the app inventory below for affected resources." };
  }
  if (metric === "connectors") {
    const counts = new Map<string, number>();
    for (const app of rows) for (const connector of new Set(app.connectorIds ?? [])) counts.set(connector, (counts.get(connector) ?? 0) + 1);
    return { kind: "chart", buckets: top([...counts].map(([connector, value]) => ({ name: friendlyConnectorName(connector), value }))),
      note: "Distinct apps per connector; one app can appear under several connectors. Other sums remaining connector-app pairs, not unique apps." };
  }
  if (metric === "connectorCoverage") return chart(rows, (app) => app.connectorIds === null ? "Connector metadata malformed"
    : app.connectorIds.length ? "Uses connectors" : "No connectors used");
  if (metric === "coverage") {
    const coverage: Array<[string, number]> = [
      ["Created in last 30 days", recent(rows, 30).length], ["Created in last 90 days", recent(rows, 90).length],
      ["Origin unavailable", rows.filter((app) => !app.origin).length],
      ["Creator identity unavailable", rows.filter((app) => !app.createdBy).length],
      ["Environment mapping unavailable", rows.filter((app) => !app.environmentMapped).length],
      ["Membership unresolved", rows.filter((app) => !app.membershipKnown).length],
      ["Managed-environment status unavailable", rows.filter((app) => app.environmentManaged === null).length],
      ["Creation date missing/invalid/future", rows.filter((app) => !Number.isFinite(Date.parse(app.createdAt))
        || Date.parse(app.createdAt) > Date.parse(app.snapshotAt)).length],
      ["Connector metadata malformed", rows.filter((app) => app.connectorIds === null).length],
    ];
    const issues = coverage.slice(2).filter(([, apps]) => apps > 0);
    return { kind: "table", items: (revised ? coverage.slice(0, 2) : coverage).map(([field, apps]) => ({ field, apps })),
      total: revised ? 2 : coverage.length,
      ...(revised ? { details: { label: issues.length ? `Data coverage · ${issues.length} missing or invalid fields` : "Data coverage · no missing or invalid fields",
        items: issues.map(([measure, apps]) => ({ measure, apps })) } } : {}),
      note: "Coverage counts are apps and may overlap. Having a creator ID without looking up its name is not a data defect." };
  }
  if (metric === "appsTable" || metric === "connectorApps") {
    const items = rows.flatMap((app) => {
      const base = { id: app.id, displayName: app.displayName || "Unnamed managed app", environmentId: app.environmentId,
        environmentName: app.environmentName || (app.environmentId ? "Environment details unavailable" : "Environment unavailable"),
        groupId: app.groupId, groupName: groupLabel(app), creator: creatorLabel(app), creatorId: app.createdBy,
        origin: origin(app), acp: app.acp, reason: app.acpReason, createdAt: app.createdAt || "Date unavailable" };
      return metric === "connectorApps" ? (app.connectorIds === null ? [{ connector: "Connector metadata malformed", connectorId: "" }]
        : app.connectorIds.length ? [...new Set(app.connectorIds)].map((connectorId) => ({ connector: friendlyConnectorName(connectorId), connectorId }))
          : [{ connector: "No connectors used", connectorId: "" }])
        .map((connector) => ({ ...base, ...connector })) : [base];
    });
    return { kind: "table", items, total: items.length };
  }
  throw new Error(`Unknown managed-app estate metric: ${String(metric)}`);
}

export const MANAGED_APP_ESTATE_AGGREGATOR = "managedApps.estate";
registerAggregators({ [MANAGED_APP_ESTATE_AGGREGATOR]: {
  fn: managedAppsEstateMetric as Aggregator<unknown>, dataSource: "managed-apps",
} });
