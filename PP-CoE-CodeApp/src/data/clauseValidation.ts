/**
 * Validation for hand-written / pasted Clause arrays.
 *
 * Used by the tile editor's Advanced (clauses) mode to give the user
 * meaningful errors BEFORE we ship a bad clause list to the connector.
 *
 * Pure module — no I/O, no React. Easy to unit-test exhaustively.
 *
 * What we validate:
 *   - The outer shape is an array
 *   - Every entry is an object with a `$type` from the allowed set
 *   - Per-type required-field shape (matches the generated model)
 *
 * What we DO NOT validate (left to the connector):
 *   - Operator semantic correctness (`==`, `!startswith`, etc. — the
 *     connector knows the full whitelist; we only check the field exists)
 *   - KQL expression syntax inside `extend` (e.g.
 *     `tostring(properties.X)` — that's a connector concern)
 *   - Field-name existence on actual resources (the field picker is a
 *     hint catalog, not a whitelist, per the existing UX)
 *
 * Inputs typically come from user paste (often with `//` line comments
 * from annotated docs), so we strip those silently before parsing JSON
 * and report the count back as informational, not an error.
 */

/** All clause `$type` discriminator values the connector accepts.
 *  Mirrors `Clause$type` in `src/generated/models/PowerPlatformforAdminsV2Model.ts`. */
export const ALLOWED_CLAUSE_TYPES = [
  "where",
  "project",
  "take",
  "orderby",
  "distinct",
  "count",
  "summarize",
  "extend",
  "join",
] as const;

export type AllowedClauseType = (typeof ALLOWED_CLAUSE_TYPES)[number];

const ALLOWED_SET = new Set<string>(ALLOWED_CLAUSE_TYPES);

/** Maximum Levenshtein distance for "did you mean" suggestions on a
 *  typoed `$type`. 2 catches `whre`, `wehre`, `extned`, etc. but won't
 *  match anything wildly different. */
const SUGGESTION_MAX_DISTANCE = 2;

export interface ValidationOk {
  ok: true;
  /** The parsed clause array. May not be deeply typed — we coerce at the
   *  boundary, the connector validates the remainder. */
  clauses: unknown[];
  /** Number of `//`-style line comments stripped from the input. Surfaced
   *  to the user as an informational note ("Stripped 3 line comments")
   *  so they know we modified their paste. */
  strippedComments: number;
}

export interface ValidationError {
  ok: false;
  /** Human-readable, one-line error. Suitable for the status row. */
  message: string;
  /** Best-effort 1-indexed line number where the error occurred. Only
   *  populated for JSON syntax errors; undefined for shape errors. */
  line?: number;
  /** Best-effort 0-indexed clause-array index where the error occurred.
   *  Populated for shape errors. */
  clauseIndex?: number;
}

export type ValidationResult = ValidationOk | ValidationError;

/** Strip `//`-style line comments from a JSON-looking string.
 *
 *  Naive but safe enough for clauses authored by humans: walks the string
 *  character-by-character tracking whether we're inside a double-quoted
 *  string (with `\"` escape awareness). Outside strings, `//` to end-of-
 *  line is dropped.
 *
 *  Does NOT handle block comments (`slash-star ... star-slash`) — those
 *  are rarer in paste-from-chat scenarios and complicate the state
 *  machine. Add later if users complain. */
export function stripLineComments(input: string): { stripped: string; count: number } {
  let out = "";
  let count = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      out += ch;
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === "\\") {
        escapeNext = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && input[i + 1] === "/") {
      // Skip to end of line (preserve the newline so line numbers don't shift)
      count++;
      while (i < input.length && input[i] !== "\n") i++;
      if (i < input.length) out += input[i]; // preserve the newline
      continue;
    }
    out += ch;
  }
  return { stripped: out, count };
}

/** Compute the 1-indexed line number for a character offset in the
 *  original text. Used to map JSON parse errors back to a user-visible
 *  line. Returns 1 for offsets past end-of-string (defensive). */
