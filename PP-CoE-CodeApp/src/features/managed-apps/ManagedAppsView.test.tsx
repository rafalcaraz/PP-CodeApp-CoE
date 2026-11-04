import { beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, Tab, TabList, webLightTheme } from "@fluentui/react-components";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import type { MoveOutcome, MoveProgress, MoveRecord } from "./pdeMoves";
import type { DragEndEvent } from "@dnd-kit/core";
const { drag } = vi.hoisted(() => ({ drag: { end: undefined as ((event: DragEndEvent) => void) | undefined } }));
vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return { ...actual, DndContext: (props: React.ComponentProps<typeof actual.DndContext>) => {
    drag.end = props.onDragEnd;
    return <actual.DndContext {...props} />;
  } };
});
const { executeLivePdeMoves, reconcileLivePdeMove, checkPreviousPdeMoves } = vi.hoisted(() => ({
  executeLivePdeMoves: vi.fn(), reconcileLivePdeMove: vi.fn(), checkPreviousPdeMoves: vi.fn(),
}));
vi.mock("./pdeMoveData", async () => ({
  ...await vi.importActual<typeof import("./pdeMoveData")>("./pdeMoveData"),
  executeLivePdeMoves, reconcileLivePdeMove, checkPreviousPdeMoves,
}));

const { loadManagedApps, loadGroupPolicies, loadPdeApps, loadGroupEvidenceBatch, preparePdeMoves, prepareGroupClone, executeGroupClone, newCloneOperation } = vi.hoisted(() => ({
  loadManagedApps: vi.fn(), loadGroupPolicies: vi.fn(), loadPdeApps: vi.fn(),
  loadGroupEvidenceBatch: vi.fn(), preparePdeMoves: vi.fn(), prepareGroupClone: vi.fn(),
  executeGroupClone: vi.fn(), newCloneOperation: vi.fn(),
}));
vi.mock("./groupClone", async () => ({
  ...await vi.importActual<typeof import("./groupClone")>("./groupClone"), executeGroupClone, newCloneOperation,
}));
vi.mock("./groupCloneData", async () => ({
  ...await vi.importActual<typeof import("./groupCloneData")>("./groupCloneData"), prepareGroupClone,
}));
vi.mock("./governance", async () => ({
  ...await vi.importActual<typeof import("./governance")>("./governance"),
  loadGroupEvidenceBatch, preparePdeMoves,
}));
vi.mock("./data", async () => {
  const actual = await vi.importActual<typeof import("./data")>("./data");
  return { ...actual, loadManagedApps, loadGroupPolicies, loadPdeApps };
});
vi.mock("../../components/UserChip", () => ({ UserChip: ({ id }: { id: string }) => <span>{id}</span> }));

import { ManagedAppsView } from "./ManagedAppsView";
import { ManagedAppsMoveStatus } from "./ManagedAppsMoveStatus";
import { liveMoveTask } from "./liveMoveTask";
import { pendingMoveNotice } from "./pendingMoveNotice";
import { readManagedApp } from "./data";
import type { CloneOperation, CloneOutcome } from "./groupClone";

const environment = {
  id: "pde-one", displayName: "Personal workspace", environmentType: "Developer", isManaged: true,
  environmentGroupId: "group-one", environmentGroup: "Renamed group", region: "", createdAt: "", createdBy: "", lastModifiedAt: "", tenantId: "",
};
const apps = ["Budget planner", "Travel assistant"].map((name) => readManagedApp({
  name, type: "microsoft.powerapps/apps",
  properties: { displayName: name, environmentId: "pde-one", ownerId: "owner", createdBy: { id: "maker", displayName: "Avery Maker" }, origin: "CopilotStudio" },
}));
const inventory = {
  apps, environments: [environment], excludedApps: 0,
  groups: [{ id: "group-one", displayName: "Renamed group", description: "", createdAt: "", createdBy: "", lastModifiedAt: "", location: "" }],
};
const renderView = () => render(<FluentProvider theme={webLightTheme}><MemoryRouter initialEntries={["/managed-apps"]}>
  <TabList selectedValue="managed-apps" aria-label="Persistent shell navigation"><Tab value="managed-apps">Managed apps</Tab></TabList>
  <ManagedAppsMoveStatus /><ManagedAppsView />
</MemoryRouter></FluentProvider>);
async function selectDestination() {
  const picker = screen.getByRole("combobox", { name: "Destination environment group" });
  fireEvent.click(picker);
  fireEvent.change(picker, { target: { value: "group-one" } });
  fireEvent.click(await screen.findByRole("option", { name: "Renamed group (group-one)" }));
}

beforeEach(() => {
  liveMoveTask.dismiss();
  pendingMoveNotice.dismiss("");
  vi.clearAllMocks();
  localStorage.clear();
  prepareGroupClone.mockImplementation(async (id, name) => ({ ok: true, data: {
    sourceId: id, sourcePolicyId: "source-acp", sourceRuleIds: [], sourceFingerprint: "synthetic",
    preparedAt: Date.now(), group: { displayName: name, description: "" }, rules: [],
    policy: { name: `${name} - Synthetic ACP`, ruleSets: [] }, publication: "unknown",
    copied: [], blockers: ["Source publication is unavailable. No tenant writes are allowed."],
  } }));
  loadManagedApps.mockResolvedValue({ ok: true, data: inventory });
  loadGroupPolicies.mockResolvedValue({ ok: true, data: [] });
  loadPdeApps.mockResolvedValue({ ok: true, data: apps });
  loadGroupEvidenceBatch.mockImplementation(async (ids: string[]) => Promise.all(ids.map(async (id) => ({
    groupId: id, capturedAt: Date.now(),
    details: { ok: true, data: { id, displayName: "Renamed group", description: "" } },
    rulesets: { ok: true, data: { matching: [], unresolved: [] } },
    policies: await loadGroupPolicies(id),
  }))));
  preparePdeMoves.mockResolvedValue({ ok: true, data: {
    preparedAt: Date.now(), destination: inventory.groups[0],
    pdes: [{ environmentId: environment.id, environment, status: "prepared", apps, resourceCount: apps.length, connectors: [] }],
  } });
  executeLivePdeMoves.mockRejectedValue(new Error("Unexpected execution"));
  checkPreviousPdeMoves.mockResolvedValue([]);
});

