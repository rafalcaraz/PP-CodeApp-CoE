/**
 * Per-clause template stubs for the "Insert clause" dropdown in the
 * Advanced (clauses) tile editor.
 *
 * Each stub is a valid Clause object (passes `validateClausesValue`) that
 * gives the user a working starting point so they don't have to memorize
 * the connector's wire format (`FieldName` vs `Name`, `Values` as a
 * string array, `FieldNamesAscDesc` as a record, etc.).
 *
 * Field values are intentionally placeholder strings (`properties.X`,
 * `'value'`, `"asc"`) — the user replaces them with real values.
 */
import type { Clause } from "../generated/models/PowerPlatformforAdminsV2Model";
import type { AllowedClauseType } from "./clauseValidation";

export interface ClauseTemplate {
  /** The `$type` discriminator the template builds. */
  type: AllowedClauseType;
  /** Short human-friendly label for the dropdown (e.g. "Where (filter)"). */
  label: string;
  /** One-line description shown as helper text. */
  description: string;
  /** A pre-formatted JSON snippet ready to paste at the cursor. Pretty-
   *  printed with 2-space indent so it drops in cleanly. */
  json: string;
}

function format(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const TEMPLATES_RAW: Array<{ template: ClauseTemplate; clause: Clause }> = [
  {
    template: {
      type: "where",
      label: "Where (filter)",
      description: "Restrict rows by a field expression. Most common clause.",
      json: "",
    },
    clause: {
      $type: "where",
      FieldName: "properties.displayName",
      Operator: "==",
      Values: ["'value'"],
    } as unknown as Clause,
  },
  {
    template: {
      type: "extend",
      label: "Extend (alias / computed column)",
      description: "Compute a new column from a KQL expression. Useful before a `where` against the alias.",
      json: "",
    },
    clause: {
      $type: "extend",
      FieldName: "__alias",
      Expression: "tostring(properties.X)",
    } as unknown as Clause,
  },
  {
    template: {
      type: "orderby",
      label: "Order by",
      description: "Sort rows. Values must be \"asc\" or \"desc\".",
      json: "",
    },
    clause: {
      $type: "orderby",
      FieldNamesAscDesc: { "tostring(properties.createdAt)": "desc" },
    } as unknown as Clause,
  },
  {
    template: {
      type: "take",
      label: "Take (limit row count)",
      description: "Cap the number of rows returned. Be aware — this also caps `totalRecords`.",
      json: "",
    },
    clause: { $type: "take", TakeCount: 100 } as unknown as Clause,
  },
  {
    template: {
      type: "distinct",
      label: "Distinct",
      description: "Collapse to distinct combinations of the listed fields.",
      json: "",
    },
    clause: {
      $type: "distinct",
      FieldList: ["properties.X"],
    } as unknown as Clause,
  },
  {
    template: {
      type: "count",
      label: "Count",
      description: "Return the row count. Usually combined with `where` to count a filtered set.",
      json: "",
    },
    clause: { $type: "count" } as unknown as Clause,
  },
  {
    template: {
      type: "project",
      label: "Project (select fields)",
      description: "Keep only the listed fields on each row.",
      json: "",
    },
    clause: {
      $type: "project",
      FieldList: ["properties.displayName", "properties.environmentId"],
    } as unknown as Clause,
  },
  {
    template: {
      type: "summarize",
      label: "Summarize (group + count)",
      description: "Aggregate rows. Server-side `summarize by` — same idiom the dashboard uses for bar/pie charts.",
      json: "",
    },
    clause: {
      $type: "summarize",
      SummarizeClauseExpression: {
        OperatorName: "count",
        OperatorFieldName: "resourceCount",
        FieldList: ["type"],
      },
    } as unknown as Clause,
  },
];

/** Public registry of clause templates, in the order they should appear
 *  in the dropdown (most common → least common). */
export const CLAUSE_TEMPLATES: ClauseTemplate[] = TEMPLATES_RAW.map(({ template, clause }) => ({
  ...template,
  json: format(clause),
}));

/** Convenience lookup by type, used by the editor when the user picks
 *  an item from the Insert dropdown. */
export function getClauseTemplate(type: AllowedClauseType): ClauseTemplate | null {
  return CLAUSE_TEMPLATES.find((t) => t.type === type) ?? null;
}
