import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearDataverseFileInflight,
  downloadDataverseFile,
  resetDataverseFileRunner,
  setDataverseFileRunner,
} from "./index";
import type { DataverseFileRawResult } from "./flowContract";

const REQ = { environmentId: "env-1", recordId: "rec-1" };

const runMock = vi.fn<() => Promise<DataverseFileRawResult>>();

beforeEach(() => {
  runMock.mockReset();
  clearDataverseFileInflight();
  setDataverseFileRunner(() => runMock());
});

afterEach(() => {
  clearDataverseFileInflight();
  resetDataverseFileRunner();
});

describe("downloadDataverseFile - input passthrough", () => {
  it("forwards environmentId and recordId to the runner", async () => {
    const spy = vi.fn(async () => ({ success: true, data: { result: "hi" } }));
    setDataverseFileRunner(spy);
    await downloadDataverseFile(REQ);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith({ environmentId: "env-1", recordId: "rec-1" });
  });
});

describe("downloadDataverseFile - success", () => {
  it("returns the raw result string verbatim (no JSON parsing)", async () => {
    runMock.mockResolvedValue({ success: true, data: { result: "# Title\nbody" } });
    const res = await downloadDataverseFile(REQ);
    expect(res).toEqual({ ok: true, data: "# Title\nbody" });
  });
});

describe("downloadDataverseFile - failure modes", () => {
  it("treats the literal ERROR sentinel as a failure", async () => {
    runMock.mockResolvedValue({ success: true, data: { result: "ERROR" } });
    const res = await downloadDataverseFile(REQ);
    expect(res.ok).toBe(false);
  });

  it("treats empty content as a failure", async () => {
    runMock.mockResolvedValue({ success: true, data: { result: "" } });
    const res = await downloadDataverseFile(REQ);
    expect(res.ok).toBe(false);
  });

  it("maps success=false to a failure", async () => {
    runMock.mockResolvedValue({ success: false, error: "boom" });
    const res = await downloadDataverseFile(REQ);
    expect(res).toEqual({ ok: false, error: "boom" });
  });

  it("catches a rejected runner promise", async () => {
    runMock.mockRejectedValue(new Error("network down"));
    const res = await downloadDataverseFile(REQ);
    expect(res).toEqual({ ok: false, error: "network down" });
  });
});

describe("downloadDataverseFile - inflight dedupe", () => {
  it("collapses concurrent downloads of the same record into one call", async () => {
    let resolve: (v: DataverseFileRawResult) => void = () => {};
    runMock.mockReturnValue(
      new Promise<DataverseFileRawResult>((r) => {
        resolve = r;
      }),
    );
    const p1 = downloadDataverseFile(REQ);
    const p2 = downloadDataverseFile(REQ);
    resolve({ success: true, data: { result: "shared" } });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(runMock).toHaveBeenCalledOnce();
    expect(r1).toEqual({ ok: true, data: "shared" });
    expect(r2).toEqual({ ok: true, data: "shared" });
  });
});
