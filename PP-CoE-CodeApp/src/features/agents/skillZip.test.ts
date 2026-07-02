import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { buildSkillTree, type SkillSummary } from "./skillTree";
import {
  collectFiles,
  dataUrlToBytes,
  safeZipName,
  buildSkillZip,
  type FileBytesResolver,
} from "./skillZip";

function bundledSkill(): SkillSummary {
  return {
    id: "b1",
    name: "My Bundle",
    description: "",
    kind: "bundled",
    componentType: 9,
    tree: buildSkillTree([
      { path: "SKILL.md", recordId: "r-md" },
      { path: "scripts/run.py", recordId: "r-py" },
      { path: "assets/data.xlsx", recordId: "r-xlsx" },
    ]),
    isMock: false,
  };
}

describe("collectFiles", () => {
  it("flattens nested folders into file leaves", () => {
    const paths = collectFiles(bundledSkill().tree)
      .map((f) => f.path)
      .sort();
    expect(paths).toEqual(["SKILL.md", "assets/data.xlsx", "scripts/run.py"]);
  });
});

describe("dataUrlToBytes", () => {
  it("decodes a base64 data URL", () => {
    // "hi" → base64 "aGk="
    const bytes = dataUrlToBytes("data:application/octet-stream;base64,aGk=");
    expect(bytes && strFromU8(bytes)).toBe("hi");
  });

  it("returns null for a malformed data URL", () => {
    expect(dataUrlToBytes("not-a-data-url")).toBeNull();
  });
});

describe("safeZipName", () => {
  it("sanitizes illegal filename characters", () => {
    expect(safeZipName('a/b:c*d?"e')).toBe("a-b-c-d-e");
    expect(safeZipName("  spaced name  ")).toBe("spaced_name");
    expect(safeZipName("")).toBe("skill");
  });
});

describe("buildSkillZip", () => {
  it("zips every file with folder paths preserved", async () => {
    const resolver: FileBytesResolver = async (file) => ({
      ok: true,
      bytes: new TextEncoder().encode(`content of ${file.path}`),
    });

    const res = await buildSkillZip(bundledSkill(), "env-1", resolver);
    expect(res.ok).toBe(true);
    expect(res.filename).toBe("My_Bundle.zip");
    expect(res.errors).toHaveLength(0);

    const buf = res.bytes!;
    const unzipped = unzipSync(buf);
    expect(Object.keys(unzipped).sort()).toEqual([
      "SKILL.md",
      "assets/data.xlsx",
      "scripts/run.py",
    ]);
    expect(strFromU8(unzipped["scripts/run.py"])).toBe("content of scripts/run.py");
  });

  it("skips failed files and adds an error manifest", async () => {
    const resolver: FileBytesResolver = async (file) =>
      file.path === "assets/data.xlsx"
        ? { ok: false, error: "could not decode" }
        : { ok: true, bytes: new TextEncoder().encode("ok") };

    const res = await buildSkillZip(bundledSkill(), "env-1", resolver);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([
      { path: "assets/data.xlsx", error: "could not decode" },
    ]);

    const unzipped = unzipSync(res.bytes!);
    expect(unzipped["_download-errors.txt"]).toBeDefined();
    expect(strFromU8(unzipped["_download-errors.txt"])).toContain(
      "assets/data.xlsx: could not decode",
    );
    expect(unzipped["assets/data.xlsx"]).toBeUndefined();
  });

  it("reports failure when no file could be downloaded", async () => {
    const resolver: FileBytesResolver = async () => ({
      ok: false,
      error: "flow returned ERROR",
    });
    const res = await buildSkillZip(bundledSkill(), "env-1", resolver);
    expect(res.ok).toBe(false);
    expect(res.blob).toBeUndefined();
    expect(res.errors).toHaveLength(3);
  });
});
