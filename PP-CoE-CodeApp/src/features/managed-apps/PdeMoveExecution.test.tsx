import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { StrictMode } from "react";
import type { MoveRecord } from "./pdeMoves";
import type { MovePreview } from "./governance";
import { readManagedApp } from "./data";
const { list, check, execute } = vi.hoisted(() => ({ list: vi.fn(), check: vi.fn(), execute: vi.fn() }));
vi.mock("./pdeMoveData", () => ({
  MOVE_NOTICE: "Power Platform Administrator role required.",
  pdeMoveStore: { list }, checkPreviousPdeMoves: check, executeLivePdeMoves: execute, reconcileLivePdeMove: vi.fn(),
}));
import { PdeMoveExecution } from "./PdeMoveExecution";
import { liveMoveTask } from "./liveMoveTask";
const record: MoveRecord = {
  version: 1, id: "synthetic-previous", destinationId: "synthetic-destination", previewHash: "hash", updatedAt: 123,
  pdes: [{ environmentId: "synthetic-pde", sourceId: "", phase: "indeterminate", remove: "none", add: "accepted" }],
};
beforeEach(() => { liveMoveTask.dismiss(); vi.clearAllMocks(); list.mockReturnValue([record]); check.mockResolvedValue([]); });
it("automatically checks an unresolved move once on open, including StrictMode, without executing a move", async () => {
  const completed = { ...record, pdes: [{ ...record.pdes[0], phase: "verified" as const, observedGroupId: record.destinationId }] };
  check.mockImplementation(async () => { list.mockReturnValue([completed]); return [{ record: completed, messages: ["Membership verified read-only."] }]; });
  const onCompleted = vi.fn();
  const onStatusChecked = vi.fn();
  render(<StrictMode><FluentProvider theme={webLightTheme}><PdeMoveExecution preview={null} statusOnly onBusyChange={vi.fn()} onStatusChecked={onStatusChecked} /></FluentProvider></StrictMode>);
  expect(await screen.findByText("No moves need checking. Close this window and select the PDEs for your next move.")).toBeVisible();
  expect(check).toHaveBeenCalledTimes(1);
  expect(check).toHaveBeenCalledWith([], expect.any(AbortSignal));
  expect(onStatusChecked).toHaveBeenCalledWith([{ record: completed, messages: ["Membership verified read-only."] }]);
  expect(execute).not.toHaveBeenCalled(); expect(onCompleted).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Check move status" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Move .*PDE/ })).not.toBeInTheDocument();
  expect(list()).toEqual([completed]);
});
it("keeps verified and no-write records out of the UI without deleting durable history", () => {
  const completed = { ...record, pdes: [{ ...record.pdes[0], phase: "verified" as const }] };
  const noWrite = { ...record, id: "synthetic-no-write", pdes: [{ ...record.pdes[0], phase: "failed" as const, add: "none" as const }] };
  list.mockReturnValue([completed, noWrite]);
  render(<FluentProvider theme={webLightTheme}><PdeMoveExecution preview={null} statusOnly onBusyChange={vi.fn()} /></FluentProvider>);
  expect(screen.getByText("No moves need checking.")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Check|Reconcile/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/synthetic-no-write|synthetic-previous|move history|Technical details/i)).not.toBeInTheDocument();
  expect(check).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  expect(list()).toEqual([completed, noWrite]);
});
it("keeps unresolved status warnings visible without enabling writes after a check", async () => {
  check.mockResolvedValue([{ record, messages: ["Synthetic unresolved status."] }]);
  render(<FluentProvider theme={webLightTheme}><PdeMoveExecution preview={null} statusOnly onBusyChange={vi.fn()} /></FluentProvider>);
  expect(await screen.findByText("The move is not yet verified. No move was retried.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Check move status" })).toBeEnabled();
  expect(execute).not.toHaveBeenCalled();
});
it("allows a fresh confirmed move with completed and no-write history, using readable names", () => {
  const completed = { ...record, pdes: [{ ...record.pdes[0], phase: "verified" as const }] };
  const noWrite = { ...record, id: "synthetic-no-write", pdes: [{ ...record.pdes[0], phase: "failed" as const, add: "none" as const }] };
  list.mockReturnValue([completed, noWrite]);
  const app = readManagedApp({ name: "synthetic-app", type: "microsoft.powerapps/apps", properties: { environmentId: "synthetic-pde", displayName: "Project tracker" } });
  const preview: MovePreview = {
    preparedAt: Date.now(),
    destination: { id: "synthetic-destination", displayName: "Engineering", description: "", createdAt: "", createdBy: "", lastModifiedAt: "", location: "" },
    pdes: [{
      environmentId: "synthetic-pde", status: "already-member",
      environment: { id: "synthetic-pde", displayName: "Developer workspace", environmentType: "Developer", isManaged: true, environmentGroupId: "synthetic-destination", environmentGroup: "Engineering", region: "", createdAt: "", createdBy: "", lastModifiedAt: "", tenantId: "" },
      apps: [app], resources: [app], resourceCount: 1, connectors: [],
    }],
  };
  render(<FluentProvider theme={webLightTheme}><PdeMoveExecution preview={preview} onBusyChange={vi.fn()} /></FluentProvider>);
  expect(screen.queryByRole("button", { name: /Check|Reconcile/ })).not.toBeInTheDocument();
  const move = screen.getByRole("button", { name: "Move PDE" });
  expect(move).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Move Developer workspace, including all apps and resources, to Engineering." }));
  expect(move).toBeEnabled();
  expect(execute).not.toHaveBeenCalled(); expect(check).not.toHaveBeenCalled();
  expect(screen.queryByText(/synthetic-no-write|move history/i)).not.toBeInTheDocument();
});
it("cancels further automatic checks when closed and ignores a late result", async () => {
  let finish!: (outcomes: unknown[]) => void;
  check.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const onStatusChecked = vi.fn();
  const onBusyChange = vi.fn();
  const view = render(<FluentProvider theme={webLightTheme}><PdeMoveExecution preview={null} statusOnly onBusyChange={onBusyChange} onStatusChecked={onStatusChecked} /></FluentProvider>);
  expect(await screen.findByText("Checking move status automatically...")).toBeVisible();
  const signal: AbortSignal = check.mock.calls[0][1];
  view.unmount();
  expect(signal.aborted).toBe(true);
  finish([]);
  await Promise.resolve();
  expect(onStatusChecked).not.toHaveBeenCalled(); expect(onBusyChange).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});
