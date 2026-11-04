import { PowerPlatformforAdminsV2Service } from "../generated";
import type { Clause, ResourceItem } from "../generated/models/PowerPlatformforAdminsV2Model";
import {
  buildClausesFromSpec, isManagedApp, MANAGED_APP_SUBTYPE, normalizeConnectorId,
  ResourceType, runRawQuery, toAppRow, type AppRow, type DataResult, type ResourceTypeValue,
} from "./inventory";
import { formatApiError } from "../shared/api-explorer/schema";
import { peekUser } from "./userEnrichment";

export type ManagedAppAcpState = "With ACP" | "Without ACP" | "Ungrouped" | "Unable to assess";
export interface EstateManagedApp extends AppRow {
  creatorName: string;
  origin: string;
  connectorIds: string[] | null;
  environmentType: string;
  environmentManaged: boolean | null;
  environmentMapped: boolean;
  groupId: string;
  groupName: string;
  membershipKnown: boolean;
  acp: ManagedAppAcpState;
  acpReason: string;
  snapshotAt: string;
}
export interface ManagedAppsEstateSnapshot {
  apps: EstateManagedApp[];
  capturedAt: string;
}
export interface ManagedAppsEstateStatus {
  phase: "idle" | "loading" | "ready" | "error";
  capturedAt?: string;
}
const id = (value: string) => value.trim().toLowerCase();
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const cancelled = (): DataResult<never> => ({ ok: false, error: "Managed Apps Estate read cancelled." });

/** Missing connector metadata means no usage for managed apps; malformed data is unknown. */
export function managedAppConnectorIds(properties: Record<string, unknown>): string[] | null {
  if (properties.powerPlatformConnectors === undefined) return [];
  const raw = properties.powerPlatformConnectors;
  if (!Array.isArray(raw)) return null;
  const ids = raw.map((entry) => normalizeConnectorId(text(object(entry).connectorId)).toLowerCase().replace(/^shared_/, ""));
  return ids.some((entry) => !entry) ? null : [...new Set(ids)];
}

async function drain(type: ResourceTypeValue, signal: AbortSignal, forceFresh: boolean): Promise<DataResult<ResourceItem[]>> {
  const clauses: Clause[] = buildClausesFromSpec({
    resourceTypes: [type], filters: type === ResourceType.AppBuilderApp
      ? [{ field: "properties.subType", op: "==", value: MANAGED_APP_SUBTYPE }] : [],
    orderField: "name", orderDirection: "asc", limit: 500,
  });
  const ordered = clauses.map((clause) => clause.$type === "orderby"
    ? { $type: "orderby" as const, FieldNamesAscDesc: { name: "asc", "tostring(properties.environmentId)": "asc", type: "asc" } } : clause);
  const rows = new Map<string, { raw: ResourceItem; fingerprint: string }>();
  const tokens = new Set<string>();
  let token = "";
  let skip = 0;
  for (;;) {
    if (signal.aborted) return cancelled();
    const result = await runRawQuery(ordered, { Top: 500, Skip: skip, SkipToken: token }, { forceFresh });
    if (signal.aborted) return cancelled();
    if (!result.ok) return result;
    const page = result.data.rawItems ?? result.data.items;
    if (!Array.isArray(page)) return { ok: false, error: "Inventory omitted a resource collection; estate totals are unavailable." };
    const previous = rows.size;
    for (const raw of page) {
      if (!text(raw.name) || raw.type?.toLowerCase() !== type.toLowerCase()
        || !raw.properties || typeof raw.properties !== "object" || Array.isArray(raw.properties)) {
        return { ok: false, error: "Inventory returned an invalid resource identity, type or properties; estate totals are unavailable." };
      }
      const key = `${id(text(object(raw.properties).environmentId))}::${id(raw.name!)}`;
      const fingerprint = JSON.stringify(raw);
      if (rows.has(key) && rows.get(key)!.fingerprint !== fingerprint) {
        return { ok: false, error: "Inventory changed across overlapping pages. Refresh the estate snapshot." };
      }
      rows.set(key, { raw, fingerprint });
    }
    if (!result.data.skipToken) {
      if (result.data.resultTruncated === "0" || result.data.resultTruncated === "unknown") {
        return { ok: false, error: "Inventory completeness is unknown without a continuation token; estate totals are unavailable." };
      }
      return { ok: true, data: [...rows.values()].map((entry) => entry.raw) };
    }
    if (rows.size === previous || tokens.has(result.data.skipToken)) {
      return { ok: false, error: "Inventory pagination did not advance; incomplete estate totals are not displayed." };
    }
    tokens.add(result.data.skipToken);
    token = result.data.skipToken;
    skip += page.length;
  }
}

