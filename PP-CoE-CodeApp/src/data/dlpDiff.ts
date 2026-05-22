/**
 * Pure diff logic for two DLP policies (`PolicyV2`).
 *
 * Kept free of React / Fluent imports on purpose — easy to unit-test in
 * isolation, and reusable by the upcoming DLP Analysis mini-app.
 *
 * The shape we compute:
 *   - `scope`   — environment-scoping diff (`environmentType` + member list)
 *   - `default` — `defaultConnectorsClassification` for each side
 *   - `connectors` — one row per connector in (A ∪ B), with its bucket
 *                    in each side and whether the classification differs
 *   - `summary` — quick counts so the UI can render KPI tiles up top
 */

import type { PolicyV2 } from "../generated/models/PowerPlatformforAdminsModel";

/** The three buckets DLP supports. Connector strings come from the
 *  connector as `"Confidential" | "General" | "Blocked"`; we keep them
 *  as-is to avoid translation surprises. */
export type ConnectorClassification = "Confidential" | "General" | "Blocked";

/** Whether a connector's bucket assignment is *explicit* (it's listed
 *  inside one of the policy's `connectorGroups`) or *default* (it falls
 *  through to `defaultConnectorsClassification`). The distinction
 *  matters for the UI: "both Blocked, but one explicit and one
 *  default" is technically the same effective classification but worth
 *  flagging. */
export type BucketSource = "explicit" | "default";

export interface ConnectorRow {
  /** Connector resource id (e.g. `/providers/Microsoft.PowerApps/apis/shared_sql`). */
  id: string;
  /** Best human-readable name. Prefer A's name; fall back to B's. */
  name: string;
  /** Underlying connector type if the policy specifies one (`_type`). */
  type?: string;
  bucketA: ConnectorClassification;
  bucketB: ConnectorClassification;
  sourceA: BucketSource;
  sourceB: BucketSource;
  /** True iff the *effective* bucket is the same on both sides
   *  (regardless of explicit vs default source). */
  sameBucket: boolean;
}

export interface ScopeDiff {
  typeA: string;
  typeB: string;
  typeSame: boolean;
  /** True when the policy's `environmentType` actually uses the
   *  `environments[]` list (i.e. not `AllEnvironments`). */
  usesEnvListA: boolean;
  usesEnvListB: boolean;
  /** Set-diff over `environments[]` keyed by `id`. */
  envsAOnly: PolicyV2["environments"];
  envsBOnly: PolicyV2["environments"];
  envsBoth: PolicyV2["environments"];
}

export interface DlpDiffSummary {
  totalConnectors: number;
  differingConnectors: number;
  matchingConnectors: number;
  defaultClassificationSame: boolean;
  scopeSame: boolean;
}

export interface DlpDiffResult {
  summary: DlpDiffSummary;
  scope: ScopeDiff;
  defaultA: ConnectorClassification;
  defaultB: ConnectorClassification;
  /** Sorted: differing rows first (most "interesting" reclassifications
   *  bubble to the top), then matching rows alphabetically by name. */
  connectors: ConnectorRow[];
}

/** Environment types that have a meaningful `environments[]` list. The
 *  schema enum is `AllEnvironments | OnlyEnvironments | ExceptEnvironments
 *  | SingleEnvironment` — only the first ignores the list. */
function usesEnvironmentList(envType: string): boolean {
  return envType !== "AllEnvironments";
}

/** Flatten a `PolicyV2.connectorGroups` into a map from connector id to
 *  its classification + reference info. Connectors not in this map fall
 *  through to the policy's `defaultConnectorsClassification`. */
interface ConnectorIndexEntry {
  classification: ConnectorClassification;
  name: string;
  type?: string;
}
function indexConnectors(policy: PolicyV2): Map<string, ConnectorIndexEntry> {
  const out = new Map<string, ConnectorIndexEntry>();
  for (const group of policy.connectorGroups ?? []) {
    const classification = group.classification as ConnectorClassification;
    for (const c of group.connectors ?? []) {
      if (!c.id) continue;
      out.set(c.id, { classification, name: c.name, type: c._type });
    }
  }
  return out;
}

/** Set-diff over an array of `{ id }` objects, keyed by id. Stable in
 *  input order (returns items from `a`/`b` in their original order). */
function diffEnvLists(
  a: PolicyV2["environments"],
  b: PolicyV2["environments"]
) {
  const aIds = new Set(a.map((e) => e.id));
  const bIds = new Set(b.map((e) => e.id));
  return {
    aOnly: a.filter((e) => !bIds.has(e.id)),
    bOnly: b.filter((e) => !aIds.has(e.id)),
    both: a.filter((e) => bIds.has(e.id)),
  };
}

/** Compute the full diff between two DLP policies. */
export function diffDlpPolicies(a: PolicyV2, b: PolicyV2): DlpDiffResult {
  const defaultA = a.defaultConnectorsClassification as ConnectorClassification;
  const defaultB = b.defaultConnectorsClassification as ConnectorClassification;

  const idxA = indexConnectors(a);
  const idxB = indexConnectors(b);

  const allIds = new Set<string>([...idxA.keys(), ...idxB.keys()]);

  const connectors: ConnectorRow[] = [];
  for (const id of allIds) {
    const inA = idxA.get(id);
    const inB = idxB.get(id);
    const bucketA: ConnectorClassification = inA?.classification ?? defaultA;
    const bucketB: ConnectorClassification = inB?.classification ?? defaultB;
    connectors.push({
      id,
      name: inA?.name ?? inB?.name ?? id,
      type: inA?.type ?? inB?.type,
      bucketA,
      bucketB,
      sourceA: inA ? "explicit" : "default",
      sourceB: inB ? "explicit" : "default",
      sameBucket: bucketA === bucketB,
    });
  }

  connectors.sort((x, y) => {
    if (x.sameBucket !== y.sameBucket) return x.sameBucket ? 1 : -1;
    return x.name.localeCompare(y.name);
  });

  const envDiff = diffEnvLists(a.environments ?? [], b.environments ?? []);
  const scope: ScopeDiff = {
    typeA: a.environmentType,
    typeB: b.environmentType,
    typeSame: a.environmentType === b.environmentType,
    usesEnvListA: usesEnvironmentList(a.environmentType),
    usesEnvListB: usesEnvironmentList(b.environmentType),
    envsAOnly: envDiff.aOnly,
    envsBOnly: envDiff.bOnly,
    envsBoth: envDiff.both,
  };

  const differingConnectors = connectors.filter((c) => !c.sameBucket).length;
  const summary: DlpDiffSummary = {
    totalConnectors: connectors.length,
    differingConnectors,
    matchingConnectors: connectors.length - differingConnectors,
    defaultClassificationSame: defaultA === defaultB,
    scopeSame:
      scope.typeSame &&
      scope.envsAOnly.length === 0 &&
      scope.envsBOnly.length === 0,
  };

  return { summary, scope, defaultA, defaultB, connectors };
}
