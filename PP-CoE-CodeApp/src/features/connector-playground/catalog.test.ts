import { describe, expect, it } from "vitest";
import { dataSourcesInfo } from "../../../.power/schemas/appschemas/dataSourcesInfo";
import {
  connectorActions, initialInputs, parameterSchema, parseInputs,
  resolveSchema, schemaDocument, schemaTemplate, validateValue,
} from "./catalog";

function action(id: string) {
  const found = connectorActions.find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing action ${id}`);
  return found;
}

describe("connector playground catalog", () => {
  it("covers every SDK-registered action, including actions missing from generated methods", () => {
    expect(connectorActions.length).toBeGreaterThan(150);
    expect(connectorActions.map((entry) => entry.id).sort())
      .toEqual(Object.keys(dataSourcesInfo.powerplatformadminv2.apis).sort());
    expect(action("ProvisionNewEnvironment").parameters.map((parameter) => parameter.name))
      .toContain("body");
    expect(action("mcp_Governance").readOnly).toBe(false);
    expect(connectorActions.every((entry) => entry.parameters.every((parameter) => parameter.name !== "connectionId"))).toBe(true);
  });

  it("requires confirmation for every non-GET except the known inventory query", () => {
    for (const entry of connectorActions) {
      expect(entry.readOnly).toBe(entry.method === "GET" || entry.id === "QueryResources");
    }
    expect(action("DeleteEnvironmentByID").readOnly).toBe(false);
    expect(action("QueryResources").readOnly).toBe(true);
  });

  it("resolves every parameter schema", () => {
    for (const entry of connectorActions) {
      for (const parameter of entry.parameters) {
        expect(() => resolveSchema(parameterSchema(parameter))).not.toThrow();
        expect(() => schemaDocument(parameterSchema(parameter))).not.toThrow();
      }
    }
  });

  it("prefills declared API versions without inventing target IDs", () => {
    const defaults = initialInputs(action("GetEnvironmentByIdForUser"));
    expect(defaults["api-version"]).toBe("2024-10-01");
    expect(defaults.environmentId).toBe("");
  });

  it("omits blank optional parameters and retains literal strings", () => {
    const entry = action("GetEnvironmentByIdForUser");
    expect(parseInputs(entry, { ...initialInputs(entry), environmentId: "test-environment" }))
      .toMatchObject({ environmentId: "test-environment", "api-version": "2024-10-01" });
    const recommendations = action("GetRecommendations");
    expect(parseInputs(recommendations, initialInputs(recommendations))).not.toHaveProperty("$skipToken");
  });

  it("rejects missing required fields, invalid JSON and incorrect body types", () => {
    expect(() => parseInputs(action("GetEnvironmentByIdForUser"), {})).toThrow("environmentId is required");
    const entry = action("QueryResources");
    expect(() => parseInputs(entry, { ...initialInputs(entry), body: "{" })).toThrow("valid JSON");
    expect(() => parseInputs(entry, { ...initialInputs(entry), body: "[]" })).toThrow("JSON object");
  });

  it("validates nested required fields, enum values, primitive types and bounds", () => {
    expect(() => validateValue({}, { type: "object", required: ["id"] }, "body")).toThrow("body.id is required");
    expect(() => validateValue({ enabled: "yes" }, {
      type: "object", properties: { enabled: { type: "boolean" } },
    }, "body")).toThrow("choose true or false");
    expect(() => validateValue("no", { type: "string", enum: ["yes"] }, "mode")).toThrow("choose one of yes");
    expect(() => validateValue(1.5, { type: "integer" }, "count")).toThrow("valid integer");
    expect(() => validateValue(-1, { type: "number", minimum: 0 }, "count")).toThrow("minimum is 0");
    expect(() => validateValue(["wrong"], { type: "array", items: { type: "object" } }, "body")).toThrow("body[0]");
  });

  it("creates editable required-only templates", () => {
    expect(schemaTemplate({
      type: "object", required: ["enabled"],
      properties: { enabled: { type: "boolean" }, optional: { type: "string" } },
    })).toEqual({ enabled: false });
  });
});
