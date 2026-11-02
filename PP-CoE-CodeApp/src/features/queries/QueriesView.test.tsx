import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { runRawQuery, downloadCsv } = vi.hoisted(() => ({ runRawQuery: vi.fn(), downloadCsv: vi.fn() }));
vi.mock("../../data/inventory", async (original) => ({
  ...await original<typeof import("../../data/inventory")>(),
  runRawQuery, getEnvironmentNameMap: vi.fn().mockResolvedValue(new Map([["env", "Production"]])),
}));
vi.mock("../../shared/connector-catalog", () => ({ useConnectorCatalog: () => ({ catalog: null }) }));
vi.mock("../../utils/csv", async (original) => ({ ...await original<typeof import("../../utils/csv")>(), downloadCsv }));
vi.mock("../../components/UserChip", () => ({ UserChip: ({ id }: { id: string }) => <span>Owner {id}</span> }));
vi.mock("../../components/EnvironmentPicker", () => ({ EnvironmentPicker: () => <span>Environment selector</span> }));
import { QueriesView } from "./QueriesView";
import { rememberExecution } from "./execution";
import { createSavedQuery } from "../../data/savedQueries";
import { buildClausesFromSpec, ResourceType, type QuerySpec } from "../../data/inventory";
import { DEFAULT_SPEC, readWorkspace } from "./workspace";
import type { Clause } from "../../generated/models/PowerPlatformforAdminsV2Model";
const item = (name: string) => ({ name, type: ResourceType.CanvasApp, properties: { displayName: `App ${name}`, environmentId: "env", ownerId: "owner" } });
const success = (items: unknown[], token?: string) => ({ ok: true, data: { items, skipToken: token, totalRecords: 1 } });
const groupedSpec = (): QuerySpec => ({
  ...DEFAULT_SPEC, filters: [],
  conditions: { kind: "group", operator: "all", children: [
    { kind: "condition", filter: { field: "properties.environmentId", op: "==", value: "env" } },
    { kind: "group", operator: "any", children: [
      { kind: "condition", filter: { field: "properties.isQuarantined", op: "==", value: "true" } },
      { kind: "condition", filter: { field: "properties.isManaged", op: "==", value: "false" } },
    ] },
  ] },
});
function saveGrouped(spec = groupedSpec()) {
  return createSavedQuery({ name: "Production risk", description: "", source: "builder", spec, clauses: buildClausesFromSpec(spec) });
}
function loadGrouped() {
  fireEvent.click(screen.getByRole("button", { name: /Show saved queries/ }));
  fireEvent.click(screen.getByRole("button", { name: "Production risk" }));
}
function pairedOrSpec(): QuerySpec {
  return {
    ...DEFAULT_SPEC, filters: [],
    conditions: { kind: "group", operator: "any", children: [
      { kind: "condition", filter: { field: "location", op: "==", value: "europe" } },
      { kind: "condition", filter: { field: "__operation", op: "==", value: "GetItems", connectorId: "shared_sharepointonline" } },
    ] },
  };
}
function withEvidence(clauses: Clause[], row: ReturnType<typeof item>, value: boolean | null) {
  const keys = clauses.flatMap((clause) => clause.$type === "extend" && "FieldName" in clause && typeof clause.FieldName === "string" &&
    clause.FieldName.startsWith("__queryEvidence_") ? [clause.FieldName] : []);
  expect(keys).toHaveLength(1);
  return { ...row, ...Object.fromEntries(keys.map((key) => [key, value])) };
}
function mount() {
  return render(<FluentProvider theme={webLightTheme}><MemoryRouter><QueriesView /></MemoryRouter></FluentProvider>);
}
async function runFirst(token?: string) {
  runRawQuery.mockResolvedValueOnce(success([item("one")], token));
  fireEvent.click(screen.getByRole("button", { name: "Run query" }));
  await waitFor(() => expect(screen.getByRole("link", { name: "App one" })).toBeInTheDocument());
}
beforeEach(() => {
  runRawQuery.mockReset(); downloadCsv.mockReset();
  localStorage.clear(); sessionStorage.clear(); rememberExecution(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("Queries investigation workspace", () => {
  it("marks edits stale and never uses an old token with edited clauses/options", async () => {
    mount(); await runFirst("next");
    fireEvent.change(screen.getByLabelText("Page size (1-500)"), { target: { value: "25" } });
    expect(screen.getByText(/Query changed - run again/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export complete result" })).toBeDisabled();
    expect(runRawQuery).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "App one" })).toBeInTheDocument();
  });
  it("rejects late responses after draft edits and mode changes", async () => {
    let resolve!: (value: ReturnType<typeof success>) => void;
    runRawQuery.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));
    fireEvent.change(screen.getByLabelText("Page size (1-500)"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    await act(async () => { resolve(success([item("late")], "old")); });
    expect(screen.queryByRole("link", { name: "App late" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    runRawQuery.mockResolvedValueOnce(success([{ Count: 7 }]));
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(runRawQuery).toHaveBeenCalledTimes(2));
  });
  it("retains loaded rows and shows load-more failures, with both offset and token on retry", async () => {
    mount(); await runFirst("next");
    runRawQuery.mockResolvedValueOnce({ ok: false, error: "Page unavailable" });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByText(/Load more failed: Page unavailable/)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "App one" })).toBeInTheDocument();
    expect(runRawQuery.mock.calls[1][1]).toEqual({ Top: 50, Skip: 1, SkipToken: "next" });
    runRawQuery.mockResolvedValueOnce(success([item("two")]));
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "App two" })).toBeInTheDocument());
  });
  it("does not download failed all-export until explicitly choosing partial", async () => {
    mount(); await runFirst("next");
    runRawQuery.mockResolvedValueOnce({ ok: false, error: "Export unavailable" });
    fireEvent.click(screen.getByRole("button", { name: "Export complete result" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Download partial CSV (1)" })).toBeInTheDocument());
    expect(downloadCsv).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Download partial CSV (1)" }));
    expect(downloadCsv.mock.calls[0][0]).toBe("inventory-query-partial-columns");
    expect(downloadCsv.mock.calls[0][1]).toContain("one");
  });
  it("downloads a complete export only after the final authoritative token ends", async () => {
    mount(); await runFirst("next");
    runRawQuery.mockResolvedValueOnce(success([item("two")]));
    fireEvent.click(screen.getByRole("button", { name: "Export complete result" }));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(1));
    expect(downloadCsv.mock.calls[0][0]).toBe("inventory-query-all-columns");
    expect(downloadCsv.mock.calls[0][1]).toContain("App two");
    expect(screen.getByText(/2 loaded - complete/)).toBeInTheDocument();
  });
  it("restores unsaved draft, mode, view settings and memory results after leaving and returning", async () => {
    const first = mount(); await runFirst("next");
    fireEvent.change(screen.getByLabelText("Page size (1-500)"), { target: { value: "77" } });
    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    fireEvent.change(screen.getByLabelText("Advanced clauses JSON"), { target: { value: "{invalid draft" } });
    first.unmount();
    mount();
    expect(screen.getByRole("tab", { name: "Advanced" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Advanced clauses JSON")).toHaveValue("{invalid draft");
    expect(screen.getByLabelText("Page size (1-500)")).toHaveValue(77);
    expect(screen.getByRole("link", { name: "App one" })).toBeInTheDocument();
    expect(screen.getByText(/Query changed - run again/)).toBeInTheDocument();
    expect(readWorkspace().draft.mode).toBe("advanced");
    await waitFor(() => expect(screen.getByText("Production")).toBeInTheDocument());
  });
  it("supports saved identity, content update vs save-as-new, favorites and search", async () => {
    const q = createSavedQuery({ name: "Original", description: "Example", source: "builder", spec: DEFAULT_SPEC, clauses: buildClausesFromSpec(DEFAULT_SPEC), pageSize: 50 });
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Show saved queries/ }));
    fireEvent.click(screen.getByRole("button", { name: "Original" }));
    fireEvent.change(screen.getByLabelText("Page size (1-500)"), { target: { value: "80" } });
    expect(screen.getByText("Original - unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update existing" }));
    expect(screen.getByText("Original - saved")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("ppcoe.savedQueries.v1")!)[0]).toMatchObject({ id: q.id, pageSize: 80 });
    fireEvent.click(screen.getByRole("button", { name: "Favorite Original" }));
    expect(screen.getByRole("button", { name: "Unfavorite Original" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Save as new" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Second" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(JSON.parse(localStorage.getItem("ppcoe.savedQueries.v1")!)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Search saved queries and templates"), { target: { value: "Second" } });
    expect(screen.queryByRole("button", { name: "Original" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Second" })).toBeInTheDocument();
  });
  it("shows failed saves without closing the dialog or claiming saved identity", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Save query" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Cannot save" } });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText(/Saved query was not changed: Quota exceeded/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("renders count/project output generically, without resource links or key collisions", async () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    fireEvent.change(screen.getByLabelText("Advanced clauses JSON"), { target: { value: '[{"$type":"count"}]' } });
    runRawQuery.mockResolvedValueOnce(success([{ Count: 7 }, { Count: 8 }]));
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(screen.getByRole("columnheader", { name: "Count" })).toBeInTheDocument());
    expect(screen.getByRole("cell", { name: "7" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "8" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Result columns")).not.toBeInTheDocument();
  });
  it("does not silently omit incomplete typed filters", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Add condition to root group" }));
    expect(screen.getByRole("button", { name: "Run query" })).toBeDisabled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
  it("drains and pairs connector-specific evidence before displaying or counting matches", async () => {
    const spec = { ...DEFAULT_SPEC, filters: [{ field: "__operation", op: "==" as const, value: "GetItems", connectorId: "shared_sharepointonline" }] };
    createSavedQuery({ name: "Paired evidence", description: "", source: "builder", spec, clauses: buildClausesFromSpec(spec) });
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Show saved queries/ }));
    fireEvent.click(screen.getByRole("button", { name: "Paired evidence" }));
    const wrong = { ...item("wrong"), properties: { ...item("wrong").properties, powerPlatformConnectors: [
      { connectorId: "shared_sharepointonline", operations: [] },
      { connectorId: "shared_other", operations: [{ operationId: "GetItems" }] },
    ] } };
    const right = { ...item("right"), properties: { ...item("right").properties, powerPlatformConnectors: [
      { connectorId: "shared_sharepointonline", operations: [{ operationId: "GetItems" }] },
    ] } };
    runRawQuery.mockResolvedValueOnce(success([wrong], "next")).mockResolvedValueOnce(success([right]));
    expect(screen.getByRole("button", { name: "Copy clauses JSON" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Advanced" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "App right" })).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "App wrong" })).not.toBeInTheDocument();
    expect(screen.getByText(/1 loaded - complete/)).toBeInTheDocument();
    expect(runRawQuery.mock.calls[1][1]).toMatchObject({ Skip: 1, SkipToken: "next" });
  });
  it("never presents incomplete paired candidate scans as confirmed matches", async () => {
    const spec = { ...DEFAULT_SPEC, filters: [{ field: "__operation", op: "==" as const, value: "GetItems", connectorId: "shared_sharepointonline" }] };
    createSavedQuery({ name: "Paired evidence", description: "", source: "builder", spec, clauses: buildClausesFromSpec(spec) });
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Show saved queries/ }));
    fireEvent.click(screen.getByRole("button", { name: "Paired evidence" }));
    runRawQuery.mockResolvedValueOnce(success([item("candidate")], "next")).mockResolvedValueOnce({ ok: false, error: "Scan interrupted" });
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(screen.getByText(/Paired evidence scan is incomplete/)).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "App candidate" })).not.toBeInTheDocument();
    expect(downloadCsv).not.toHaveBeenCalled();
  });
  it("ignores late responses after selecting a different saved query", async () => {
    const q = createSavedQuery({ name: "Another query", description: "", source: "builder",
      spec: { ...DEFAULT_SPEC, limit: 33 }, clauses: buildClausesFromSpec(DEFAULT_SPEC) });
    let resolve!: (value: ReturnType<typeof success>) => void;
    runRawQuery.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));
    fireEvent.click(screen.getByRole("button", { name: /Show saved queries/ }));
    fireEvent.click(screen.getByRole("button", { name: q.name }));
    await act(async () => { resolve(success([item("late")])); });
    expect(screen.queryByRole("link", { name: "App late" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Page size (1-500)")).toHaveValue(33);
  });
  it("ignores responses after navigating away instead of overwriting remembered results", async () => {
    const first = mount(); await runFirst("next");
    let resolve!: (value: ReturnType<typeof success>) => void;
    runRawQuery.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    first.unmount();
    await act(async () => { resolve(success([item("late")])); });
    mount();
    expect(screen.getByRole("link", { name: "App one" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "App late" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Production")).toBeInTheDocument());
  });
  it("surfaces clipboard failures", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("Permission denied")) } });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Copy clauses JSON" }));
    await waitFor(() => expect(screen.getByText(/Clipboard failed: Permission denied/)).toBeInTheDocument());
  });
  it("copies grouped runnable clauses, pastes them into Advanced, and sends the identical scoped payload", async () => {
    const clipboard = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    const spec = groupedSpec();
    saveGrouped(spec); mount(); loadGrouped();
    fireEvent.click(screen.getByRole("button", { name: "Copy clauses JSON" }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(1));
    const json = clipboard.mock.calls[0][0] as string;
    expect(JSON.parse(json)).toEqual(buildClausesFromSpec(spec));
    expect(json).toContain(" or ");
    expect(json).toContain(" and ");
    expect(json).toContain(ResourceType.CanvasApp);
    expect(json).not.toContain('"source"');
    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    fireEvent.change(screen.getByLabelText("Advanced clauses JSON"), { target: { value: json } });
    runRawQuery.mockResolvedValueOnce(success([item("scoped-risk")]));
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(runRawQuery).toHaveBeenCalledTimes(1));
    expect(runRawQuery.mock.calls[0][0]).toEqual(JSON.parse(json));
    expect(screen.getByRole("link", { name: "App scoped-risk" })).toBeInTheDocument();
  });
  it("roundtrips grouped saved queries through updates, reusable sharing, import and tab restoration", async () => {
    const clipboard = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    const q = saveGrouped();
    const first = mount(); loadGrouped();
    fireEvent.change(screen.getByLabelText("Condition 1 value"), { target: { value: "env-updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Update existing" }));
    const persisted = JSON.parse(localStorage.getItem("ppcoe.savedQueries.v1")!)[0];
    expect(persisted.id).toBe(q.id);
    expect(persisted.spec.filters).toEqual([]);
    expect(persisted.spec.conditions.children[0].filter.value).toBe("env-updated");
    fireEvent.click(screen.getByRole("button", { name: "Copy reusable query JSON" }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(1));
    const envelope = JSON.parse(clipboard.mock.calls[0][0]);
    expect(envelope.spec.conditions).toEqual(persisted.spec.conditions);
    fireEvent.click(screen.getByRole("button", { name: "Import query JSON" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reusable query or raw clauses JSON"), { target: { value: JSON.stringify(envelope) } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Import draft" }));
    expect(screen.queryByRole("button", { name: "Update existing" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Condition 1 value")).toHaveValue("env-updated");
    expect(screen.getByLabelText("Group 1 match")).toHaveTextContent("Match any (OR)");
    expect(readWorkspace().draft.spec.conditions).toEqual(persisted.spec.conditions);
    first.unmount(); mount();
    expect(screen.getByLabelText("Condition 1 value")).toHaveValue("env-updated");
    expect(screen.getByLabelText("Group 1 match")).toHaveTextContent("Match any (OR)");
    fireEvent.click(screen.getByRole("button", { name: "Save query" }));
    const newDialog = screen.getByRole("dialog");
    fireEvent.change(within(newDialog).getByLabelText("Name"), { target: { value: "Risk copy" } });
    fireEvent.click(within(newDialog).getByRole("button", { name: "Save" }));
    const copies = JSON.parse(localStorage.getItem("ppcoe.savedQueries.v1")!);
    expect(copies).toHaveLength(2);
    expect(copies.find((entry: { name: string }) => entry.name === "Risk copy").spec.conditions).toEqual(persisted.spec.conditions);
  });
  it("rejects deeper imported groups without flattening or replacing the existing draft", () => {
    saveGrouped(); mount(); loadGrouped();
    const invalid = groupedSpec();
    invalid.conditions!.children.push({ kind: "group", operator: "all", children: [
      { kind: "group", operator: "any", children: [
        { kind: "condition", filter: { field: "location", op: "==", value: "unknown" } },
      ] },
    ] });
    fireEvent.click(screen.getByRole("button", { name: "Import query JSON" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reusable query or raw clauses JSON"), { target: { value: JSON.stringify({
      source: "builder", spec: invalid, clauses: [{ $type: "count" }],
    }) } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Import draft" }));
    expect(within(dialog).getByText(/Imported builder spec is invalid or unsupported/)).toBeInTheDocument();
    expect(screen.getByLabelText("Condition 1 value")).toHaveValue("env");
    expect(readWorkspace().draft.spec.conditions).toEqual(groupedSpec().conditions);
  });
  it("disables run for an empty subgroup or incomplete nested condition until repaired", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Add group" }));
    expect(screen.getByRole("button", { name: "Run query" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove condition 1" }));
    expect(screen.getByText(/This group is empty/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run query" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove group 1" }));
    expect(screen.getByRole("button", { name: "Run query" })).toBeEnabled();
    fireEvent.click(screen.getByLabelText("Root group match"));
    fireEvent.click(screen.getByRole("option", { name: "Match any (OR)" }));
    expect(screen.getByRole("button", { name: "Run query" })).toBeDisabled();
  });
  it("keeps grouped execution immutable across pagination/export and makes operator changes stale", async () => {
    saveGrouped(); mount(); loadGrouped();
    await runFirst("next");
    const executed = structuredClone(runRawQuery.mock.calls[0][0]);
    runRawQuery.mockResolvedValueOnce(success([item("two")], "more"));
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "App two" })).toBeInTheDocument());
    expect(runRawQuery.mock.calls[1][0]).toEqual(executed);
    expect(runRawQuery.mock.calls[1][1]).toMatchObject({ Skip: 1, SkipToken: "next" });
    runRawQuery.mockResolvedValueOnce(success([item("three")]));
    fireEvent.click(screen.getByRole("button", { name: "Export complete result" }));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(1));
    expect(runRawQuery.mock.calls[2][0]).toEqual(executed);
    expect(runRawQuery.mock.calls[2][1]).toMatchObject({ Skip: 2, SkipToken: "more" });
    fireEvent.click(screen.getByLabelText("Group 1 match"));
    fireEvent.click(screen.getByRole("option", { name: "Match all (AND)" }));
    expect(screen.getByText(/Query changed - run again/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export complete result" })).toBeDisabled();
  });
  it("ignores an old grouped response after changing the root operator", async () => {
    saveGrouped(); mount(); loadGrouped();
    let resolve!: (value: ReturnType<typeof success>) => void;
    runRawQuery.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));
    fireEvent.click(screen.getByLabelText("Root group match"));
    fireEvent.click(screen.getByRole("option", { name: "Match any (OR)" }));
    await act(async () => { resolve(success([item("late-grouped")])); });
    expect(screen.queryByRole("link", { name: "App late-grouped" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run query" })).toBeEnabled();
  });
  it("drains ordinary OR paired evidence branches and strips internal booleans from raw exports", async () => {
    saveGrouped(pairedOrSpec()); mount(); loadGrouped();
    const wrong = { ...item("wrong-pair"), properties: { ...item("wrong-pair").properties, powerPlatformConnectors: [
      { connectorId: "shared_sharepointonline", operations: [] },
      { connectorId: "shared_other", operations: [{ operationId: "GetItems" }] },
    ] } };
    const right = { ...item("right-pair"), properties: { ...item("right-pair").properties, powerPlatformConnectors: [
      { connectorId: "shared_sharepointonline", operations: [{ operationId: "GetItems" }] },
    ] } };
    runRawQuery.mockImplementationOnce((clauses: Clause[]) => Promise.resolve(success([
      withEvidence(clauses, item("ordinary-branch"), true), withEvidence(clauses, wrong, false),
      withEvidence(clauses, item("unknown-branch"), null),
    ], "next")));
    let finish!: () => void;
    runRawQuery.mockImplementationOnce((clauses: Clause[]) => new Promise((resolve) => {
      finish = () => resolve(success([withEvidence(clauses, right, false)]));
    }));
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(runRawQuery).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("link", { name: "App ordinary-branch" })).not.toBeInTheDocument();
    await act(async () => finish());
    await waitFor(() => expect(screen.getByRole("link", { name: "App ordinary-branch" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "App right-pair" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "App wrong-pair" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "App unknown-branch" })).not.toBeInTheDocument();
    expect(runRawQuery.mock.calls[1][1]).toMatchObject({ Skip: 3, SkipToken: "next" });
    expect(screen.getByRole("button", { name: "Copy clauses JSON" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("CSV fields"));
    fireEvent.click(screen.getByRole("option", { name: "All raw fields (flattened)" }));
    fireEvent.click(screen.getByRole("button", { name: "Export complete result" }));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(1));
    expect(downloadCsv.mock.calls[0][1]).toContain("ordinary-branch");
    expect(downloadCsv.mock.calls[0][1]).toContain("right-pair");
    expect(downloadCsv.mock.calls[0][1]).not.toContain("__queryEvidence_");
    expect(downloadCsv.mock.calls[0][1]).not.toContain("wrong-pair");
  });
  it("reports missing grouped branch evidence without replacing previously useful results", async () => {
    saveGrouped(pairedOrSpec()); mount(); await runFirst();
    loadGrouped();
    runRawQuery.mockResolvedValueOnce(success([item("missing-evidence")]));
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Query failed:.*evidence/i));
    expect(screen.getByRole("link", { name: "App one" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "App missing-evidence" })).not.toBeInTheDocument();
  });
});
