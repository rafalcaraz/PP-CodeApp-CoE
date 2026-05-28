/**
 * Exhaustive tests for `clauseValidation`. Pure module, easy to cover.
 */
import { describe, it, expect } from "vitest";
import {
  ALLOWED_CLAUSE_TYPES,
  stripLineComments,
  validateClausesText,
  validateClausesValue,
} from "./clauseValidation";

describe("stripLineComments", () => {
  it("removes //-style comments outside strings", () => {
    const input = `[\n  { "$type": "where" } // a where clause\n]`;
    const { stripped, count } = stripLineComments(input);
    expect(count).toBe(1);
    expect(stripped).not.toContain("a where clause");
    // Newlines preserved so line numbers don't shift downstream.
    expect(stripped.split("\n")).toHaveLength(3);
  });

  it("leaves // inside JSON strings alone", () => {
    const input = `{ "url": "https://example.com" }`;
    const { stripped, count } = stripLineComments(input);
    expect(count).toBe(0);
    expect(stripped).toContain("https://example.com");
  });

  it("handles escaped quotes inside strings without losing track of state", () => {
    const input = `{ "expr": "a \\"b\\" c" } // comment`;
    const { stripped, count } = stripLineComments(input);
    expect(count).toBe(1);
    expect(stripped).toContain(`"a \\"b\\" c"`);
  });

  it("returns count=0 for input with no comments", () => {
    const { count } = stripLineComments(`{ "a": 1 }`);
    expect(count).toBe(0);
  });
});

describe("validateClausesText — happy paths", () => {
  it("accepts an empty array", () => {
    const r = validateClausesText("[]");
    expect(r).toEqual({ ok: true, clauses: [], strippedComments: 0 });
  });

  it("accepts a minimal where clause", () => {
    const r = validateClausesText(
      `[{ "$type": "where", "FieldName": "type", "Operator": "==", "Values": ["'agent'"] }]`,
    );
    expect(r.ok).toBe(true);
  });

  it("accepts the full Phase-1 agentScope shape (where + extend + where)", () => {
    const r = validateClausesText(`
      [
        { "$type": "where", "FieldName": "type", "Operator": "==", "Values": ["'microsoft.copilotstudio/agents'"] },
        { "$type": "extend", "FieldName": "__sn", "Expression": "tostring(properties.schemaName)" },
        { "$type": "where", "FieldName": "__sn", "Operator": "!startswith", "Values": ["'msdyn_'"] }
      ]
    `);
    expect(r.ok).toBe(true);
  });

  it("accepts orderby with FieldNamesAscDesc", () => {
    const r = validateClausesText(
      `[{ "$type": "orderby", "FieldNamesAscDesc": { "properties.createdAt": "desc" } }]`,
    );
    expect(r.ok).toBe(true);
  });

  it("accepts a summarize count clause", () => {
    const r = validateClausesText(`
      [{
        "$type": "summarize",
        "SummarizeClauseExpression": {
          "OperatorName": "count",
          "OperatorFieldName": "resourceCount",
          "FieldList": ["type"]
        }
      }]
    `);
    expect(r.ok).toBe(true);
  });

  it("accepts a count clause with only $type", () => {
    const r = validateClausesText(`[{ "$type": "count" }]`);
    expect(r.ok).toBe(true);
  });

  it("strips line comments and reports the count", () => {
    const r = validateClausesText(`
      [
        // This is the type filter
        { "$type": "where", "FieldName": "type", "Operator": "==", "Values": ["'x'"] } // trailing comment
      ]
    `);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.strippedComments).toBe(2);
  });

  it("trims a BOM and whitespace before parsing", () => {
    const r = validateClausesText("\uFEFF\n  []\n  ");
    expect(r.ok).toBe(true);
  });
});

describe("validateClausesText — JSON syntax errors", () => {
  it("rejects empty input with a helpful message", () => {
    const r = validateClausesText("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/empty/i);
  });

  it("rejects malformed JSON and reports a line number when available", () => {
    const r = validateClausesText(`[\n  { "$type": "where", }\n]`);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/JSON syntax error/i);
      // V8 reports the trailing comma's position; that maps back to line 2.
      // Some engines may not include a position — accept undefined too.
      if (r.line !== undefined) {
        expect(r.line).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("validateClausesText — shape errors", () => {
  it("rejects a non-array top level", () => {
    const r = validateClausesText(`{ "$type": "where" }`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/array/i);
  });

  it("rejects null entries", () => {
    const r = validateClausesText("[null]");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/Clause #1/);
      expect(r.clauseIndex).toBe(0);
    }
  });

  it("rejects missing $type", () => {
    const r = validateClausesText(`[{ "FieldName": "x" }]`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/\$type/);
  });

  it("rejects unknown $type and suggests the nearest valid one", () => {
    const r = validateClausesText(`[{ "$type": "whre" }]`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/did you mean.*where/i);
  });

  it("does not suggest when $type is too far from any valid type", () => {
    const r = validateClausesText(`[{ "$type": "completely-different" }]`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toMatch(/did you mean/i);
  });

  it("rejects a where clause missing FieldName", () => {
    const r = validateClausesText(`[{ "$type": "where", "Operator": "==", "Values": ["'x'"] }]`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/FieldName/);
  });

  it("rejects a where clause with non-array Values", () => {
    const r = validateClausesText(
      `[{ "$type": "where", "FieldName": "x", "Operator": "==", "Values": "not-an-array" }]`,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Values/);
  });

  it("rejects an extend clause missing Expression", () => {
    const r = validateClausesText(`[{ "$type": "extend", "FieldName": "__alias" }]`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Expression/);
  });

  it("rejects an orderby with invalid direction", () => {
    const r = validateClausesText(
      `[{ "$type": "orderby", "FieldNamesAscDesc": { "x": "sideways" } }]`,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/asc.*desc/);
  });

  it("rejects a take clause with non-positive TakeCount", () => {
    const r = validateClausesText(`[{ "$type": "take", "TakeCount": 0 }]`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/TakeCount/);
  });

  it("rejects a distinct clause with empty FieldList", () => {
    const r = validateClausesText(`[{ "$type": "distinct", "FieldList": [] }]`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/FieldList/);
  });

  it("rejects a summarize with unknown OperatorName", () => {
    const r = validateClausesText(
      `[{ "$type": "summarize", "SummarizeClauseExpression": { "OperatorName": "sum" } }]`,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/count.*argmax/);
  });

  it("rejects a join missing required fields", () => {
    const r = validateClausesText(`[{ "$type": "join", "JoinKind": "leftouter" }]`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/LeftColumnName|RightColumnName|RightTable/);
  });

  it("reports the FIRST error when multiple clauses are invalid", () => {
    const r = validateClausesText(`[
      { "$type": "where" },
      { "$type": "extend" }
    ]`);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.clauseIndex).toBe(0);
      expect(r.message).toMatch(/Clause #1/);
    }
  });
});

describe("validateClausesValue — bypass JSON parsing", () => {
  it("accepts an already-parsed array", () => {
    const r = validateClausesValue([{ $type: "count" }]);
    expect(r.ok).toBe(true);
  });

  it("propagates strippedComments through opts", () => {
    const r = validateClausesValue([], { strippedComments: 5 });
    if (r.ok) expect(r.strippedComments).toBe(5);
  });
});

describe("ALLOWED_CLAUSE_TYPES", () => {
  it("matches the connector's documented set exactly", () => {
    expect(new Set(ALLOWED_CLAUSE_TYPES)).toEqual(
      new Set(["where", "project", "take", "orderby", "distinct", "count", "summarize", "extend", "join"]),
    );
  });
});
