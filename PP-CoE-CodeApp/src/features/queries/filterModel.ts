import type { QueryFilter, QueryFilterOp } from "../../data/inventory";
import type { InventoryField } from "../../data/inventory.fields";

const OPS: { value: QueryFilterOp; label: string }[] = [
  { value: "==", label: "equals" }, { value: "!=", label: "not equals" },
  { value: "contains", label: "contains" }, { value: "!contains", label: "does not contain" },
  { value: "startswith", label: "starts with" }, { value: "!startswith", label: "does not start with" },
  { value: "endswith", label: "ends with" }, { value: "!endswith", label: "does not end with" },
  { value: "in~", label: "in (comma-separated)" }, { value: "has", label: "has token" },
  { value: "has_any", label: "has any token" },
  { value: ">", label: "greater than / after" }, { value: ">=", label: "at least / on or after" },
  { value: "<", label: "less than / before" }, { value: "<=", label: "at most / on or before" },
  { value: "lastNdays", label: "last X days (rolling)" }, { value: "today", label: "today (UTC)" },
  { value: "yesterday", label: "yesterday (UTC)" }, { value: "onDate", label: "on date (UTC)" },
  { value: "dateRange", label: "date range (UTC)" },
  { value: "isempty", label: "is empty (array)" }, { value: "!isempty", label: "is non-empty (array)" },
];
export function operatorsFor(field?: InventoryField): typeof OPS {
  if (!field) return OPS;
  const allowed = field.kind === "boolean" ? ["==", "!="] :
    field.kind === "number" ? ["==", "!=", ">", ">=", "<", "<=", "in~"] :
    field.kind === "date" ? [">", ">=", "<", "<=", "lastNdays", "today", "yesterday", "onDate", "dateRange"] :
    field.kind === "array" ? ["isempty", "!isempty", "has", "has_any", "contains", "!contains"] :
    field.kind === "object" ? ["contains", "!contains", "has", "has_any"] :
    ["==", "!=", "contains", "!contains", "startswith", "!startswith", "endswith", "!endswith", "in~", "has", "has_any"];
  return OPS.filter((o) => allowed.includes(o.value));
}
export function typedFilterErrors(filters: QueryFilter[], fields: InventoryField[]): string[] {
  return filters.flatMap((f, index) => {
    const meta = fields.find((m) => m.path === f.field);
    if (!meta || ["isempty", "!isempty", "today", "yesterday"].includes(f.op)) return [];
    if (meta.kind === "boolean" && !["true", "false"].includes(f.value.trim())) return [`Filter ${index + 1}: choose true or false. Missing fields are not false.`];
    if (meta.kind === "number" && f.value.split(",").some((v) => !v.trim() || !Number.isFinite(Number(v)))) return [`Filter ${index + 1}: enter a valid number.`];
    if (meta.kind === "date" && [">", ">=", "<", "<=", "==", "!="].includes(f.op) &&
      (!Number.isFinite(Date.parse(f.value)) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(f.value.trim()))) return [`Filter ${index + 1}: enter an ISO date/time with timezone, or use a UTC calendar preset.`];
    return [];
  });
}
