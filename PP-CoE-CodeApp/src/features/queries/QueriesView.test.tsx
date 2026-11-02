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
import { buildClausesFromSpec, ResourceType } from "../../data/inventory";
import { DEFAULT_SPEC, readWorkspace } from "./workspace";
const item = (name: string) => ({ name, type: ResourceType.CanvasApp, properties: { displayName: `App ${name}`, environmentId: "env", ownerId: "owner" } });
const success = (items: unknown[], token?: string) => ({ ok: true, data: { items, skipToken: token, totalRecords: 1 } });
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
    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
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
});
