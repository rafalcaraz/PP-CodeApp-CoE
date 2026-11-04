import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { CloneOperation, CloneOutcome, ClonePlan } from "./groupClone";

const { prepare, loadRecords, execute, reconcile, save, newOperation } = vi.hoisted(() => ({
  prepare: vi.fn(), loadRecords: vi.fn(), execute: vi.fn(), reconcile: vi.fn(), save: vi.fn(), newOperation: vi.fn(),
}));
vi.mock("./groupCloneData", async () => ({
  ...await vi.importActual<typeof import("./groupCloneData")>("./groupCloneData"),
  prepareGroupClone: prepare, loadCloneOperations: loadRecords, groupCloneStore: { read: vi.fn(), save },
}));
vi.mock("./groupClone", async () => ({
  ...await vi.importActual<typeof import("./groupClone")>("./groupClone"),
  executeGroupClone: execute, reconcileGroupClone: reconcile, newCloneOperation: newOperation,
}));
import { GroupClonePanel } from "./GroupClonePanel";

function plan(blockers = ["Publication is unknown; no writes are enabled."]): ClonePlan {
  return {
    sourceId: "source-id", sourcePolicyId: "source-policy-id", sourceRuleIds: ["source-rule-id"], sourceFingerprint: "synthetic",
    preparedAt: 123, publication: "unknown", group: { displayName: "New empty group", description: "" },
    rules: [{ sourceId: "source-rule-id", parameters: [] }], policy: { name: "Independent policy", ruleSets: [] },
    copied: [{ identity: "source-rule-id", path: "ModelA.Sharing/UsersBot/MaximumShareLimit", value: "99" }], blockers,
  };
}
const operation = (): CloneOperation => ({
  version: 1, id: "synthetic-operation", sourceId: "source-id", sourceFingerprint: "synthetic", planFingerprint: "synthetic",
  phase: "planned", updatedAt: 123, rules: [], steps: [],
});
const renderPanel = (onCompleted = vi.fn()) => render(<FluentProvider theme={webLightTheme}>
  <GroupClonePanel sourceId="source-id" sourceName="Synthetic source" onCompleted={onCompleted} />
</FluentProvider>);
async function review() {
  fireEvent.change(screen.getByRole("textbox", { name: "New group name" }), { target: { value: "New empty group" } });
  fireEvent.click(screen.getByRole("button", { name: "Review independent copy" }));
}
beforeEach(() => {
  vi.clearAllMocks(); loadRecords.mockReturnValue([]);
  prepare.mockResolvedValue({ ok: true, data: plan() });
  newOperation.mockResolvedValue(operation());
});

describe("independent copy panel (synthetic UI evidence)", () => {
  it("uses a fresh preflight and shows concrete source/destination, both-model scope and the publication blocker", async () => {
    renderPanel(); await review();
    expect(await screen.findByText(/Source: Synthetic source/)).toHaveTextContent("New empty group");
    expect(prepare).toHaveBeenCalledWith("source-id", "New empty group", expect.any(AbortSignal));
    expect(screen.getByText("Publication is unknown; no writes are enabled.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create independent copy (unavailable)" })).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.queryByRole("link", { name: /destination/ })).not.toBeInTheDocument();
    expect(execute).not.toHaveBeenCalled();
  });
  it("reports actual read authorization failure without an apparent empty/successful copy", async () => {
    prepare.mockResolvedValue({ ok: false, error: "403 AuthorizationFailed" });
    renderPanel(); await review();
    expect(await screen.findByText("403 AuthorizationFailed")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(execute).not.toHaveBeenCalled();
  });
  it("aborts and ignores a late preflight when the panel closes", async () => {
    let finish!: (value: unknown) => void;
    prepare.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const mounted = renderPanel(); await review();
    const signal = prepare.mock.calls[0][2] as AbortSignal;
    mounted.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ ok: true, data: plan() }));
    expect(execute).not.toHaveBeenCalled();
  });
  it("invalidates the plan and confirmation when the destination name changes", async () => {
    prepare.mockResolvedValue({ ok: true, data: plan([]) });
    renderPanel(); await review();
    await screen.findByRole("checkbox");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Create independent copy" })).not.toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "New group name" }), { target: { value: "Changed name" } });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(execute).not.toHaveBeenCalled();
  });
  it("blocks duplicate creation with unresolved records and exposes read-only recovery", async () => {
    const record = { ...operation(), phase: "indeterminate" as const, destinationId: "returned-group-id", steps: [{ key: "create-policy", outcome: "started" as const }] };
    loadRecords.mockReturnValue([record]);
    prepare.mockResolvedValue({ ok: true, data: plan([]) });
    reconcile.mockResolvedValue({ operation: record, message: "Policy ID unresolved; admin recovery required." });
    renderPanel(); await review();
    await screen.findByRole("checkbox");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Create independent copy" })).toBeDisabled();
    fireEvent.click(screen.getByText(/Copy operation records and manual recovery/));
    expect(screen.getByText(/returned-group-id/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconcile known IDs (read only)" }));
    expect(await screen.findByText("Policy ID unresolved; admin recovery required.")).toBeInTheDocument();
    expect(execute).not.toHaveBeenCalled();
  });
  it("does not start a copy without durable intent or refresh the board for a partial failure", async () => {
    prepare.mockResolvedValue({ ok: true, data: plan([]) });
    save.mockImplementationOnce(() => { throw new Error("Quota exceeded"); });
    const onCompleted = vi.fn();
    renderPanel(onCompleted); await review();
    await screen.findByRole("checkbox");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create independent copy" }));
    expect(await screen.findByText(/Quota exceeded/)).toBeInTheDocument();
    expect(execute).not.toHaveBeenCalled();
    expect(onCompleted).not.toHaveBeenCalled();
  });
  it("returns a verified actual destination link and refresh notification only for full success", async () => {
    prepare.mockResolvedValue({ ok: true, data: plan([]) });
    const outcome: CloneOutcome = {
      operation: { ...operation(), phase: "verified", destinationId: "returned-group-id", policyId: "returned-policy-id" },
      destinationUrl: "https://admin.powerplatform.microsoft.com/manage/envgroups/returned-group-id/details",
      message: "Synthetic verified copy",
    };
    execute.mockResolvedValue(outcome);
    const onCompleted = vi.fn();
    renderPanel(onCompleted); await review();
    await screen.findByRole("checkbox");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create independent copy" }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith(outcome));
    expect(screen.getByRole("link", { name: "Open verified destination group in admin center" })).toHaveAttribute("href", outcome.destinationUrl);
    expect(save).toHaveBeenCalledBefore(execute);
  });
});
