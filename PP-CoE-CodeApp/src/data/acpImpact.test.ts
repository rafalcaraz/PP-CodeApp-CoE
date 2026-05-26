/**
 * Unit tests for the ACP Impact helpers in `acpImpact.ts`.
 *
 * The async `queryAcpImpact` orchestrator is tested via integration
 * tests (mocking runImpactQuery + listEnvironmentsInGroup). These
 * unit tests focus on the pure `enrichWithOperationMetadata` logic
 * and the summary computation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { queryAcpImpact, type AcpImpactResult } from "./acpImpact";

// Mock the async dependencies so we can drive `queryAcpImpact` end-to-end
// with controlled data.
vi.mock("./inventory", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    listEnvironmentsInGroup: vi.fn(),
    friendlyConnectorName: (slug: string) => slug,
  };
});

vi.mock("./dlpImpact", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    runImpactQuery: vi.fn(),
  };
});

import { listEnvironmentsInGroup } from "./inventory";
import { runImpactQuery, type DlpImpactRow } from "./dlpImpact";

const mockListEnvs = vi.mocked(listEnvironmentsInGroup);
const mockRunImpact = vi.mocked(runImpactQuery);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<DlpImpactRow> & { _rawConnectors?: unknown[] }): DlpImpactRow {
  const row: DlpImpactRow = {
    id: "res-1",
    type: "microsoft.powerautomate/cloudflows",
    displayName: "My Flow",
    environmentId: "env-1",
    environmentName: "Dev",
    ownerId: "user-1",
    ownerDisplayName: "User One",
    lastModifiedAt: "2024-01-01T00:00:00Z",
    detailHref: "",
    ...overrides,
  };
  if (overrides._rawConnectors) {
    Object.defineProperty(row, "_rawConnectors", {
      value: overrides._rawConnectors,
      enumerable: false,
    });
  }
  return row;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("queryAcpImpact – operation filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all rows when no operationId filter", async () => {
    mockListEnvs.mockResolvedValue({
      ok: true,
      data: [{ id: "env-1" }] as never[],
    });
    const row = makeRow({
      _rawConnectors: [
        {
          connectorId: "/providers/Microsoft.PowerApps/apis/shared_sql",
          operations: [{ operationId: "GetItems" }],
        },
      ],
    });
    mockRunImpact.mockResolvedValue({
      ok: true,
      data: {
        rows: [row],
        summary: {
          totalResources: 1,
          byType: { "microsoft.powerautomate/cloudflows": 1 },
          environmentCount: 1,
          ownerCount: 1,
        },
      },
    });
    const res = await queryAcpImpact("group-1", "Group 1", "sql");
    expect(res.ok).toBe(true);
    const data = (res as { ok: true; data: AcpImpactResult }).data;
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].usedAs).toBe("");
  });

  it("filters to only rows that have the specified operation", async () => {
    mockListEnvs.mockResolvedValue({
      ok: true,
      data: [{ id: "env-1" }] as never[],
    });
    const rowWithOp = makeRow({
      id: "flow-with-op",
      _rawConnectors: [
        {
          connectorId: "shared_sql",
          operations: [
            { operationId: "GetItems", usedAs: "Tool" },
            { operationId: "DeleteItem" },
          ],
        },
      ],
    });
    const rowWithoutOp = makeRow({
      id: "flow-without-op",
      _rawConnectors: [
        {
          connectorId: "shared_sql",
          operations: [{ operationId: "CreateRecord" }],
        },
      ],
    });
    mockRunImpact.mockResolvedValue({
      ok: true,
      data: {
        rows: [rowWithOp, rowWithoutOp],
        summary: {
          totalResources: 2,
          byType: { "microsoft.powerautomate/cloudflows": 2 },
          environmentCount: 1,
          ownerCount: 1,
        },
      },
    });
    const res = await queryAcpImpact("group-1", "Group 1", "sql", "GetItems");
    expect(res.ok).toBe(true);
    const data = (res as { ok: true; data: AcpImpactResult }).data;
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].id).toBe("flow-with-op");
    expect(data.rows[0].usedAs).toBe("Tool");
    expect(data.summary.totalResources).toBe(1);
    expect(data.ranAgainst.operationId).toBe("GetItems");
  });

  it("case-insensitive operation matching", async () => {
    mockListEnvs.mockResolvedValue({
      ok: true,
      data: [{ id: "env-1" }] as never[],
    });
    const row = makeRow({
      _rawConnectors: [
        {
          connectorId: "shared_sql",
          operations: [{ operationId: "GetItems" }],
        },
      ],
    });
    mockRunImpact.mockResolvedValue({
      ok: true,
      data: {
        rows: [row],
        summary: {
          totalResources: 1,
          byType: { "microsoft.powerautomate/cloudflows": 1 },
          environmentCount: 1,
          ownerCount: 1,
        },
      },
    });
    const res = await queryAcpImpact("group-1", "Group 1", "sql", "getitems");
    expect(res.ok).toBe(true);
    const data = (res as { ok: true; data: AcpImpactResult }).data;
    expect(data.rows).toHaveLength(1);
  });

  it("passes all rows through when _rawConnectors is absent", async () => {
    mockListEnvs.mockResolvedValue({
      ok: true,
      data: [{ id: "env-1" }] as never[],
    });
    // Row without _rawConnectors stash — legacy path.
    const row = makeRow({ id: "legacy-row" });
    mockRunImpact.mockResolvedValue({
      ok: true,
      data: {
        rows: [row],
        summary: {
          totalResources: 1,
          byType: { "microsoft.powerautomate/cloudflows": 1 },
          environmentCount: 1,
          ownerCount: 1,
        },
      },
    });
    const res = await queryAcpImpact("group-1", "Group 1", "sql", "GetItems");
    expect(res.ok).toBe(true);
    const data = (res as { ok: true; data: AcpImpactResult }).data;
    // Falls through because no _rawConnectors — can't filter.
    expect(data.rows).toHaveLength(1);
  });

  it("returns empty group short-circuit", async () => {
    mockListEnvs.mockResolvedValue({
      ok: true,
      data: [],
    });
    const res = await queryAcpImpact("group-1", "Group 1", "sql");
    expect(res.ok).toBe(true);
    const data = (res as { ok: true; data: AcpImpactResult }).data;
    expect(data.rows).toHaveLength(0);
    expect(data.ranAgainst.effectiveEnvCount).toBe(0);
  });
});
