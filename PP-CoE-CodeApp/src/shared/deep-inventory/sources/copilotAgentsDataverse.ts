import {
  buildFetchXml,
  retrieveRecordPage,
  type DataverseRecord,
} from "../../dataverse";
import {
  normalizeAgentEvidence,
  type OpenRecord,
} from "../agent-evidence";
import type { DeepRecord, DeepRecordIdentity } from "../catalog/types";
import type {
  DeepSource,
  ScopeUnit,
  SourceFetchContext,
  SourcePage,
} from "./types";

const CANDIDATE_BATCH_SIZE = 50;

/** Raw evidence retained for audit but hidden from discovered-property pickers. */
export const COPILOT_AGENT_OBSERVED_HIDE_PREFIXES = [
  "inventory",
  "components.records",
  "capabilities.evidence",
  "diagnostics.items",
];

const BOT_ATTRIBUTES = [
  "botid",
  "name",
  "schemaname",
  "authenticationmode",
  "ismanaged",
  "createdon",
  "modifiedon",
  "configuration",
];

const COMPONENT_ATTRIBUTES = [
  "botcomponentid",
  "parentbotid",
  "parentbotcomponentid",
  "name",
  "schemaname",
  "description",
  "componenttype",
  "data",
  "statecode",
  "statuscode",
  "ismanaged",
  "modifiedon",
];

async function* fetchCopilotAgentPages(
  scopeUnit: ScopeUnit,
  signal: AbortSignal,
  context?: SourceFetchContext
): AsyncIterable<SourcePage> {
  if (!context?.resolveCandidates) {
    throw new Error(
      "Copilot agent scan requires an Inventory API candidate resolver"
    );
  }

  const candidates = await context.resolveCandidates(
    context.spec,
    scopeUnit,
    signal
  );
  if (signal.aborted) return;
  if (candidates.length === 0) {
    yield {
      records: [],
      isLast: true,
      stats: { candidatesConsidered: 0, scopeUnitsSkipped: 1 },
    };
    return;
  }

  // Publish the Inventory API count before the first Dataverse request so a
  // flow failure does not misleadingly report that zero candidates were found.
  yield {
    records: [],
    isLast: false,
    stats: { candidatesConsidered: candidates.length },
  };

  const batches = chunk(candidates, CANDIDATE_BATCH_SIZE);
  for (let index = 0; index < batches.length; index++) {
    if (signal.aborted) return;
    const batch = batches[index];
    const ids = batch
      .map(readCandidateId)
      .filter((id): id is string => !!id);
    if (ids.length === 0) {
      yield { records: [], isLast: index === batches.length - 1 };
      continue;
    }

    const [botsResult, componentsResult] = await Promise.all([
      retrieveRecordPage({
        environmentId: scopeUnit.envId,
        pluralName: "bots",
        fetchXml: buildFetchXml({
          entity: "bot",
          attributes: BOT_ATTRIBUTES,
          conditions: [{ attribute: "botid", operator: "in", value: ids }],
          order: { attribute: "name" },
        }),
      }),
      retrieveRecordPage({
        environmentId: scopeUnit.envId,
        pluralName: "botcomponents",
        fetchXml: buildFetchXml({
          entity: "botcomponent",
          attributes: COMPONENT_ATTRIBUTES,
          conditions: [{ attribute: "parentbotid", operator: "in", value: ids }],
          order: { attribute: "name" },
        }),
      }),
    ]);

    if (!botsResult.ok) {
      throw new Error(
        `ListRows-Dataverse couldn't retrieve bots: ${botsResult.error}. Check that flow's run history and its connection permission for this environment.`
      );
    }
    if (!componentsResult.ok) {
      throw new Error(
        `ListRows-Dataverse couldn't retrieve botcomponents: ${componentsResult.error}. Check that flow's run history and its connection permission for this environment.`
      );
    }

    const botsById = indexBy(
      botsResult.data.records,
      (record) => readString(record, "botid")
    );
    const componentsByBot = groupBy(
      componentsResult.data.records,
      (record) => readString(record, "_parentbotid_value", "parentbotid")
    );

    const records = batch.map((candidate) =>
      normalizeAgentEvidence({
        inventory: candidate as OpenRecord,
        bot: botsById.get(readCandidateId(candidate)?.toLowerCase() ?? "") as
          | OpenRecord
          | undefined,
        components: (componentsByBot.get(
          readCandidateId(candidate)?.toLowerCase() ?? ""
        ) ?? []) as OpenRecord[],
      })
    ) as DeepRecord[];

    const truncatedTables = [
      botsResult.data.nextLink ? "bots" : "",
      componentsResult.data.nextLink ? "botcomponents" : "",
    ].filter(Boolean);

    yield {
      records,
      isLast: index === batches.length - 1 && truncatedTables.length === 0,
      stats: {
        sourceRecordsProcessed:
          botsResult.data.records.length + componentsResult.data.records.length,
      },
    };

    if (truncatedTables.length > 0) {
      throw new Error(
        `Dataverse returned a partial ${truncatedTables.join(
          " and "
        )} page. Narrow the candidate filters or update the passthrough flow to continue @odata.nextLink before treating non-matches as complete.`
      );
    }
  }
}

function identifyCopilotAgent(record: DeepRecord): DeepRecordIdentity | null {
  const inventory = readObject(record, "inventory");
  const id = inventory ? readString(inventory, "id") : undefined;
  if (!id) return null;
  const environmentId =
    (inventory && readString(inventory, "environmentId")) ?? "";
  return {
    id,
    environmentId,
    displayName:
      (inventory && readString(inventory, "displayName")) ?? id,
    resourceType: "microsoft.copilotstudio/agents",
  };
}

function readCandidateId(record: DeepRecord): string | undefined {
  return readString(record, "id");
}

function readString(
  record: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function readObject(
  record: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function indexBy(
  records: DataverseRecord[],
  keySelector: (record: DataverseRecord) => string | undefined
): Map<string, DataverseRecord> {
  const result = new Map<string, DataverseRecord>();
  for (const record of records) {
    const key = keySelector(record);
    if (key) result.set(key.toLowerCase(), record);
  }
  return result;
}

function groupBy(
  records: DataverseRecord[],
  keySelector: (record: DataverseRecord) => string | undefined
): Map<string, DataverseRecord[]> {
  const result = new Map<string, DataverseRecord[]>();
  for (const record of records) {
    const key = keySelector(record)?.toLowerCase();
    if (!key) continue;
    const group = result.get(key) ?? [];
    group.push(record);
    result.set(key, group);
  }
  return result;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export const copilotAgentsDataverseSource: DeepSource = {
  id: "copilot-agents-dataverse",
  label: "Copilot Studio agents (Dataverse)",
  fetch: fetchCopilotAgentPages,
  identify: identifyCopilotAgent,
  defaultColumns: [
    "components.kinds",
    "components.componentCount",
    "bot.modifiedon",
    "diagnostics.hasIssues",
  ],
};
