/**
 * Mock skill provider.
 *
 * Bundled skills (`componenttype === 14`) carry their real file contents in
 * Dataverse file attachments that require a dedicated download flow — which
 * does not exist yet. Until it does, bundled file contents are sourced from
 * these fixtures so the explorer UI + file renderers can be validated end to
 * end.
 *
 * The fixtures under `./skills/**` are synthetic sample skills (unpacked from
 * exported skill bundles) used purely for renderer validation. Text files are
 * inlined via Vite `?raw` imports; binary assets (PDF, images, …) are exposed
 * as URLs via `?url` imports so the viewer's Download affordance has a target.
 */

import {
  buildSkillTree,
  unwrapInlineSkillData,
  type SkillFileInput,
  type SkillSummary,
} from "../skillTree";

/** Eagerly-inlined text file contents, keyed by module path. */
const rawTextFiles = import.meta.glob("./skills/**/*.{md,py,json,txt,yaml,yml,csv}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Eagerly-resolved URLs for binary assets, keyed by module path. */
const assetUrls = import.meta.glob(
  "./skills/**/*.{pdf,docx,pptx,xlsx,png,jpg,jpeg,gif}",
  { query: "?url", import: "default", eager: true },
) as Record<string, string>;

/** A single inline skill sample, mirroring a real `componenttype 9` record. */
const MOCK_SINGLE_SKILL_DATA =
  "kind: InlineAgentSkill\r\ncontent: |\r\n ---\r\n name: single-whatever-skill\r\n" +
  " description: single-whatever-skill\r\n ---\r\n <!-- bic:source=blank -->\r\n" +
  " When this skill is activated:\r\n\r\n 1. [First step or action the agent should take]\r\n" +
  " 2. [Second step or action]\r\n\r\n ## Guidelines\r\n\r\n - [Key guideline or constraint]\r\n" +
  " - [Another important consideration]\r\n\r\n ## Examples\r\n\r\n" +
  " **Example 1: [Scenario name]**\r\n - User request: \"[Example user input]\"\r\n" +
  " - Expected behavior: [How the agent should respond]\r\n\r\n ## Notes\r\n\r\n" +
  " [Any additional context, edge cases, or important information the agent should know.]\r\n";

/**
 * Strip the `./skills/<bundle>/` prefix off a glob key, returning the bundle
 * name and the file path relative to the bundle root.
 */
function splitBundleKey(key: string): { bundle: string; relPath: string } | null {
  const m = /^\.\/skills\/([^/]+)\/(.+)$/.exec(key);
  if (!m) return null;
  return { bundle: m[1], relPath: m[2] };
}

/** Group all fixture files by bundle name into {@link SkillFileInput} rows. */
function collectBundles(): Map<string, SkillFileInput[]> {
  const bundles = new Map<string, SkillFileInput[]>();

  const push = (bundle: string, input: SkillFileInput) => {
    const list = bundles.get(bundle) ?? [];
    list.push(input);
    bundles.set(bundle, list);
  };

  for (const [key, content] of Object.entries(rawTextFiles)) {
    const parsed = splitBundleKey(key);
    if (!parsed) continue;
    push(parsed.bundle, {
      path: parsed.relPath,
      content,
      size: content.length,
    });
  }

  for (const [key, url] of Object.entries(assetUrls)) {
    const parsed = splitBundleKey(key);
    if (!parsed) continue;
    push(parsed.bundle, { path: parsed.relPath, downloadUrl: url });
  }

  return bundles;
}

let bundleCache: Map<string, SkillFileInput[]> | null = null;
function bundleFiles(): Map<string, SkillFileInput[]> {
  if (!bundleCache) bundleCache = collectBundles();
  return bundleCache;
}

/**
 * Return the mock file tree for a bundled skill matched by name, or `null`
 * when no fixture matches. Matching is exact on the fixture folder name.
 */
export function getMockBundleTree(bundleName: string) {
  const files = bundleFiles().get(bundleName);
  if (!files) return null;
  return buildSkillTree(files);
}

/** Names of all available mock bundle fixtures. */
export function mockBundleNames(): string[] {
  return [...bundleFiles().keys()].sort();
}

/**
 * Return the mock file inputs (path + content/url) for a bundled skill matched
 * by name, or `null` when no fixture matches. Used by the live data layer to
 * overlay sample content onto the real bundle structure (from `componenttype
 * 14` records) until the file-download flow exists.
 */
export function getMockBundleFiles(bundleName: string): SkillFileInput[] | null {
  const files = bundleFiles().get(bundleName);
  return files ? files.map((f) => ({ ...f })) : null;
}

/**
 * A full set of mock skills (one single + every bundle fixture), used as a
 * fallback when a live `botcomponent` retrieve yields nothing so the explorer
 * always has content to validate against.
 */
export function listMockSkills(): SkillSummary[] {
  const single: SkillSummary = {
    id: "mock-single-whatever-skill",
    name: "single-whatever-skill",
    description: "single-whatever-skill",
    kind: "single",
    componentType: 9,
    tree: buildSkillTree([
      { path: "SKILL.md", content: unwrapInlineSkillData(MOCK_SINGLE_SKILL_DATA) },
    ]),
    isMock: true,
  };

  const bundles: SkillSummary[] = mockBundleNames().map((name) => ({
    id: `mock-bundle-${name}`,
    name,
    description: "",
    kind: "bundled" as const,
    componentType: 14,
    tree: getMockBundleTree(name) ?? [],
    isMock: true,
  }));

  return [single, ...bundles];
}
