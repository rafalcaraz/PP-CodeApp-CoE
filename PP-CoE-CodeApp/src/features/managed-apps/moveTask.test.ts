import { describe, expect, it, vi } from "vitest";
import { createMoveTaskRunner, type MoveTaskExecutor, type MoveTaskProgress } from "./moveTask";
import type { MovePreview } from "./governance";
import type { MoveOutcome } from "./pdeMoves";
import type { EnvironmentRow } from "./data";

const environment = (id: string): EnvironmentRow => ({
  id, displayName: `Workspace ${id}`, environmentType: "Developer", isManaged: true,
  environmentGroupId: "source", environmentGroup: "Source", region: "", createdAt: "",
  createdBy: "", lastModifiedAt: "", tenantId: "",
});
const preview: MovePreview = {
  preparedAt: 1,
  destination: { id: "destination", displayName: "Destination", description: "", createdAt: "", createdBy: "", lastModifiedAt: "", location: "" },
  pdes: ["one", "two"].map((id) => ({
    environmentId: id, environment: environment(id), status: "prepared", apps: [], resourceCount: 0, connectors: [],
  })),
};
const outcome = (partial = false): MoveOutcome => ({
  record: { version: 1, id: "synthetic-operation", destinationId: "destination", previewHash: "synthetic", updatedAt: 1,
    pdes: preview.pdes.map((pde, index) => ({
      environmentId: pde.environmentId, sourceId: "source", phase: partial ? index ? "stopped" : "detached" : "verified",
      remove: partial && index ? "none" : "accepted", add: partial ? "none" : "accepted",
    })) },
  messages: partial ? ["Synthetic partial move"] : [],
});

function deferredExecution() {
  let finish!: (result: MoveOutcome) => void;
  let fail!: (error: Error) => void;
  let progress!: (value: MoveTaskProgress) => void;
  const execute = vi.fn<MoveTaskExecutor>((_preview, _confirmed, _recoveryIds, notify) => {
    progress = notify;
    return new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  });
  return { execute, finish: (value: MoveOutcome) => finish(value), fail: (error: Error) => fail(error),
    progress: (value: MoveTaskProgress) => progress(value) };
}

describe("in-app move task lifetime", () => {
  it("continues a submitted write and verification after all modal/route subscribers unmount", async () => {
    const operation = deferredExecution();
    const runner = createMoveTaskRunner(operation.execute);
    const modal = vi.fn();
    const unsubscribe = runner.subscribe(modal);
    const running = runner.start(preview, true);
    operation.progress({ environmentId: "one", phase: "adding" });
    unsubscribe();
    runner.hideDetails();
    runner.dismiss();
    expect(runner.getSnapshot()?.running).toBe(true);
    operation.progress({ environmentId: "one", phase: "verifying" });
    const route = vi.fn();
    runner.subscribe(route);
    expect(runner.getSnapshot()?.environments[0].phase).toBe("verifying");
    operation.finish(outcome());
    await running;
    expect(runner.getSnapshot()?.environments.map((entry) => entry.phase)).toEqual(["moved", "moved"]);
    expect(route).toHaveBeenCalled(); expect(operation.execute).toHaveBeenCalledTimes(1);
  });
  it("reopens progress without restarting and blocks overlapping batches synchronously", async () => {
    const operation = deferredExecution();
    const runner = createMoveTaskRunner(operation.execute);
    const running = runner.start(preview, true, ["recovery-source"]);
    runner.showDetails(); runner.hideDetails(); runner.showDetails();
    expect(runner.getSnapshot()?.detailOpen).toBe(true);
    await expect(runner.start(preview, true)).rejects.toThrow("already running");
    expect(operation.execute).toHaveBeenCalledTimes(1);
    expect(operation.execute.mock.calls[0].slice(0, 3)).toEqual([preview, true, ["recovery-source"]]);
    operation.finish(outcome()); await running;
    runner.dismiss(); expect(runner.getSnapshot()).toBeNull();
  });
  it("keeps actual partial failure and stopped entries without automatically replaying writes", async () => {
    const operation = deferredExecution();
    const runner = createMoveTaskRunner(operation.execute);
    const running = runner.start(preview, true);
    operation.progress({ environmentId: "one", phase: "removing" });
    operation.finish(outcome(true)); await running;
    expect(runner.getSnapshot()?.environments.map((entry) => entry.phase)).toEqual(["needs-attention", "stopped"]);
    runner.showDetails(); expect(operation.execute).toHaveBeenCalledTimes(1);
    expect(runner.getSnapshot()?.outcome?.record.pdes[0].phase).toBe("detached");
  });
  it("surfaces runner failures explicitly and never starts unconfirmed work", async () => {
    const operation = deferredExecution();
    const runner = createMoveTaskRunner(operation.execute);
    await expect(runner.start(preview, false)).rejects.toThrow("Confirm");
    expect(operation.execute).not.toHaveBeenCalled();
    const running = runner.start(preview, true);
    const rejected = expect(running).rejects.toThrow("Synthetic denied");
    operation.fail(new Error("Synthetic denied")); await rejected;
    expect(runner.getSnapshot()).toMatchObject({ running: false, error: "Error: Synthetic denied" });
  });
  it("starts empty after a tab reload and subscription/reopen cannot replay a durable journal", () => {
    const execute = vi.fn<MoveTaskExecutor>();
    const runner = createMoveTaskRunner(execute);
    runner.subscribe(vi.fn()); runner.showDetails(); runner.hideDetails();
    expect(runner.getSnapshot()).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
  it("ignores late phase callbacks after completion or a newer batch starts", async () => {
    const first = deferredExecution();
    const second = deferredExecution();
    const execute = vi.fn<MoveTaskExecutor>().mockImplementationOnce(first.execute).mockImplementationOnce(second.execute);
    const runner = createMoveTaskRunner(execute);
    const runningFirst = runner.start(preview, true);
    first.finish(outcome()); await runningFirst;
    first.progress({ environmentId: "one", phase: "adding" });
    expect(runner.getSnapshot()?.environments[0].phase).toBe("moved");
    const runningSecond = runner.start(preview, true);
    first.progress({ environmentId: "one", phase: "needs-attention" });
    expect(runner.getSnapshot()?.environments[0].phase).toBe("queued");
    second.finish(outcome()); await runningSecond;
  });
});
