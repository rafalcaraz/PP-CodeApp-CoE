/**
 * Smoke test for the Agents feature.
 *
 * Renders the AgentsList view inside a MemoryRouter with the data layer
 * mocked. The goal is NOT to validate behavior — Fluent UI + DataGrid
 * are well-tested upstream — but to catch the most common regression
 * we'd hit after a refactor: a renamed prop, removed export, or broken
 * import chain that compiles cleanly under tsc but blows up at runtime.
 *
 * If you copy this pattern to other features, the formula is:
 *  1. vi.mock the feature's `./data` module BEFORE importing the view.
 *  2. Mock the cross-cutting providers your view consumes (UserChip,
 *     EnvironmentPicker, etc.) with stubs that render predictable text.
 *  3. Wrap in MemoryRouter + FluentProvider and assert at least one
 *     row renders.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { UserLookupProvider } from "../../components/UserLookupProvider";

// Mock the feature's data layer. Vitest hoists vi.mock() above imports,
// so this runs before AgentsList is loaded.
vi.mock("../../features/agents/data", async () => {
  const actual = await vi.importActual<
    typeof import("../../features/agents/data")
  >("../../features/agents/data");
  return {
    ...actual,
    listAgentsPage: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        rows: [
          {
            id: "agent-1",
            type: "microsoft.copilotstudio/agents",
            displayName: "Customer Service Bot",
            schemaName: "new_customer_service",
            environmentId: "env-1",
            environmentName: "Production",
            ownerId: "00000000-0000-0000-0000-000000000001",
            ownerDisplayName: "Alice Maker",
            createdAt: "2024-01-15T00:00:00Z",
            createdBy: "00000000-0000-0000-0000-000000000001",
            lastPublishedAt: "2024-09-01T00:00:00Z",
            region: "unitedstates",
            tenantId: "tenant-1",
            entraAppId: "",
            titleId: "",
            createdIn: "",
            authentication: "",
            orchestration: "",
            model: "",
            instructionsCharactersCount: 0,
            isWebSearchEnabledForKnowledge: false,
            channels: [],
            sharedWithEditors: { userCount: 0, groupCount: 0, entireTenant: false },
            sharedWithViewers: { userCount: 0, groupCount: 0, entireTenant: false },
            isManaged: false,
            isQuarantined: false,
            distinctConnectors: 0,
            distinctConnectorOperations: 0,
            connectors: [],
          },
        ],
        totalRecords: 1,
        skipToken: undefined,
      },
    }),
  };
});

// EnvironmentPicker hits the inventory layer too; stub it to a plain
// label so we don't pull in the cascade of dropdown + env list fetch.
vi.mock("../../components/EnvironmentPicker", () => ({
  EnvironmentPicker: () => <div data-testid="env-picker">all envs</div>,
}));

// Import AFTER vi.mock calls so the mocks take effect.
import { AgentsList } from "../../features/agents/AgentsList";

function renderAgentsList() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={["/agents"]}>
        <UserLookupProvider>
          <Routes>
            <Route path="/agents" element={<AgentsList />} />
          </Routes>
        </UserLookupProvider>
      </MemoryRouter>
    </FluentProvider>,
  );
}

describe("AgentsList smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders without throwing and surfaces the mocked agent row", async () => {
    renderAgentsList();
    // The DataGrid renders the displayName as a link.
    await waitFor(
      () => {
        expect(
          screen.getByText("Customer Service Bot"),
        ).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });
});
