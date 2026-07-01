import { describe, it, expect } from "vitest";
import {
  extOf,
  renderForExt,
  buildSkillTree,
  unwrapInlineSkillData,
  splitFrontmatter,
  parseSkillData,
  normalizeBundlePath,
  type SkillFolderNode,
  type SkillFileNode,
} from "./skillTree";

describe("extOf", () => {
  it("returns the lower-cased extension", () => {
    expect(extOf("scripts/Foo.PY")).toBe("py");
    expect(extOf("SKILL.md")).toBe("md");
  });
  it("returns empty for no extension or dotfiles", () => {
    expect(extOf("Makefile")).toBe("");
    expect(extOf(".gitignore")).toBe("");
  });
});

describe("renderForExt", () => {
  it("maps markdown, code and download buckets", () => {
    expect(renderForExt("md")).toBe("markdown");
    expect(renderForExt("py")).toBe("code");
    expect(renderForExt("json")).toBe("code");
    expect(renderForExt("pdf")).toBe("download");
    expect(renderForExt("docx")).toBe("download");
    expect(renderForExt("")).toBe("download");
  });
});

describe("buildSkillTree", () => {
  it("nests folders and sorts folders before files", () => {
    const tree = buildSkillTree([
      { path: "SKILL.md", content: "# hi" },
      { path: "scripts/b.py", content: "b" },
      { path: "scripts/a.py", content: "a" },
      { path: "evals/evals.json", content: "{}" },
    ]);
    // folders (evals, scripts) come before the SKILL.md file
    expect(tree.map((n) => n.name)).toEqual(["evals", "scripts", "SKILL.md"]);
    const scripts = tree.find((n) => n.name === "scripts") as SkillFolderNode;
    expect(scripts.kind).toBe("folder");
    expect(scripts.children.map((c) => c.name)).toEqual(["a.py", "b.py"]);
    const skillMd = tree.find((n) => n.name === "SKILL.md") as SkillFileNode;
    expect(skillMd.render).toBe("markdown");
    expect(skillMd.path).toBe("SKILL.md");
  });

  it("carries downloadUrl and size through", () => {
    const tree = buildSkillTree([
      { path: "assets/logo.pdf", downloadUrl: "blob:abc", size: 100 },
    ]);
    const assets = tree[0] as SkillFolderNode;
    const file = assets.children[0] as SkillFileNode;
    expect(file.render).toBe("download");
    expect(file.downloadUrl).toBe("blob:abc");
    expect(file.size).toBe(100);
  });
});

describe("unwrapInlineSkillData", () => {
  it("unwraps the content block and de-indents", () => {
    const data =
      "kind: InlineAgentSkill\r\ncontent: |\r\n ---\r\n name: s\r\n ---\r\n # Title\r\n body\r\n";
    const md = unwrapInlineSkillData(data);
    expect(md).toContain("---\nname: s\n---");
    expect(md).toContain("# Title");
    expect(md).toContain("body");
    // no leading single-space indentation should remain
    expect(md.split("\n").every((l) => !l.startsWith(" "))).toBe(true);
  });

  it("returns trimmed input when no content marker is present", () => {
    expect(unwrapInlineSkillData("just some text")).toBe("just some text");
    expect(unwrapInlineSkillData("")).toBe("");
  });
});

describe("splitFrontmatter", () => {
  it("parses flat frontmatter and returns the body", () => {
    const { frontmatter, body } = splitFrontmatter(
      "---\nname: My Skill\ndescription: does things\n---\n# Heading\ntext",
    );
    expect(frontmatter.name).toBe("My Skill");
    expect(frontmatter.description).toBe("does things");
    expect(body).toBe("# Heading\ntext");
  });

  it("returns the whole string when there is no frontmatter", () => {
    const { frontmatter, body } = splitFrontmatter("# Heading");
    expect(frontmatter).toEqual({});
    expect(body).toBe("# Heading");
  });
});

describe("parseSkillData", () => {
  it("detects an inline single skill and unwraps its markdown", () => {
    const parsed = parseSkillData(
      "kind: InlineAgentSkill\r\ncontent: |\r\n ---\r\n name: s\r\n ---\r\n # Title\r\n body\r\n",
    );
    expect(parsed.isSkill).toBe(true);
    expect(parsed.shape).toBe("inline");
    expect(parsed.markdown).toContain("# Title");
  });

  it("detects a bundled skill and captures the bundle ref", () => {
    const parsed = parseSkillData(
      "kind: InlineAgentSkill\r\ncontent: <!-- bic:bundle=crc44_x.file.zip_abc -->",
    );
    expect(parsed.isSkill).toBe(true);
    expect(parsed.shape).toBe("bundle");
    expect(parsed.bundleRef).toBe("crc44_x.file.zip_abc");
    expect(parsed.markdown).toBeUndefined();
  });

  it("flags a ConnectorTool as not a skill", () => {
    const parsed = parseSkillData(
      "kind: ConnectorTool\r\nauthMode: Invoker\r\noperationId: InvokeHttp",
    );
    expect(parsed.kind).toBe("ConnectorTool");
    expect(parsed.isSkill).toBe(false);
    expect(parsed.shape).toBe("unknown");
  });

  it("handles empty / unknown data", () => {
    expect(parseSkillData("").isSkill).toBe(false);
    expect(parseSkillData("random text").shape).toBe("unknown");
  });
});

describe("normalizeBundlePath", () => {
  it("strips a leading ./ or /", () => {
    expect(normalizeBundlePath("./SKILL.md")).toBe("SKILL.md");
    expect(normalizeBundlePath("./scripts/foo.py")).toBe("scripts/foo.py");
    expect(normalizeBundlePath("/scripts/foo.py")).toBe("scripts/foo.py");
    expect(normalizeBundlePath("SKILL.md")).toBe("SKILL.md");
  });
});
