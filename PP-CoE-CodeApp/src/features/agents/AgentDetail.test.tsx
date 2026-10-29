import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { FeatureFlagsProvider } from "../../featureFlags";

vi.mock("../../features/agents/data", async () => {
  const actual = await vi.importActual<
    typeof import("../../features/agents/data")
  >("../../features/agents/data");
  return { ...actual, getAgent: vi.fn() };
});

import { AgentDetail } from "../../features/agents/AgentDetail";
import { getAgent } from "../../features/agents/data";

function agentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "agent-1",
    type: "microsoft.copilotstudio/agents",
    displayName: "Copilot Agent",
    schemaName: "cr000_agent",
    ownerId: "00000000-0000-0000-0000-000000000001",
    ownerDisplayName: "Alice Maker",
    environmentId: "env-1",
    environmentName: "Production",
    createdAt: "2024-01-01T00:00:00Z",
    lastPublishedAt: "2024-09-01T00:00:00Z",
    createdBy: "user@contoso.com",
    region: "unitedstates",
    tenantId: "tenant-1",
    entraAppId: "",
    titleId: "",
    createdIn: "Copilot Studio",
    authentication: "Microsoft Entra",
    orchestration: "Generative",
    model: "Claude Sonnet 4.6",
    instructionsCharactersCount: 100,
    isWebSearchEnabledForKnowledge: true,
    isCLIAgent: true,
    connectors: [],
    channels: [],
    sharedWithEditors: { userCount: 0, groupCount: 0, entireTenant: false },
    sharedWithViewers: { userCount: 0, groupCount: 0, entireTenant: false },
    isManaged: false,
    isQuarantined: false,
    distinctConnectors: 0,
    distinctConnectorOperations: 0,
    ...overrides,
  };
}

function renderAgentDetail(route = "/agents/agent-1") {
  return render(
    <FluentProvider theme={webLightTheme}>
      <FeatureFlagsProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/agents/:agentId" element={<AgentDetail />} />
          </Routes>
        </MemoryRouter>
      </FeatureFlagsProvider>
    </FluentProvider>
  );
}

describe("AgentDetail smoke", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows new identity, harness, and quarantine metadata", async () => {
    vi.mocked(getAgent).mockResolvedValue({
      ok: true,
      data: {
        row: agentRow({
          harness: "Standard",
          botId: "bot-1",
          entraAgentId: "identity-1",
          entraAgentBlueprintId: "blueprint-1",
          quarantinedAt: "2026-10-01T10:00:00Z",
          isManaged: null,
        }) as never,
        raw: {},
      },
    });
    renderAgentDetail();
    expect(await screen.findByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("Not applicable / not reported")).toBeInTheDocument();
    expect(screen.queryByText("Unmanaged")).not.toBeInTheDocument();
    const quarantine = screen.getByText("Last quarantined").parentElement!;
    expect(within(quarantine).getByText(/2026/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Identifiers" }));
    expect(screen.getByText("bot-1")).toBeInTheDocument();
    expect(screen.getByText("identity-1")).toBeInTheDocument();
    expect(screen.getByText("blueprint-1")).toBeInTheDocument();
  });

  it.each([[true, "Managed"], [false, "Unmanaged"]] as const)(
    "distinguishes explicit managed status %s",
    async (isManaged, label) => {
      vi.mocked(getAgent).mockResolvedValue({
        ok: true,
        data: { row: agentRow({ isManaged }) as never, raw: {} },
      });
      renderAgentDetail();
      await waitFor(() => expect(screen.getAllByText(label).length).toBeGreaterThan(0));
      expect(screen.queryByText("Not applicable / not reported")).not.toBeInTheDocument();
    },
  );

  it("loads and renders the agent display name", async () => {
    vi.mocked(getAgent).mockResolvedValue({
      ok: true,
      data: { row: agentRow() as never, raw: {} },
    });
    renderAgentDetail();
    await waitFor(() => {
      expect(screen.getAllByText("Copilot Agent").length).toBeGreaterThan(0);
    });
    expect(getAgent).toHaveBeenCalledWith("agent-1", undefined);
  });

  it("passes envId from the URL query to getAgent", async () => {
    vi.mocked(getAgent).mockResolvedValue({
      ok: true,
      data: { row: agentRow() as never, raw: {} },
    });
    renderAgentDetail("/agents/agent-1?envId=env-9");
    await waitFor(() => {
      expect(screen.getAllByText("Copilot Agent").length).toBeGreaterThan(0);
    });
    expect(getAgent).toHaveBeenCalledWith("agent-1", "env-9");
  });

  it("shows the Skills card for a skills-capable (isCLIAgent) agent", async () => {
    vi.mocked(getAgent).mockResolvedValue({
      ok: true,
      data: { row: agentRow({ isCLIAgent: true }) as never, raw: {} },
    });
    renderAgentDetail();
    await waitFor(() => {
      expect(screen.getAllByText("Copilot Agent").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("Skills")).toBeInTheDocument();
  });

  it("hides the Skills card for a non-skills-capable agent", async () => {
    vi.mocked(getAgent).mockResolvedValue({
      ok: true,
      data: { row: agentRow({ isCLIAgent: false }) as never, raw: {} },
    });
    renderAgentDetail();
    await waitFor(() => {
      expect(screen.getAllByText("Copilot Agent").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("Skills")).not.toBeInTheDocument();
  });
});
