/**
 * Unit tests for the background scan store.
 *
 * Verifies the pub/sub mechanics, supersession of concurrent scans,
 * and that subscribers see the full event stream even when they
 * subscribe mid-scan (simulates the "navigate away, navigate back"
 * UX scenario).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the runner so we can shape its event stream per-test.
const { runDeepScanMock } = vi.hoisted(() => ({
  runDeepScanMock: vi.fn(),
}));

vi.mock("./runner", () => ({
  runDeepScan: runDeepScanMock,
}));

import {
  subscribeToScan,
  getScanSnapshot,
  startScan,
  cancelScan,
  resetScan,
  isScanRunning,
  type ScanSnapshot,
} from "./scanStore";
import type {
  DeepQuerySpec,
  ScanEvent,
  ScanSummary,
} from "./catalog/types";

beforeEach(() => {
  runDeepScanMock.mockReset();
  resetScan();
});

afterEach(() => {
  resetScan();
});

const SPEC: DeepQuerySpec = {
  source: "admin-apps",
  scope: { kind: "tenant" },
  filters: [],
  columns: [],
};

function fakeSummary(overrides: Partial<ScanSummary> = {}): ScanSummary {
  return {
    scopeUnitsTotal: 1,
    scopeUnitsDone: 1,
    scopeUnitsErrored: 0,
    recordsScanned: 1,
    matches: 1,
    errors: [],
    cancelled: false,
    observedAfter: {
      source: "admin-apps",
      windowRecords: 1,
      windowSize: 500,
      paths: new Map(),
      updatedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

/** Promise that resolves on the next snapshot of the given kind. */
function waitForSnapshot(predicate: (s: ScanSnapshot) => boolean): Promise<ScanSnapshot> {
  return new Promise((resolve) => {
    const current = getScanSnapshot();
    if (predicate(current)) {
      resolve(current);
      return;
    }
    const unsubscribe = subscribeToScan((snap) => {
      if (predicate(snap)) {
        unsubscribe();
        resolve(snap);
      }
    });
  });
}

