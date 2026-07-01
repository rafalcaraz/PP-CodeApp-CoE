/**
 * Agent Skills — pure model + tree helpers.
 *
 * This module is intentionally dependency-free (it imports nothing from the
 * Dataverse client or the mock provider) so both the live data layer
 * (`./skills`) and the mock provider (`./_mock/mockSkills`) can share the same
 * node model and tree builder without an import cycle.
 *
 * Skill packaging in Copilot Studio `botcomponent` records:
 *
 *  - **`componenttype === 9`** is a skill *definition* record — the parent for
 *    BOTH single and bundled skills (and, confusingly, other tool kinds too).
 *    The `data` field disambiguates via its leading `kind:`:
 *      - `kind: InlineAgentSkill` + `content: |` block → **single** skill; the
 *        whole markdown body is inline. We unwrap it into a virtual `SKILL.md`.
 *      - `kind: InlineAgentSkill` + `content: <!-- bic:bundle=… -->` →
 *        **bundled** skill parent; its files are separate `componenttype 14`
 *        child records.
 *      - `kind: ConnectorTool` (and anything else) → NOT a skill; ignored.
 *  - **`componenttype === 14`** is an individual *file inside a bundle*. It is
 *    linked to its parent definition via `_parentbotcomponentid_value`, carries
 *    the file's relative path in `name` (e.g. `./scripts/foo.py`), and stores
 *    the bytes as a Dataverse file attachment (`filedata` blob id). Retrieving
 *    those bytes needs a file-download flow that does not exist yet, so bundle
 *    file contents are overlaid from mock fixtures where a sample matches.
 *
 * See {@link parseSkillData} for the `data`-field discrimination and
 * {@link normalizeBundlePath} for the `name` → relative-path normalization.
 */

/** Discriminates the two skill packaging shapes. */
export type SkillKind = "single" | "bundled";

/** How the file viewer should present a given file. */
export type SkillFileRender = "markdown" | "code" | "download";

/** A single file within a skill. */
export interface SkillFileNode {
  kind: "file";
  /** Leaf name, e.g. `molina_summary.py`. */
  name: string;
  /** Path relative to the skill root, e.g. `scripts/molina_summary.py`. */
  path: string;
  /** Lower-cased extension without the dot, e.g. `py`. Empty when none. */
  ext: string;
  /** How the viewer should render this file. */
  render: SkillFileRender;
  /**
   * `botcomponentid` of the source file record (`componenttype 14`), when this
   * file's bytes must be fetched live via the download flow. Undefined for
   * inline single-skill files (their content is already present).
   */
  recordId?: string;
  /** Text content when we have it (single-skill inline, or mock text files). */
  content?: string;
  /** Object URL for download-only files (mock assets), when available. */
  downloadUrl?: string;
  /** Byte size when known. */
  size?: number;
}

/** A folder grouping other nodes within a skill. */
export interface SkillFolderNode {
  kind: "folder";
  name: string;
  /** Path relative to the skill root, e.g. `scripts`. */
  path: string;
  children: SkillNode[];
}

export type SkillNode = SkillFileNode | SkillFolderNode;

/** A single skill belonging to an agent, plus its file tree. */
export interface SkillSummary {
  /** `botcomponentid` — unique; safe as part of a React key. */
  id: string;
  /** Skill display name (the `name` column). */
  name: string;
  /** Skill description (the `description` column), may be empty. */
  description: string;
  kind: SkillKind;
  /** Raw `componenttype` of the *definition* record (9 for single & bundled). */
  componentType: number;
  /** Top-level nodes of this skill's file tree. */
  tree: SkillNode[];
  /**
   * True when the file contents are mock placeholders rather than live data.
   * Bundled skills are always mock for now (no download flow); single skills
   * are live (their content is inline on the record).
   */
  isMock: boolean;
}

/** Componenttype of a skill *definition* record (single or bundled parent). */
export const SKILL_COMPONENT_TYPE_DEFINITION = 9;
/** Componenttype of an individual *file* inside a bundled skill. */
export const SKILL_COMPONENT_TYPE_BUNDLE_FILE = 14;

/** Lower-cased extension (no dot) of a file path, or "" when none. */
export function extOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** Extensions we render as syntax-free monospace code blocks. */
const CODE_EXTS = new Set([
  "py",
  "json",
  "txt",
  "js",
  "ts",
  "tsx",
  "jsx",
  "yaml",
  "yml",
  "csv",
  "sh",
  "ps1",
  "xml",
  "html",
  "css",
  "sql",
  "toml",
  "ini",
  "cfg",
  "env",
]);

/** Decide how the viewer should present a file with the given extension. */
export function renderForExt(ext: string): SkillFileRender {
  if (ext === "md" || ext === "markdown") return "markdown";
  if (CODE_EXTS.has(ext)) return "code";
  return "download";
}

/** Input row for {@link buildSkillTree}. */
export interface SkillFileInput {
  /** Path relative to the skill root (POSIX separators). */
  path: string;
  content?: string;
  downloadUrl?: string;
  size?: number;
  /** Source file record id for live download; see {@link SkillFileNode.recordId}. */
  recordId?: string;
}

/**
 * Build a nested folder/file tree from a flat list of relative file paths.
 *
 * Folders are inferred from path segments. Within a level, folders sort before
 * files, each alphabetically (case-insensitive), so the tree reads like a
 * conventional file explorer.
 */
