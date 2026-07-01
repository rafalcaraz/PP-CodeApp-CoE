/**
 * Agents feature — Skills data layer.
 *
 * Copilot Studio agents that support **skills** store them as Dataverse
 * `botcomponent` records parented to the bot (`parentbotid`). This layer
 * retrieves those records via the generic passthrough (`shared/dataverse`),
 * discriminates them, and maps them into feature-shaped {@link SkillSummary}
 * trees.
 *
 * Record roles (see {@link parseSkillData}):
 *  - **`componenttype 9`** — a skill *definition* record (the parent for both
 *    single and bundled skills). Its `data` field's `kind:` disambiguates:
 *      - `InlineAgentSkill` + inline `content: |` → **single** skill (markdown
 *        inline in `data`; rendered live).
 *      - `InlineAgentSkill` + `content: <!-- bic:bundle=… -->` → **bundled**
 *        skill parent (its files are `componenttype 14` children).
 *      - `ConnectorTool` / anything else → NOT a skill; filtered out.
 *  - **`componenttype 14`** — an individual *file inside a bundle*, linked to
 *    its parent via `_parentbotcomponentid_value`, with the relative path in
 *    `name` and the bytes in a `filedata` blob. Those bytes are fetched live via
 *    the download flow when a file is selected (see `./skillFiles`); the tree
 *    itself only needs the structure (paths) + each file's `recordId`.
 *
 * We optimistically try to retrieve botcomponents for any agent. When the
 * retrieve errors the error is surfaced; when it returns no skill components the
 * result is simply an empty skill list.
 *
 * ── Missing / deferred (see plan.md) ──────────────────────────────────────
 *  1. The inventory/schema property that marks an agent as skills-capable is
 *     not yet known; callers currently assume every agent is capable.
 *
 * NOTE: Mock fixtures (`./_mock/mockSkills`) are intentionally left on disk but
 * are no longer wired into this live path. Re-import them here if you need to
 * temporarily validate renderers without a live connection.
 */

import {
  buildFetchXml,
  retrieveRecords,
  type DataverseRecord,
  type DataverseResult,
} from "../../shared/dataverse";
import {
  buildSkillTree,
  normalizeBundlePath,
  parseSkillData,
  SKILL_COMPONENT_TYPE_BUNDLE_FILE,
  SKILL_COMPONENT_TYPE_DEFINITION,
  type SkillFileInput,
  type SkillSummary,
} from "./skillTree";

/** Dataverse entity-set (plural) name for bot components. */
export const BOTCOMPONENTS_PLURAL_NAME = "botcomponents";
/** Dataverse logical (singular) entity name for bot components. */
export const BOTCOMPONENT_ENTITY_NAME = "botcomponent";

/** Result of retrieving an agent's skills. */
export interface AgentSkillsResult {
  skills: SkillSummary[];
  /**
   * Reserved advisory flag for when sample/mock skills are surfaced instead of
   * live data. Mocks are currently detached from the live path, so this is
   * always `false`; kept so the UI banner can be re-enabled if mocks are
   * temporarily re-wired.
   */
  usedMockFallback: boolean;
  /** Optional human-readable note (e.g. why a fallback engaged). */
  note?: string;
}

function str(rec: DataverseRecord, key: string): string {
  const v = rec[key];
  return typeof v === "string" ? v : "";
}

function num(rec: DataverseRecord, key: string): number | undefined {
  const v = rec[key];
  return typeof v === "number" ? v : undefined;
}

/** Map an inline single-skill definition record to a SkillSummary. */
function toSingleSkill(rec: DataverseRecord, markdown: string): SkillSummary {
  const name = str(rec, "name") || "Untitled skill";
  return {
    id: str(rec, "botcomponentid") || name,
    name,
    description: str(rec, "description"),
    kind: "single",
    componentType: num(rec, "componenttype") ?? SKILL_COMPONENT_TYPE_DEFINITION,
    tree: buildSkillTree([{ path: "SKILL.md", content: markdown }]),
    isMock: false,
  };
}

/**
 * Map a bundled-skill definition record + its `componenttype 14` file children
 * to a SkillSummary.
 *
 * The tree *structure* comes from the real child records (their `name` paths),
 * and each file carries its `recordId` so the viewer can fetch the bytes live
 * on demand. When the agent has no child records, the tree is empty and the
 * explorer shows a "files unavailable" leaf.
 */
function toBundledSkill(
  rec: DataverseRecord,
  fileRecs: DataverseRecord[],
): SkillSummary {
  const name = str(rec, "name") || "Untitled bundle";
  const id = str(rec, "botcomponentid") || name;

  const inputs: SkillFileInput[] = fileRecs.map((f) => ({
    path: normalizeBundlePath(str(f, "name") || str(f, "filedata_name")),
    recordId: str(f, "botcomponentid") || undefined,
  }));

  return {
    id,
    name,
    description: str(rec, "description"),
    kind: "bundled",
    componentType: num(rec, "componenttype") ?? SKILL_COMPONENT_TYPE_DEFINITION,
    tree: inputs.length > 0 ? buildSkillTree(inputs) : [],
    isMock: false,
  };
}

/**
 * Retrieve the skills for an agent.
 *
 * @param agentId        The bot GUID (`parentbotid`).
 * @param environmentId  The environment GUID the agent lives in.
 */
export async function listAgentSkills(
  agentId: string,
  environmentId: string,
): Promise<DataverseResult<AgentSkillsResult>> {
  const fetchXml = buildFetchXml({
    entity: BOTCOMPONENT_ENTITY_NAME,
    attributes: [
      "botcomponentid",
      "name",
      "description",
      "componenttype",
      "filedata_name",
      "filedata",
      "parentbotcomponentid",
      "data",
    ],
    conditions: [{ attribute: "parentbotid", operator: "eq", value: agentId }],
    order: { attribute: "name" },
  });

  const res = await retrieveRecords({
    environmentId,
    pluralName: BOTCOMPONENTS_PLURAL_NAME,
    fetchXml,
  });

  if (!res.ok) {
    // Live retrieve failed — surface the error (no mock fallback).
    return res;
  }

  // Partition: skill definitions (type 9) vs. bundle file children (type 14).
  const definitions: DataverseRecord[] = [];
  const filesByParent = new Map<string, DataverseRecord[]>();
  for (const rec of res.data) {
    const type = num(rec, "componenttype");
    if (type === SKILL_COMPONENT_TYPE_DEFINITION) {
      definitions.push(rec);
    } else if (type === SKILL_COMPONENT_TYPE_BUNDLE_FILE) {
      const parent = str(rec, "_parentbotcomponentid_value");
      if (!parent) continue;
      const list = filesByParent.get(parent) ?? [];
      list.push(rec);
      filesByParent.set(parent, list);
    }
  }

  const skills: SkillSummary[] = [];
  for (const rec of definitions) {
    const parsed = parseSkillData(str(rec, "data"));
    if (!parsed.isSkill) continue; // filter out ConnectorTool & other kinds
    if (parsed.shape === "bundle") {
      const children = filesByParent.get(str(rec, "botcomponentid")) ?? [];
      skills.push(toBundledSkill(rec, children));
    } else {
      skills.push(toSingleSkill(rec, parsed.markdown ?? ""));
    }
  }

  if (skills.length === 0) {
    // No skill components on this agent — return an empty list (the UI shows a
    // friendly "no skills" message).
    return { ok: true, data: { skills: [], usedMockFallback: false } };
  }

  skills.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  return { ok: true, data: { skills, usedMockFallback: false } };
}
