import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { cloneIntent, type CloneOperation, type CloneOutcome, type ClonePlan } from "./groupClone";

const { prepare, loadRecords, execute, reconcile, inspect, locked, save, newOperation } = vi.hoisted(() => ({
  prepare: vi.fn(), loadRecords: vi.fn(), execute: vi.fn(), reconcile: vi.fn(), inspect: vi.fn(), locked: vi.fn(), save: vi.fn(), newOperation: vi.fn(),
}));
vi.mock("./groupCloneData", async () => ({
  ...await vi.importActual<typeof import("./groupCloneData")>("./groupCloneData"),
  prepareGroupClone: prepare, loadCloneOperations: loadRecords, groupCloneStore: { read: vi.fn(), save, list: vi.fn() }, withGroupCloneLock: locked,
}));
vi.mock("./groupClone", async () => ({
  ...await vi.importActual<typeof import("./groupClone")>("./groupClone"),
  executeGroupClone: execute, reconcileGroupClone: reconcile, inspectGroupClone: inspect, newCloneOperation: newOperation,
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
beforeEach(async () => {
  const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>("node:crypto");
  vi.stubGlobal("crypto", webcrypto);
  vi.clearAllMocks(); loadRecords.mockReturnValue([]);
  locked.mockImplementation((action: () => Promise<unknown>) => action());
  inspect.mockImplementation(async (record: CloneOperation) => ({
    operationId: record.id, message: "Recorded state inspected; this is not full verification.", observations: [],
  }));
  prepare.mockResolvedValue({ ok: true, data: plan() });
  newOperation.mockResolvedValue(operation());
});

describe("independent copy panel (synthetic UI evidence)", () => {
  it.each([true, false])("omits the sharing editor and requests no overrides while preserving the prepared copy (existing sharing: %s)", async (present) => {
    const values = { MaximumShareLimit: "-1", IsGroupSharingDisabled: "false",
      IsGuestSharingDisabled: "true", IsViralSharingDisabled: "false" };
    const next: ClonePlan = { ...plan([]), managedAppSharing: { present, configurable: true, values: present ? values : {} },
      ...(present ? { trialRules: [{ sourceRuleId: "source-rule-id", bucket: "Sharing/MicrosoftApp" as const }] } : {}) };
    next.rules[0].parameters = [
      ...(present ? [{ type: "Sharing", resourceType: "MicrosoftApp",
        value: Object.entries(values).map(([id, value]) => ({ id, value })) }] : []),
      { type: "Sharing", resourceType: "UsersBot", value: [{ id: "MaximumShareLimit", value: "99" }] },
    ];
    const original = structuredClone(next);
    prepare.mockResolvedValue({ ok: true, data: next });
    execute.mockResolvedValue({ operation: { ...operation(), phase: "failed" }, message: "Synthetic stopped copy" });
    renderPanel(); await review();
    await screen.findByRole("checkbox", { name: /^Create / });
    expect(screen.queryByText("Managed app sharing (optional)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Maximum share limit")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Disable group sharing")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { hidden: true })).not.toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(prepare).toHaveBeenCalledWith("source-id", "New empty group", expect.any(AbortSignal), "Source description");
    fireEvent.click(screen.getByRole("checkbox", { name: /^Create / }));
    fireEvent.click(screen.getByRole("button", { name: "Create independent copy" }));
    await waitFor(() => expect(execute).toHaveBeenCalledWith(next, expect.anything(), expect.anything(), expect.anything(), true, false, present, false));
    expect(next).toEqual(original);
  });
  it("uses one explicit confirmation with scoped sharing risk and collapsed technical diagnostics", async () => {
    const next: ClonePlan = { ...plan([]), trialRules: [{ sourceRuleId: "source-rule-id", bucket: "Sharing/MicrosoftApp", sourceManagedBy: "IT" }] };
    prepare.mockResolvedValue({ ok: true, data: next });
    execute.mockResolvedValue({ operation: { ...operation(), phase: "failed" }, message: "Synthetic rejected trial" });
    renderPanel(); await review();
    expect(await screen.findByText(/Managed app sharing is checked after creation/)).toBeVisible();
    expect(screen.getByText(/Managed app sharing was returned successfully/)).not.toBeVisible();
    expect(screen.getByText("Technical details").closest("details")).not.toHaveAttribute("open");
    const regular = () => screen.getByRole("checkbox", { name: /^Create / });
    const create = () => screen.getByRole("button", { name: "Create independent copy" });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(create()).toBeDisabled();
    expect(execute).not.toHaveBeenCalled();
    fireEvent.click(regular());
    expect(create()).toBeEnabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "Fresh trial review" } });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review copy" }));
    expect(await screen.findByRole("checkbox", { name: /^Create / })).not.toBeChecked();
    fireEvent.click(regular()); fireEvent.click(create());
    await waitFor(() => expect(execute).toHaveBeenCalledWith(next, expect.anything(), expect.anything(), expect.anything(), true, false, true, false));
    expect(await screen.findByText("Synthetic rejected trial")).toBeVisible();
  });
  it("retains the independent-sharing trial warning in recovery history", async () => {
    loadRecords.mockReturnValue([{ ...operation(), phase: "failed", destinationId: "returned-group-id",
      trialRules: [{ sourceRuleId: "source-rule-id", bucket: "Sharing/MicrosoftApp", sourceManagedBy: "IT" }] }]);
    renderPanel();
    fireEvent.click(screen.getByText(/Copy history and recovery/));
    fireEvent.click(screen.getByText("Operation details"));
    expect(screen.getByText(/Sharing\/MicrosoftApp trial; source management was not copied/)).toBeVisible();
  });
  it("discloses independently managed rules before explicit confirmation and retains the notice in history", async () => {
    const independentRules: NonNullable<ClonePlan["independentRules"]> = [
      { id: "MicrosoftAppsContentSecurityPolicy", sourceManagedBy: "Microsoft" },
      { id: "MicrosoftAppsAppCreationFromCLI", sourceManagedBy: "Microsoft" },
    ];
    const next = { ...plan([]), independentRules, connectionTypeModes: { omitted: 1370, total: 1394 } };
    prepare.mockResolvedValue({ ok: true, data: next });
    loadRecords.mockReturnValue([{ ...operation(), independentRules, phase: "verified" }]);
    execute.mockResolvedValue({ operation: { ...operation(), phase: "failed" }, message: "Synthetic stopped copy" });
    renderPanel(); await review();
    expect(await screen.findByText(/Independent settings; source-managed updates are not copied/)).toBeVisible();
    expect(screen.getByText(/1370 of 1394 connectors omit the connection-type mode/)).not.toBeVisible();
    const accept = screen.getByRole("checkbox", { name: /^Create / });
    expect(accept).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Create independent copy" })).toBeDisabled();
    expect(execute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Technical details"));
    expect(screen.getByText(/1370 of 1394 connectors omit the connection-type mode/)).toBeVisible();
    fireEvent.click(screen.getByText(/Copy history and recovery/));
    fireEvent.click(screen.getByText("Operation details"));
    expect(screen.getAllByText(/Rules: MicrosoftAppsContentSecurityPolicy, MicrosoftAppsAppCreationFromCLI/).every((node) => node.closest("details")?.open)).toBe(true);
    fireEvent.click(accept); fireEvent.click(screen.getByRole("button", { name: "Create independent copy" }));
    await waitFor(() => expect(execute).toHaveBeenCalledWith(next, expect.anything(), expect.anything(), expect.anything(), true, false, false, false));
  });
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
    expect(screen.getByText("Technical details").closest("details")).not.toHaveAttribute("open");
    const confirmation = screen.getByRole("checkbox", { name: /I accept the listed skipped rules: governance will be incomplete/ });
    const create = screen.getByRole("button", { name: "Create partial copy" });
    expect(create).toBeDisabled();
    expect(execute).not.toHaveBeenCalled();
    fireEvent.click(confirmation); fireEvent.click(create);
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith(outcome));
    expect(execute).toHaveBeenCalledWith(partialPlan, expect.anything(), expect.anything(), expect.anything(), true, true, false, false);
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
    fireEvent.click(screen.getByText("Technical details"));
    fireEvent.click(screen.getByText(/Copy history and recovery/));
    fireEvent.click(screen.getByText("Operation details"));
    expect(screen.getByText(/Skipped MicrosoftAppsContentSecurityPolicy: Unsupported field: managedBy/)).toBeInTheDocument();
  });
  it("uses a fresh preflight and shows concrete source/destination, both-model scope and the publication blocker", async () => {
    renderPanel(); await review();
    expect(await screen.findByText("Synthetic source → New empty group")).toBeInTheDocument();
    expect(prepare).toHaveBeenCalledWith("source-id", "New empty group", expect.any(AbortSignal), "Source description");
    expect(screen.getByText(/Copy isn't ready:/)).toHaveTextContent("Publication is unknown");
    expect(screen.queryByRole("button", { name: /Create independent copy/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("Technical details").closest("details")).not.toHaveAttribute("open");
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
    expect(screen.getByText(/Applied settings only; pending admin-center changes aren't copied/)).toBeVisible();
    expect(screen.getByRole("checkbox")).toHaveAccessibleName(/reviewed independent settings and a separate ACP/);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Create independent copy" })).not.toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "New group name" }), { target: { value: "Changed name" } });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(execute).not.toHaveBeenCalled();
  });
  it("permits a separately acknowledged new copy while preserving legacy uncertain history", async () => {
    const record = { ...operation(), id: "old-uncertain", phase: "indeterminate" as const, destinationId: "returned-group-id", steps: [{ key: "create-policy", outcome: "started" as const }] };
    loadRecords.mockReturnValue([record]);
    prepare.mockResolvedValue({ ok: true, data: plan([]) });
    execute.mockResolvedValue({ operation: { ...operation(), phase: "failed" }, message: "Synthetic stopped copy" });
    renderPanel(); await review();
    const separate = await screen.findByRole("checkbox", { name: /^Start a separate new copy/ });
    expect(separate).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: /^Create / }));
    expect(screen.getByRole("button", { name: "Create independent copy" })).toBeDisabled();
    expect(execute).not.toHaveBeenCalled();
    expect(screen.getByText(/Copy history and recovery/).closest("details")).not.toHaveAttribute("open");
    fireEvent.click(separate);
    fireEvent.click(screen.getByRole("button", { name: "Create independent copy" }));
    await waitFor(() => expect(execute).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.anything(), true, false, false, true));
    expect(loadRecords()).toEqual([record]);
  });
  it.each([1, 2] as const)("blocks the same uncertain destination intent even when the previous operation has a different ID (v%s)", async (version) => {
    const next = plan([]), intent = await cloneIntent(next);
    const record: CloneOperation = { ...operation(), id: "earlier-same-intent", version, phase: "indeterminate",
      planFingerprint: intent.planFingerprint, ...(version === 2 ? { destinationFingerprint: intent.destinationFingerprint } : {}) };
    loadRecords.mockReturnValue([record]); prepare.mockResolvedValue({ ok: true, data: next });
    renderPanel(); await review();
    expect(await screen.findByText(/already has this destination request/)).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create independent copy" })).not.toBeInTheDocument();
    expect(execute).not.toHaveBeenCalled();
  });
  it("clears both confirmations when a separate-copy destination changes", async () => {
    loadRecords.mockReturnValue([{ ...operation(), id: "legacy-incomplete", phase: "indeterminate" }]);
    prepare.mockResolvedValue({ ok: true, data: plan([]) });
    renderPanel(); await review();
    fireEvent.click(await screen.findByRole("checkbox", { name: /^Start a separate new copy/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^Create / }));
    expect(screen.getByRole("button", { name: "Create independent copy" })).toBeEnabled();
    fireEvent.change(screen.getByRole("textbox", { name: "New group name" }), { target: { value: "Another empty group" } });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review copy" }));
    expect(await screen.findByRole("checkbox", { name: /^Start a separate new copy/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Create / })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Create independent copy" })).toBeDisabled();
    expect(execute).not.toHaveBeenCalled();
  });
  it("reviews an obsolete incomplete copy by recorded IDs without entering the original form or marking it verified", async () => {
    const onCompleted = vi.fn(), record: CloneOperation = { ...operation(), id: "old-override",
      phase: "indeterminate", destinationId: "returned-group-id", planFingerprint: "obsolete-override" };
    loadRecords.mockReturnValue([record]);
    renderPanel(onCompleted);
    fireEvent.click(screen.getByText(/Copy history and recovery/));
    const inspectButton = screen.getByRole("button", { name: "Review existing copy (read only)" });
    expect(inspectButton).toBeEnabled();
    expect(screen.getByRole("link", { name: "Open recorded destination group" })).toHaveAttribute("href", expect.stringContaining("returned-group-id"));
    fireEvent.click(inspectButton);
    expect(await screen.findByRole("status")).toHaveTextContent("not full verification");
    expect(inspect).toHaveBeenCalledWith(record, expect.anything(), expect.anything());
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(onCompleted).not.toHaveBeenCalled();
  });
  it("shows a live lock error without permanently disabling later fresh reviews", async () => {
    prepare.mockResolvedValue({ ok: true, data: plan([]) });
    locked.mockRejectedValueOnce(new Error("Another group copy is active"));
    renderPanel(); await review();
    fireEvent.click(await screen.findByRole("checkbox", { name: /^Create / }));
    fireEvent.click(screen.getByRole("button", { name: "Create independent copy" }));
    expect(await screen.findByText(/Another group copy is active/)).toBeVisible();
    expect(newOperation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review copy" }));
    expect(await screen.findByRole("checkbox", { name: /^Create / })).not.toBeChecked();
    expect(screen.queryByText(/Another group copy is active/)).not.toBeInTheDocument();
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
