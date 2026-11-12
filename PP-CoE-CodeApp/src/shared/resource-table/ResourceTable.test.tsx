import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { ResourceTable } from "./ResourceTable";
import type { ViewColumn } from "./model";

interface Row { id: string; name: string; count: number }
const columns: ViewColumn<Row>[] = [
  { id: "name", label: "Name", value: (row) => row.name },
  { id: "count", label: "Count", value: (row) => row.count, kind: "number", defaultVisible: false },
];
const rows = [{ id: "1", name: "Zulu", count: 20 }, { id: "2", name: "Alpha", count: 3 }];
function table(items = rows) {
  return <FluentProvider theme={webLightTheme}>
    <ResourceTable columns={columns} rows={items} getRowId={(row) => row.id} label="Records" persistence={{ key: "test-view" }} />
  </FluentProvider>;
}
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
describe("ResourceTable interactions", () => {
  it("supports returned column aliases that collide with Object property names", async () => {
    const user = userEvent.setup();
    render(<FluentProvider theme={webLightTheme}>
      <ResourceTable columns={[{ id: "constructor", label: "Alias", value: (row: Row) => row.name }]}
        rows={rows} getRowId={(row) => row.id} label="Aliases" />
    </FluentProvider>);
    expect(screen.getByRole("columnheader")).toHaveStyle({ width: "200px", flexBasis: "200px" });
    await user.click(screen.getByRole("button", { name: "Alias column options" }));
    await user.type(screen.getByRole("textbox", { name: "Alias filter value" }), "alpha");
    await user.click(screen.getByRole("button", { name: "Apply filter" }));
    expect(screen.queryByText("Zulu")).not.toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
  it("adds, reorders, resizes and restores optional columns, then resets defaults", async () => {
    const user = userEvent.setup();
    const result = render(table());
    await user.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.getByRole("button", { name: "Columns" })).toHaveAttribute("aria-expanded", "true");
    await user.click(await screen.findByLabelText("Count"));
    await user.click(screen.getByLabelText("Move Count earlier"));
    fireEvent.change(screen.getByLabelText("Count width"), { target: { value: "320" } });
    await user.click(screen.getByText("Done"));
    expect(screen.getAllByRole("columnheader", { hidden: true })[0]).toHaveTextContent("Count");
    expect(screen.getAllByRole("columnheader", { hidden: true })[0]).toHaveStyle({ width: "320px" });
    result.unmount();
    render(table());
    expect(screen.getAllByRole("columnheader", { hidden: true })[0]).toHaveTextContent("Count");
    expect(screen.getAllByRole("columnheader", { hidden: true })[0]).toHaveStyle({ width: "320px" });
    await user.click(screen.getByText("Reset view"));
    expect(screen.getAllByRole("columnheader", { hidden: true })).toHaveLength(1);
    expect(screen.getAllByRole("columnheader", { hidden: true })[0]).toHaveTextContent("Name");
  });
  it("retains sorting/filtering as rows arrive and keeps controls available at zero matches", async () => {
    const user = userEvent.setup();
    const result = render(table());
    await user.click(screen.getByRole("button", { name: "Name column options" }));
    await user.click(screen.getByRole("button", { name: "Sort ascending" }));
    expect(within(screen.getAllByRole("row")[1]).getByText("Alpha")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Name column options" }));
    await user.type(screen.getByRole("textbox", { name: "Name filter value" }), "new");
    await user.click(screen.getByRole("button", { name: "Apply filter" }));
    expect(screen.getByText(/No matching loaded rows/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Columns" })).toBeEnabled();
    result.rerender(table([...rows, { id: "3", name: "New arrival", count: 4 }]));
    expect(screen.getByText("New arrival")).toBeInTheDocument();
    expect(screen.queryByText("Zulu")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear column filters" }));
    expect(screen.getByText("Zulu")).toBeInTheDocument();
  });
  it("does not overwrite malformed preferences until Reset and surfaces storage write failures", async () => {
    const user = userEvent.setup();
    localStorage.setItem("test-view", "{bad");
    render(table());
    expect(screen.getByRole("alert")).toHaveTextContent("could not be restored");
    await user.click(screen.getByRole("button", { name: "Name column options" }));
    await user.click(screen.getByRole("button", { name: "Sort ascending" }));
    expect(localStorage.getItem("test-view")).toBe("{bad");
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    await user.click(screen.getByRole("button", { name: "Reset view" }));
    expect(screen.getByRole("alert")).toHaveTextContent("could not be saved: quota");
    write.mockRestore();
    await user.click(screen.getByRole("button", { name: "Reset view" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("test-view")!).sort).toBeUndefined();
  });
});
