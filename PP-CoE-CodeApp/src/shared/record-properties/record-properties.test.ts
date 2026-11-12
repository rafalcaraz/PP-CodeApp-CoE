import { describe, expect, it } from "vitest";
import { hasSourceRecord, readPropertyPath, readRowProperty, retainSourceRecord } from "./index";
import { toAgentRow, toAppRow, toEnvironmentGroupRow, toEnvironmentRow, toFlowRow } from "../../data/inventory";
import { rowsToCsv } from "../../utils/csv";

describe("custom source property paths", () => {
  it("reads exact projected aliases, nested objects, array indexes, false and zero without inherited access", () => {
    const raw = { "properties.logicalName": "projected", properties: { logicalName: "nested", choices: [{ active: false, count: 0 }] } };
    expect(readPropertyPath(raw, "properties.logicalName")).toBe("projected");
    expect(readPropertyPath(raw, "properties.choices.0.active")).toBe(false);
    expect(readPropertyPath(raw, "properties.choices.0.count")).toBe(0);
    expect(readPropertyPath(raw, "properties.missing")).toBeUndefined();
    expect(readPropertyPath(raw, "__proto__.constructor")).toBeUndefined();
    expect(readPropertyPath(raw, "properties..logicalName")).toBeUndefined();
  });
  it.each([
    ["apps", toAppRow], ["flows", toFlowRow], ["agents", toAgentRow],
    ["environments", toEnvironmentRow], ["groups", toEnvironmentGroupRow],
  ])("retains arbitrary %s source properties without changing ordinary row exports", (_name, convert) => {
    const raw = { name: "fixture-resource", type: "fixture-type", properties: { displayName: "Fixture", logicalName: "fixture_logical", futureProperty: { score: 7 } } };
    const row = convert(raw);
    expect(hasSourceRecord(row)).toBe(true);
    expect(readRowProperty(row, "properties.logicalName")).toBe("fixture_logical");
    expect(readRowProperty(row, "properties.futureProperty.score")).toBe(7);
    expect(JSON.stringify(row)).not.toContain("futureProperty");
    expect(rowsToCsv([row])).not.toContain("futureProperty");
  });
  it("does not add enumerable fields to a retained row", () => {
    const row = retainSourceRecord({ name: "Fixture" }, { properties: { secret: "not-an-export-field" } });
    expect(row).toEqual({ name: "Fixture" });
    expect(Object.keys(row)).toEqual(["name"]);
    expect(readRowProperty(row, "properties.secret")).toBe("not-an-export-field");
  });
});
