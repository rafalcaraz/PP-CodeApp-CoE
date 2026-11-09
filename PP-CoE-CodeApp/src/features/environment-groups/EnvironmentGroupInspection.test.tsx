import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { createMemoryRouter, createRoutesFromElements, RouterProvider } from "react-router-dom";
import type { EnvironmentGroupRow } from "./data";
import type { GroupEvidence } from "../managed-apps/governance";
import type { CloneOperation, CloneOutcome, ClonePlan } from "../managed-apps/groupClone";

const { evidence, prepare, execute, operation } = vi.hoisted(() => ({
  evidence: vi.fn(), prepare: vi.fn(), execute: vi.fn(), operation: vi.fn(),
}));
vi.mock("./data", async () => ({
  ...await vi.importActual<typeof import("./data")>("./data"),
  getEnvironmentGroup: vi.fn(async (id: string) => ({
    ok: true, data: { row: row(id), raw: {} },
  })),
  listEnvironmentsInGroup: vi.fn(async () => ({ ok: true, data: [] })),
  countResourcesByTypeForGroup: vi.fn(async () => ({ ok: true, data: [] })),
}));
vi.mock("../managed-apps/governance", async () => ({
  ...await vi.importActual<typeof import("../managed-apps/governance")>("../managed-apps/governance"),
  loadGroupEvidenceBatch: evidence,
}));
vi.mock("../managed-apps/groupCloneData", async () => ({
  ...await vi.importActual<typeof import("../managed-apps/groupCloneData")>("../managed-apps/groupCloneData"),
  prepareGroupClone: prepare, loadCloneOperations: () => [], groupCloneStore: { read: vi.fn(), save: vi.fn() },
}));
vi.mock("../managed-apps/groupClone", async () => ({
  ...await vi.importActual<typeof import("../managed-apps/groupClone")>("../managed-apps/groupClone"),
  executeGroupClone: execute, newCloneOperation: operation,
}));
import { environmentGroupsRoutes } from "./index";
import { GroupGovernanceInspector } from "../managed-apps";

function row(id = "fixture-group-one"): EnvironmentGroupRow {
  return {
    id, displayName: `Group ${id}`, description: `Inventory description ${id}`,
    location: "", createdAt: "", createdBy: "", lastModifiedAt: "",
  };
}
function groupEvidence(id = "fixture-group-one"): GroupEvidence {
  return {
    groupId: id, capturedAt: 123,
    details: { ok: true, data: { id, displayName: `Group ${id}`, description: `Applied description ${id}` } },
    rulesets: { ok: true, data: { matching: [{
      id: `rule-${id}`, environmentFilter: { type: "Include", values: [{ type: "EnvironmentGroup", id }] },
      parameters: [{ type: "Sharing", resourceType: "UsersBot", value: [{ id: "MaximumShareLimit", value: "99" }] }],
    }], unresolved: [] } },
    policies: { ok: true, data: [{
      id: `policy-${id}`, name: `ACP ${id}`, ruleSets: [{
        id: "ConnectorManagement", version: "1.0", inputs: { AllowedConnectorList: [{
          AllowedConnector: "shared_sql", AllowedActionsMode: "AllAllowed", AllowedConnectionTypesMode: "AllAllowed",
        }] },
      }],
    }] },
  };
}
function renderDetail() {
  const router = createMemoryRouter(createRoutesFromElements(environmentGroupsRoutes(GroupGovernanceInspector)), {
    initialEntries: ["/environment-groups/fixture-group-one"],
  });
  return {
    router,
    ...render(<FluentProvider theme={webLightTheme}>
      <Suspense fallback={<div>Loading route...</div>}><RouterProvider router={router} /></Suspense>
    </FluentProvider>),
  };
}
async function openInspection() {
  await user.click(await screen.findByRole("button", { name: "View rules & ACP" }));
  const drawer = await screen.findByRole("dialog", { hidden: true });
  // Give Fluent's modalizer explicit focus in JSDOM, which has no browser layout/autofocus.
  await act(async () => drawer.focus());
  await screen.findByRole("dialog");
}
let user: ReturnType<typeof userEvent.setup>;
beforeEach(() => {
  user = userEvent.setup();
  vi.clearAllMocks(); localStorage.clear();
  evidence.mockImplementation(async ([id]: string[]) => [groupEvidence(id)]);
});