describe("ManagedAppsView", () => {
  it("reuses mounted inventory during search, filters, selection and app details", async () => {
    renderView();
    await screen.findByText("Budget planner");
    const board = screen.getByRole("region", { name: "Managed apps by environment group" });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Budget" } });
    await waitFor(() => expect(screen.queryByText("Travel assistant")).not.toBeInTheDocument());
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    await screen.findByText("Travel assistant");
    fireEvent.click(screen.getByRole("checkbox", { name: "Show empty groups" }));
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select PDE Personal workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Inspect Budget planner and connectors" }));
    await screen.findByRole("dialog");
    expect(loadPdeApps).toHaveBeenCalledWith("pde-one", true, expect.any(AbortSignal));
    expect(board).toBeInTheDocument();
    expect(loadManagedApps).toHaveBeenCalledTimes(1);
    expect(loadGroupEvidenceBatch).not.toHaveBeenCalled();
  });
  it("shares the initial board read across StrictMode cleanup while keeping explicit refresh fresh", async () => {
    render(<StrictMode><FluentProvider theme={webLightTheme}><MemoryRouter><ManagedAppsView /></MemoryRouter></FluentProvider></StrictMode>);
    await screen.findByText("Budget planner");
    expect(loadManagedApps).toHaveBeenCalledTimes(1);
    expect(loadManagedApps.mock.calls[0][1].aborted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Refresh inventory" }));
    await screen.findByText("Budget planner");
    expect(loadManagedApps).toHaveBeenCalledTimes(2);
    expect(loadManagedApps).toHaveBeenLastCalledWith(true, expect.any(AbortSignal));
  });
  it("ignores an inventory result after route unmount", async () => {
    let finish!: (value: { ok: true; data: typeof inventory }) => void;
    loadManagedApps.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const view = renderView();
    view.unmount();
    await act(async () => { finish({ ok: true, data: inventory }); });
    expect(screen.queryByText("Budget planner")).not.toBeInTheDocument();
    expect(loadGroupEvidenceBatch).not.toHaveBeenCalled();
  });
  it("continues an actual modal-started task across close, route transition and reopen without a duplicate runner", async () => {
    const groupEvidence = {
      groupId: "group-one", capturedAt: Date.now(), details: { ok: true, data: { id: "group-one" } },
      policies: { ok: true, data: [] }, rulesets: { ok: true, data: { matching: [], unresolved: [] } },
    };
    preparePdeMoves.mockResolvedValue({ ok: true, data: {
      preparedAt: Date.now(), destination: inventory.groups[0], pdes: [{
        environmentId: environment.id, environment, status: "prepared", apps, resources: apps,
        resourceCount: apps.length, connectors: [], sourceEvidence: groupEvidence, destinationEvidence: groupEvidence,
      }],
    } });
    let finish!: (value: MoveOutcome) => void;
    let progress!: (value: MoveProgress) => void;
    executeLivePdeMoves.mockImplementation((_preview, _confirmed, _recoveryIds, notify) => {
      progress = notify;
      notify({ environmentId: "pde-one", phase: "adding" });
      return new Promise((resolve) => { finish = resolve; });
    });
    render(<FluentProvider theme={webLightTheme}><MemoryRouter initialEntries={["/managed-apps"]}>
      <ManagedAppsMoveStatus />
      <Link to="/other">Other page</Link><Link to="/managed-apps">Back to managed apps</Link>
      <Routes><Route path="/managed-apps" element={<ManagedAppsView />} /><Route path="/other" element={<h1>Another page</h1>} /></Routes>
    </MemoryRouter></FluentProvider>);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select PDE Personal workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare selected PDE moves" }));
    await selectDestination();
    fireEvent.click(screen.getByRole("button", { name: "Review impact" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Move Personal workspace, including all apps and resources/ }));
    fireEvent.click(screen.getByRole("button", { name: "Move PDE" }));
    expect(await screen.findByText("Adding to destination")).toBeVisible();
    expect(screen.queryByText("Ready for review")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue in background" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("link", { name: "Other page" }));
    expect(screen.getByRole("heading", { name: "Another page" })).toBeVisible();
    act(() => progress({ environmentId: "pde-one", phase: "verifying" }));
    fireEvent.click(screen.getByRole("button", { name: "View progress" }));
    expect(screen.getByText("Personal workspace: Checking membership")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Continue in background" }));
    await screen.findByRole("link", { name: "Back to managed apps" });
    const outcome: MoveOutcome = {
      record: { version: 1, id: "synthetic-background", destinationId: "group-one", previewHash: "hash", updatedAt: Date.now(),
        pdes: [{ environmentId: "pde-one", sourceId: "group-one", phase: "verified", remove: "accepted", add: "accepted", observedGroupId: "group-one" }] },
      messages: [],
    };
    await act(async () => { finish(outcome); await Promise.resolve(); });
    expect(screen.getByText(/Move complete/)).toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: "Back to managed apps" }));
    expect(await screen.findByText("Budget planner")).toBeVisible();
    expect(loadManagedApps).toHaveBeenCalledTimes(2);
    expect(loadManagedApps).toHaveBeenLastCalledWith(false, expect.any(AbortSignal));
    expect(executeLivePdeMoves).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "View progress" }));
    expect(screen.getByText("Personal workspace: Moved")).toBeVisible();
  }, 15_000);
  it("dismisses the same pending reminder across checks, focus and remount while keeping recovery available and new state visible", async () => {
    const pending: MoveRecord = {
      version: 1, id: "synthetic-dismiss-pending", destinationId: "group-one", previewHash: "hash", updatedAt: 123,
      pdes: [{ environmentId: "pde-one", sourceId: "group-one", phase: "detached", remove: "accepted", add: "none", observedGroupId: "" }],
    };
    const key = `ppcoe:managed-apps:pde-move:v1:${pending.id}`;
    localStorage.setItem(key, JSON.stringify(pending));
    checkPreviousPdeMoves.mockResolvedValue([{ record: pending, messages: [] }]);
    const first = renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss pending move reminder" }));
    expect(screen.queryByText("A move needs attention.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Resolve pending move" }));
    expect(await screen.findByText(/Personal workspace: the previous removal completed; no add was requested/)).toBeVisible();
    expect(screen.getByText(/The original stop reason is not available/)).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    localStorage.setItem(key, JSON.stringify({ ...pending, updatedAt: 456 }));
    act(() => { window.dispatchEvent(new Event("storage")); window.dispatchEvent(new Event("focus")); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("A move needs attention.")).not.toBeInTheDocument();
    first.unmount();
    renderView();
    await screen.findByText("Budget planner");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("A move needs attention.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(await screen.findByRole("menuitem", { name: "Resolve pending move" })).toBeVisible();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Resolve pending move" }), { key: "Escape" });
    localStorage.setItem(key, JSON.stringify({ ...pending, pdes: [{ ...pending.pdes[0], phase: "indeterminate", add: "uncertain" }] }));
    act(() => window.dispatchEvent(new Event("storage")));
    expect(await screen.findByText("A move needs attention.")).toBeVisible();
    expect(JSON.parse(localStorage.getItem(key)!).pdes[0].add).toBe("uncertain");
    expect(executeLivePdeMoves).not.toHaveBeenCalled();
  });
  it("renders live membership and origins without repeated move-protocol boilerplate", async () => {
    renderView();
    expect(await screen.findByText("Budget planner")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Renamed group" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Managed apps by environment group" })).getAllByText("Copilot Studio")).toHaveLength(2);
    expect(screen.queryByText("Avery Maker")).not.toBeInTheDocument();
    expect(screen.getAllByRole("article", { name: "PDE Personal workspace" })).toHaveLength(1);
    expect(screen.getAllByRole("checkbox", { name: "Select PDE Personal workspace" })).toHaveLength(1);
    expect(screen.queryByText(/PDE moves require fresh whole-PDE/)).not.toBeInTheDocument();
    expect(loadGroupPolicies).not.toHaveBeenCalled();
  });
  it("searches makers and keeps unfiltered PDE/app counts", async () => {
    renderView();
    await screen.findByText("Budget planner");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "avery budget" } });
    expect(screen.queryByText("Travel assistant")).not.toBeInTheDocument();
    expect(screen.getByText("1 shown / 2 apps · 1 PDE")).toBeInTheDocument();
  });
  it("loads ACP only on explicit inspection and does not label missing assignments allowed", async () => {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Inspect ACP permissions" }));
    expect(await screen.findByText(/No policy assignments were returned/)).toBeInTheDocument();
    expect(loadGroupPolicies).toHaveBeenCalledWith("group-one");
  });
  it("displays policy identities separately and unknown ACP-only state", async () => {
    loadGroupPolicies.mockResolvedValue({ ok: true, data: [
      { id: "p-first", name: "First policy", ruleSets: [] },
      { id: "p-second", name: "Second policy", ruleSets: [] },
    ] });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Inspect ACP permissions" }));
    expect(await screen.findByText("Policy ID: p-first")).toBeInTheDocument();
    expect(screen.getByText("Policy ID: p-second")).toBeInTheDocument();
    expect(screen.getAllByText("ACP-only flag: Unavailable")).toHaveLength(2);
  });
  it("reports inventory failure without rendering partial board data", async () => {
    loadManagedApps.mockResolvedValue({ ok: false, error: "Inventory denied" });
    renderView();
    expect(await screen.findByText("Inventory denied")).toBeInTheDocument();
    expect(screen.queryByText("Budget planner")).not.toBeInTheDocument();
  });
  it("inspects hidden PDE apps and routes movement through preparation, never direct execution", async () => {
    renderView();
    await screen.findByText("Budget planner");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "budget" } });
    fireEvent.click(screen.getByRole("button", { name: "Actions for PDE Personal workspace" }));
    expect(await screen.findByRole("menuitem", { name: "Move environment" })).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "View all apps in environment" }));
    expect(await screen.findByText("2 apps in this PDE")).toBeInTheDocument();
    expect(screen.getByText("Travel assistant")).toBeInTheDocument();
  });
  it("refreshes rather than mutating local membership", async () => {
    renderView();
    await screen.findByText("Budget planner");
    fireEvent.click(screen.getByRole("button", { name: "Refresh inventory" }));
    await waitFor(() => expect(loadManagedApps).toHaveBeenLastCalledWith(true, expect.any(AbortSignal)));
    await waitFor(() => expect(loadGroupEvidenceBatch).toHaveBeenCalledWith(["group-one"], expect.any(AbortSignal)));
  });
  it("keeps the verified destination link visible after clone completion refresh closes the drawer", async () => {
    prepareGroupClone.mockResolvedValue({ ok: true, data: {
      sourceId: "group-one", sourcePolicyId: "source-policy", sourceRuleIds: [], sourceFingerprint: "synthetic",
      preparedAt: Date.now(), group: { displayName: "New empty group", description: "" }, rules: [],
      policy: { name: "Independent ACP", ruleSets: [] }, publication: "published", copied: [], blockers: [],
    } });
    const operation: CloneOperation = {
      version: 1, id: "synthetic-operation", sourceId: "group-one", sourceFingerprint: "synthetic", planFingerprint: "synthetic",
      phase: "planned", updatedAt: Date.now(), rules: [], steps: [],
    };
    newCloneOperation.mockResolvedValue(operation);
    const outcome: CloneOutcome = {
      operation: { ...operation, phase: "verified", destinationId: "returned-group", policyId: "returned-policy" },
      message: "Synthetic verified independent copy",
      destinationUrl: "https://admin.powerplatform.microsoft.com/manage/envgroups/returned-group/details",
    };
    executeGroupClone.mockResolvedValue(outcome);
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Inspect ACP permissions" }));
    const nameInput = await screen.findByRole("textbox", { name: "New group name" });
    await act(async () => { nameInput.focus(); });
    fireEvent.change(nameInput, { target: { value: "New empty group" } });
    fireEvent.click(await screen.findByRole("button", { name: "Review independent copy" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /I confirm copying/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create independent copy" }));
    expect(await screen.findByRole("link", { name: "Open verified destination group in admin center" })).toHaveAttribute("href", outcome.destinationUrl);
    await waitFor(() => expect(loadManagedApps).toHaveBeenLastCalledWith(true, expect.any(AbortSignal)));
    expect(screen.queryByRole("textbox", { name: "New group name" })).not.toBeInTheDocument();
    expect(screen.getByText("Synthetic verified independent copy")).toBeInTheDocument();
  });
  it("prepares selected PDEs through an accessible action and shows hidden sibling impact", async () => {
    renderView();
    await screen.findByText("Budget planner");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select PDE Personal workspace" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "budget" } });
    fireEvent.click(screen.getByRole("button", { name: "Prepare selected PDE moves" }));
    await selectDestination();
    fireEvent.click(screen.getByRole("button", { name: "Review impact" }));
    expect(await screen.findByText((_, element) => element?.tagName === "LI" && element.textContent === "Travel assistant")).toBeInTheDocument();
    expect(preparePdeMoves).toHaveBeenCalledWith([{ environmentId: "pde-one" }], "group-one", expect.any(AbortSignal));
    expect(screen.getByRole("button", { name: "Move PDE" })).toBeDisabled();
    expect(executeLivePdeMoves).not.toHaveBeenCalled();
    expect(screen.getByText("Ready for review")).toBeInTheDocument();
  });
  it("requires explicit transfer confirmation and reports completion in the task strip without reloading inventory", async () => {
    const groupEvidence = {
      groupId: "group-one", capturedAt: Date.now(), details: { ok: true, data: { id: "group-one" } },
      policies: { ok: true, data: [] }, rulesets: { ok: true, data: { matching: [], unresolved: [] } },
    };
    preparePdeMoves.mockResolvedValue({ ok: true, data: {
      preparedAt: Date.now(), destination: inventory.groups[0],
      pdes: [{ environmentId: environment.id, environment, status: "prepared", apps, resourceCount: apps.length,
        resources: apps, connectors: [], sourceEvidence: groupEvidence, destinationEvidence: groupEvidence }],
    } });
    executeLivePdeMoves.mockResolvedValue({
      record: { version: 1, id: "synthetic-operation", destinationId: "group-one", previewHash: "synthetic", updatedAt: Date.now(),
        pdes: [{ environmentId: "pde-one", sourceId: "group-one", phase: "already-member", remove: "none", add: "none", observedGroupId: "group-one" }] },
      messages: ["Synthetic current destination membership verified; no mutation needed."],
    });
    renderView();
    await screen.findByText("Budget planner");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select PDE Personal workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare selected PDE moves" }));
    await selectDestination();
    fireEvent.click(screen.getByRole("button", { name: "Review impact" }));
    const button = await screen.findByRole("button", { name: "Move PDE" });
    expect(screen.getByText(/Requires the Power Platform Administrator role \(not checked in advance\)/)).toBeVisible();
    expect(screen.queryByText(/The SDK returns no operation ID\/status headers/)).not.toBeInTheDocument();
    expect(button).toBeDisabled(); expect(executeLivePdeMoves).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Move Personal workspace, including all apps and resources, to Renamed group/ }));
    expect(button).toBeEnabled(); fireEvent.click(button);
    expect(await screen.findByText(/Move complete · 1 of 1 complete · Renamed group/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Check move status" })).not.toBeInTheDocument();
    expect(executeLivePdeMoves).toHaveBeenCalledWith(expect.objectContaining({ pdes: expect.any(Array) }), true, [], expect.any(Function));
    expect(loadManagedApps).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole("button", { name: "View progress" }));
    expect(screen.getByText("Personal workspace: Already in destination")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss move result" }));
    expect(screen.queryByText(/Move complete/)).not.toBeInTheDocument();
    expect(screen.queryByText(/move history/i)).not.toBeInTheDocument();
    expect(executeLivePdeMoves).toHaveBeenCalledTimes(1);
  });
  it("shows a verified direct move with lagging inventory in its destination without mutating raw inventory", async () => {
    const ungrouped = { ...environment, environmentGroupId: "", environmentGroup: "" };
    const snapshot = { ...inventory, environments: [ungrouped] };
    loadManagedApps.mockResolvedValue({ ok: true, data: snapshot });
    preparePdeMoves.mockResolvedValue({ ok: true, data: {
      preparedAt: Date.now(), destination: inventory.groups[0],
      pdes: [{ environmentId: environment.id, environment: ungrouped, status: "prepared", apps, resources: apps,
        resourceCount: apps.length, connectors: [], destinationEvidence: {
          groupId: "group-one", capturedAt: Date.now(), details: { ok: true, data: { id: "group-one" } },
          policies: { ok: true, data: [] }, rulesets: { ok: true, data: { matching: [], unresolved: [] } },
        } }],
    } });
    executeLivePdeMoves.mockImplementation(async () => ({
      record: { version: 1, id: "synthetic-direct-move", destinationId: "group-one", previewHash: "hash", updatedAt: Date.now(),
        pdes: [{ environmentId: "pde-one", sourceId: "", phase: "verified", remove: "none", add: "accepted", observedGroupId: "group-one" }] },
      messages: ["Synthetic direct membership verified."],
      verifiedMemberships: [{ environmentId: "pde-one", groupId: "group-one", hasDataverse: true,
        evidence: { source: "GetEnvironmentByIdForUser", readAt: Date.now(), inventoryReadAt: Date.now(), inventoryGroupId: "" } }],
    }));
    renderView();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select PDE Personal workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare selected PDE moves" }));
    await selectDestination();
    fireEvent.click(screen.getByRole("button", { name: "Review impact" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Move Personal workspace, including all apps and resources/ }));
    fireEvent.click(screen.getByRole("button", { name: "Move PDE" }));
    await screen.findByText(/Move complete · 1 of 1 complete/);
    fireEvent.click(await screen.findByRole("button", { name: "View progress" }));
    expect(screen.getByText("Personal workspace: Moved; inventory is updating")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await screen.findByRole("heading", { name: "Renamed group" });
    expect(await screen.findByRole("heading", { name: "Renamed group" })).toBeVisible();
    expect(snapshot.environments[0].environmentGroupId).toBe("");
    expect(screen.queryByRole("button", { name: "Check move status" })).not.toBeInTheDocument();
  });
  it.each([false, true])("preserves board, scroll, filters and unrelated selection on completion (partial %s)", async (partial) => {
    const second = { ...environment, id: "pde-two", displayName: "Second workspace", environmentGroupId: "", environmentGroup: "" };
    const third = { ...second, id: "pde-three", displayName: "Unrelated workspace" };
    const snapshot = { ...inventory, environments: [{ ...environment, environmentGroupId: "", environmentGroup: "" }, second, third],
      apps: [...apps, readManagedApp({ name: "second-app", type: "microsoft.powerapps/apps", properties: { environmentId: second.id, displayName: "Second project" } }),
        readManagedApp({ name: "third-app", type: "microsoft.powerapps/apps", properties: { environmentId: third.id, displayName: "Unrelated project" } })] };
    loadManagedApps.mockResolvedValue({ ok: true, data: snapshot });
    const destinationEvidence = {
      groupId: "group-one", capturedAt: Date.now(), details: { ok: true, data: { id: "group-one" } },
      policies: { ok: true, data: [] }, rulesets: { ok: true, data: { matching: [], unresolved: [] } },
    };
    preparePdeMoves.mockResolvedValue({ ok: true, data: {
      preparedAt: Date.now(), destination: inventory.groups[0], pdes: snapshot.environments.slice(0, 2).map((env) => {
        const resources = snapshot.apps.filter((app) => app.environmentId === env.id);
        return { environmentId: env.id, environment: env, status: "prepared", apps: resources, resources,
          resourceCount: resources.length, connectors: [], destinationEvidence };
      }),
    } });
    let finish!: (value: MoveOutcome) => void;
    executeLivePdeMoves.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const view = renderView();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select PDE Personal workspace" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select PDE Second workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare selected PDE moves" }));
    await selectDestination();
    fireEvent.click(screen.getByRole("button", { name: "Review impact" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Move Personal workspace, Second workspace, including all apps/ }));
    fireEvent.click(screen.getByRole("button", { name: "Move 2 PDEs" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue in background" }));
    const search = await screen.findByRole("searchbox");
    fireEvent.change(search, { target: { value: "workspace" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Show empty groups" }));
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select PDE Unrelated workspace" }));
    const board = screen.getByRole("region", { name: "Managed apps by environment group" });
    const unrelated = screen.getByRole("article", { name: "PDE Unrelated workspace" });
    view.container.scrollTop = 321;
    const outcome: MoveOutcome = {
      record: { version: 1, id: "synthetic-quiet-completion", destinationId: "group-one", previewHash: "hash", updatedAt: Date.now(),
        pdes: [{ environmentId: "pde-one", sourceId: "", phase: "verified", remove: "none", add: "accepted", observedGroupId: "group-one" },
          { environmentId: "pde-two", sourceId: "", phase: partial ? "indeterminate" : "verified", remove: "none", add: partial ? "uncertain" : "accepted", observedGroupId: partial ? "" : "group-one" }] },
      messages: partial ? ["pde-two: Synthetic request completion remains unknown."] : [],
      verifiedMemberships: (partial ? ["pde-one"] : ["pde-one", "pde-two"]).map((environmentId) => ({
        environmentId, groupId: "group-one", hasDataverse: true,
        evidence: { source: "GetEnvironmentByIdForUser", readAt: Date.now(), inventoryReadAt: Date.now(), inventoryGroupId: "" },
      })),
    };
    await act(async () => { finish(outcome); await Promise.resolve(); });
    expect(loadManagedApps).toHaveBeenCalledTimes(1);
    expect(loadGroupEvidenceBatch).not.toHaveBeenCalled();
    expect(screen.queryByText("Loading managed apps and environment groups...")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Managed apps by environment group" })).toBe(board);
    expect(screen.getByRole("article", { name: "PDE Unrelated workspace" })).toBe(unrelated);
    expect(view.container.scrollTop).toBe(321);
    expect(search).toHaveValue("workspace");
    expect(screen.getByRole("checkbox", { name: "Show empty groups" })).toBeChecked();
    expect(screen.getByRole("region", { name: "App and governance filters" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Select PDE Unrelated workspace" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select PDE Personal workspace" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select PDE Second workspace" })).toHaveProperty("checked", partial);
    const destination = screen.getByRole("heading", { name: "Renamed group" }).closest("section")!;
    expect(within(destination).getByRole("article", { name: "PDE Personal workspace" })).toBeVisible();
    expect(snapshot.environments[0].environmentGroupId).toBe("");
    if (partial) {
      expect(screen.getByText("Second workspace: Move request not yet verified.")).toBeVisible();
      expect(screen.getByRole("button", { name: "Check move status" })).toBeVisible();
    } else {
      expect(screen.getByText(/Move complete · 2 of 2 complete · Renamed group/)).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "View progress" }));
      expect(screen.getByText("Personal workspace: Moved; inventory is updating")).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    }
    expect(executeLivePdeMoves).toHaveBeenCalledTimes(1);
  }, 15_000);
  it("opens a named detached PDE's add-only recovery directly from its current result", async () => {
    const groupEvidence = {
      groupId: "group-one", capturedAt: Date.now(), details: { ok: true, data: { id: "group-one" } },
      policies: { ok: true, data: [] }, rulesets: { ok: true, data: { matching: [], unresolved: [] } },
    };
    preparePdeMoves.mockResolvedValue({ ok: true, data: {
      preparedAt: Date.now(), destination: inventory.groups[0], pdes: [{
        environmentId: environment.id, environment, status: "prepared", apps, resources: apps,
        resourceCount: apps.length, connectors: [], sourceEvidence: groupEvidence, destinationEvidence: groupEvidence,
      }],
    } });
    executeLivePdeMoves.mockResolvedValue({
      record: { version: 1, id: "synthetic-detached", destinationId: "group-one", previewHash: "hash", updatedAt: Date.now(),
        pdes: [{ environmentId: "pde-one", sourceId: "group-one", phase: "detached", remove: "accepted", add: "none", observedGroupId: "" }] },
      messages: ["Synthetic removal completed; add not issued."],
    });
    renderView();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select PDE Personal workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare selected PDE moves" }));
    await selectDestination();
    fireEvent.click(screen.getByRole("button", { name: "Review impact" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Move Personal workspace, including all apps and resources/ }));
    fireEvent.click(screen.getByRole("button", { name: "Move PDE" }));
    const recovery = await screen.findByRole("button", { name: "Review add-only recovery" });
    expect(await screen.findByText("Personal workspace: Outside any group; ready for a confirmed add.")).toBeVisible();
    await waitFor(() => expect(recovery).toBeEnabled());
    fireEvent.click(recovery);
    await waitFor(() => expect(preparePdeMoves).toHaveBeenLastCalledWith([{ environmentId: "pde-one" }], "group-one", expect.any(AbortSignal)));
    expect(executeLivePdeMoves).toHaveBeenCalledTimes(1);
  }, 15_000);
  it("clears selections and group inspection on authoritative refresh", async () => {
    renderView();
    await screen.findByText("Budget planner");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select PDE Personal workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh inventory" }));
    await screen.findByText("Budget planner");
    expect(screen.getByRole("checkbox", { name: "Select PDE Personal workspace" })).not.toBeChecked();
    expect(screen.queryByRole("region", { name: "Move selection" })).not.toBeInTheDocument();
  });
  it("reviews independent ACP cloning without offering a shared-policy or incomplete live copy", async () => {
    loadGroupPolicies.mockResolvedValue({ ok: true, data: [{ id: "source-acp", name: "Synthetic ACP", ruleSets: [{
      id: "ConnectorManagement", version: "1", inputs: { AllowedConnectorList: [] },
    }, { id: "ReviewOnlyRule", version: "1", inputs: { FeatureEnabled: true } }] }] });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Inspect ACP permissions" }));
    const input = await screen.findByRole("textbox", { name: "New group name" });
    expect(screen.getAllByText("ReviewOnlyRule").length).toBeGreaterThan(0);
    expect(screen.getByText("Open / configure this group in Power Platform admin center")).toHaveAttribute("href", "https://admin.powerplatform.microsoft.com/manage/envgroups/group-one/details");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "New empty group" } });
    fireEvent.click(await screen.findByRole("button", { name: "Review independent copy" }));
    expect(await screen.findByText("0 environments copied · 1 independent ACP copies proposed")).toBeInTheDocument();
    expect(screen.getByText("Create independent copy (unavailable)")).toBeDisabled();
  });
  it("allows refresh to cancel an in-flight evidence read and ignores its late response", async () => {
    let finish!: (value: unknown[]) => void;
    loadGroupEvidenceBatch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Inspect ACP permissions" }));
    await screen.findByText("Loading group properties, rules and ACP evidence...");
    const oldSignal = loadGroupEvidenceBatch.mock.calls[0][1] as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "Close group inspection" }));
    const refresh = screen.getByRole("button", { name: "Refresh inventory" });
    expect(refresh).not.toBeDisabled();
    fireEvent.click(refresh);
    expect(oldSignal.aborted).toBe(true);
    await waitFor(() => expect(loadGroupEvidenceBatch).toHaveBeenCalledTimes(2));
    await act(async () => { finish([{ groupId: "obsolete-group", policies: { ok: true, data: [] } }]); });
    fireEvent.click(await screen.findByRole("button", { name: "Inspect ACP permissions" }));
    expect(await screen.findByText("No policy assignments were returned. Connector permissions are unknown, not unrestricted.")).toBeInTheDocument();
    expect(screen.queryByText("obsolete-group")).not.toBeInTheDocument();
  });
  it("invalidates prior evidence and open previews when returning from an external window", async () => {
    renderView();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select PDE Personal workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare selected PDE moves" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent(window, new Event("focus"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText(/earlier policy evidence and previews were invalidated/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select PDE Personal workspace" })).toBeChecked();
  });
  it("cancels closed move previews and restores focus to the initiating selection action", async () => {
    let finish!: (value: unknown) => void;
    preparePdeMoves.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    renderView();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select PDE Personal workspace" }));
    const opener = screen.getByRole("button", { name: "Prepare selected PDE moves" });
    opener.focus();
    fireEvent.click(opener);
    await selectDestination();
    fireEvent.click(screen.getByRole("button", { name: "Review impact" }));
    await waitFor(() => expect(preparePdeMoves).toHaveBeenCalledTimes(1));
    const signal = preparePdeMoves.mock.calls[0][2] as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(signal.aborted).toBe(true);
    await waitFor(() => expect(opener).toHaveFocus());
    await act(async () => { finish({ ok: false, error: "Obsolete read" }); });
    expect(screen.queryByText("Obsolete read")).not.toBeInTheDocument();
  });
  it("retains an empty group as an accessible destination", async () => {
    loadManagedApps.mockResolvedValue({ ok: true, data: { ...inventory, groups: [
      ...inventory.groups, { ...inventory.groups[0], id: "empty-group", displayName: "Empty destination" },
    ] } });
    renderView();
    await screen.findByText("Budget planner");
    expect(screen.queryByRole("heading", { name: "Empty destination" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select PDE Personal workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare selected PDE moves" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Destination environment group" }));
    expect(await screen.findByRole("option", { name: "Empty destination (empty-group)" })).toBeInTheDocument();
  });
  it("duplicates an empty template through an all-groups searchable source independently of board filters", async () => {
    loadManagedApps.mockResolvedValue({ ok: true, data: { ...inventory, groups: [...inventory.groups,
      { ...inventory.groups[0], id: "synthetic-template", displayName: "Empty template" }] } });
    renderView();
    await screen.findByText("Budget planner");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no matching app" } });
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Duplicate environment group" }));
    const picker = await screen.findByRole("combobox", { name: "Source environment group" });
    fireEvent.click(picker);
    fireEvent.change(picker, { target: { value: "SYNTHETIC-TEMPLATE" } });
    fireEvent.click(await screen.findByRole("option", { name: "Empty template (synthetic-template)" }));
    fireEvent.click(screen.getByRole("button", { name: "Review selected source" }));
    expect(await screen.findByRole("textbox", { name: "New group name" })).toBeInTheDocument();
    expect(loadGroupEvidenceBatch).toHaveBeenCalledWith(["synthetic-template"], expect.any(AbortSignal));
  });
  it("finds apps through PDE names and combines advanced context fields", async () => {
    renderView();
    await screen.findByText("Budget planner");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "PERSONAL WORKSPACE" } });
    expect(screen.getByText("Budget planner")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "App name or ID" }), { target: { value: "Budget" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Environment group name or ID" }), { target: { value: "GROUP-ONE" } });
    expect(screen.getByText("Budget planner")).toBeInTheDocument();
    expect(screen.queryByText("Travel assistant")).not.toBeInTheDocument();
  });
  it("shows actual reported app connectors separately from ACP permissions", async () => {
    const reported = { ...apps[0], connectorIds: ["shared_syntheticconnector"] };
    loadManagedApps.mockResolvedValue({ ok: true, data: { ...inventory, apps: [reported] } });
    renderView();
    await screen.findByText("Budget planner");
    expect(screen.getByText("1 connector used")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Inspect Budget planner and connectors" }));
    expect(await screen.findByRole("heading", { name: "Connectors used" })).toBeInTheDocument();
    expect(screen.getByText("Reported by inventory")).toBeVisible();
    expect(screen.getByText("Syntheticconnector")).toBeVisible();
    expect(screen.getByText("shared_syntheticconnector")).not.toBeVisible();
    expect(screen.getByText("Avery Maker")).toBeVisible();
  });
  it("opens app-first details with joined group name and collapsed IDs and sibling inventory", async () => {
    loadManagedApps.mockResolvedValue({ ok: true, data: { ...inventory,
      environments: [{ ...environment, environmentGroup: "group-one" }],
      apps: [{ ...apps[0], subType: "microsoftApp", connectorIds: ["shared_commondataserviceforapps"] }, apps[1]],
    } });
    loadPdeApps.mockResolvedValue({ ok: true, data: [...apps, { ...apps[0], id: "canvas-other", displayName: "Canvas sibling", type: "microsoft.powerapps/canvasapps" }] });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Inspect Budget planner and connectors" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Budget planner" })).toBeVisible();
    expect(within(dialog).getByText("Environment: Personal workspace")).toBeVisible();
    expect(within(dialog).getByText("Group: Renamed group")).toBeVisible();
    expect(within(dialog).getByText("Microsoft Dataverse (legacy)")).toBeVisible();
    expect(within(dialog).getByText("Name not resolved")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Look up identity" })).toBeVisible();
    const siblings = await within(dialog).findByText("Other apps in this environment (2)");
    expect(within(dialog).getByText("Canvas sibling")).not.toBeVisible();
    fireEvent.click(siblings);
    expect(within(dialog).getByText("Canvas sibling")).toBeVisible();
    expect(within(dialog).getByText("(Canvas app)")).toBeVisible();
    expect(within(dialog).getByText(/Complete app inventory read/)).toBeVisible();
    expect(within(dialog).queryByText(/Moving it would affect|must be reconciled/)).not.toBeInTheDocument();
    expect(within(dialog).getByText("Subtype: microsoftApp")).not.toBeVisible();
    fireEvent.click(within(dialog).getByText("Technical details"));
    expect(within(dialog).getByText("Subtype: microsoftApp")).toBeVisible();
    expect(within(dialog).getByText("App ID: Budget planner")).toBeVisible();
    expect(within(dialog).getByText("shared_commondataserviceforapps")).toBeVisible();
    expect(loadPdeApps).toHaveBeenCalledWith("pde-one", true, expect.any(AbortSignal));
    expect(executeLivePdeMoves).not.toHaveBeenCalled();
  });
  it.each([
    [null, "Connector usage was not reported or is unreadable."],
    [[], "No connectors reported (explicit empty inventory list)."],
  ])("keeps connector usage %j distinct without move warnings", async (connectorIds, message) => {
    loadManagedApps.mockResolvedValue({ ok: true, data: { ...inventory, apps: [{ ...apps[0], connectorIds }] } });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Inspect Budget planner and connectors" }));
    expect(within(screen.getByRole("dialog")).getByText(message)).toBeVisible();
    expect(within(screen.getByRole("dialog")).queryByRole("alert")).not.toBeInTheDocument();
  });
  it("keeps failed sibling reads explicit instead of showing an incomplete count as complete", async () => {
    loadPdeApps.mockResolvedValue({ ok: false, error: "Synthetic incomplete inventory response" });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Inspect Budget planner and connectors" }));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByText("Synthetic incomplete inventory response")).toBeVisible();
    expect(within(dialog).queryByText(/Other apps in this environment/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Connectors used" })).toBeVisible();
  });
  it("lazily shows only the exact selected raw inventory record including unknown fields", async () => {
    const raw = { name: "raw-app", type: "microsoft.powerapps/apps", properties: {
      displayName: "Raw example", environmentId: "pde-one", futureSetting: { retained: ["original"] },
    } };
    loadManagedApps.mockResolvedValue({ ok: true, data: { ...inventory, apps: [readManagedApp(raw), apps[1]] } });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Inspect Raw example and connectors" }));
    const dialog = screen.getByRole("dialog");
    const disclosure = within(dialog).getByText("Raw inventory record");
    expect(disclosure.closest("details")).not.toHaveAttribute("open");
    expect(within(dialog).queryByLabelText("Raw inventory JSON")).not.toBeInTheDocument();
    fireEvent.click(disclosure);
    const code = await within(dialog).findByLabelText("Raw inventory JSON");
    expect(JSON.parse(code.textContent || "")).toEqual(raw);
    expect(code.textContent).not.toContain("Travel assistant");
    expect(loadManagedApps).toHaveBeenCalledTimes(1);
  });
  it("reports missing raw data rather than reconstructing an inventory record", async () => {
    loadManagedApps.mockResolvedValue({ ok: true, data: { ...inventory, apps: [{ ...apps[0], raw: undefined }] } });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Inspect Budget planner and connectors" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Raw inventory record"));
    expect(await screen.findByText(/The original inventory record is unavailable/)).toBeVisible();
  });
  it("surfaces raw serialization failure explicitly without breaking app details", async () => {
    const properties: Record<string, unknown> = {};
    properties.self = properties;
    loadManagedApps.mockResolvedValue({ ok: true, data: { ...inventory, apps: [{ ...apps[0], raw: { name: "cyclic", properties } }] } });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Inspect Budget planner and connectors" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Raw inventory record"));
    expect(await screen.findByText(/Could not display the inventory record:/)).toBeVisible();
    expect(within(screen.getByRole("dialog")).getByRole("heading", { name: "Connectors used" })).toBeVisible();
  });
  it("renders a PDE once with compact app rows, one selection/drag handle and actual governing group actions", async () => {
    renderView();
    const pde = await screen.findByRole("article", { name: "PDE Personal workspace" });
    expect(within(pde).getAllByRole("checkbox")).toHaveLength(1);
    expect(within(pde).getAllByRole("button", { name: /Drag PDE/ })).toHaveLength(1);
    expect(within(pde).queryByRole("checkbox", { name: /Budget planner|Travel assistant/ })).not.toBeInTheDocument();
    expect(within(pde).getAllByRole("listitem")).toHaveLength(2);
    expect(within(pde).getByText("2 apps")).toBeVisible();
    expect(within(pde).queryByText("Owner")).not.toBeInTheDocument();
    fireEvent.click(within(pde).getByRole("button", { name: "Actions for PDE Personal workspace" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "View governing rules / ACP" }));
    expect(await screen.findByText(/No policy assignments were returned/)).toBeInTheDocument();
    expect(loadGroupEvidenceBatch).toHaveBeenLastCalledWith(["group-one"], expect.any(AbortSignal));
  });
  it("counts all sibling apps when selecting filtered PDEs and deduplicates environment-only move requests", async () => {
    const second = { ...environment, id: "pde-two", displayName: "Second workspace" };
    const sibling = { ...apps[1], id: "second-app", displayName: "Second tracker", environmentId: second.id };
    loadManagedApps.mockResolvedValue({ ok: true, data: { ...inventory, apps: [...apps, sibling], environments: [environment, second] } });
    renderView();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select PDE Personal workspace" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select PDE Second workspace" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "budget" } });
    expect(screen.getByText("1 of 2 apps matching")).toBeVisible();
    expect(screen.queryByText("Travel assistant")).not.toBeInTheDocument();
    expect(screen.getByText("2 selected PDEs · 3 inventory apps affected")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Prepare selected PDE moves" }));
    await selectDestination();
    fireEvent.click(screen.getByRole("button", { name: "Review impact" }));
    await waitFor(() => expect(preparePdeMoves).toHaveBeenCalledWith(
      [{ environmentId: "pde-one" }, { environmentId: "pde-two" }], "group-one", expect.any(AbortSignal)));
    expect(executeLivePdeMoves).not.toHaveBeenCalled();
  });
  it("offers a keyboard-accessible move action on an ungrouped PDE without inventing ACP", async () => {
    loadManagedApps.mockResolvedValue({ ok: true, data: { ...inventory, environments: [{ ...environment, environmentGroupId: "", environmentGroup: "" }] } });
    renderView();
    const pde = await screen.findByRole("article", { name: "PDE Personal workspace" });
    expect(within(pde).getByText(/Governing group rules \/ ACP unavailable/)).toBeVisible();
    fireEvent.click(within(pde).getByRole("button", { name: "Actions for PDE Personal workspace" }));
    expect(await screen.findByRole("menuitem", { name: "View governing rules / ACP" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Move environment" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(preparePdeMoves).not.toHaveBeenCalled(); expect(executeLivePdeMoves).not.toHaveBeenCalled();
  });
  it("uses a single PDE drag identity and prepares selected environments once without executing", async () => {
    loadManagedApps.mockResolvedValue({ ok: true, data: { ...inventory,
      environments: [...inventory.environments, { ...environment, id: "pde-two", displayName: "Second workspace" }],
      apps: [...apps, { ...apps[0], id: "second-app", environmentId: "pde-two", displayName: "Second tracker" }],
    } });
    renderView();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select PDE Personal workspace" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select PDE Second workspace" }));
    act(() => drag.end?.({
      active: { id: "pde-one", data: { current: {} }, rect: { current: { initial: null, translated: null } } },
      over: { id: "group-one", data: { current: {} }, disabled: false, rect: { top: 0, bottom: 10, left: 0, right: 10, width: 10, height: 10 } },
      activatorEvent: new Event("pointerup"), delta: { x: 0, y: 0 }, collisions: [],
    }));
    await waitFor(() => expect(preparePdeMoves).toHaveBeenCalledWith(
      [{ environmentId: "pde-one" }, { environmentId: "pde-two" }], "group-one", expect.any(AbortSignal)));
    expect(preparePdeMoves).toHaveBeenCalledTimes(1); expect(executeLivePdeMoves).not.toHaveBeenCalled();
  });
  it("defaults to app-bearing groups, reports app/PDE inventory totals and exposes empty drag/inspection targets explicitly", async () => {
    loadManagedApps.mockResolvedValue({ ok: true, data: { ...inventory,
      environments: [...inventory.environments, { ...environment, id: "empty-pde", displayName: "Empty PDE", environmentGroupId: "empty-group" }],
      groups: [...inventory.groups, { ...inventory.groups[0], id: "empty-group", displayName: "Empty destination" }],
    } });
    renderView();
    await screen.findByText("Budget planner");
    expect(screen.queryByText("Empty PDE")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Empty destination" })).not.toBeInTheDocument();
    expect(screen.getByText("2 of 2 apps shown · 1 of 1 PDEs with apps · 1 of 2 group columns shown")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show empty groups" }));
    const empty = await screen.findByRole("region", { name: "Empty destination" });
    expect(within(empty).getByRole("button", { name: "Inspect ACP permissions" })).toBeInTheDocument();
    expect(screen.getByText("2 of 2 apps shown · 1 of 1 PDEs with apps · 2 of 2 group columns shown")).toBeInTheDocument();
  });
  it("keeps group property/connector search available for qualifying empty groups in browse mode", async () => {
    loadManagedApps.mockResolvedValue({ ok: true, data: { ...inventory, groups: [
      ...inventory.groups, { ...inventory.groups[0], id: "empty-group", displayName: "Empty governance group", description: "Restricted sharing" },
    ] } });
    loadGroupPolicies.mockResolvedValue({ ok: true, data: [{ id: "synthetic-policy", name: "Synthetic policy", ruleSets: [{
      id: "ConnectorManagement", version: "1", inputs: { AllowedConnectorList: [{
        AllowedConnector: "/providers/Microsoft.PowerApps/apis/shared_teams", AllowedActionsMode: "AllAllowed", AllowedConnectionTypesMode: "AllAllowed",
      }] },
    }] }] });
    renderView();
    await screen.findByText("Budget planner");
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Find environment groups" }), { target: { value: "restricted sharing" } });
    expect(screen.getByText(/Group search currently shows only matching apps/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show empty groups" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Configured allowed connectors/ }), { target: { value: "teams" } });
    fireEvent.click(screen.getByRole("button", { name: "Load group rules / ACP" }));
    expect(await screen.findByRole("heading", { name: "Empty governance group" })).toBeInTheDocument();
    expect(screen.getByText("Matching groups are shown below, but no apps match the current filters.")).toBeInTheDocument();
    expect(screen.queryByText("Budget planner")).not.toBeInTheDocument();
  });
  it("counts and displays unknown parents without inventing a PDE or ungrouped membership", async () => {
    loadManagedApps.mockResolvedValue({ ok: true, data: { ...inventory, environments: [] } });
    renderView();
    expect(await screen.findByText("Budget planner")).toBeVisible();
    const unknown = screen.getByRole("article", { name: "Environment Environment details unavailable" });
    expect(within(unknown).getByText(/Environment details were not returned/)).toBeVisible();
    expect(within(unknown).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(unknown).queryByRole("button", { name: /Drag PDE/ })).not.toBeInTheDocument();
    expect(screen.getByText("2 apps · 0 PDEs · 1 other environment · 0 groups")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "No environment group" })).not.toBeInTheDocument();
    fireEvent.click(within(unknown).getByRole("button", { name: "Inspect Budget planner and connectors" }));
    expect(within(screen.getByRole("dialog")).getByText("Group: Membership unavailable")).toBeVisible();
    expect(within(screen.getByRole("dialog")).getByRole("heading", { name: "Budget planner" })).toBeVisible();
  });
  it("keeps ineligible managed apps in their known group but disables selection, move and drag", async () => {
    loadManagedApps.mockResolvedValue({ ok: true, data: { ...inventory, environments: [{ ...environment, environmentType: "Production" }] } });
    renderView();
    const card = await screen.findByRole("article", { name: "Environment Personal workspace" });
    expect(within(card).getByText("Budget planner")).toBeVisible();
    expect(within(card).getByText(/inventory reports Production/)).toBeVisible();
    expect(within(card).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("2 apps · 0 PDEs · 1 other environment · 1 group")).toBeVisible();
    fireEvent.click(within(card).getByRole("button", { name: "Actions for PDE Personal workspace" }));
    expect(await screen.findByRole("menuitem", { name: "Move environment" })).toHaveAttribute("aria-disabled", "true");
    act(() => drag.end?.({
      active: { id: "pde-one", data: { current: {} }, rect: { current: { initial: null, translated: null } } },
      over: { id: "group-one", data: { current: {} }, disabled: false, rect: { top: 0, bottom: 10, left: 0, right: 10, width: 10, height: 10 } },
      activatorEvent: new Event("pointerup"), delta: { x: 0, y: 0 }, collisions: [],
    }));
    expect(preparePdeMoves).not.toHaveBeenCalled(); expect(executeLivePdeMoves).not.toHaveBeenCalled();
  });
  it("refreshes historical managed counts including newly returned apps with unverified parents", async () => {
    loadManagedApps.mockResolvedValueOnce({ ok: true, data: inventory }).mockResolvedValue({ ok: true, data: { ...inventory,
      apps: [...apps, { ...apps[0], id: "new-app", displayName: "New managed example", environmentId: "unknown-parent" }],
    } });
    renderView();
    await screen.findByText("Budget planner");
    fireEvent(window, new Event("focus"));
    expect(screen.getByText("Historical snapshot: 2 apps · 1 PDE · 1 group")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Refresh inventory" }));
    expect(await screen.findByText("New managed example")).toBeVisible();
    expect(screen.getByText("3 apps · 1 PDE · 1 other environment · 1 group")).toBeVisible();
    expect(loadManagedApps).toHaveBeenLastCalledWith(true, expect.any(AbortSignal));
  });
  it("keeps the initial controls compact, with one accessible filter panel and on-demand totals", async () => {
    renderView();
    await screen.findByText("Budget planner");
    expect(screen.getByRole("searchbox", { name: "Search apps, people, PDEs and groups" })).toBeVisible();
    const filters = screen.getByRole("button", { name: "Filters" });
    expect(filters).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "App and governance filters" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Origin" })).not.toBeInTheDocument();
    expect(screen.getByText("2 apps · 1 PDE · 1 group")).toBeVisible();
    const totals = screen.getByText("2 of 2 apps shown · 1 of 1 PDEs with apps · 1 of 1 group columns shown");
    expect(totals).not.toBeVisible();
    fireEvent.click(screen.getByText("About this view and totals"));
    expect(totals).toBeVisible();
    fireEvent.click(filters);
    const panel = screen.getByRole("region", { name: "App and governance filters" });
    expect(filters).toHaveAttribute("aria-controls", panel.id);
    expect(filters).toHaveAttribute("aria-expanded", "true");
    expect(within(panel).getByRole("textbox", { name: "App name or ID" })).toBeVisible();
    expect(within(panel).getByRole("textbox", { name: /Configured allowed connectors/ })).toBeVisible();
    expect(loadGroupEvidenceBatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(await screen.findByRole("menuitem", { name: "Duplicate environment group" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Resolve owner / maker names" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: /Move status and history|Resolve pending move/ })).not.toBeInTheDocument();
  });
  it("shows recovery after reload only for real pending moves, retaining hidden terminal records", async () => {
    const prefix = "ppcoe:managed-apps:pde-move:v1:";
    const completed = {
      version: 1, id: "synthetic-completed", destinationId: "group-one", previewHash: "hash", updatedAt: 123,
      pdes: [{ environmentId: "pde-one", sourceId: "", phase: "verified", remove: "none", add: "accepted" }],
    };
    const pending = { ...completed, id: "synthetic-pending", pdes: [{ ...completed.pdes[0], phase: "indeterminate" }] };
    localStorage.setItem(`${prefix}${completed.id}`, JSON.stringify(completed));
    localStorage.setItem(`${prefix}${pending.id}`, JSON.stringify(pending));
    renderView();
    expect(await screen.findByRole("button", { name: "Resolve pending move" })).toBeVisible();
    expect(screen.queryByText(/synthetic-completed|synthetic-pending|move history/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(await screen.findByRole("menuitem", { name: "Resolve pending move" })).toBeVisible();
    expect(localStorage.getItem(`${prefix}${completed.id}`)).toBe(JSON.stringify(completed));
    expect(localStorage.getItem(`${prefix}${pending.id}`)).toBe(JSON.stringify(pending));
  });
  it("does not offer recovery for retained successful and no-write attempts after reload", async () => {
    const prefix = "ppcoe:managed-apps:pde-move:v1:";
    const completed = {
      version: 1, id: "synthetic-completed", destinationId: "group-one", previewHash: "hash", updatedAt: 123,
      pdes: [{ environmentId: "pde-one", sourceId: "", phase: "verified", remove: "none", add: "accepted" }],
    };
    const failed = { ...completed, id: "synthetic-no-write", pdes: [{ ...completed.pdes[0], phase: "failed", add: "none" }] };
    localStorage.setItem(`${prefix}${completed.id}`, JSON.stringify(completed));
    localStorage.setItem(`${prefix}${failed.id}`, JSON.stringify(failed));
    renderView();
    await screen.findByText("Budget planner");
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(await screen.findByRole("menuitem", { name: "Duplicate environment group" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: /Resolve pending move|Move status and history/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/synthetic-completed|synthetic-no-write|move history/i)).not.toBeInTheDocument();
    expect(localStorage.getItem(`${prefix}${completed.id}`)).toBe(JSON.stringify(completed));
    expect(localStorage.getItem(`${prefix}${failed.id}`)).toBe(JSON.stringify(failed));
  });
  it("counts effective fields and clears all filter state without changing browse scope, selection, evidence or journals", async () => {
    const journalKey = "ppcoe:managed-apps:pde-move:v1:synthetic-operation";
    const journal = JSON.stringify({ version: 1, id: "synthetic-operation", destinationId: "group-one", previewHash: "synthetic-hash",
      updatedAt: Date.now(), pdes: [{ environmentId: "pde-one", sourceId: "", phase: "verified", remove: "none", add: "accepted" }] });
    localStorage.setItem(journalKey, journal);
    renderView();
    await screen.findByText("Budget planner");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select PDE Personal workspace" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show empty groups" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "budget" } });
    fireEvent.click(screen.getByRole("button", { name: "Filters (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Load group rules / ACP" }));
    await screen.findByText(/Governance evidence loaded for 1 of 1 groups/);
    fireEvent.click(screen.getByRole("combobox", { name: "Origin" }));
    fireEvent.click(await screen.findByRole("option", { name: "Copilot Studio" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Environment group" }));
    fireEvent.click(await screen.findByRole("option", { name: /Renamed group/ }));
    for (const [label, value] of [
      ["App name or ID", "budget"], ["Environment name or ID", "personal"], ["Environment group name or ID", "group-one"],
      ["Find environment groups", "Renamed"], ["Configured allowed connectors (comma-separated)", "teams, sharepointonline"],
    ]) fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });
    fireEvent.change(screen.getByRole("combobox", { name: "Connector match" }), { target: { value: "any" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Rule / property" }));
    fireEvent.click(await screen.findByRole("option", { name: "Group.displayName" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Exact returned value" }));
    fireEvent.click(await screen.findByRole("option", { name: "Renamed group" }));
    expect(screen.getByRole("button", { name: "Filters (9)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("button", { name: "Filters" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("searchbox")).toHaveValue("");
    for (const label of ["App name or ID", "Environment name or ID", "Environment group name or ID", "Find environment groups", "Configured allowed connectors (comma-separated)"]) {
      expect(screen.getByRole("textbox", { name: label })).toHaveValue("");
    }
    expect(screen.getByRole("combobox", { name: "Origin" })).toHaveValue("All origins");
    expect(screen.getByRole("combobox", { name: "Environment group" })).toHaveValue("All groups (*)");
    expect(screen.getByRole("combobox", { name: "Connector match" })).toHaveValue("all");
    expect(screen.getByRole("combobox", { name: "Rule / property" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Exact returned value" })).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "Show empty groups" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select PDE Personal workspace" })).toBeChecked();
    expect(screen.getByText("Travel assistant")).toBeVisible();
    expect(loadManagedApps).toHaveBeenCalledTimes(1);
    expect(loadGroupEvidenceBatch).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(journalKey)).toBe(journal);
    expect(executeLivePdeMoves).not.toHaveBeenCalled();
  }, 15_000);
  it("keeps stale and failed-evidence alerts visible when filters are closed", async () => {
    loadGroupEvidenceBatch.mockResolvedValue([{
      groupId: "group-one", capturedAt: Date.now(), details: { ok: true, data: { id: "group-one" } },
      policies: { ok: true, data: [] }, rulesets: { ok: false, error: "Synthetic rules denied" },
    }]);
    renderView();
    await screen.findByText("Budget planner");
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Load group rules / ACP" }));
    const warning = await screen.findByText(/Some group evidence is unavailable/);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(warning).toBeVisible();
    fireEvent(window, new Event("focus"));
    expect(screen.getByText(/earlier policy evidence and previews were invalidated/)).toBeVisible();
    expect(screen.getByText("Historical snapshot: 2 apps · 1 PDE · 1 group")).toBeVisible();
  });
});
