import type { Clause } from "../../generated/models/PowerPlatformforAdminsV2Model";
import { isQuerySpec } from "../../data/savedQueries";
import { ResourceType, type QuerySpec } from "../../data/inventory";

export type BuilderMode = "basic" | "advanced";
export const DEFAULT_SPEC: QuerySpec = {
  resourceTypes: [ResourceType.CanvasApp], filters: [],
  orderField: "properties.lastModifiedAt", orderDirection: "desc", limit: 50,
};
export interface WorkspaceDraft {
  version: 1;
  spec: QuerySpec;
  mode: BuilderMode;
  advancedText: string;
  advancedSeed?: string;
  loadedId?: string;
  columns?: string[];
  libraryOpen: boolean;
  search: string;
  favoritesOnly: boolean;
  exportShape?: "raw" | "columns";
}
const KEY = "ppcoe.queries.workspace.v1";
const CLAUSE_TYPES = new Set(["where", "project", "take", "orderby", "distinct", "count", "summarize", "extend", "join"]);

export function parseClausesPayload(text: string):
  { ok: true; clauses: Clause[] } | { ok: false; error: string } {
  try {
    const parsed: unknown = JSON.parse(text);
    const clauses: unknown = Array.isArray(parsed) ? parsed :
      parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).clauses : undefined;
    if (!Array.isArray(clauses) || !clauses.length) throw new Error("Expected a non-empty clauses array, or an object with a clauses array.");
    for (const [i, clause] of clauses.entries()) {
      if (!clause || typeof clause !== "object" || !CLAUSE_TYPES.has(clause.$type)) {
        throw new Error(`Clause #${i + 1} has a missing or unsupported $type.`);
      }
    }
    return { ok: true, clauses: clauses as Clause[] };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid clauses JSON." };
  }
}

export function readWorkspace(): { draft: WorkspaceDraft; warning?: string } {
  const fallback: WorkspaceDraft = {
    version: 1, spec: DEFAULT_SPEC, mode: "basic", advancedText: "",
    libraryOpen: false, search: "", favoritesOnly: false,
  };
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { draft: fallback };
    const d: unknown = JSON.parse(raw);
    if (!d || typeof d !== "object") throw new Error("Invalid workspace.");
    const v = d as Record<string, unknown>;
    if (v.version !== 1 || !isQuerySpec(v.spec) || !["basic", "advanced"].includes(String(v.mode)) ||
      typeof v.advancedText !== "string" ||
      typeof v.libraryOpen !== "boolean" || typeof v.search !== "string" || typeof v.favoritesOnly !== "boolean" ||
      (v.loadedId !== undefined && typeof v.loadedId !== "string") ||
      (v.advancedSeed !== undefined && typeof v.advancedSeed !== "string") ||
      (v.exportShape !== undefined && v.exportShape !== "raw" && v.exportShape !== "columns") ||
      (v.columns !== undefined && (!Array.isArray(v.columns) || !v.columns.every((c) => typeof c === "string")))) {
      throw new Error("Unsupported workspace.");
    }
    return { draft: { ...fallback, ...v, spec: v.spec } as WorkspaceDraft };
  } catch {
    return { draft: fallback, warning: "The previous workspace could not be restored. A fresh draft is open; saved queries are unchanged." };
  }
}
export function writeWorkspace(draft: WorkspaceDraft): void {
  sessionStorage.setItem(KEY, JSON.stringify(draft));
}
export function draftKey(spec: QuerySpec, mode: BuilderMode, advancedText: string): string {
  return JSON.stringify({ spec, mode, advancedText: mode === "advanced" ? advancedText : "" });
}
export function getPath(row: unknown, path: string): unknown {
  if (row && typeof row === "object" && Object.prototype.hasOwnProperty.call(row, path)) {
    return (row as Record<string, unknown>)[path];
  }
  return path.split(".").reduce<unknown>((value, key) =>
    value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, row);
}
export function cellText(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
export function resourceIdentity(row: unknown): { name: string; type: string; environmentId: string } | null {
  const name = getPath(row, "name");
  const type = getPath(row, "type");
  if (typeof name !== "string" || !name || typeof type !== "string" || !type) return null;
  const environment = getPath(row, "properties.environmentId");
  const environmentId = typeof environment === "string" ? environment.trim() : "";
  const environmentOwned = type.startsWith("microsoft.powerapps/") || type.startsWith("microsoft.powerautomate/") || type === ResourceType.CopilotStudioAgent;
  if (environmentOwned && !environmentId) return null;
  return { name, type, environmentId };
}
export function isProjected(clauses: Clause[]): boolean {
  return clauses.some((c) => ["project", "summarize", "count", "distinct"].includes(c.$type));
}
export function genericResultShape(rows: unknown[], clauses: Clause[]): boolean {
  return isProjected(clauses) || (rows.length > 0 && rows.every((r) => !resourceIdentity(r)));
}
export function resultColumns(rows: unknown[], clauses: Clause[], selected?: string[], defaults: string[] = []): string[] {
  if (genericResultShape(rows, clauses)) {
    return [...new Set(rows.flatMap((r) => r && typeof r === "object" ? Object.keys(r) : ["Value"]))];
  }
  return selected?.length ? selected : defaults;
}
export function resultViewKey(rows: unknown[], clauses: Clause[], resourceTypes?: string[]): string {
  const shape = genericResultShape(rows, clauses)
    ? ["returned", ...resultColumns(rows, clauses).sort()]
    : ["inventory", ...(resourceTypes ?? []).slice().sort()];
  return `ppcoe.queries.results.v1:${JSON.stringify(shape)}`;
}
