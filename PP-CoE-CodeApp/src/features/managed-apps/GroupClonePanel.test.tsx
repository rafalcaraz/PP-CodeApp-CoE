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
    preparedAt: 123, publication: blockers.length ? "unknown" : "applied", group: { displayName: "New empty group", description: "" },
    rules: [{ sourceId: "source-rule-id", parameters: [] }], policy: { name: "Independent policy", ruleSets: [] },
    copied: [{ identity: "source-rule-id", path: "ModelA.Sharing/UsersBot/MaximumShareLimit", value: "99" }], blockers,
  };
}
const operation = (): CloneOperation => ({
  version: 1, id: "synthetic-operation", sourceId: "source-id", sourceFingerprint: "synthetic", planFingerprint: "synthetic",
  phase: "planned", updatedAt: 123, rules: [], steps: [],
});
const renderPanel = (onCompleted = vi.fn()) => render(<FluentProvider theme={webLightTheme}>
  <GroupClonePanel sourceId="source-id" sourceName="Synthetic source" sourceDescription="Source description" onCompleted={onCompleted} />
</FluentProvider>);
async function review() {
  fireEvent.change(screen.getByRole("textbox", { name: "New group name" }), { target: { value: "New empty group" } });
  fireEvent.click(screen.getByRole("button", { name: "Review copy" }));
}
beforeEach(() => {
  vi.clearAllMocks(); loadRecords.mockReturnValue([]);
  prepare.mockResolvedValue({ ok: true, data: plan() });
  newOperation.mockResolvedValue(operation());
});

