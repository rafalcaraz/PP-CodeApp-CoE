import { describe, it, expect, vi, afterEach } from "vitest";
import {
  normalizeOrgUrl,
  dataverseFileValueUrl,
  triggerUrlDownload,
  downloadTextFile,
} from "./skillDownload";

describe("normalizeOrgUrl", () => {
  it("strips trailing slashes and whitespace", () => {
    expect(normalizeOrgUrl("https://contoso.crm.dynamics.com/")).toBe(
      "https://contoso.crm.dynamics.com",
    );
    expect(normalizeOrgUrl("  https://contoso.crm.dynamics.com//  ")).toBe(
      "https://contoso.crm.dynamics.com",
    );
  });

  it("leaves a clean URL untouched", () => {
    expect(normalizeOrgUrl("https://contoso.crm.dynamics.com")).toBe(
      "https://contoso.crm.dynamics.com",
    );
  });
});

describe("dataverseFileValueUrl", () => {
  it("builds the botcomponent filedata $value link", () => {
    expect(
      dataverseFileValueUrl(
        "https://ralop-molina.crm.dynamics.com",
        "7ef7ffdb-fa8c-48f4-b2c9-e36b7049813f",
      ),
    ).toBe(
      "https://ralop-molina.crm.dynamics.com/api/data/v9.2/botcomponents(7ef7ffdb-fa8c-48f4-b2c9-e36b7049813f)/filedata/$value",
    );
  });

  it("does not produce a double slash when the org URL has a trailing slash", () => {
    expect(dataverseFileValueUrl("https://x.crm.dynamics.com/", "abc")).toBe(
      "https://x.crm.dynamics.com/api/data/v9.2/botcomponents(abc)/filedata/$value",
    );
  });
});

describe("triggerUrlDownload", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clicks a hidden anchor with the href and download name", () => {
    const click = vi.fn();
    const anchor = {
      href: "",
      download: "",
      rel: "",
      click,
      remove: vi.fn(),
    } as unknown as HTMLAnchorElement;
    vi.spyOn(document, "createElement").mockReturnValue(anchor);
    vi.spyOn(document.body, "appendChild").mockImplementation(
      (n) => n as Node,
    );

    triggerUrlDownload("blob:xyz", "file.md");

    expect(anchor.href).toBe("blob:xyz");
    expect(anchor.download).toBe("file.md");
    expect(click).toHaveBeenCalledOnce();
  });
});

describe("downloadTextFile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an object URL for a text blob and triggers a download", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:abc");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.fn();
    const anchor = {
      href: "",
      download: "",
      rel: "",
      click,
      remove: vi.fn(),
    } as unknown as HTMLAnchorElement;
    vi.spyOn(document, "createElement").mockReturnValue(anchor);
    vi.spyOn(document.body, "appendChild").mockImplementation(
      (n) => n as Node,
    );

    downloadTextFile("# hello", "readme.md");

    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toContain("text/plain");
    expect(anchor.download).toBe("readme.md");
    expect(click).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
