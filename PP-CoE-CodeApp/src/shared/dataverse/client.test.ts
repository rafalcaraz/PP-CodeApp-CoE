import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearDataverseInflight,
  mockDataverseRunner,
  resetDataverseRunner,
  retrieveRecords,
  setDataverseRunner,
} from "./index";
import type { DataverseFlowRawResult } from "./flowContract";

const REQ = {
  environmentId: "env-1",
  pluralName: "solutions",
  fetchXml: "<fetch><entity name=\"solution\"><all-attributes /></entity></fetch>",
};

// A controllable runner the tests swap in for each case. We inject via
// setDataverseRunner rather than vi.mock-ing a generated module because the
// real flow service doesn't exist in the project yet.
const runMock = vi.fn<() => Promise<DataverseFlowRawResult>>();

beforeEach(() => {
  runMock.mockReset();
  clearDataverseInflight();
  setDataverseRunner(() => runMock());
});

afterEach(() => {
  clearDataverseInflight();
  resetDataverseRunner();
});

describe("retrieveRecords - input passthrough", () => {
  it("forwards environmentId, pluralName and fetchXml to the runner", async () => {
    const spy = vi.fn(async () => ({
      success: true,
      data: { response: JSON.stringify({ value: [] }) },
    }));
    setDataverseRunner(spy);
    await retrieveRecords(REQ);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith({
      environmentId: "env-1",
      pluralName: "solutions",
      fetchXml: REQ.fetchXml,
    });
  });
});

describe("retrieveRecords - happy path", () => {
  it("parses the OData value array and returns {ok:true, data}", async () => {
    const rows = [{ solutionid: "a", uniquename: "X" }];
    runMock.mockResolvedValueOnce({
      success: true,
      data: { response: JSON.stringify({ value: rows }) },
    });
    const res = await retrieveRecords(REQ);
    expect(res).toEqual({ ok: true, data: rows });
  });

  it("returns an empty array when the table has no records", async () => {
    runMock.mockResolvedValueOnce({
      success: true,
      data: { response: JSON.stringify({ value: [] }) },
    });
    const res = await retrieveRecords(REQ);
    expect(res).toEqual({ ok: true, data: [] });
  });
});

describe("retrieveRecords - failure modes", () => {
  it("rejected promise -> ok:false with the error message", async () => {
    runMock.mockRejectedValueOnce(new Error("Network blew up"));
    const res = await retrieveRecords(REQ);
    expect(res).toEqual({ ok: false, error: "Network blew up" });
  });

  it("success:false -> ok:false (uses error message if present)", async () => {
    runMock.mockResolvedValueOnce({
      success: false,
      error: { message: "Connection unauthorized" },
    });
    const res = await retrieveRecords(REQ);
    expect(res).toEqual({ ok: false, error: "Connection unauthorized" });
  });

  it("success:false with no error payload -> generic message", async () => {
    runMock.mockResolvedValueOnce({ success: false });
    const res = await retrieveRecords(REQ);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/success=false/i);
  });

  it("success:true with no data -> empty-response error", async () => {
    runMock.mockResolvedValueOnce({ success: true });
    const res = await retrieveRecords(REQ);
    expect(res).toEqual({ ok: false, error: "Empty response from Dataverse flow" });
  });

  it("success:true with empty response string -> empty-response error", async () => {
    runMock.mockResolvedValueOnce({ success: true, data: { response: "" } });
    const res = await retrieveRecords(REQ);
    expect(res).toEqual({ ok: false, error: "Empty response from Dataverse flow" });
  });

  it("success:true with HTML body -> non-JSON error with preview", async () => {
    runMock.mockResolvedValueOnce({
      success: true,
      data: { response: "<html><body>500 Internal Server Error - upstream failure</body></html>" },
    });
    const res = await retrieveRecords(REQ);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/Non-JSON/);
      expect(res.error).toMatch(/500 Internal Server Error/);
    }
  });

  it("success:true with JSON error envelope -> ok:false with envelope message", async () => {
    runMock.mockResolvedValueOnce({
      success: true,
      data: {
        response: JSON.stringify({
          error: { code: "0x80040217", message: "The table does not exist" },
        }),
      },
    });
    const res = await retrieveRecords(REQ);
    expect(res).toEqual({ ok: false, error: "The table does not exist" });
  });

  it("success:true with statusCode>=400 + message -> formatted HTTP error", async () => {
    runMock.mockResolvedValueOnce({
      success: true,
      data: { response: JSON.stringify({ statusCode: 404, message: "Not Found" }) },
    });
    const res = await retrieveRecords(REQ);
    expect(res).toEqual({ ok: false, error: "HTTP 404: Not Found" });
  });

  it("success:true with JSON lacking any records array -> shape error", async () => {
    runMock.mockResolvedValueOnce({
      success: true,
      data: { response: JSON.stringify({ notValue: 1 }) },
    });
    const res = await retrieveRecords(REQ);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/could not find a records array/);
  });

  it("result of literal 'ERROR' -> ok:false with a clear message", async () => {
    runMock.mockResolvedValueOnce({ success: true, data: { response: "ERROR" } });
    const res = await retrieveRecords(REQ);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/ERROR/);
  });
});

