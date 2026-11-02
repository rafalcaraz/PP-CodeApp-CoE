import { fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider, webLightTheme, webDarkTheme } from "@fluentui/react-components";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConditionBuilder } from "./ConditionBuilder";
import { getFieldSuggestions } from "../../data/inventory.fields";
import { ResourceType, buildClausesFromSpec, formatQueryConditionSummary, type QuerySpec } from "../../data/inventory";
import { DEFAULT_SPEC } from "./workspace";
vi.mock("../../components/EnvironmentPicker", () => ({ EnvironmentPicker: () => <span>Environment selector</span> }));

function mount(spec = DEFAULT_SPEC, theme = webLightTheme) {
  function Wrapper() {
    const [value, setValue] = useState<QuerySpec>(spec);
    return <><ConditionBuilder spec={value} fields={getFieldSuggestions(value.resourceTypes, "filter")}
      onChange={(conditions) => setValue({ ...value, conditions, filters: [] })} />
      <output aria-label="Spec">{JSON.stringify(value)}</output></>;
  }
  return render(<FluentProvider theme={theme}><Wrapper /></FluentProvider>);
}
describe("one-level condition builder", () => {
  it("displays old flat filters as Match all without changing their serialized form", () => {
    const spec = { ...DEFAULT_SPEC, filters: [{ field: "location", op: "==" as const, value: "europe" }] };
    mount(spec);
    expect(screen.getByLabelText("Root group match")).toHaveTextContent("Match all (AND)");
    expect(screen.getByLabelText("Condition 1 field")).toHaveValue("location");
    expect(JSON.parse(screen.getByLabelText("Spec").textContent!)).toEqual(spec);
    expect(screen.getByRole("note", { name: "Condition summary" })).toHaveTextContent("Region");
  });
  it("adds a subgroup and conditions with unambiguous hierarchy, labels and no deeper nesting controls", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Add condition to root group" }));
    fireEvent.change(screen.getByLabelText("Condition 1 field"), { target: { value: "location" } });
    fireEvent.change(screen.getByLabelText("Condition 1 value"), { target: { value: "europe" } });
    fireEvent.click(screen.getByRole("button", { name: "Add group" }));
    const group = screen.getByRole("group", { name: "Group 1" });
    expect(within(group).getByLabelText("Group 1 match")).toHaveTextContent("Match any (OR)");
    expect(screen.getAllByRole("button", { name: "Add group" })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Condition 2 field"), { target: { value: "properties.isQuarantined" } });
    fireEvent.click(within(group).getByRole("button", { name: "Add condition to group 1" }));
    fireEvent.change(screen.getByLabelText("Condition 3 field"), { target: { value: "properties.isManaged" } });
    const state = JSON.parse(screen.getByLabelText("Spec").textContent!) as QuerySpec;
    expect(state.filters).toEqual([]);
    expect(state.conditions?.operator).toBe("all");
    expect(state.conditions?.children[1]).toMatchObject({ kind: "group", operator: "any", children: [
      { kind: "condition", filter: { field: "properties.isQuarantined" } },
      { kind: "condition", filter: { field: "properties.isManaged" } },
    ] });
    expect(screen.getByRole("note", { name: "Condition summary" })).toHaveTextContent("AND");
    expect(screen.getByRole("note", { name: "Condition summary" })).toHaveTextContent("OR");
  });
  it("changes root and subgroup match operators without flattening any branch", () => {
    mount({ ...DEFAULT_SPEC, filters: [], conditions: { kind: "group", operator: "all", children: [
      { kind: "group", operator: "any", children: [{ kind: "condition", filter: { field: "location", op: "==", value: "europe" } }] },
    ] } });
    fireEvent.click(screen.getByLabelText("Root group match"));
    fireEvent.click(screen.getByRole("option", { name: "Match any (OR)" }));
    fireEvent.click(screen.getByLabelText("Group 1 match"));
    fireEvent.click(screen.getByRole("option", { name: "Match all (AND)" }));
    const state = JSON.parse(screen.getByLabelText("Spec").textContent!) as QuerySpec;
    expect(state.conditions).toMatchObject({ operator: "any", children: [{ operator: "all" }] });
    expect(screen.getByLabelText("Condition 1 value")).toHaveValue("europe");
  });
  it("leaves empty groups visible for validation and can remove a group without touching siblings", () => {
    mount({ ...DEFAULT_SPEC, filters: [{ field: "location", op: "==", value: "europe" }] });
    fireEvent.click(screen.getByRole("button", { name: "Add group" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove condition 2" }));
    expect(screen.getByText(/This group is empty/)).toBeInTheDocument();
    expect(screen.getByLabelText("Condition 1 value")).toHaveValue("europe");
    fireEvent.click(screen.getByRole("button", { name: "Remove group 1" }));
    expect(screen.queryByRole("group", { name: "Group 1" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Condition 1 value")).toHaveValue("europe");
  });
  it("summarizes actual parenthesized precedence and connector-operation atomicity", () => {
    const spec: QuerySpec = { ...DEFAULT_SPEC, filters: [], conditions: { kind: "group", operator: "any", children: [
      { kind: "group", operator: "all", children: [
        { kind: "condition", filter: { field: "location", op: "==", value: "europe" } },
        { kind: "condition", filter: { field: "properties.isManaged", op: "==", value: "false" } },
      ] },
      { kind: "condition", filter: { field: "__operation", connectorId: "shared_sql", op: "==", value: "GetRows" } },
    ] } };
    const summary = formatQueryConditionSummary(spec);
    expect(summary).toContain("OR");
    expect(summary).toContain("AND");
    expect(summary).toContain("shared_sql");
    expect(summary).toContain("GetRows");
    mount(spec);
    expect(screen.getByRole("note", { name: "Condition summary" })).toHaveTextContent(/missing or null value is not false/);
    expect(screen.getByLabelText("Condition 3 within connector (optional)")).toHaveValue("shared_sql");
    expect(screen.getByLabelText("Condition 2 value")).toHaveTextContent("false");
    expect(spec.resourceTypes).toEqual([ResourceType.CanvasApp]);
  });
  it.each([["light", webLightTheme], ["dark", webDarkTheme]] as const)("keeps %s containment styling independent of match operators and sibling positions", (_name, theme) => {
    const spec: QuerySpec = { ...DEFAULT_SPEC, filters: [], conditions: { kind: "group", operator: "all", children: [
      { kind: "group", operator: "any", children: [
        { kind: "condition", filter: { field: "location", op: "==", value: "europe" } },
      ] },
      { kind: "group", operator: "all", children: [
        { kind: "condition", filter: { field: "properties.isManaged", op: "==", value: "false" } },
      ] },
    ] } };
    const clauses = buildClausesFromSpec(spec);
    mount(spec, theme);
    const rootClass = screen.getByRole("group", { name: "Root group" }).className;
    const subgroupClass = screen.getByRole("group", { name: "Group 1" }).className;
    expect(subgroupClass).not.toBe(rootClass);
    expect(screen.getByRole("group", { name: "Group 2" }).className).toBe(subgroupClass);
    expect(buildClausesFromSpec(JSON.parse(screen.getByLabelText("Spec").textContent!))).toEqual(clauses);
    fireEvent.click(screen.getByLabelText("Group 1 match"));
    fireEvent.click(screen.getByRole("option", { name: "Match all (AND)" }));
    expect(screen.getByRole("group", { name: "Group 1" }).className).toBe(subgroupClass);
    fireEvent.click(screen.getByRole("button", { name: "Add group" }));
    expect(screen.getByRole("group", { name: "Group 3" }).className).toBe(subgroupClass);
    fireEvent.click(screen.getByRole("button", { name: "Remove group 1" }));
    expect(screen.getByRole("group", { name: "Group 1" }).className).toBe(subgroupClass);
    expect(screen.getByLabelText("Condition 1 field")).toHaveValue("properties.isManaged");
    expect(screen.getByLabelText("Condition 1 value")).toHaveTextContent("false");
    const remaining = JSON.parse(screen.getByLabelText("Spec").textContent!) as QuerySpec;
    expect(remaining.conditions?.children[0]).toEqual(spec.conditions?.children[1]);
  });
});
