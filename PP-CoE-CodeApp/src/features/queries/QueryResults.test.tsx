import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter } from "react-router-dom";
vi.mock("../../data/inventory", async (original) => ({
  ...await original<typeof import("../../data/inventory")>(),
  getEnvironmentNameMap: vi.fn().mockResolvedValue(new Map([["z-env", "Alpha environment"], ["a-env", "Zulu environment"]])),
}));
vi.mock("../../components/UserChip", () => ({ UserChip: ({ id }: { id: string }) => <span>{id}</span> }));
import { QueryResults } from "./QueryResults";
import { createExecution } from "./execution";
import { ResourceType } from "../../data/inventory";

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});
afterEach(() => vi.unstubAllGlobals());
describe("QueryResults presentation", () => {
  it("sorts and filters friendly environment names while exporting original IDs", async () => {
    const user = userEvent.setup();
    const execution = {
      ...createExecution("query", [], 50), complete: true, resourceTypes: [ResourceType.CanvasApp],
      rows: [
        { name: "first", type: ResourceType.CanvasApp, properties: { displayName: "First app", environmentId: "z-env" } },
        { name: "second", type: ResourceType.CanvasApp, properties: { displayName: "Second app", environmentId: "a-env" } },
      ],
    };
    render(<FluentProvider theme={webLightTheme}><MemoryRouter>
      <QueryResults execution={execution} columns={["properties.displayName", "properties.environmentId"]} onError={vi.fn()} />
    </MemoryRouter></FluentProvider>);
    await screen.findByText("Alpha environment");
    await user.click(screen.getByRole("button", { name: "Environment ID column options" }));
    await user.click(screen.getByRole("button", { name: "Sort ascending" }));
    expect(within(screen.getAllByRole("row")[1]).getByText("First app")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Environment ID column options" }));
    await user.type(screen.getByRole("textbox", { name: "Environment ID filter value" }), "alpha");
    await user.click(screen.getByRole("button", { name: "Apply filter" }));
    expect(screen.queryByText("Second app")).not.toBeInTheDocument();
    expect(screen.getByText("First app")).toBeInTheDocument();

    let captured: Blob | undefined;
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn((blob: Blob) => { captured = blob; return "blob:query-export"; }),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Export current view" }));
    expect(captured).toBeDefined();
    const reader = new FileReader();
    const contents = new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
    });
    reader.readAsText(captured!);
    await expect(contents).resolves.toContain('"First app","z-env"');
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalled());
  });
});