it("shows the specific automatic check failure while keeping raw diagnostics collapsed", async () => {
  check.mockResolvedValue([{ record, messages: ["synthetic-pde: Synthetic direct/inventory mismatch detail."], verificationIssues: [{ environmentId: "synthetic-pde", reason: "read-failed" }] }]);
  render(<FluentProvider theme={webLightTheme}><PdeMoveExecution preview={null} statusOnly environmentNames={{ "synthetic-pde": "Developer workspace" }} onBusyChange={vi.fn()} /></FluentProvider>);
  expect(await screen.findByText("Developer workspace: Membership read failed; completion not confirmed.")).toBeVisible();
  expect(screen.getByText("synthetic-pde: Synthetic direct/inventory mismatch detail.")).not.toBeVisible();
  expect(execute).not.toHaveBeenCalled();
});
it("ignores another PDE's unfinished history before preview without binding it to the selected name", async () => {
  const unrelated = { ...record, pdes: [{ ...record.pdes[0], environmentId: "different-pde", remove: "accepted" as const, add: "none" as const, phase: "detached" as const, observedGroupId: "" }] };
  list.mockReturnValue([unrelated]);
  render(<FluentProvider theme={webLightTheme}><PdeMoveExecution preview={null} selectedEnvironmentIds={["selected-pde"]}
    environmentNames={{ "selected-pde": "Selected workspace", "different-pde": "Other workspace" }}
    onBusyChange={vi.fn()} /></FluentProvider>);
  await Promise.resolve();
  expect(check).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  expect(screen.queryByText(/previous move is still|not yet verified|previous removal completed/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Other workspace|different-pde/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Selected workspace \(different-pde\)/)).not.toBeInTheDocument();
});
it("scopes automatic status requests to the selected PDE before a preview exists", async () => {
  render(<FluentProvider theme={webLightTheme}><PdeMoveExecution preview={null} selectedEnvironmentIds={["synthetic-pde"]}
    onBusyChange={vi.fn()} /></FluentProvider>);
  await waitFor(() => expect(check).toHaveBeenCalledWith(["synthetic-pde"], expect.any(AbortSignal)));
  expect(execute).not.toHaveBeenCalled();
});
it("offers an explicitly confirmed linked add-only recovery after fresh impact, never an automatic write", async () => {
  const detached: MoveRecord = { ...record, pdes: [{ ...record.pdes[0], sourceId: "original-source", phase: "detached", remove: "accepted", add: "none", observedGroupId: "" }] };
  list.mockReturnValue([detached]); check.mockResolvedValue([{ record: detached, messages: ["Synthetic removal verified; no add requested."] }]);
  const app = readManagedApp({ name: "synthetic-app", type: "microsoft.powerapps/apps", properties: { environmentId: "synthetic-pde", displayName: "Project tracker" } });
  const preview: MovePreview = {
    preparedAt: Date.now(),
    destination: { id: "synthetic-destination", displayName: "Engineering", description: "", createdAt: "", createdBy: "", lastModifiedAt: "", location: "" },
    pdes: [{
      environmentId: "synthetic-pde", status: "prepared",
      environment: { id: "synthetic-pde", displayName: "Developer workspace", environmentType: "Developer", isManaged: true, environmentGroupId: "", environmentGroup: "", region: "", createdAt: "", createdBy: "", lastModifiedAt: "", tenantId: "" },
      apps: [app], resources: [app], resourceCount: 1, connectors: [],
      destinationEvidence: { groupId: "synthetic-destination", capturedAt: Date.now(), details: { ok: true, data: { id: "synthetic-destination" } }, policies: { ok: true, data: [] }, rulesets: { ok: true, data: { matching: [], unresolved: [] } } },
    }],
  };
  execute.mockResolvedValue({ record: { ...record, id: "synthetic-recovery", pdes: [{ ...record.pdes[0], phase: "verified", recoveryOf: [detached.id] }] }, messages: [] });
  render(<FluentProvider theme={webLightTheme}><PdeMoveExecution preview={preview} onBusyChange={vi.fn()} /></FluentProvider>);
  await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
  expect(screen.getByText(/Developer workspace: the previous removal completed; no add was requested/)).toBeVisible();
  const move = screen.getByRole("button", { name: "Move to Engineering" });
  expect(move).toBeDisabled(); expect(execute).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Continue the previous move: add Developer workspace, including all apps and resources, to Engineering." }));
  expect(move).toBeEnabled(); fireEvent.click(move);
  await waitFor(() => expect(execute).toHaveBeenCalledWith(preview, true, [detached.id], expect.any(Function)));
});
