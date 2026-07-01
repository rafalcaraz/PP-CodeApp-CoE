import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearDataverseFileInflight,
  resetDataverseFileRunner,
  setDataverseFileRunner,
} from "../../shared/dataverse";
import {
  clearSkillFileCache,
  decodeFileResult,
  fetchSkillFileContent,
  maybeBase64ToUtf8,
  mimeForExt,
} from "./skillFiles";

/** base64 of "hello world" */
const B64_HELLO = "aGVsbG8gd29ybGQ=";

beforeEach(() => {
  clearSkillFileCache();
  clearDataverseFileInflight();
});

afterEach(() => {
  resetDataverseFileRunner();
  clearSkillFileCache();
  clearDataverseFileInflight();
});

describe("maybeBase64ToUtf8", () => {
  it("decodes a pure-base64 payload", () => {
    expect(maybeBase64ToUtf8(B64_HELLO)).toBe("hello world");
  });

  it("returns null for raw text that isn't base64", () => {
    expect(maybeBase64ToUtf8("# Heading\nsome markdown {x}")).toBeNull();
  });

  it("returns null for short strings", () => {
    expect(maybeBase64ToUtf8("abc")).toBeNull();
  });
});

describe("decodeFileResult", () => {
  it("passes raw markdown text through unchanged", () => {
    const md = "# Title\n\nHello **world**";
    expect(decodeFileResult(md, "markdown", "md")).toEqual({ content: md });
  });

  it("decodes base64 text for code files", () => {
    expect(decodeFileResult(B64_HELLO, "code", "py")).toEqual({
      content: "hello world",
    });
  });

  it("base64-encodes a raw (non-base64) binary payload for the data URL", () => {
    // A real PDF comes back as raw text starting with %PDF-1.4, not base64.
    const out = decodeFileResult("%PDF-1.4 body", "download", "pdf");
    expect(out.downloadUrl).toBe(
      `data:application/pdf;base64,${btoa("%PDF-1.4 body")}`,
    );
  });

  it("passes through an already-base64 binary payload", () => {
    const out = decodeFileResult("QUJDRUZH", "download", "pdf");
    expect(out.downloadUrl).toBe("data:application/pdf;base64,QUJDRUZH");
  });

  it("returns no downloadUrl when binary bytes were corrupted in transit", () => {
    // U+FFFD (65533) can't be a byte — signals the flow mangled the binary.
    const out = decodeFileResult("%PDF\uFFFD\uFFFD", "download", "pdf");
    expect(out.downloadUrl).toBeUndefined();
  });
});

describe("mimeForExt", () => {
  it("maps common extensions", () => {
    expect(mimeForExt("pdf")).toBe("application/pdf");
    expect(mimeForExt("PNG")).toBe("image/png");
    expect(mimeForExt("unknown")).toBe("application/octet-stream");
  });
});

describe("fetchSkillFileContent", () => {
  const ARGS = {
    environmentId: "env-1",
    recordId: "rec-1",
    render: "markdown" as const,
    ext: "md",
  };

  it("decodes a successful download", async () => {
    setDataverseFileRunner(async () => ({
      success: true,
      data: { result: "# Live content" },
    }));
    const res = await fetchSkillFileContent(ARGS);
    expect(res).toEqual({ ok: true, data: { content: "# Live content" } });
  });

  it("propagates a failed download", async () => {
    setDataverseFileRunner(async () => ({ success: true, data: { result: "ERROR" } }));
    const res = await fetchSkillFileContent(ARGS);
    expect(res.ok).toBe(false);
  });

  it("memoizes per env+record", async () => {
    const spy = vi.fn(async () => ({ success: true, data: { result: "x body" } }));
    setDataverseFileRunner(spy);
    await fetchSkillFileContent(ARGS);
    await fetchSkillFileContent(ARGS);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("reports an error when a binary download can't be decoded", async () => {
    setDataverseFileRunner(async () => ({
      success: true,
      data: { result: "%PDF\uFFFD\uFFFD" },
    }));
    const res = await fetchSkillFileContent({
      environmentId: "env-1",
      recordId: "pdf-rec",
      render: "download",
      ext: "pdf",
    });
    expect(res.ok).toBe(false);
  });

  it("builds a data URL for a raw binary download", async () => {
    setDataverseFileRunner(async () => ({
      success: true,
      data: { result: "%PDF-1.4 x" },
    }));
    const res = await fetchSkillFileContent({
      environmentId: "env-1",
      recordId: "pdf-rec-2",
      render: "download",
      ext: "pdf",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.downloadUrl).toBe(
        `data:application/pdf;base64,${btoa("%PDF-1.4 x")}`,
      );
    }
  });
});