export function assessManagedAppAssignment(value: unknown, groupId: string): { acp: ManagedAppAcpState; reason: string } {
  const response = object(value);
  if (!Array.isArray(response.value) || response["@odata.nextLink"] || response.nextLink) {
    return { acp: "Unable to assess", reason: "Assignment collection is missing or incomplete." };
  }
  if (response.value.some((entry: unknown) => {
    const assignment = object(entry);
    return !text(assignment.policyId) || id(text(assignment.resourceId)) !== groupId || assignment.resourceType !== "EnvironmentGroup";
  })) return { acp: "Unable to assess", reason: "Assignment identity or group association is ambiguous." };
  return { acp: response.value.length ? "With ACP" : "Without ACP",
    reason: response.value.length ? "Assigned policy identity returned; effective permissions not assessed." : "Complete group assignment collection is empty." };
}

export async function readManagedAppsEstate(signal: AbortSignal, forceFresh = false): Promise<DataResult<ManagedAppsEstateSnapshot>> {
  const [appRead, envRead, groupRead] = await Promise.all([
    drain(ResourceType.AppBuilderApp, signal, forceFresh),
    drain(ResourceType.Environment, signal, forceFresh),
    drain(ResourceType.EnvironmentGroup, signal, forceFresh),
  ]);
  if (signal.aborted) return cancelled();
  if (!appRead.ok) return appRead;
  if (!envRead.ok) return envRead;
  if (!groupRead.ok) return groupRead;
  const envs = new Map(envRead.data.map((raw) => [id(raw.name!), raw]));
  const groups = new Map(groupRead.data.map((raw) => [id(raw.name!), text(object(raw.properties).displayName)]));
  const apps: EstateManagedApp[] = [];
  for (const raw of appRead.data) {
    if (!text(object(raw.properties).subType)) {
      return { ok: false, error: "App inventory omitted its subtype; the managed-app population cannot be established." };
    }
    const app = toAppRow(raw);
    if (!isManagedApp(app)) continue;
    const props = object(raw.properties);
    const envId = id(app.environmentId);
    const environment = envs.get(envId);
    const env = object(environment?.properties);
    const groupValue = env.environmentGroupId;
    const groupId = typeof groupValue === "string" && id(groupValue) !== "00000000-0000-0000-0000-000000000000" ? id(groupValue) : "";
    const membershipKnown = !!environment
      && (groupValue === undefined || groupValue === null || typeof groupValue === "string")
      && (!!groupId || !env.environmentGroup);
    const creator = object(props.createdBy);
    const creatorId = typeof props.createdBy === "string" ? text(props.createdBy) : text(creator.id);
    const cachedCreator = peekUser(creatorId);
    apps.push({
      ...app, environmentId: envId, environmentName: text(env.displayName) || app.environmentName,
      createdBy: creatorId ? id(creatorId) : "", creatorName: text(creator.displayName)
        || (cachedCreator.status === "resolved" ? cachedCreator.user.displayName : ""),
      origin: text(props.origin), connectorIds: managedAppConnectorIds(props),
      environmentType: text(env.environmentType), environmentManaged: typeof env.isManaged === "boolean" ? env.isManaged : null,
      environmentMapped: !!environment, groupId, groupName: groups.get(groupId) || "",
      membershipKnown,
      acp: membershipKnown && !groupId ? "Ungrouped" : "Unable to assess",
      acpReason: membershipKnown && !groupId ? "No environment group is reported." : "Environment or group mapping is unavailable.",
      snapshotAt: "",
    });
  }
  const relevant = [...new Set(apps.filter((app) => app.membershipKnown && app.groupId && groups.has(app.groupId)).map((app) => app.groupId))];
  const assignments = new Map<string, { acp: ManagedAppAcpState; reason: string }>();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, relevant.length) }, async () => {
    while (cursor < relevant.length && !signal.aborted) {
      const groupId = relevant[cursor++];
      try {
        const result = await PowerPlatformforAdminsV2Service.ListRuleAssignmentsByEnvironmentGroupId(groupId, true, "2024-10-01");
        assignments.set(groupId, result.success ? assessManagedAppAssignment(result.data, groupId)
          : { acp: "Unable to assess", reason: `Assignment read failed: ${formatApiError(result.error)}` });
      } catch (error) { assignments.set(groupId, { acp: "Unable to assess", reason: `Assignment read failed: ${formatApiError(error)}` }); }
    }
  }));
  if (signal.aborted) return cancelled();
  const capturedAt = new Date().toISOString();
  const creatorNames = new Map(apps.filter((app) => app.createdBy && app.creatorName).map((app) => [app.createdBy, app.creatorName]));
  return { ok: true, data: {
    capturedAt,
    apps: apps.map((app) => {
      const assessed = app.membershipKnown ? assignments.get(app.groupId) : undefined;
      return { ...app, creatorName: app.creatorName || creatorNames.get(app.createdBy) || "", snapshotAt: capturedAt,
        ...(assessed ? { acp: assessed.acp, acpReason: assessed.reason } : {}) };
    }),
  } };
}