function lineNumberFor(text: string, offset: number): number {
  if (offset <= 0) return 1;
  const cap = Math.min(offset, text.length);
  let line = 1;
  for (let i = 0; i < cap; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/** Extract a position offset from a JSON.parse SyntaxError message.
 *  V8 and modern engines emit messages like:
 *    "Unexpected token } in JSON at position 47"
 *    "Expected ',' or ']' after array element in JSON at position 19"
 *  Returns null if the message doesn't match the expected shape. */
function parsePositionFromJsonError(msg: string): number | null {
  const m = /at position (\d+)/i.exec(msg);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Levenshtein distance — used for "did you mean 'where'?" suggestions
 *  on a misspelled `$type`. Capped at small inputs (`$type` values are
 *  always short) so the O(m*n) cost is irrelevant. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** "Did you mean 'where'?" — null when no allowed type is close enough. */
function suggestType(typed: string): string | null {
  const lower = typed.toLowerCase();
  let best: string | null = null;
  let bestDist = SUGGESTION_MAX_DISTANCE + 1;
  for (const t of ALLOWED_CLAUSE_TYPES) {
    const d = levenshtein(lower, t);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return bestDist <= SUGGESTION_MAX_DISTANCE ? best : null;
}

function isStringNonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isStringArray(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Per-`$type` shape validator. Returns an error message string when
 *  invalid, or null when the clause's required fields are all present
 *  with the right basic types. Mirrors the generated model interfaces. */
function validateClauseShape(c: Record<string, unknown>, type: AllowedClauseType): string | null {
  switch (type) {
    case "where":
      if (!isStringNonEmpty(c.FieldName)) return "Missing or invalid `FieldName` (string)";
      if (!isStringNonEmpty(c.Operator)) return "Missing or invalid `Operator` (string, e.g. `==`, `!startswith`)";
      if (c.Values !== undefined && !isStringArray(c.Values)) return "`Values` must be an array of strings";
      return null;
    case "extend":
      if (!isStringNonEmpty(c.FieldName)) return "Missing or invalid `FieldName` (string — the alias name)";
      if (!isStringNonEmpty(c.Expression)) return "Missing or invalid `Expression` (string — the KQL expression)";
      return null;
    case "orderby":
      if (!isRecord(c.FieldNamesAscDesc)) {
        return "Missing `FieldNamesAscDesc` (object of `{ \"field\": \"asc\" | \"desc\" }`)";
      }
      for (const [k, v] of Object.entries(c.FieldNamesAscDesc)) {
        if (!isStringNonEmpty(k)) return "`FieldNamesAscDesc` has an empty key";
        if (v !== "asc" && v !== "desc") return `\`FieldNamesAscDesc["${k}"]\` must be "asc" or "desc"`;
      }
      return null;
    case "take":
      if (typeof c.TakeCount !== "number" || !Number.isFinite(c.TakeCount) || c.TakeCount <= 0) {
        return "Missing or invalid `TakeCount` (positive number)";
      }
      return null;
    case "distinct":
      if (!isStringArray(c.FieldList) || (c.FieldList as unknown[]).length === 0) {
        return "Missing `FieldList` (non-empty array of strings)";
      }
      return null;
    case "project":
      if (!isStringArray(c.FieldList) || (c.FieldList as unknown[]).length === 0) {
        return "Missing `FieldList` (non-empty array of strings)";
      }
      return null;
    case "count":
      // No required fields beyond `$type`.
      return null;
    case "summarize":
      if (!isRecord(c.SummarizeClauseExpression)) {
        return "Missing `SummarizeClauseExpression` (object)";
      }
      {
        const exp = c.SummarizeClauseExpression;
        if (exp.OperatorName !== "count" && exp.OperatorName !== "argmax") {
          return "`SummarizeClauseExpression.OperatorName` must be \"count\" or \"argmax\"";
        }
        if (exp.OperatorFieldName !== undefined && typeof exp.OperatorFieldName !== "string") {
          return "`SummarizeClauseExpression.OperatorFieldName` must be a string when provided";
        }
        if (exp.FieldList !== undefined && !isStringArray(exp.FieldList)) {
          return "`SummarizeClauseExpression.FieldList` must be an array of strings when provided";
        }
      }
      return null;
    case "join":
      if (!isStringNonEmpty(c.JoinKind)) return "Missing `JoinKind` (string — e.g. \"innerunique\", \"leftouter\")";
      if (!isStringNonEmpty(c.LeftColumnName)) return "Missing `LeftColumnName` (string)";
      if (!isStringNonEmpty(c.RightColumnName)) return "Missing `RightColumnName` (string)";
      if (c.RightTable === undefined) return "Missing `RightTable` (sub-query object)";
      return null;
  }
  // Unreachable — all branches covered.
  return null;
}

/** Validate a textarea string containing pasted clause-array JSON.
 *
 *  Pipeline:
 *    1. Trim whitespace and a possible BOM
 *    2. Strip `//` line comments silently
 *    3. JSON.parse — map parse errors back to a 1-indexed line number
 *    4. Confirm result is an array, every element is a clause-shaped
 *       object with a known `$type` and required fields per type
 *
 *  Returns the first error encountered. */
export function validateClausesText(text: string): ValidationResult {
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  if (cleaned === "") {
    return { ok: false, message: "Empty clauses — paste or build a clause array (e.g. `[]`)" };
  }
  const { stripped, count: strippedComments } = stripLineComments(cleaned);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const offset = parsePositionFromJsonError(msg);
    const line = offset !== null ? lineNumberFor(stripped, offset) : undefined;
    return {
      ok: false,
      message: line !== undefined ? `JSON syntax error on line ${line}: ${msg}` : `JSON syntax error: ${msg}`,
      line,
    };
  }

  return validateClausesValue(parsed, { strippedComments });
}

/** Validate an already-parsed value (no JSON parsing).
 *  Exposed separately so callers that already have the value (e.g.
 *  tests, or future programmatic editors) don't have to round-trip
 *  through JSON. */
export function validateClausesValue(
  value: unknown,
  opts: { strippedComments?: number } = {}
): ValidationResult {
  const strippedComments = opts.strippedComments ?? 0;
  if (!Array.isArray(value)) {
    return { ok: false, message: "Top-level value must be a JSON array of clauses" };
  }
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (!isRecord(c)) {
      return {
        ok: false,
        message: `Clause #${i + 1}: must be an object, got ${typeof c === "object" ? "null" : typeof c}`,
        clauseIndex: i,
      };
    }
    const typeRaw = c.$type;
    if (!isStringNonEmpty(typeRaw)) {
      return { ok: false, message: `Clause #${i + 1}: missing required \`$type\``, clauseIndex: i };
    }
    if (!ALLOWED_SET.has(typeRaw)) {
      const suggestion = suggestType(typeRaw);
      const suggestStr = suggestion ? ` (did you mean \`${suggestion}\`?)` : "";
      return {
        ok: false,
        message: `Clause #${i + 1}: unknown \`$type\` "${typeRaw}"${suggestStr}`,
        clauseIndex: i,
      };
    }
    const shapeErr = validateClauseShape(c, typeRaw as AllowedClauseType);
    if (shapeErr) {
      return {
        ok: false,
        message: `Clause #${i + 1} (\`${typeRaw}\`): ${shapeErr}`,
        clauseIndex: i,
      };
    }
  }
  return { ok: true, clauses: value, strippedComments };
}