export function buildSkillTree(files: SkillFileInput[]): SkillNode[] {
  const root: SkillFolderNode = { kind: "folder", name: "", path: "", children: [] };

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let cursor = root;
    // Walk / create intermediate folders.
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const folderPath = segments.slice(0, i + 1).join("/");
      let next = cursor.children.find(
        (c): c is SkillFolderNode => c.kind === "folder" && c.name === segment,
      );
      if (!next) {
        next = { kind: "folder", name: segment, path: folderPath, children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    }
    const leaf = segments[segments.length - 1];
    const ext = extOf(leaf);
    cursor.children.push({
      kind: "file",
      name: leaf,
      path: segments.join("/"),
      ext,
      render: renderForExt(ext),
      recordId: file.recordId,
      content: file.content,
      downloadUrl: file.downloadUrl,
      size: file.size,
    });
  }

  sortNodes(root.children);
  return root.children;
}

/** Recursively sort: folders first, then files; each alphabetical. */
function sortNodes(nodes: SkillNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  for (const n of nodes) {
    if (n.kind === "folder") sortNodes(n.children);
  }
}

/**
 * Unwrap a single-skill `data` field into raw markdown.
 *
 * The `data` column looks like:
 *
 *   kind: InlineAgentSkill
 *   content: |
 *    ---
 *    name: single-whatever-skill
 *    ...
 *
 * The markdown body lives under the `content: |` YAML block literal, indented
 * by a common amount (one space in observed payloads). This strips the wrapper
 * and de-indents the block. If no `content:` block marker is found, the input
 * is returned trimmed (best-effort fallback).
 */
export function unwrapInlineSkillData(data: string): string {
  if (!data) return "";
  const lines = data.replace(/\r\n/g, "\n").split("\n");
  const markerIdx = lines.findIndex((l) => {
    const t = l.trimStart();
    return /^content:\s*[|>][+-]?\s*$/.test(t);
  });
  if (markerIdx === -1) return data.replace(/\r\n/g, "\n").trim();

  const block = lines.slice(markerIdx + 1);
  while (block.length > 0 && block[block.length - 1].trim() === "") block.pop();
  while (block.length > 0 && block[0].trim() === "") block.shift();

  const indents = block
    .filter((l) => l.trim() !== "")
    .map((l) => (l.match(/^ */)?.[0].length ?? 0));
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
  return block.map((l) => l.slice(minIndent)).join("\n");
}

/**
 * Split leading YAML frontmatter (`--- … ---`) off a markdown string.
 * Returns the parsed key/value frontmatter and the remaining body. Frontmatter
 * parsing is intentionally shallow (flat `key: value` pairs only) — enough to
 * recover `name` / `description` for display.
 */
export function splitFrontmatter(markdown: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!match) return { frontmatter: {}, body: normalized };

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (kv) frontmatter[kv[1]] = kv[2].trim();
  }
  return { frontmatter, body: normalized.slice(match[0].length) };
}

/** Shape of a skill definition record's `data` field, after discrimination. */
export interface ParsedSkillData {
  /** The `kind:` value, e.g. `InlineAgentSkill` or `ConnectorTool`. */
  kind: string;
  /** True only when `kind === "InlineAgentSkill"` (i.e. an actual skill). */
  isSkill: boolean;
  /**
   * Packaging shape:
   *  - `inline`  → single skill; `markdown` holds the unwrapped body.
   *  - `bundle`  → bundled skill; `bundleRef` holds the referenced file id.
   *  - `unknown` → not a skill (e.g. a ConnectorTool) or unrecognized `data`.
   */
  shape: "inline" | "bundle" | "unknown";
  /** Unwrapped markdown body, present when `shape === "inline"`. */
  markdown?: string;
  /** Bundle file reference (`bic:bundle=…`), present when `shape === "bundle"`. */
  bundleRef?: string;
}

/**
 * Discriminate a skill *definition* record's (`componenttype 9`) `data` field.
 *
 * Observed `data` shapes:
 *
 *   kind: InlineAgentSkill        kind: InlineAgentSkill              kind: ConnectorTool
 *   content: |                    content: <!-- bic:bundle=REF -->    authMode: Invoker
 *    <inline markdown…>                                               connectorId: …
 *
 * Only `kind: InlineAgentSkill` records are skills. Among those, a `bic:bundle`
 * marker means bundled (files are separate `componenttype 14` children); an
 * indented `content: |` block means single (markdown is inline).
 */
export function parseSkillData(data: string): ParsedSkillData {
  const normalized = (data ?? "").replace(/\r\n/g, "\n");
  const kind = /^\s*kind:\s*(.+)$/m.exec(normalized)?.[1].trim() ?? "";
  if (kind !== "InlineAgentSkill") {
    return { kind, isSkill: false, shape: "unknown" };
  }
  const bundle = /content:\s*<!--\s*bic:bundle=(\S+?)\s*-->/.exec(normalized);
  if (bundle) {
    return { kind, isSkill: true, shape: "bundle", bundleRef: bundle[1] };
  }
  return { kind, isSkill: true, shape: "inline", markdown: unwrapInlineSkillData(data) };
}

/**
 * Normalize a bundle file record's `name` (e.g. `./scripts/foo.py`) into a
 * skill-root-relative POSIX path (`scripts/foo.py`) suitable for
 * {@link buildSkillTree}. Strips a single leading `./` or `/`.
 */
export function normalizeBundlePath(name: string): string {
  return (name ?? "").trim().replace(/^\.?\//, "").replace(/^\/+/, "");
}
