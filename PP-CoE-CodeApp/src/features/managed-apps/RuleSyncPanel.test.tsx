import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { SyncCatalog, SyncOutcome, SyncPlan, SyncSnapshot } from "./ruleSync";
const { groups, source, catalog, preview, apply, records } = vi.hoisted(() => ({
  groups: vi.fn(), source: vi.fn(), catalog: vi.fn(), preview: vi.fn(), apply: vi.fn(), records: vi.fn(),
}));
vi.mock("./data", async () => ({
  ...await vi.importActual<typeof import("./data")>("./data"), loadRuleSyncGroups: groups,
}));
vi.mock("./ruleSync", async () => ({
  ...await vi.importActual<typeof import("./ruleSync")>("./ruleSync"), ruleSyncCatalog: catalog,
}));
vi.mock("./ruleSyncData", () => ({
  readRuleSyncSource: source, prepareRuleSync: preview, runRuleSync: apply,
  reconcileRuleSyncRecord: vi.fn(),
  ruleSyncRuntimeBlocker: () => "", ruleSyncStore: { all: records }, ruleSyncBackend: {},
}));
import { RuleSyncPanel } from "./RuleSyncPanel";
const choices: SyncCatalog = {
  rules: [
    { key: "one", label: "Maximum share limit", kind: "setting", bucket: { type: "Sharing", resourceType: "UsersBot" }, setting: { id: "MaximumShareLimit", value: "10" } },
    { key: "two", label: "Copilot transcripts", kind: "policy", module: { id: "CopilotTranscripts", version: "1.0", inputs: {} } },
  ], exclusions: [{ label: "Unsafe ownership rule", reason: "No safe write contract" }], blockers: [],
};
const snapshot: SyncSnapshot = {
  group: { id: "destination-one", displayName: "Destination one" }, rules: [], policy: { id: "policy-one" },
  assignments: [], policyScope: [], environments: [], publication: "applied", publicationEvidence: "Synthetic", blockers: [],
};
const plan: SyncPlan = {
  sourceId: "source", sourceName: "Source group", sourceFingerprint: "hash", selected: ["one"],
  targets: [{ id: "destination-one", name: "Destination one", before: snapshot, after: snapshot,
    changes: [{ key: "one", label: "Maximum share limit", action: "replace", before: "5", after: "10" }], steps: [], blockers: [] }],
  blockers: [], exclusions: choices.exclusions,
};
beforeEach(() => {
  vi.clearAllMocks();
  source.mockResolvedValue({ ok: true, data: snapshot });
  catalog.mockResolvedValue(choices);
  groups.mockResolvedValue({ ok: true, data: [{ id: "source", displayName: "Source group" },
    { id: "destination-one", displayName: "Destination one" }, { id: "destination-two", displayName: "Destination two" }] });
  preview.mockResolvedValue({ ok: true, data: plan });
  records.mockReturnValue([]);
  const outcome: SyncOutcome = { record: { version: 1, id: "operation", sourceId: "source", sourceFingerprint: "hash", planFingerprint: "hash", updatedAt: 123,
    phase: "verified", targets: [{ id: "destination-one", policyId: "policy-one", expected: "hash", phase: "verified",
      steps: [{ kind: "settings", resourceId: "rule-one", expected: "hash", phase: "verified" }] }] }, message: "Synthetic selected rules verified" };
  apply.mockResolvedValue(outcome);
});
const mount = (id = "source") => render(<FluentProvider theme={webLightTheme}><RuleSyncPanel sourceId={id} /></FluentProvider>);
async function choose() {
  fireEvent.click(await screen.findByRole("checkbox", { name: "Maximum share limit" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Destination one" }));
  fireEvent.click(screen.getByRole("button", { name: "Preview selected changes" }));
  await screen.findByText(/Source group: 1 checked rules/);
}
describe("quiet selective rule and group form (synthetic)", () => {
  it("starts with no checked rules or targets and shows specific unavailable rules", async () => {
    mount();
    await screen.findByRole("checkbox", { name: "Maximum share limit" });
    expect(screen.getAllByRole("checkbox").every((input) => input instanceof HTMLInputElement && !input.checked)).toBe(true);
    expect(screen.queryByRole("checkbox", { name: "Source group" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview selected changes" })).toBeDisabled();
    expect(screen.getByText("Unavailable rules (1)").closest("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Unavailable rules (1)"));
    expect(screen.getByText(/Unsafe ownership rule: No safe write contract/)).toBeVisible();
    expect(apply).not.toHaveBeenCalled();
  });
  it("previews only checked pairs, requires confirmation, and calls the one-time flow once", async () => {
    const written = vi.fn();
    window.addEventListener("ppcoe:managed-apps:rule-sync:written", written, { once: true });
    mount(); await choose();
    expect(preview).toHaveBeenCalledWith("source", ["one"], ["destination-one"], expect.any(AbortSignal));
    expect(screen.getByText(/Replace: Maximum share limit/)).toBeVisible();
    expect(screen.getByText(/Destination one · 0 affected environments/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply selected rules once" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Apply only these 1 rules once/ }));
    fireEvent.click(screen.getByRole("button", { name: "Apply selected rules once" }));
    expect(await screen.findByText("Synthetic selected rules verified")).toBeVisible();
    expect(apply).toHaveBeenCalledExactlyOnceWith(plan, true, expect.any(AbortSignal));
    expect(written.mock.calls[0][0].detail).toEqual({ targetIds: ["destination-one"] });
  });
  it("invalidates confirmation on either rule or group edits and on focus return", async () => {
    mount(); await choose();
    fireEvent.click(screen.getByRole("checkbox", { name: /Apply only these 1 rules once/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Copilot transcripts" }));
    expect(screen.queryByRole("button", { name: "Apply selected rules once" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview selected changes" }));
    await screen.findByRole("button", { name: "Apply selected rules once" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Destination two" }));
    expect(screen.queryByRole("button", { name: "Apply selected rules once" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview selected changes" }));
    await screen.findByRole("button", { name: "Apply selected rules once" });
    fireEvent.focus(window);
    expect(screen.queryByRole("button", { name: "Apply selected rules once" })).not.toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
  });
  it("does not silently deselect hidden checked groups during search", async () => {
    mount();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Destination one" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Find destination groups" }), { target: { value: "two" } });
    expect(screen.queryByRole("checkbox", { name: "Destination one" })).not.toBeInTheDocument();
    expect(screen.getByText(/1 checked groups/)).toBeVisible();
  });
  it("blocks shared or otherwise unsafe selections rather than applying a subset", async () => {
    preview.mockResolvedValue({ ok: true, data: { ...plan, blockers: ["Target ACP is shared with another group"] } });
    mount(); await choose();
    expect(screen.getByText("Target ACP is shared with another group")).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply selected rules once" })).toBeDisabled();
    expect(apply).not.toHaveBeenCalled();
  });
  it("aborts source loading on source switch and ignores old results", async () => {
    let finish!: (value: { ok: true; data: SyncSnapshot }) => void;
    source.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = mount();
    await waitFor(() => expect(source).toHaveBeenCalledTimes(1));
    const signal = source.mock.calls[0][1] as AbortSignal;
    view.rerender(<FluentProvider theme={webLightTheme}><RuleSyncPanel sourceId="new-source" /></FluentProvider>);
    await screen.findByRole("checkbox", { name: "Maximum share limit" });
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ ok: true, data: snapshot }));
    expect(source).toHaveBeenLastCalledWith("new-source", expect.any(AbortSignal));
    expect(screen.getAllByRole("checkbox").every((input) => input instanceof HTMLInputElement && !input.checked)).toBe(true);
  });
  it("aborts a stale pending preview when checked groups change and ignores its late result", async () => {
    let finish!: (value: { ok: true; data: SyncPlan }) => void;
    preview.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    mount();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Maximum share limit" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Destination one" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview selected changes" }));
    const signal = preview.mock.calls[0][3] as AbortSignal;
    fireEvent.click(screen.getByRole("checkbox", { name: "Destination two" }));
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ ok: true, data: plan }));
    expect(screen.queryByRole("button", { name: "Apply selected rules once" })).not.toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
  });
  it("keeps overlapping uncertain operations from other source groups visible with read-only recovery", async () => {
    records.mockReturnValue([{
      version: 1, id: "other-operation", sourceId: "another-source", sourceFingerprint: "hash", planFingerprint: "hash", updatedAt: 123,
      phase: "indeterminate", targets: [{ id: "source", policyId: "policy-source", expected: "hash", phase: "indeterminate",
        steps: [{ kind: "policy", resourceId: "policy-source", expected: "hash", phase: "started" }] }],
    }]);
    mount();
    expect(await screen.findByText("Previous sync needs reconciliation")).toBeVisible();
    expect(screen.getByText("Sync history and recovery").closest("details")).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Reconcile sync (read only)" })).toBeVisible();
  });
  it("surfaces authorization/read failures and uncertain outcomes without a success notice", async () => {
    source.mockResolvedValueOnce({ ok: false, error: "403 AuthorizationFailed" });
    mount();
    expect(await screen.findByText("403 AuthorizationFailed")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Preview selected changes" })).not.toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
  });
});
