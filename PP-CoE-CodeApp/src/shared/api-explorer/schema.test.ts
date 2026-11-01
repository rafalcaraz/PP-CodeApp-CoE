import { describe, expect, it } from "vitest";
import { createSchemaTools, formatApiError } from "./schema";

describe("API explorer schema tools", () => {
  const tools = createSchemaTools({
    Target: { type: "object", required: ["id"], properties: { id: { type: "string" }, enabled: { type: "boolean" } } },
    Alias: { $ref: "#/definitions/Target" },
  });

  it("resolves aliases and includes referenced definitions in schema documentation", () => {
    expect(tools.resolveSchema({ $ref: "#/definitions/Alias" }).type).toBe("object");
    expect(tools.schemaDocument({ $ref: "#/definitions/Alias" }).definitions.Alias).toHaveProperty("properties.id");
    expect(() => tools.resolveSchema({ $ref: "#/definitions/Unknown" })).toThrow("not found");
  });

  it("builds required-only or full writable templates without including read-only fields", () => {
    expect(tools.schemaTemplate({ $ref: "#/definitions/Target" })).toEqual({ id: "" });
    expect(tools.schemaTemplate({ $ref: "#/definitions/Target" }, true)).toEqual({ id: "", enabled: false });
    expect(tools.schemaTemplate({
      type: "object", properties: { createdOn: { type: "string", readOnly: true }, limit: { type: "number" } },
    }, true)).toEqual({ limit: 0 });
  });

  it("combines inherited and local body properties", () => {
    expect(tools.schemaTemplate({
      type: "object", allOf: [{ $ref: "#/definitions/Target" }],
      properties: { limit: { type: "number" } },
    }, true)).toEqual({ id: "", enabled: false, limit: 0 });
  });

  it("enforces composed alternatives, enums, required properties and numeric bounds", () => {
    expect(() => tools.validateValue({}, { $ref: "#/definitions/Target" }, "body")).toThrow("body.id is required");
    expect(() => tools.validateValue(null, { type: "object", nullable: true }, "body")).not.toThrow();
    expect(() => tools.validateValue(true, { oneOf: [{ type: "string" }, { type: "integer" }] }, "body")).toThrow("exactly one");
    expect(() => tools.validateValue(1, { oneOf: [{ type: "integer" }, { type: "number" }] }, "body")).toThrow("exactly one");
    expect(() => tools.validateValue(1, { anyOf: [{ type: "integer" }, { type: "number" }] }, "body")).not.toThrow();
    expect(() => tools.validateValue(0, { type: "number", minimum: 0, exclusiveMinimum: true }, "body")).toThrow("exclusive");
    expect(() => tools.validateValue(10, { type: "number", exclusiveMaximum: 10 }, "body")).toThrow("below");
  });

  it("does not mistake inherited JavaScript keys for declared body properties", () => {
    expect(() => tools.validateValue(JSON.parse('{"__proto__":{}}'), {
      type: "object", properties: {}, additionalProperties: false,
    }, "body")).toThrow("__proto__ is not allowed");
  });

  it("formats errors, including circular error payloads, without throwing", () => {
    expect(formatApiError(new Error("Forbidden"))).toBe("Forbidden");
    const circular = { self: {} };
    circular.self = circular;
    expect(formatApiError(circular)).toBe("[object Object]");
  });
});
