import { describe, it, expect } from "vitest";
import {
  where,
  project,
  extend,
  orderBy,
  take,
  summarize,
} from "./inventory";

// These tests pin the shape of the clause objects we send to the
// QueryResources connector. They are golden-output tests on purpose —
// the server-side KQL builder is strict about `$type` discriminators
// and field casing, so if any of these change the runtime breaks
// silently with empty result sets.
describe("inventory clause builders", () => {
  it("where() emits a where clause with field, operator, and values", () => {
    expect(where("type", "==", ["microsoft.copilotstudio/agents"])).toEqual({
      $type: "where",
      FieldName: "type",
      Operator: "==",
      Values: ["microsoft.copilotstudio/agents"],
    });
  });

  it("where() preserves multiple values without dedup", () => {
    expect(where("environmentId", "in~", ["env1", "env2", "env1"])).toEqual({
      $type: "where",
      FieldName: "environmentId",
      Operator: "in~",
      Values: ["env1", "env2", "env1"],
    });
  });

  it("project() emits a project clause with the field list", () => {
    expect(project(["name", "type", "properties.displayName"])).toEqual({
      $type: "project",
      FieldList: ["name", "type", "properties.displayName"],
    });
  });

  it("extend() emits an extend clause for synthesized columns", () => {
    expect(extend("g_env", "tostring(environmentId)")).toEqual({
      $type: "extend",
      FieldName: "g_env",
      Expression: "tostring(environmentId)",
    });
  });

  it("orderBy() emits an orderby clause with the asc/desc map", () => {
    expect(orderBy({ "properties.lastPublishedAt": "desc" })).toEqual({
      $type: "orderby",
      FieldNamesAscDesc: { "properties.lastPublishedAt": "desc" },
    });
  });

  it("take() emits a take clause", () => {
    expect(take(500)).toEqual({ $type: "take", TakeCount: 500 });
  });

  it("summarize() wraps the operator inside SummarizeClauseExpression", () => {
    expect(summarize("count", "id", ["g_env"])).toEqual({
      $type: "summarize",
      SummarizeClauseExpression: {
        OperatorName: "count",
        OperatorFieldName: "id",
        FieldList: ["g_env"],
      },
    });
  });
});
