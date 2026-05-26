/**
 * Filter evaluation for deep-scan rows.
 *
 * Given a `FlatPayload` (from `flatten.ts`) and a `DeepFilterClause`,
 * decides whether the record matches. Pure function — no side effects,
 * easily testable.
 *
 * Semantics per operator:
 *
 *  - `eq`        → strict equality. For booleans we accept literal
 *                  `true`/`false`/`"true"`/`"false"`. For strings,
 *                  case-insensitive equality (admin-payload casing is
 *                  inconsistent).
 *  - `ne`        → strict inequality (negation of `eq`).
 *  - `in`        → value is one of the elements in `value: string[]`.
 *                  Case-insensitive string compare.
 *  - `notIn`     → negation of `in`.
 *  - `contains`  → string substring match (case-insensitive).
 *  - `startsWith`/`endsWith` → string prefix / suffix match
 *                  (case-insensitive).
 *  - `gt`/`gte`/`lt`/`lte` → numeric comparison. Coerces the actual
 *                  value to number via `Number(...)`; non-numeric
 *                  actuals fail the comparison.
 *  - `exists`    → actual is present and not null / undefined.
 *  - `notExists` → actual is missing, null, or undefined.
 *
 * All other operators on missing values return `false` — a filter on
 * a path that isn't present in the record can't be satisfied (except
 * `notExists`).
 */

import type { DeepFilterClause } from "./catalog/types";
import { getPath, type FlatPayload } from "./catalog/flatten";

/** Evaluate a single filter clause against a flat payload. */
export function evaluateFilter(
  flat: FlatPayload,
  clause: DeepFilterClause
): boolean {
  const actual = getPath(flat, clause.path);
  const present = actual !== undefined && actual !== null;

  switch (clause.op) {
    case "exists":
      return present;
    case "notExists":
      return !present;
  }

  if (!present) return false;

  switch (clause.op) {
    case "eq":
      return equals(actual, clause.value);
    case "ne":
      return !equals(actual, clause.value);
    case "in":
      return arrayIncludes(clause.value, actual);
    case "notIn":
      return !arrayIncludes(clause.value, actual);
    case "contains":
      return stringContains(actual, clause.value);
    case "startsWith":
      return stringStartsWith(actual, clause.value);
    case "endsWith":
      return stringEndsWith(actual, clause.value);
    case "gt":
      return numericCompare(actual, clause.value) > 0;
    case "gte":
      return numericCompare(actual, clause.value) >= 0;
    case "lt":
      return numericCompare(actual, clause.value) < 0;
    case "lte":
      return numericCompare(actual, clause.value) <= 0;
  }
}

function equals(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (typeof actual === "boolean" || typeof expected === "boolean") {
    return toBool(actual) === toBool(expected);
  }
  if (typeof actual === "number" || typeof expected === "number") {
    const a = Number(actual);
    const b = Number(expected);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return a === b;
  }
  return String(actual).toLowerCase() === String(expected).toLowerCase();
}

function arrayIncludes(haystack: unknown, needle: unknown): boolean {
  if (!Array.isArray(haystack)) return false;
  for (const item of haystack) {
    if (equals(needle, item)) return true;
  }
  return false;
}

function stringContains(actual: unknown, expected: unknown): boolean {
  if (expected === null || expected === undefined) return false;
  const a = String(actual).toLowerCase();
  const e = String(expected).toLowerCase();
  if (e === "") return true;
  return a.includes(e);
}

function stringStartsWith(actual: unknown, expected: unknown): boolean {
  if (expected === null || expected === undefined) return false;
  return String(actual).toLowerCase().startsWith(String(expected).toLowerCase());
}

function stringEndsWith(actual: unknown, expected: unknown): boolean {
  if (expected === null || expected === undefined) return false;
  return String(actual).toLowerCase().endsWith(String(expected).toLowerCase());
}

function numericCompare(actual: unknown, expected: unknown): number {
  const a = Number(actual);
  const b = Number(expected);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return a - b;
}

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase().trim();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  return Boolean(value);
}
