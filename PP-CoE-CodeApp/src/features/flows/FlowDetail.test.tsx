/**
 * Smoke test for FlowDetail. Flows don't currently have a
 * supplemental admin enrichment card, so this is a straightforward
 * load → render assertion with the three terminal states.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

vi.mock("../../features/flows/data", async () => {
  const actual = await vi.importActual<
    typeof import("../../features/flows/data")
  >("../../features/flows/data");
  return { ...actual, getFlow: vi.fn() };
});

import { FlowDetail } from "../../features/flows/FlowDetail";
import { getFlow } from "../../features/flows/data";

function flowRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "flow-1",
    type: "microsoft.flow/flows",
    displayName: "Weekly Reminder",
    environmentId: "env-1",
    environmentName: "Production",
    tenantId: "tenant-1",
    ownerId: "00000000-0000-0000-0000-000000000001",
    ownerDisplayName: "Alice Maker",
    region: "unitedstates",
    createdAt: "2024-01-01T00:00:00Z",
    lastModifiedAt: "2024-09-01T00:00:00Z",
    createdBy: "",
    status: "Started",
    flowTriggerType: "Recurrence",
    trigger: null,
    triggerOperationId: "",
    triggerKind: "",
    workflowEntityId: "",
    connectors: [],
    ...overrides,
  };
}

function renderFlowDetail(flowId = "flow-1") {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={[`/flows/${flowId}`]}>
        <Routes>
          <Route path="/flows/:flowId" element={<FlowDetail />} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
}

describe("FlowDetail smoke", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads and renders the flow display name", async () => {
    vi.mocked(getFlow).mockResolvedValue({
      ok: true,
      data: { row: flowRow() as never, raw: {} },
    });
    renderFlowDetail();
    await waitFor(() => {
      expect(screen.getAllByText("Weekly Reminder").length).toBeGreaterThan(0);
    });
    expect(getFlow).toHaveBeenCalledWith("flow-1");
  });

  it("renders a human-readable trigger summary for Recurrence flows", async () => {
    vi.mocked(getFlow).mockResolvedValue({
      ok: true,
      data: { row: flowRow({ flowTriggerType: "Recurrence" }) as never, raw: {} },
    });
    renderFlowDetail();
    await waitFor(() => {
      expect(
        screen.getByText(/Runs on a recurring schedule/i),
      ).toBeInTheDocument();
    });
  });

  it("renders the missing-state pane when getFlow returns ok:true but no data", async () => {
    vi.mocked(getFlow).mockResolvedValue({ ok: true, data: null });
    renderFlowDetail();
    await waitFor(() => {
      expect(screen.getByText("Flow not found")).toBeInTheDocument();
    });
  });

  it("renders the error-state ErrorPane when getFlow fails", async () => {
    vi.mocked(getFlow).mockResolvedValue({ ok: false, error: "boom" });
    renderFlowDetail();
    await waitFor(() => {
      expect(screen.getByText("Couldn't load flow")).toBeInTheDocument();
    });
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});