describe("retrieveRecords - record-array shapes", () => {
  const rows = [{ solutionid: "a" }, { solutionid: "b" }];

  it("accepts a bare array", async () => {
    runMock.mockResolvedValueOnce({
      success: true,
      data: { response: JSON.stringify(rows) },
    });
    const res = await retrieveRecords(REQ);
    expect(res).toEqual({ ok: true, data: rows });
  });

  it("accepts an OData { value: [...] } collection", async () => {
    runMock.mockResolvedValueOnce({
      success: true,
      data: { response: JSON.stringify({ value: rows }) },
    });
    const res = await retrieveRecords(REQ);
    expect(res).toEqual({ ok: true, data: rows });
  });

  it("accepts a double-encoded { value: \"[...]\" } collection", async () => {
    runMock.mockResolvedValueOnce({
      success: true,
      data: { response: JSON.stringify({ value: JSON.stringify(rows) }) },
    });
    const res = await retrieveRecords(REQ);
    expect(res).toEqual({ ok: true, data: rows });
  });

  it("accepts records nested under a `result` key", async () => {
    runMock.mockResolvedValueOnce({
      success: true,
      data: { response: JSON.stringify({ result: rows }) },
    });
    const res = await retrieveRecords(REQ);
    expect(res).toEqual({ ok: true, data: rows });
  });

  it("returns an empty array for an empty bare array", async () => {
    runMock.mockResolvedValueOnce({
      success: true,
      data: { response: "[]" },
    });
    const res = await retrieveRecords(REQ);
    expect(res).toEqual({ ok: true, data: [] });
  });
});

describe("retrieveRecords - in-flight dedupe", () => {
  it("two concurrent identical requests merge into one runner invocation", async () => {
    let resolveFn!: (v: DataverseFlowRawResult) => void;
    runMock.mockImplementationOnce(
      () =>
        new Promise<DataverseFlowRawResult>((resolve) => {
          resolveFn = resolve;
        }),
    );

    const p1 = retrieveRecords(REQ);
    const p2 = retrieveRecords(REQ);
    resolveFn({ success: true, data: { response: JSON.stringify({ value: [] }) } });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(runMock).toHaveBeenCalledOnce();
    expect(r1).toEqual({ ok: true, data: [] });
    expect(r2).toEqual({ ok: true, data: [] });
  });

  it("different tables do NOT merge", async () => {
    runMock.mockResolvedValue({
      success: true,
      data: { response: JSON.stringify({ value: [] }) },
    });
    await Promise.all([
      retrieveRecords({ environmentId: "env-1", pluralName: "solutions", fetchXml: "<fetch/>" }),
      retrieveRecords({ environmentId: "env-1", pluralName: "publishers", fetchXml: "<fetch/>" }),
    ]);
    expect(runMock).toHaveBeenCalledTimes(2);
  });

  it("after the inflight resolves, a subsequent identical call re-invokes", async () => {
    runMock.mockResolvedValue({
      success: true,
      data: { response: JSON.stringify({ value: [] }) },
    });
    await retrieveRecords(REQ);
    await retrieveRecords(REQ);
    expect(runMock).toHaveBeenCalledTimes(2);
  });
});

describe("retrieveRecords - mock runner", () => {
  it("returns the solutions fixture when the mock runner is active", async () => {
    setDataverseRunner(mockDataverseRunner);
    const res = await retrieveRecords(REQ);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.length).toBeGreaterThan(0);
      expect(res.data.some((r) => r.uniquename === "PPCoECodeApp")).toBe(true);
    }
  });
});