describe("independent copy panel (synthetic UI evidence)", () => {
  it("shows skipped rules before confirmation and reports verified partial completion without hiding omissions", async () => {
    const skipped: NonNullable<ClonePlan["skipped"]> = [{
      kind: "policy-module", id: "MicrosoftAppsContentSecurityPolicy", reasons: ["Unsupported field: managedBy."],
    }];
    const partialPlan = { ...plan([]), skipped };
    prepare.mockResolvedValue({ ok: true, data: partialPlan });
    const outcome: CloneOutcome = {
      operation: { ...operation(), skipped, phase: "created-with-omissions", destinationId: "returned-group-id", policyId: "returned-policy-id" },
      destinationUrl: "https://admin.powerplatform.microsoft.com/manage/envgroups/returned-group-id/details",
      message: "Created with omissions; governance is incomplete.",
    };
    execute.mockResolvedValue(outcome);
    const onCompleted = vi.fn();
    renderPanel(onCompleted); await review();
    expect(await screen.findByText("MicrosoftAppsContentSecurityPolicy")).toBeVisible();
    expect(screen.getByText(/Unsupported field: managedBy/)).toBeVisible();
    expect(screen.getByText(/Partial copy: 1 rule skipped/)).toBeVisible();
    expect(screen.getByText(/Copy details/).closest("details")).not.toHaveAttribute("open");
    const confirmation = screen.getByRole("checkbox", { name: /I accept the listed skipped rules: governance will be incomplete/ });
    const create = screen.getByRole("button", { name: "Create partial copy" });
    expect(create).toBeDisabled();
    expect(execute).not.toHaveBeenCalled();
    fireEvent.click(confirmation); fireEvent.click(create);
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith(outcome));
    expect(execute).toHaveBeenCalledWith(partialPlan, expect.anything(), expect.anything(), expect.anything(), true, true);
    expect(screen.getByText(outcome.message)).toBeVisible();
    expect(screen.getByText("MicrosoftAppsContentSecurityPolicy")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open verified destination group in admin center" })).toHaveAttribute("href", outcome.destinationUrl);
  });
  it("treats a completed-with-omissions journal as terminal while retaining its skip list in history", async () => {
    const record: CloneOperation = {
      ...operation(), phase: "created-with-omissions", destinationId: "returned-group-id", policyId: "returned-policy-id",
      skipped: [{ kind: "policy-module", id: "MicrosoftAppsContentSecurityPolicy", reasons: ["Unsupported field: managedBy."] }],
    };
    loadRecords.mockReturnValue([record]);
    prepare.mockResolvedValue({ ok: true, data: plan([]) });
    renderPanel(); await review();
    expect(await screen.findByRole("checkbox")).toBeInTheDocument();
    expect(screen.queryByText(/A previous copy has incomplete or uncertain writes/)).not.toBeInTheDocument();
    const history = screen.getByText(/Copy history and recovery/).closest("details")!;
    expect(history).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText(/Copy history and recovery/));
    expect(screen.getByText(/Skipped MicrosoftAppsContentSecurityPolicy: Unsupported field: managedBy/)).toBeInTheDocument();
  });
  it("uses a fresh preflight and shows concrete source/destination, both-model scope and the publication blocker", async () => {
    renderPanel(); await review();
    expect(await screen.findByText("Synthetic source → New empty group")).toBeInTheDocument();
    expect(prepare).toHaveBeenCalledWith("source-id", "New empty group", expect.any(AbortSignal), "Source description");
    expect(screen.getByText(/Copy isn't ready:/)).toHaveTextContent("Publication is unknown");
    expect(screen.queryByRole("button", { name: /Create independent copy/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("Copy details and checks (1)").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText(/Source group: source-id/)).not.toBeVisible();
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
  it.each(["A description for this copy\nSecond line", ""])("prefills, edits and reviews the description %j, invalidating earlier confirmation", async (description) => {
    prepare.mockImplementation(async (_id, _name, _signal, value) => ({
      ok: true, data: { ...plan([]), group: { displayName: "New empty group", description: value } },
    }));
    renderPanel();
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("Source description");
    await review();
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: description } });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create independent copy" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review copy" }));
    expect(await screen.findByRole("checkbox")).not.toBeChecked();
    expect(prepare).toHaveBeenLastCalledWith("source-id", "New empty group", expect.any(AbortSignal), description);
    fireEvent.click(screen.getByRole("checkbox"));
    execute.mockResolvedValue({ operation: { ...operation(), phase: "failed" }, message: "Synthetic stopped copy" });
    fireEvent.click(screen.getByRole("button", { name: "Create independent copy" }));
    await waitFor(() => expect(execute).toHaveBeenCalled());
    expect(execute.mock.calls[0][0].group.description).toBe(description);
  });
  it("fills late source properties only until the user edits or clears the description", () => {
    const onCompleted = vi.fn();
    const panel = (sourceDescription?: string) => <FluentProvider theme={webLightTheme}>
      <GroupClonePanel sourceId="source-id" sourceName="Synthetic source" sourceDescription={sourceDescription} onCompleted={onCompleted} />
    </FluentProvider>;
    const mounted = render(panel());
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("");
    mounted.rerender(panel("Description loaded later"));
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("Description loaded later");
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "" } });
    mounted.rerender(panel("Refreshed source description"));
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("");
  });
  it("resets description on source change and ignores the previous source's late review", async () => {
    let finish!: (value: unknown) => void;
    prepare.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const mounted = renderPanel();
    await review();
    const signal = prepare.mock.calls[0][2] as AbortSignal;
    mounted.rerender(<FluentProvider theme={webLightTheme}>
      <GroupClonePanel sourceId="other-source-id" sourceName="Other source" sourceDescription="Other source description" onCompleted={vi.fn()} />
    </FluentProvider>);
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("Other source description");
    expect(screen.getByRole("textbox", { name: "New group name" })).toHaveValue("");
    await act(async () => finish({ ok: true, data: plan([]) }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("Other source description");
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
    expect(screen.getByText("Copies applied settings. Pending changes in admin center aren't copied.")).toBeVisible();
    expect(screen.getByRole("checkbox")).toHaveAccessibleName(/all reviewed applied settings and a separate ACP/);
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
    await screen.findByText("Synthetic source → New empty group");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create independent copy" })).not.toBeInTheDocument();
    expect(screen.getByText(/Copy history and recovery/).closest("details")).toHaveAttribute("open");
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