/** One snapshot per dashboard refresh, shared by its tabs/tiles; never a global tenant cache. */
export function createManagedAppsEstateSource(read = readManagedAppsEstate) {
  type Flight = { key: number; controller: AbortController; subscribers: Set<symbol>; promise: ReturnType<typeof read>; settled: boolean };
  let current: Flight | undefined;
  let cached: { key: number; data: ManagedAppsEstateSnapshot } | undefined;
  let status: ManagedAppsEstateStatus = { phase: "idle" };
  const subscribers = new Set<() => void>();
  const publish = (next: ManagedAppsEstateStatus) => { status = next; subscribers.forEach((notify) => notify()); };
  return {
    subscribe(notify: () => void) { subscribers.add(notify); return () => { subscribers.delete(notify); }; },
    getStatus: () => status,
    load(key = 0, signal?: AbortSignal): Promise<DataResult<ManagedAppsEstateSnapshot>> {
      if (signal?.aborted) return Promise.resolve(cancelled());
      if (cached?.key === key) return Promise.resolve({ ok: true, data: cached.data });
      if (!current || current.key !== key || current.controller.signal.aborted) {
        const controller = new AbortController();
        const flight: Flight = { key, controller, subscribers: new Set(), promise: read(controller.signal, key > 0), settled: false };
        current = flight;
        publish({ phase: "loading", capturedAt: cached?.data.capturedAt });
        const settled = (result?: DataResult<ManagedAppsEstateSnapshot>) => {
          flight.settled = true;
          if (current === flight) {
            if (result?.ok && !controller.signal.aborted) cached = { key, data: result.data };
            current = undefined;
            publish(controller.signal.aborted ? { phase: "idle" }
              : result?.ok ? { phase: "ready", capturedAt: result.data.capturedAt } : { phase: "error", capturedAt: cached?.data.capturedAt });
          }
        };
        void flight.promise.then(settled, () => settled());
      }
      const flight = current;
      return new Promise((resolve, reject) => {
        const subscriber = Symbol();
        flight.subscribers.add(subscriber);
        const detach = () => {
          signal?.removeEventListener("abort", abort);
          flight.subscribers.delete(subscriber);
          queueMicrotask(() => { if (!flight.settled && !flight.subscribers.size) flight.controller.abort(); });
        };
        const abort = () => { detach(); resolve(cancelled()); };
        signal?.addEventListener("abort", abort, { once: true });
        void flight.promise.then(
          (result) => { detach(); resolve(signal?.aborted ? cancelled() : result); },
          (error: unknown) => { detach(); if (signal?.aborted) resolve(cancelled()); else reject(error); },
        );
      });
    },
  };
}
export type ManagedAppsEstateSource = ReturnType<typeof createManagedAppsEstateSource>;
