import { describe, it, expect } from "vitest";
import { ResourceType } from "./inventory";
import {
  FIELDS_BY_RESOURCE_TYPE,
  getFieldSuggestions,
  groupFields,
} from "./inventory.fields";

// These tests are the safety net for the per-resource-type field
// picker. They exist because the previous behavior — a single flat
// `COMMON_FIELD_SUGGESTIONS` list — silently mixed irrelevant fields
// across types, and we want to be loud if we ever regress.

describe("FIELDS_BY_RESOURCE_TYPE", () => {
  it("covers every ResourceType", () => {
    const expected = Object.values(ResourceType).sort();
    const actual = Object.keys(FIELDS_BY_RESOURCE_TYPE).sort();
    expect(actual).toEqual(expected);
  });

  it("every type bag includes the shared base fields", () => {
    const baseRequired = [
      "type",
      "name",
      "location",
      "properties.displayName",
      "properties.createdAt",
      "properties.createdBy",
    ];
    for (const [rt, fields] of Object.entries(FIELDS_BY_RESOURCE_TYPE)) {
      const paths = fields.map((f) => f.path);
      for (const required of baseRequired) {
        expect(paths, `${rt} missing ${required}`).toContain(required);
      }
    }
  });

  it("agents include the rich Copilot Studio fields", () => {
    const paths = FIELDS_BY_RESOURCE_TYPE[ResourceType.CopilotStudioAgent].map(
      (f) => f.path
    );
    for (const required of [
      "properties.schemaName",
      "properties.channels",
      "properties.authentication",
      "properties.model",
      "properties.orchestration",
      "properties.lastPublishedAt",
      "properties.isWebSearchEnabledForKnowledge",
      "properties.entraAppId",
    ]) {
      expect(paths).toContain(required);
    }
  });

  it("agents do NOT include flow-specific or app-specific noise", () => {
    const paths = FIELDS_BY_RESOURCE_TYPE[ResourceType.CopilotStudioAgent].map(
      (f) => f.path
    );
    expect(paths).not.toContain("properties.appType");
    expect(paths).not.toContain("properties.flowTriggerType");
    expect(paths).not.toContain("properties.environmentType");
    expect(paths).not.toContain("properties.lastModifiedAt"); // agents don't have it
  });

  it("canvas apps include canvas-specific fields", () => {
    const paths = FIELDS_BY_RESOURCE_TYPE[ResourceType.CanvasApp].map(
      (f) => f.path
    );
    for (const required of [
      "properties.appType",
      "properties.sharedUsersCount",
      "properties.sharedGroupsCount",
      "properties.isFeaturedApp",
      "properties.lastLaunchedTime",
    ]) {
      expect(paths).toContain(required);
    }
    expect(paths).not.toContain("properties.schemaName");
    expect(paths).not.toContain("properties.flowTriggerType");
  });

  it("flows include flow-specific fields", () => {
    const paths = FIELDS_BY_RESOURCE_TYPE[ResourceType.CloudFlow].map(
      (f) => f.path
    );
    for (const required of [
      "properties.status",
      "properties.flowTriggerType",
      "properties.trigger.connectorId",
      "properties.workflowEntityId",
    ]) {
      expect(paths).toContain(required);
    }
  });
});

