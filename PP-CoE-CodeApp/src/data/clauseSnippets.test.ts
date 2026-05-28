/**
 * Asserts every clause template stub is a valid Clause. If we ever
 * change the connector's wire format, these tests pin the templates
 * to it — a broken template would otherwise silently teach users
 * a wrong shape.
 */
import { describe, it, expect } from "vitest";
import { CLAUSE_TEMPLATES, getClauseTemplate } from "./clauseSnippets";
import { validateClausesValue } from "./clauseValidation";

describe("CLAUSE_TEMPLATES", () => {
  it("includes every documented $type except join", () => {
    // We omit join from the dropdown because the RightTable subquery
    // shape is complex and rarely user-authored. If we ever want it,
    // add it here AND in the registry.
    const types = CLAUSE_TEMPLATES.map((t) => t.type).sort();
    expect(types).toEqual(
      ["count", "distinct", "extend", "orderby", "project", "summarize", "take", "where"].sort(),
    );
  });

  it("every template's JSON parses and passes validateClausesValue", () => {
    for (const tpl of CLAUSE_TEMPLATES) {
      const parsed = JSON.parse(tpl.json);
      const result = validateClausesValue([parsed]);
      expect(result.ok, `template ${tpl.type} failed validation: ${result.ok ? "" : result.message}`).toBe(true);
    }
  });

  it("getClauseTemplate resolves every type in the registry", () => {
    for (const tpl of CLAUSE_TEMPLATES) {
      expect(getClauseTemplate(tpl.type)).toBeTruthy();
    }
  });

  it("returns null for an unknown type", () => {
    // @ts-expect-error — intentionally testing the runtime guard
    expect(getClauseTemplate("nonexistent")).toBeNull();
  });
});
