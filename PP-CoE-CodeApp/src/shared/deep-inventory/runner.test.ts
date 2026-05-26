/**
 * Unit tests for the deep-scan runner.
 *
 * Mocks the source by inlining a fake into the SOURCES registry so the
 * runner exercises end-to-end (fetch → flatten → introspect → filter
 * → project → yield) without touching the real connector.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted handles for the fake source — set per-test so cases can
// shape the iterable behavior however they need.
const { fakeFetchMock, fakeIdentifyMock, clearCacheMock } = vi.hoisted(() => ({
  fakeFetchMock: vi.fn(),
  fakeIdentifyMock: vi.fn(),
  clearCacheMock: vi.fn(),
}));

vi.mock("./sources", () => ({
  SOURCES: {
    "admin-apps": {
      id: "admin-apps",
      label: "Apps (admin scope)",
      fetch: fakeFetchMock,
      identify: fakeIdentifyMock,
      defaultColumns: ["name"],
      flattenOptions: undefined,
    },
  },
  getSource: () => ({
    id: "admin-apps",
    label: "Apps (admin scope)",
    fetch: fakeFetchMock,
    identify: fakeIdentifyMock,
    defaultColumns: ["name"],
    flattenOptions: undefined,
  }),
}));

// Stub localStorage between tests so observed-schema persistence
// doesn't bleed across cases.
const { localStorageMock } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    localStorageMock: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      __reset: () => store.clear(),
    },
  };
});

import { runDeepScan } from "./runner";
import { cacheClear } from "./cache";
import type { DeepQuerySpec, ScanEvent } from "./catalog/types";
import type { ScopeResolver } from "./runner";

void clearCacheMock;

beforeEach(() => {
  fakeFetchMock.mockReset();
  fakeIdentifyMock.mockReset();
  cacheClear();
  localStorageMock.__reset();
  // Replace global localStorage just for this test file. jsdom
  // already provides one, but we replace with our reset-able stub
  // so the runner's observed-schema persistence doesn't leak.
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
});

// Helpers --------------------------------------------------------------

async function* makePages(records: unknown[][]) {
  for (let i = 0; i < records.length; i++) {
    yield { records: records[i] as Record<string, unknown>[], isLast: i === records.length - 1 };
  }
}

const RESOLVE_TWO_ENVS: ScopeResolver = async () => [
  { envId: "env-A", envName: "Env A" },
  { envId: "env-B", envName: "Env B" },
];

const SPEC: DeepQuerySpec = {
  source: "admin-apps",
  scope: { kind: "tenant" },
  filters: [
    { path: "properties.embeddedApp.type", op: "eq", value: "SharepointFormApp" },
  ],
  columns: ["properties.embeddedApp.type"],
};

async function collect(
  generator: AsyncGenerator<ScanEvent, void, void>
): Promise<ScanEvent[]> {
  const events: ScanEvent[] = [];
  for await (const ev of generator) events.push(ev);
  return events;
}

// ---------------------------------------------------------------------

describe("runDeepScan", () => {
  it("emits matches for records that satisfy the filter", async () => {
    fakeFetchMock
      .mockReturnValueOnce(
        makePages([
          [
            { name: "app-1", properties: { embeddedApp: { type: "SharepointFormApp" } } },
            { name: "app-2", properties: { embeddedApp: { type: "TeamsApp" } } },
          ],
        ])
      )
      .mockReturnValueOnce(
        makePages([
          [
            { name: "app-3", properties: { embeddedApp: { type: "SharepointFormApp" } } },
          ],
        ])
      );
    fakeIdentifyMock.mockImplementation((record: { name: string }, unit: { envId: string }) => ({
      id: record.name,
      environmentId: unit.envId,
      displayName: record.name,
    }));

    const events = await collect(runDeepScan(SPEC, RESOLVE_TWO_ENVS, { concurrency: 1 }));
    const matches = events.filter((e) => e.kind === "match");
    expect(matches).toHaveLength(2);
    const done = events.find((e) => e.kind === "done");
    expect(done?.kind).toBe("done");
    if (done?.kind === "done") {
      expect(done.summary.matches).toBe(2);
      expect(done.summary.recordsScanned).toBe(3);
      expect(done.summary.scopeUnitsDone).toBe(2);
      expect(done.summary.cancelled).toBe(false);
    }
  });

  it("emits a scopeUnitError when a fetch throws but continues with remaining envs", async () => {
    async function* throwing() {
      yield { records: [], isLast: false };
      throw new Error("Forbidden");
    }
    fakeFetchMock
      .mockReturnValueOnce(throwing())
      .mockReturnValueOnce(
        makePages([
          [{ name: "ok", properties: { embeddedApp: { type: "SharepointFormApp" } } }],
        ])
      );
    fakeIdentifyMock.mockImplementation((record: { name: string }, unit: { envId: string }) => ({
      id: record.name,
      environmentId: unit.envId,
      displayName: record.name,
    }));
    const events = await collect(runDeepScan(SPEC, RESOLVE_TWO_ENVS, { concurrency: 1 }));
    const errors = events.filter((e) => e.kind === "scopeUnitError");
    const matches = events.filter((e) => e.kind === "match");
    expect(errors).toHaveLength(1);
    expect(matches).toHaveLength(1);
  });

  it("returns a single done event when scope resolution throws", async () => {
    const events = await collect(
      runDeepScan(SPEC, async () => {
        throw new Error("nope");
      })
    );
    expect(events).toHaveLength(1);
    if (events[0].kind === "done") {
      expect(events[0].summary.errors[0].message).toContain("nope");
      expect(events[0].summary.scopeUnitsTotal).toBe(0);
    }
  });

  it("aborts gracefully when the signal fires before any fetch starts", async () => {
    const controller = new AbortController();
    controller.abort();
    const events = await collect(
      runDeepScan(SPEC, RESOLVE_TWO_ENVS, { signal: controller.signal })
    );
    const done = events.find((e) => e.kind === "done");
    expect(done?.kind).toBe("done");
    if (done?.kind === "done") {
      expect(done.summary.cancelled).toBe(true);
    }
  });

  it("treats records lacking identity as drops", async () => {
    fakeFetchMock
      .mockReturnValueOnce(
        makePages([
          [
            { name: "named", properties: { embeddedApp: { type: "SharepointFormApp" } } },
            { properties: { embeddedApp: { type: "SharepointFormApp" } } }, // no name
          ],
        ])
      )
      .mockReturnValueOnce(makePages([[]]));
    fakeIdentifyMock.mockImplementation((record: { name?: string }, unit: { envId: string }) =>
      record.name ? { id: record.name, environmentId: unit.envId, displayName: record.name } : null
    );
    const events = await collect(runDeepScan(SPEC, RESOLVE_TWO_ENVS, { concurrency: 1 }));
    expect(events.filter((e) => e.kind === "match")).toHaveLength(1);
  });

  it("returns no matches when filters exclude every record", async () => {
    fakeFetchMock.mockReturnValue(
      makePages([
        [{ name: "x", properties: { embeddedApp: { type: "TeamsApp" } } }],
      ])
    );
    fakeIdentifyMock.mockImplementation((record: { name: string }, unit: { envId: string }) => ({
      id: record.name,
      environmentId: unit.envId,
      displayName: record.name,
    }));
    const events = await collect(
      runDeepScan({ ...SPEC }, async () => [{ envId: "env-A" }])
    );
    expect(events.filter((e) => e.kind === "match")).toHaveLength(0);
    const done = events.find((e) => e.kind === "done");
    if (done?.kind === "done") {
      expect(done.summary.recordsScanned).toBe(1);
      expect(done.summary.matches).toBe(0);
    }
  });
});
