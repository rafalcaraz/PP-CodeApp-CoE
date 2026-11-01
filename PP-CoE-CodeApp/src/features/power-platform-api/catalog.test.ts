import { describe, expect, it } from "vitest";
import {
  apiCatalog, apiOperations, buildApiRequest, initialApiInputs, isReadOnly,
  parameterKey, schemaTools, unsupportedReason,
} from "./catalog";

const getAll = apiOperations.find((operation) =>
  operation.method === "GET" && operation.path === "/licensing/entitlements/{entitlementId}/resourceThresholds",
);
if (!getAll) throw new Error("Missing documented Get All Resource Thresholds operation.");

describe("Power Platform API catalog", () => {
  it("has unique operations and preserves source coverage and hierarchy", () => {
    expect(apiOperations).toHaveLength(apiCatalog.source.operationCount);
    expect(new Set(apiOperations.map((operation) => operation.id)).size).toBe(apiOperations.length);
    expect(new Set(apiOperations.map((operation) => operation.section)).size).toBeGreaterThan(1);
    expect(apiOperations.some((operation) => operation.title === "Upsert Resource Threshold")).toBe(true);
    for (const operation of apiOperations) {
      expect(operation.section).not.toBe("");
      expect(operation.group).not.toBe("");
      expect(operation.docUrl).toMatch(/^https:\/\/learn\.microsoft\.com\//);
      expect(operation.path).toMatch(/^\//);
      expect(operation.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
      for (const match of operation.path.matchAll(/\{([^}]+)\}/g)) {
        expect(operation.parameters.some((parameter) => parameter.in === "path" && parameter.name === match[1]), operation.id).toBe(true);
      }
      if (operation.parameters.some((parameter) => parameter.name === "api-version")) {
        expect(initialApiInputs(operation).parameters["query:api-version"], operation.id).toBeTruthy();
      }
    }
  });

  it("resolves every parameter, request-body, and response-schema reference", () => {
    for (const operation of apiOperations) {
      const schemas = [
        ...operation.parameters.map((parameter) => parameter.schema),
        ...(operation.body ? [operation.body.schema] : []),
        ...operation.responses.flatMap((response) => response.schema ? [response.schema] : []),
      ];
      for (const schema of schemas) expect(() => schemaTools.schemaDocument(schema), operation.id).not.toThrow();
    }
  });

  it("builds the exact documented threshold GET without an HTTP request body", () => {
    const inputs = initialApiInputs(getAll);
    inputs.parameters["path:entitlementId"] = "MCSMessages";
    expect(buildApiRequest(inputs)).toEqual({
      method: "GET",
      url: "https://api.powerplatform.com/licensing/entitlements/MCSMessages/resourceThresholds?api-version=2024-10-01",
      body: "",
    });
  });

  it("encodes path values and rejects traversal segments, missing values and injected parameters", () => {
    const inputs = initialApiInputs(getAll);
    expect(() => buildApiRequest(inputs)).toThrow("entitlementId is required");
    inputs.parameters["path:entitlementId"] = "name/with?reserved&characters";
    expect(buildApiRequest(inputs).url).toContain("name%2Fwith%3Freserved%26characters");
    inputs.parameters["path:entitlementId"] = "..";
    expect(() => buildApiRequest(inputs)).toThrow("traversal");
    inputs.parameters["path:entitlementId"] = "MCSMessages";
    inputs.parameters["query:unregistered"] = "yes";
    expect(() => buildApiRequest(inputs)).toThrow("Unknown input");
  });

  it("does not accept bodies for bodyless operations or arbitrary operation IDs", () => {
    const inputs = initialApiInputs(getAll);
    inputs.parameters["path:entitlementId"] = "MCSMessages";
    inputs.body = "{}";
    expect(() => buildApiRequest(inputs)).toThrow("does not document a request body");
    expect(() => buildApiRequest({ operationId: "custom-url", parameters: {}, body: "" })).toThrow("Select an operation");
  });

  it("requires review for every non-read HTTP method", () => {
    for (const operation of apiOperations) {
      expect(isReadOnly(operation)).toBe(["GET", "HEAD"].includes(operation.method));
    }
  });

  it("blocks required headers rather than silently dropping them", () => {
    const requiredHeader = { name: "If-Match", in: "header", required: true, description: "", schema: { type: "string" } };
    expect(unsupportedReason({ ...getAll, parameters: [...getAll.parameters, requiredHeader] })).toContain("If-Match");
    expect(parameterKey(requiredHeader)).toBe("header:If-Match");
  });

  it("preserves multipart operations in the catalog but blocks their unsupported transport", () => {
    const upload = apiOperations.find((operation) => operation.title === "Upload Certificate");
    if (!upload) throw new Error("Missing documented certificate upload.");
    expect(unsupportedReason(upload)).toContain("transport");
    expect(() => buildApiRequest(initialApiInputs(upload))).toThrow("transport");
  });

  it("validates the documented upsert fields and exposes their writable template", () => {
    const upsert = apiOperations.find((operation) => operation.title === "Upsert Resource Threshold");
    if (!upsert?.body) throw new Error("Missing documented upsert body.");
    const bodySchema = upsert.body.schema;
    expect(schemaTools.schemaTemplate(bodySchema, true)).toEqual({
      limit: 0, notificationThreshold: 0, notifyIfOverCapacity: false,
      resourceConsumption: 0, stopIfOverCapacity: false, stopResource: false,
    });
    expect(() => schemaTools.validateValue({ notifyIfOverCapacity: "true" }, bodySchema, "body")).toThrow("choose true or false");
  });
});
