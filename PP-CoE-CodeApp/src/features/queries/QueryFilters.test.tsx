import { fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { describe, expect, it, vi } from "vitest";
import { QueryFilterRow } from "./QueryFilters";
import { operatorsFor, typedFilterErrors } from "./filterModel";
import { getFieldSuggestions } from "../../data/inventory.fields";
import { ResourceType } from "../../data/inventory";
const fields = getFieldSuggestions([ResourceType.CopilotStudioAgent], "filter");
describe("typed query filters", () => {
  it("offers boolean, number, date and array operators by kind, retaining the freeform escape hatch", () => {
    expect(operatorsFor(fields.find((f) => f.path === "properties.isManaged")).map((o) => o.value)).toEqual(["==", "!="]);
    expect(operatorsFor(fields.find((f) => f.path === "properties.triggers")).map((o) => o.value)).toContain("isempty");
    const dates = operatorsFor(fields.find((f) => f.path === "properties.lastPublishedAt")).map((o) => o.value);
    expect(dates).toEqual(expect.arrayContaining(["today", "yesterday", "lastNdays", "onDate", "dateRange"]));
    expect(operatorsFor().length).toBeGreaterThan(dates.length);
  });
  it("requires typed values without coercing missing data into false or zero", () => {
    expect(typedFilterErrors([{ field: "properties.isManaged", op: "==", value: "" }], fields)).toHaveLength(1);
    expect(typedFilterErrors([{ field: "properties.isManaged", op: "==", value: "false" }], fields)).toEqual([]);
    expect(typedFilterErrors([{ field: "properties.instructionsCharactersCount", op: ">", value: "NaN" }], fields)).toHaveLength(1);
    expect(typedFilterErrors([{ field: "properties.triggers", op: "isempty", value: "" }], fields)).toEqual([]);
    expect(typedFilterErrors([{ field: "properties.futureField", op: "==", value: "anything" }], fields)).toEqual([]);
  });
  it("requires explicit timezone for absolute timestamps", () => {
    expect(typedFilterErrors([{ field: "properties.lastPublishedAt", op: ">", value: "2026-03-08T02:00:00" }], fields)).toHaveLength(1);
    expect(typedFilterErrors([{ field: "properties.lastPublishedAt", op: ">", value: "2026-03-08T02:00:00-08:00" }], fields)).toEqual([]);
  });
  it("does not render a meaningless value control for array emptiness", () => {
    render(<FluentProvider theme={webLightTheme}><QueryFilterRow filter={{ field: "properties.triggers", op: "isempty", value: "" }}
      index={0} fields={fields} resourceTypes={[ResourceType.CopilotStudioAgent]} onChange={vi.fn()} onRemove={vi.fn()} /></FluentProvider>);
    expect(screen.queryByLabelText("Filter 1 value")).not.toBeInTheDocument();
  });
  it("makes connector pairing an explicit part of operation evidence", () => {
    const onChange = vi.fn();
    render(<FluentProvider theme={webLightTheme}><QueryFilterRow filter={{ field: "__operation", op: "==", value: "GetItems" }}
      index={0} fields={fields} resourceTypes={[ResourceType.CopilotStudioAgent]} onChange={onChange} onRemove={vi.fn()} /></FluentProvider>);
    expect(screen.getByText(/Independent match across all connectors/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Within connector (optional)"), { target: { value: "shared_sharepointonline" } });
    expect(onChange).toHaveBeenCalledWith({ connectorId: "shared_sharepointonline" });
  });
});
