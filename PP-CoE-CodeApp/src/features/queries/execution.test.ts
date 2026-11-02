import { beforeEach, describe, expect, it, vi } from "vitest";
const { runRawQuery } = vi.hoisted(() => ({ runRawQuery: vi.fn() }));
vi.mock("../../data/inventory", async (original) => ({ ...await original<typeof import("../../data/inventory")>(), runRawQuery }));
import { appendPage, createExecution, drainExecution, nextPage } from "./execution";
import type { Clause } from "../../generated/models/PowerPlatformforAdminsV2Model";
const row = (name: string, env = "a") => ({ name, type: "test", properties: { environmentId: env } });
const page = (items: unknown[], skipToken?: string) => ({ items, skipToken, totalRecords: 1 });
beforeEach(() => runRawQuery.mockReset());
describe("execution-owned pagination", () => {
  it("uses both cumulative offset and token, ignoring approximate totals", async () => {
    let e = createExecution("draft-a", [{ $type: "where" } as Clause], 2);
    runRawQuery.mockResolvedValueOnce({ ok: true, data: page([row("1"), row("2")], "t1") })
      .mockResolvedValueOnce({ ok: true, data: page([row("3")], "t2") })
      .mockResolvedValueOnce({ ok: true, data: page([row("4")]) });
    const first = await nextPage(e);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    e = first.execution;
    const result = await drainExecution(e, vi.fn(), () => false);
    expect(runRawQuery.mock.calls.map((c) => c[1])).toEqual([
      { Top: 2, Skip: 0, SkipToken: "" }, { Top: 2, Skip: 2, SkipToken: "t1" }, { Top: 2, Skip: 3, SkipToken: "t2" },
    ]);
    expect(result.execution.rows).toHaveLength(4);
    expect(result.execution.complete).toBe(true);
  });
  it("snapshots clauses and separates identical IDs across environments", () => {
    const clauses = [{ $type: "where" } as Clause];
    const e = createExecution("a", clauses, 50);
    clauses.push({ $type: "count" } as Clause);
    const first = appendPage(e, page([row("1"), row("1", "b")], "t"));
    const next = appendPage(first, page([row("1"), row("2")]));
    expect(e.clauses).toHaveLength(1);
    expect(next.rows).toHaveLength(3);
    expect(next.offset).toBe(4);
  });
  it("halts repeated/cyclic tokens and no-progress pages without claiming completion", () => {
    const e = appendPage(createExecution("a", [], 10), page([row("1")], "t"));
    const repeated = appendPage(e, page([row("2")], "t"));
    expect(repeated.warning).toMatch(/repeated/);
    expect(repeated.token).toBeUndefined();
    expect(repeated.complete).toBe(false);
    expect(appendPage(e, page([], "new")).warning).toMatch(/no new rows/);
    expect(appendPage(e, page([row("1")], "new")).warning).toMatch(/no new rows/);
  });
  it("does not deduplicate projected or aggregate rows by partial resource identity", () => {
    const e = createExecution("a", [{ $type: "project" } as Clause], 50);
    const same = row("same");
    const result = appendPage(appendPage(e, page([same], "t")), page([same]));
    expect(result.rows).toHaveLength(2);
  });
  it("preserves useful rows and token on request errors for explicit partial export/retry", async () => {
    const e = appendPage(createExecution("a", [], 10), page([row("1")], "t"));
    runRawQuery.mockResolvedValue({ ok: false, error: "429" });
    const result = await drainExecution(e, vi.fn(), () => false);
    expect(result.error).toContain("429");
    expect(result.execution).toBe(e);
    expect(result.execution.complete).toBe(false);
  });
  it("surfaces the safety cap instead of pretending all rows were fetched", async () => {
    const e = appendPage(createExecution("a", [], 1), page([row("1")], "t1"));
    runRawQuery.mockResolvedValue({ ok: true, data: page([row("2")], "t2") });
    const result = await drainExecution(e, vi.fn(), () => false, 1);
    expect(result.error).toMatch(/safety limit/);
    expect(result.execution.complete).toBe(false);
  });
  it("cancels without committing late pages", async () => {
    const e = appendPage(createExecution("a", [], 1), page([row("1")], "t1"));
    const progress = vi.fn();
    let cancelled = false;
    runRawQuery.mockImplementation(async () => { cancelled = true; return { ok: true, data: page([row("2")]) }; });
    const result = await drainExecution(e, progress, () => cancelled);
    expect(result.cancelled).toBe(true);
    expect(progress).not.toHaveBeenCalled();
    expect(result.execution.rows).toHaveLength(1);
  });
});