describe("getFieldSuggestions", () => {
  it("scopes to the selected resource type — agents", () => {
    const paths = getFieldSuggestions(
      [ResourceType.CopilotStudioAgent],
      "groupBy"
    ).map((f) => f.path);
    expect(paths).toContain("properties.schemaName");
    expect(paths).toContain("properties.model");
    expect(paths).not.toContain("properties.appType");
    expect(paths).not.toContain("properties.flowTriggerType");
  });

  it("scopes to canvas apps", () => {
    const paths = getFieldSuggestions(
      [ResourceType.CanvasApp],
      "groupBy"
    ).map((f) => f.path);
    expect(paths).toContain("properties.appType");
    expect(paths).not.toContain("properties.schemaName");
  });

  it("union across multiple types includes fields from each", () => {
    const paths = getFieldSuggestions(
      [ResourceType.CanvasApp, ResourceType.CopilotStudioAgent],
      "groupBy"
    ).map((f) => f.path);
    expect(paths).toContain("properties.appType"); // canvas
    expect(paths).toContain("properties.schemaName"); // agent
  });

  it("empty resourceTypes falls back to union of all types", () => {
    const paths = getFieldSuggestions([], "groupBy").map((f) => f.path);
    expect(paths).toContain("properties.appType");
    expect(paths).toContain("properties.schemaName");
    expect(paths).toContain("properties.flowTriggerType");
    expect(paths).toContain("properties.environmentType");
  });

  it("dateField intent only returns date kinds", () => {
    const fields = getFieldSuggestions(
      [ResourceType.CopilotStudioAgent],
      "dateField"
    );
    for (const f of fields) {
      expect(f.kind, `${f.path} should be a date`).toBe("date");
    }
    const paths = fields.map((f) => f.path);
    expect(paths).toContain("properties.createdAt");
    expect(paths).toContain("properties.lastPublishedAt");
  });

  it("groupBy intent drops arrays and objects", () => {
    const fields = getFieldSuggestions(
      [ResourceType.CopilotStudioAgent],
      "groupBy"
    );
    for (const f of fields) {
      expect(["string", "boolean", "number", "date"]).toContain(f.kind);
    }
  });

  it("column intent keeps arrays (cells can render JSON)", () => {
    const paths = getFieldSuggestions(
      [ResourceType.CopilotStudioAgent],
      "column"
    ).map((f) => f.path);
    expect(paths).toContain("properties.channels"); // array kind
  });

  it("filter intent appends connector sentinels for connector-bearing types", () => {
    const paths = getFieldSuggestions(
      [ResourceType.CanvasApp],
      "filter"
    ).map((f) => f.path);
    expect(paths).toContain("__connector");
    expect(paths).toContain("__operation");
  });

  it("filter intent OMITS connector sentinels for non-connector types", () => {
    const paths = getFieldSuggestions(
      [ResourceType.Environment],
      "filter"
    ).map((f) => f.path);
    expect(paths).not.toContain("__connector");
    expect(paths).not.toContain("__operation");
  });

  it("sort intent drops sentinels (they aren't sortable server-side)", () => {
    const paths = getFieldSuggestions(
      [ResourceType.CanvasApp],
      "sort"
    ).map((f) => f.path);
    expect(paths).not.toContain("__connector");
    expect(paths).not.toContain("__operation");
  });

  it("de-dupes when multiple types contribute the same path (first wins)", () => {
    // Canvas + Cloud flow both list properties.lastModifiedAt — should
    // appear exactly once.
    const fields = getFieldSuggestions(
      [ResourceType.CanvasApp, ResourceType.CloudFlow],
      "groupBy"
    );
    const matches = fields.filter((f) => f.path === "properties.lastModifiedAt");
    expect(matches).toHaveLength(1);
  });
});

describe("groupFields", () => {
  it("groups by .group label preserving order", () => {
    const grouped = groupFields(
      getFieldSuggestions([ResourceType.CopilotStudioAgent], "filter")
    );
    const labels = grouped.map((g) => g.label);
    expect(labels).toContain("Identity");
    expect(labels).toContain("Behavior");
    expect(labels).toContain("Connectors");
    // No duplicate group labels.
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("every field ends up in exactly one group", () => {
    const fields = getFieldSuggestions([ResourceType.CanvasApp], "filter");
    const grouped = groupFields(fields);
    const flatPaths = grouped.flatMap((g) => g.fields.map((f) => f.path));
    expect(flatPaths.sort()).toEqual(fields.map((f) => f.path).sort());
  });
});
