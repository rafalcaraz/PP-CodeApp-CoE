import { beforeEach, describe, expect, it, vi } from "vitest";

const { listAgentsPageMock } = vi.hoisted(() => ({
  listAgentsPageMock: vi.fn(),
}));

vi.mock("../../data/inventory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/inventory")>();
  return {
    ...actual,
    listAgentsPage: listAgentsPageMock,
    listEnvironments: vi.fn(),
    listEnvironmentsInGroup: vi.fn(),
  };
});

import {
  getAgentCandidateCatalog,
  listSavedAgentCandidateQueries,
  previewAgentCandidates,
  resolveAgentCandidates,
} from "./data";
import type { DeepQuerySpec } from "./data";
import { ResourceType } from "../../data/inventory";
import { createSavedQuery } from "../../data/savedQueries";

const BASE_SPEC: DeepQuerySpec = {
  source: "copilot-agents-dataverse",
  scope: { kind: "env", envId: "env-1" },
  filters: [],
  columns: [],
};

beforeEach(() => {
  listAgentsPageMock.mockReset();
  localStorage.clear();
});

describe("resolveAgentCandidates", () => {
  it("pages inventory agents and applies candidate filters before enrichment", async () => {
    listAgentsPageMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          rows: [
            { id: "agent-1", isCLIAgent: true },
            { id: "agent-2", isCLIAgent: false },
          ],
          skipToken: "next",
          totalRecords: 3,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          rows: [{ id: "agent-3", isCLIAgent: true }],
          skipToken: undefined,
          totalRecords: 3,
        },
      });

    const rows = await resolveAgentCandidates(
      {
        ...BASE_SPEC,
        candidateFilters: [
          { path: "isCLIAgent", op: "eq", value: true },
        ],
      },
      { envId: "env-1" },
      new AbortController().signal,
    );

    expect(rows.map((row) => row.id)).toEqual(["agent-1", "agent-3"]);
    expect(listAgentsPageMock).toHaveBeenNthCalledWith(
      2,
      { environmentId: "env-1" },
      "next",
      500,
      2,
    );
  });

  it("surfaces Inventory API failures as environment errors", async () => {
    listAgentsPageMock.mockResolvedValueOnce({
      ok: false,
      error: "Inventory unavailable",
    });

    await expect(
      resolveAgentCandidates(
        BASE_SPEC,
        { envId: "env-1" },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/Inventory unavailable/);
  });

  it("stops before calling inventory when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      resolveAgentCandidates(BASE_SPEC, { envId: "env-1" }, controller.signal),
    ).resolves.toEqual([]);
    expect(listAgentsPageMock).not.toHaveBeenCalled();
  });

  it("uses the Queries agent field catalog for candidate filters", () => {
    const catalog = getAgentCandidateCatalog();

    expect(catalog.length).toBeGreaterThan(15);
    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Schema name", path: "schemaName" }),
        expect.objectContaining({ label: "Model", path: "model" }),
        expect.objectContaining({ label: "Owner ID", path: "ownerId" }),
        expect.objectContaining({
          label: "Distinct flows",
          path: "distinctFlows",
        }),
      ]),
    );
  });

  it("loads compatible saved visual agent queries as candidate filters", () => {
    createSavedQuery({
      name: "Custom agents",
      description: "",
      source: "builder",
      clauses: [],
      spec: {
        resourceTypes: [ResourceType.CopilotStudioAgent],
        filters: [
          {
            field: "properties.schemaName",
            op: "!startswith",
            value: "msdyn_",
          },
          {
            field: "properties.isCLIAgent",
            op: "==",
            value: "true",
          },
        ],
        orderField: "properties.lastPublishedAt",
        orderDirection: "desc",
        limit: 50,
      },
    });

    expect(listSavedAgentCandidateQueries()).toEqual([
      expect.objectContaining({
        name: "Custom agents",
        filters: [
          { path: "schemaName", op: "notStartsWith", value: "msdyn_" },
          { path: "isCLIAgent", op: "eq", value: true },
        ],
      }),
    ]);
  });

  it("previews matching agents without invoking Dataverse", async () => {
    listAgentsPageMock.mockResolvedValueOnce({
      ok: true,
      data: {
        rows: [
          {
            id: "agent-1",
            displayName: "Agent One",
            environmentId: "env-1",
            environmentName: "Environment One",
            isCLIAgent: true,
          },
          {
            id: "agent-2",
            displayName: "Agent Two",
            environmentId: "env-1",
            environmentName: "Environment One",
            isCLIAgent: false,
          },
        ],
        skipToken: undefined,
        totalRecords: 2,
      },
    });

    const preview = await previewAgentCandidates(
      {
        ...BASE_SPEC,
        candidateFilters: [
          { path: "isCLIAgent", op: "eq", value: true },
        ],
      },
      new AbortController().signal,
    );

    expect(preview).toMatchObject({
      count: 1,
      countBeforeFilters: 2,
      environmentsScanned: 1,
      environmentsTotal: 1,
      sample: [
        {
          id: "agent-1",
          displayName: "Agent One",
          environmentId: "env-1",
          environmentName: "Environment One",
        },
      ],
      errors: [],
      filterDiagnostics: [
        {
          path: "isCLIAgent",
          matched: 1,
          observedValues: { true: 1, false: 1 },
        },
      ],
    });
  });
});