describe("Environment group inspection via app-composed public APIs (synthetic)", () => {
  it("loads only the selected empty group's evidence on demand and keeps copying/raw detail quiet", async () => {
    renderDetail();
    expect(await screen.findByText("No environments are assigned to this group.")).toBeVisible();
    expect(evidence).not.toHaveBeenCalled();
    await openInspection();
    expect(await screen.findByText("ACP fixture-group-one")).toBeVisible();
    expect(evidence).toHaveBeenCalledExactlyOnceWith(["fixture-group-one"], expect.any(AbortSignal));
    expect(screen.getByText("Group settings and policy details").closest("details")).toHaveAttribute("open");
    expect(screen.getByText("Duplicate environment group", { selector: "summary" }).closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Sync rules to other groups", { selector: "summary" }).closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText("Rules to apply")).not.toBeInTheDocument();
    expect(screen.getByText("Policy settings (1)").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText(/Configuration only, not a runtime permission verdict/)).toBeVisible();
    expect(screen.getByRole("textbox", { name: "New group name" })).not.toBeVisible();
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(["no-policy", "denied", "rules-unavailable"])("distinguishes %s from unrestricted runtime access", async (state) => {
    const value = groupEvidence();
    if (state === "no-policy") value.policies = { ok: true, data: [] };
    if (state === "denied") value.policies = { ok: false, error: "403 PolicyReadDenied" };
    if (state === "rules-unavailable") value.rulesets = { ok: false, error: "TenantRulesUnavailable" };
    evidence.mockResolvedValue([value]);
    renderDetail(); await openInspection();
    if (state === "no-policy") {
      expect(await screen.findByText(/No policy assignments were returned. Connector permissions are unknown/)).toBeVisible();
    } else {
      expect(await screen.findByText(state === "denied" ? "Connector permissions unavailable" : "Group rules unavailable")).toBeVisible();
      expect(screen.queryByText(/No policy assignments were returned/)).not.toBeInTheDocument();
      if (state === "rules-unavailable") expect(screen.getByText("ACP fixture-group-one")).toBeVisible();
    }
    expect(execute).not.toHaveBeenCalled();
  });
  it("reports failed inspection explicitly and refreshes the same source without a write", async () => {
    evidence.mockRejectedValueOnce(new Error("503 GovernanceUnavailable"));
    renderDetail(); await openInspection();
    expect(await screen.findByText("Group governance unavailable")).toBeVisible();
    expect(screen.getByText(/503 GovernanceUnavailable/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Refresh rules & ACP" }));
    expect(await screen.findByText("ACP fixture-group-one")).toBeVisible();
    expect(evidence).toHaveBeenCalledTimes(2);
    expect(evidence.mock.calls.every(([ids]) => ids.length === 1 && ids[0] === "fixture-group-one")).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects foreign evidence rather than displaying another group's configuration", async () => {
    evidence.mockResolvedValue([groupEvidence("foreign-group")]);
    renderDetail(); await openInspection();
    expect(await screen.findByText(/No governance evidence was returned for the selected group/)).toBeVisible();
    expect(screen.queryByText("ACP foreign-group")).not.toBeInTheDocument();
  });
  it("cancels a pending read on close and reads fresh evidence when reopened", async () => {
    let finish!: (value: GroupEvidence[]) => void;
    evidence.mockImplementationOnce(() => new Promise<GroupEvidence[]>((resolve) => { finish = resolve; }));
    renderDetail(); await openInspection();
    expect(await screen.findByText("Loading group properties, rules and ACP evidence...")).toBeVisible();
    const signal = evidence.mock.calls[0][1] as AbortSignal;
    await user.click(screen.getByRole("button", { name: "Close group inspection" }));
    await waitFor(() => expect(signal.aborted).toBe(true));
    const stale = groupEvidence();
    if (stale.policies.ok) stale.policies.data[0].name = "Stale previous inspection";
    await act(async () => finish([stale]));
    await openInspection();
    expect(await screen.findByText("ACP fixture-group-one")).toBeVisible();
    expect(screen.queryByText("Stale previous inspection")).not.toBeInTheDocument();
    expect(evidence).toHaveBeenCalledTimes(2);
  });
  it("aborts late evidence on group navigation and initializes copying for the new source", async () => {
    let finish!: (value: GroupEvidence[]) => void;
    evidence.mockImplementationOnce(() => new Promise<GroupEvidence[]>((resolve) => { finish = resolve; }));
    const { router } = renderDetail(); await openInspection();
    await waitFor(() => expect(evidence).toHaveBeenCalledTimes(1));
    const signal = evidence.mock.calls[0][1] as AbortSignal;
    await act(async () => { await router.navigate("/environment-groups/fixture-group-two"); });
    await waitFor(() => expect(signal.aborted).toBe(true));
    expect((await screen.findAllByText("Group fixture-group-two")).length).toBeGreaterThan(0);
    await act(async () => finish([groupEvidence("fixture-group-one")]));
    expect(screen.queryByText("ACP fixture-group-one")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "View rules & ACP" }));
    expect(await screen.findByText("ACP fixture-group-two")).toBeVisible();
    await user.click(screen.getByText("Duplicate environment group", { selector: "summary" }));
    // Test source identity, not Tabster's stale modal accessibility state after JSDOM route replacement.
    expect(await screen.findByLabelText("Description")).toHaveValue("Applied description fixture-group-two");
    expect(screen.getByLabelText("New group name")).toHaveValue("");
    expect(evidence).toHaveBeenLastCalledWith(["fixture-group-two"], expect.any(AbortSignal));
  });
  it.each(["Description for new group", ""])("reuses explicit partial-copy confirmation and reviewed description %j", async (description) => {
    const skipped: NonNullable<ClonePlan["skipped"]> = [{
      kind: "policy-module", id: "MicrosoftAppsContentSecurityPolicy", reasons: ["Unsupported field: managedBy."],
    }];
    const record: CloneOperation = {
      version: 1, id: "synthetic-copy", sourceId: "fixture-group-one", sourceFingerprint: "synthetic", planFingerprint: "synthetic",
      phase: "planned", rules: [], steps: [], updatedAt: 123, skipped,
    };
    operation.mockResolvedValue(record);
    prepare.mockImplementation(async (id, name, _signal, value) => ({ ok: true, data: {
      sourceId: id, sourcePolicyId: "source-policy", sourceRuleIds: [], sourceFingerprint: "synthetic",
      preparedAt: 123, publication: "applied", group: { displayName: name, description: value },
      rules: [], policy: { name: "Independent ACP", ruleSets: [] }, copied: [], skipped, blockers: [],
    } satisfies ClonePlan }));
    const outcome: CloneOutcome = {
      operation: { ...record, phase: "created-with-omissions", destinationId: "created-group", policyId: "created-acp" },
      message: "Synthetic copy created with omissions. Governance is incomplete.",
      destinationUrl: "https://admin.powerplatform.microsoft.com/manage/envgroups/created-group/details",
    };
    execute.mockResolvedValue(outcome);
    renderDetail(); await openInspection();
    await screen.findByText("ACP fixture-group-one");
    await user.click(screen.getByText("Duplicate environment group", { selector: "summary" }));
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("Applied description fixture-group-one");
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: description } });
    fireEvent.change(screen.getByRole("textbox", { name: "New group name" }), { target: { value: "New empty group" } });
    await user.click(screen.getByRole("button", { name: "Review copy" }));
    expect(await screen.findByText("MicrosoftAppsContentSecurityPolicy")).toBeVisible();
    expect(prepare).toHaveBeenCalledWith("fixture-group-one", "New empty group", expect.any(AbortSignal), description);
    expect(screen.getByRole("button", { name: "Create partial copy" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /I accept the listed skipped rules/ }));
    await user.click(screen.getByRole("button", { name: "Create partial copy" }));
    expect(await screen.findByText(outcome.message)).toBeVisible();
    expect(await screen.findByRole("link", { name: "Open verified destination group in admin center" })).toHaveAttribute("href", outcome.destinationUrl);
    expect(screen.getByText(/MicrosoftAppsContentSecurityPolicy: Unsupported field: managedBy/)).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "New group name" })).not.toBeInTheDocument();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ group: { displayName: "New empty group", description } }),
      record, expect.anything(), expect.anything(), true, true);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
