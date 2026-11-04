import { act, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { describe, expect, it, vi } from "vitest";
import { MoveTaskStatus } from "./MoveTaskStatus";
import { createMoveTaskRunner, type MoveTaskExecutor, type MoveTaskProgress } from "./moveTask";
import type { MovePreview } from "./governance";
import type { MoveOutcome } from "./pdeMoves";
import type { EnvironmentRow } from "./data";

const environment: EnvironmentRow = {
  id: "synthetic-pde", displayName: "Example workspace", environmentType: "Developer", isManaged: true,
  environmentGroupId: "", environmentGroup: "", region: "", createdAt: "", createdBy: "", lastModifiedAt: "", tenantId: "",
};
const preview: MovePreview = {
  preparedAt: 1, destination: { id: "target", displayName: "Example destination", description: "", createdAt: "", createdBy: "", lastModifiedAt: "", location: "" },
  pdes: [{ environmentId: environment.id, environment, apps: [], resourceCount: 0, connectors: [], status: "prepared" }],
};
const outcome: MoveOutcome = {
  record: { version: 1, id: "operation", destinationId: "target", previewHash: "synthetic", updatedAt: 1,
    pdes: [{ environmentId: environment.id, sourceId: "", phase: "verified", remove: "none", add: "accepted" }] },
  messages: [],
};
const renderStatus = (runner: ReturnType<typeof createMoveTaskRunner>) =>
  render(<FluentProvider theme={webLightTheme}><MoveTaskStatus runner={runner} /></FluentProvider>);

describe("current move progress surface", () => {
  it("can close mid-write, navigate away and reopen continued verification without resubmitting", async () => {
    let finish!: (value: MoveOutcome) => void;
    let notify!: (value: MoveTaskProgress) => void;
    const execute = vi.fn<MoveTaskExecutor>((_preview, _confirmed, _recoveryIds, progress) => {
      notify = progress;
      return new Promise((resolve) => { finish = resolve; });
    });
    const runner = createMoveTaskRunner(execute);
    const first = renderStatus(runner);
    let running!: Promise<MoveOutcome>;
    act(() => { running = runner.start(preview, true); notify({ environmentId: environment.id, phase: "adding" }); });
    fireEvent.click(screen.getByRole("button", { name: "View progress" }));
    expect(screen.getByText("Example workspace: Adding to destination")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Continue in background" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    first.unmount();
    act(() => notify({ environmentId: environment.id, phase: "verifying" }));
    renderStatus(runner);
    fireEvent.click(screen.getByRole("button", { name: "View progress" }));
    expect(screen.getByText("Example workspace: Checking membership")).toBeVisible();
    expect(execute).toHaveBeenCalledTimes(1);
    await act(async () => { finish(outcome); await running; });
    expect(screen.getByText("Example workspace: Moved")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss move result" }));
    expect(screen.queryByRole("button", { name: "View progress" })).not.toBeInTheDocument();
  });
  it("keeps actionable partial recovery without showing unrelated history or automatically writing", async () => {
    const partial: MoveOutcome = { ...outcome, messages: ["Synthetic completion detail"],
      record: { ...outcome.record, pdes: [{ ...outcome.record.pdes[0], phase: "detached", remove: "accepted", add: "none", observedGroupId: "" }] } };
    const execute = vi.fn<MoveTaskExecutor>().mockResolvedValue(partial);
    const runner = createMoveTaskRunner(execute);
    renderStatus(runner);
    await act(async () => { await runner.start(preview, true); });
    fireEvent.click(screen.getByRole("button", { name: "View progress" }));
    expect(screen.getByRole("link", { name: "Review pending move" })).toHaveAttribute("href", "#/managed-apps");
    expect(screen.getByText("Synthetic completion detail")).not.toBeVisible();
    expect(screen.queryByText(/history/i)).not.toBeInTheDocument();
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("warns before tab unload only while a batch is actively running, not after modal dismissal or completion", async () => {
    let finish!: (value: MoveOutcome) => void;
    const runner = createMoveTaskRunner(() => new Promise((resolve) => { finish = resolve; }));
    renderStatus(runner);
    let running!: Promise<MoveOutcome>;
    act(() => { running = runner.start(preview, true); });
    const activeUnload = new Event("beforeunload", { cancelable: true });
    fireEvent(window, activeUnload);
    expect(activeUnload.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "View progress" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue in background" }));
    const backgroundUnload = new Event("beforeunload", { cancelable: true });
    fireEvent(window, backgroundUnload);
    expect(backgroundUnload.defaultPrevented).toBe(true);
    await act(async () => { finish(outcome); await running; });
    const completedUnload = new Event("beforeunload", { cancelable: true });
    fireEvent(window, completedUnload);
    expect(completedUnload.defaultPrevented).toBe(false);
  });
});
