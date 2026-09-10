import { beforeEach, describe, expect, it, vi } from "vitest";

const { retrieveRecordPageMock } = vi.hoisted(() => ({
  retrieveRecordPageMock: vi.fn(),
}));

vi.mock("../../dataverse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../dataverse")>();
  return {
    ...actual,
    retrieveRecordPage: retrieveRecordPageMock,
  };
});

import { copilotAgentsDataverseSource } from "./copilotAgentsDataverse";
import type { DeepQuerySpec } from "../catalog/types";

const SPEC: DeepQuerySpec = {
  source: "copilot-agents-dataverse",
  scope: { kind: "env", envId: "env-1" },
  candidateFilters: [],
  filters: [],
  columns: [],
};

beforeEach(() => {
  retrieveRecordPageMock.mockReset();
});

async function collectPages(
  candidates: Record<string, unknown>[],
): Promise<Record<string, unknown>[][]> {
  const pages: Record<string, unknown>[][] = [];
  for await (const page of copilotAgentsDataverseSource.fetch(
    { envId: "env-1" },
    new AbortController().signal,
    {
      spec: SPEC,
      resolveCandidates: vi.fn().mockResolvedValue(candidates),
    },
  )) {
    pages.push(page.records);
  }
  return pages;
}

describe("copilotAgentsDataverseSource", () => {
  it("joins bot and botcomponent records into one agent evidence row", async () => {
    retrieveRecordPageMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          records: [
            {
              botid: "agent-1",
              configuration: JSON.stringify({
                agentSettings: { enableMemory: true },
              }),
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          records: [
            {
              botcomponentid: "component-1",
              _parentbotid_value: "agent-1",
              componenttype: 17,
              name: "Recurrence",
              data: [
                "kind: ExternalTriggerConfiguration",
                "externalTriggerSource:",
                "  kind: AgentRecurrenceTrigger",
              ].join("\n"),
            },
          ],
        },
      });

    const pages = await collectPages([
      {
        id: "agent-1",
        displayName: "Agent One",
        environmentId: "env-1",
      },
    ]);

    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual([]);
    expect(pages[1][0]).toMatchObject({
      inventory: { id: "agent-1" },
      capabilities: {
        memoryEnabled: true,
        externalTrigger: true,
        recurrenceTrigger: true,
      },
    });
    expect(retrieveRecordPageMock).toHaveBeenCalledTimes(2);
    const botRequest = retrieveRecordPageMock.mock.calls[0][0];
    expect(botRequest.fetchXml).toContain('<attribute name="configuration" />');
    expect(botRequest.fetchXml).not.toContain('<attribute name="published" />');
  });

  it("skips Dataverse when inventory filters leave no candidates", async () => {
    const pages = await collectPages([]);
    expect(pages).toEqual([[]]);
    expect(retrieveRecordPageMock).not.toHaveBeenCalled();
  });

  it("surfaces Dataverse permission failures", async () => {
    retrieveRecordPageMock
      .mockResolvedValueOnce({ ok: false, error: "Forbidden" })
      .mockResolvedValueOnce({ ok: true, data: { records: [] } });

    await expect(
      collectPages([{ id: "agent-1", environmentId: "env-1" }]),
    ).rejects.toThrow(/ListRows-Dataverse.*Forbidden/);
  });

  it("yields partial records and then fails when Dataverse reports another page", async () => {
    retrieveRecordPageMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          records: [{ botid: "agent-1" }],
          nextLink: "https://example/bots?$skiptoken=next",
        },
      })
      .mockResolvedValueOnce({ ok: true, data: { records: [] } });

    const records: Record<string, unknown>[] = [];
    let error = "";
    try {
      for await (const page of copilotAgentsDataverseSource.fetch(
        { envId: "env-1" },
        new AbortController().signal,
        {
          spec: SPEC,
          resolveCandidates: vi
            .fn()
            .mockResolvedValue([
              { id: "agent-1", environmentId: "env-1" },
            ]),
        },
      )) {
        records.push(...page.records);
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }

    expect(records).toHaveLength(1);
    expect(error).toMatch(/partial bots page/i);
  });

  it("identifies rows as Copilot Studio agents", () => {
    expect(
      copilotAgentsDataverseSource.identify(
        {
          inventory: {
            id: "agent-1",
            displayName: "Agent One",
            environmentId: "env-1",
          },
        },
        { envId: "env-1" },
      ),
    ).toEqual({
      id: "agent-1",
      environmentId: "env-1",
      displayName: "Agent One",
      resourceType: "microsoft.copilotstudio/agents",
    });
  });
});