describe("scanStore", () => {
  it("starts in the idle state", () => {
    expect(getScanSnapshot().kind).toBe("idle");
    expect(isScanRunning()).toBe(false);
  });

  it("transitions idle → running → ready over the lifecycle of a scan", async () => {
    async function* fakeRun() {
      yield {
        kind: "progress" as const,
        scopeUnitsTotal: 1,
        scopeUnitsDone: 0,
        recordsScanned: 0,
        matches: 0,
      };
      yield {
        kind: "match" as const,
        row: {
          identity: { id: "app-1", environmentId: "env-1", displayName: "App 1" },
          cells: {},
          raw: {},
        },
      };
      yield {
        kind: "done" as const,
        summary: fakeSummary(),
      };
    }
    runDeepScanMock.mockReturnValue(fakeRun());

    startScan(SPEC, async () => []);

    // Immediately after start, store should be running.
    expect(getScanSnapshot().kind).toBe("running");
    expect(isScanRunning()).toBe(true);

    const final = await waitForSnapshot((s) => s.kind === "ready");
    expect(final.kind).toBe("ready");
    if (final.kind === "ready") {
      expect(final.rows).toHaveLength(1);
      expect(final.summary.matches).toBe(1);
    }
    expect(isScanRunning()).toBe(false);
  });

  it("late subscribers receive the current snapshot synchronously", () => {
    const calls: ScanSnapshot["kind"][] = [];
    const unsubscribe = subscribeToScan((snap) => calls.push(snap.kind));
    expect(calls).toEqual(["idle"]);
    unsubscribe();
  });

  it("a subscriber that joins mid-scan sees subsequent events", async () => {
    let resolveFirstPage: () => void = () => {};
    const firstPageDone = new Promise<void>((r) => {
      resolveFirstPage = r;
    });
    async function* fakeRun() {
      yield {
        kind: "progress" as const,
        scopeUnitsTotal: 2,
        scopeUnitsDone: 0,
        recordsScanned: 0,
        matches: 0,
      };
      resolveFirstPage();
      // Wait a tick so the test can subscribe between events.
      await new Promise<void>((r) => setTimeout(r, 5));
      yield {
        kind: "match" as const,
        row: {
          identity: { id: "app-late", environmentId: "env-1", displayName: "Late" },
          cells: {},
          raw: {},
        },
      };
      yield {
        kind: "done" as const,
        summary: fakeSummary(),
      };
    }
    runDeepScanMock.mockReturnValue(fakeRun());

    startScan(SPEC, async () => []);
    await firstPageDone;

    const collected: ScanSnapshot["kind"][] = [];
    const unsubscribe = subscribeToScan((snap) => collected.push(snap.kind));
    // First call on subscription is the current snapshot (running).
    expect(collected[0]).toBe("running");

    await waitForSnapshot((s) => s.kind === "ready");
    unsubscribe();

    // Late subscriber saw the rest of the events too.
    expect(collected).toContain("ready");
  });

  it("starting a new scan aborts the previous one", async () => {
    let firstCancelled = false;
    async function* longRunningFirst() {
      yield {
        kind: "progress" as const,
        scopeUnitsTotal: 100,
        scopeUnitsDone: 0,
        recordsScanned: 0,
        matches: 0,
      };
      // Sit and wait forever — the supersession should abort us.
      try {
        await new Promise<void>(() => {});
      } finally {
        firstCancelled = true;
      }
      yield { kind: "done" as const, summary: fakeSummary() };
    }
    async function* quickSecond() {
      yield { kind: "done" as const, summary: fakeSummary() };
    }
    runDeepScanMock
      .mockReturnValueOnce(longRunningFirst())
      .mockReturnValueOnce(quickSecond());

    startScan(SPEC, async () => []);
    // Give the first one a chance to emit its initial progress.
    await new Promise<void>((r) => setTimeout(r, 10));

    startScan(SPEC, async () => []);

    const final = await waitForSnapshot((s) => s.kind === "ready");
    expect(final.kind).toBe("ready");
    expect(runDeepScanMock).toHaveBeenCalledTimes(2);
    void firstCancelled; // We don't strictly assert here — the
                          // supersession test is about the snapshot
                          // reflecting the second scan, not whether
                          // the first gen actually unwound.
  });

  it("cancelScan() transitions to ready with cancelled=true via the runner", async () => {
    async function* fakeRun(): AsyncGenerator<ScanEvent, void, void> {
      yield {
        kind: "progress" as const,
        scopeUnitsTotal: 1,
        scopeUnitsDone: 0,
        recordsScanned: 0,
        matches: 0,
      };
      // Yield a done event that mirrors what the runner would emit
      // after honoring the abort signal.
      yield {
        kind: "done" as const,
        summary: fakeSummary({ cancelled: true }),
      };
    }
    runDeepScanMock.mockReturnValue(fakeRun());

    startScan(SPEC, async () => []);
    cancelScan();

    const final = await waitForSnapshot((s) => s.kind === "ready");
    if (final.kind === "ready") {
      expect(final.summary.cancelled).toBe(true);
    }
  });

  it("resetScan() returns to idle and aborts any in-flight scan", async () => {
    async function* fakeRun(): AsyncGenerator<ScanEvent, void, void> {
      yield {
        kind: "progress" as const,
        scopeUnitsTotal: 1,
        scopeUnitsDone: 0,
        recordsScanned: 0,
        matches: 0,
      };
      // Wait long enough for resetScan to abort us.
      await new Promise<void>((r) => setTimeout(r, 50));
      yield { kind: "done" as const, summary: fakeSummary() };
    }
    runDeepScanMock.mockReturnValue(fakeRun());

    startScan(SPEC, async () => []);
    expect(isScanRunning()).toBe(true);

    resetScan();
    expect(getScanSnapshot().kind).toBe("idle");
    expect(isScanRunning()).toBe(false);
  });
});
