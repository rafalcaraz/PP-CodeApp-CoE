import { isManagedApp, readAppOrigin, type AppRow } from "./data";
import { readRowProperty } from "../../shared/record-properties";

export type ReportedValue<T> = { kind: "reported"; value: T } | { kind: "unreported" | "invalid" };
export interface PackageEntry {
  name: ReportedValue<string>;
  version: ReportedValue<string>;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function field<T>(value: unknown, valid: (entry: unknown) => entry is T): ReportedValue<T> {
  return value === undefined ? { kind: "unreported" } : valid(value) ? { kind: "reported", value } : { kind: "invalid" };
}
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const boolean = (value: unknown): value is boolean => typeof value === "boolean";
export function propertyLabel(value: ReportedValue<string | number | boolean>): string {
  return value.kind === "reported" ? typeof value.value === "boolean" ? value.value ? "Yes" : "No" : String(value.value)
    : value.kind === "invalid" ? "Invalid value" : "Not reported";
}
export function packageSearchText(entry: PackageEntry): string {
  return [entry.name, entry.version].flatMap((value) => value.kind === "reported" ? [value.value] : []).join(" ");
}
export function matchesPackage(entry: PackageEntry, query: string): boolean {
  const haystack = packageSearchText(entry).toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every((word) => haystack.includes(word));
}

export function readManagedAppProperties(value: unknown) {
  const props = object(value) ?? {};
  const sharing = object(props.sharing);
  const access = (mode: "edit" | "run") => {
    const raw = sharing?.[mode], details = object(raw);
    const malformed = (props.sharing !== undefined && !sharing) || (raw !== undefined && !details);
    const readCount = (key: string) => malformed ? { kind: "invalid" as const } : field(details?.[key], count);
    return {
      users: readCount("userCount"), groups: readCount("groupCount"), guests: readCount("guestUserCount"),
      servicePrincipals: readCount("servicePrincipalCount"),
      entireTenant: malformed ? { kind: "invalid" as const } : field(details?.entireTenant, boolean),
    };
  };
  const listKind = props.npmPackages === undefined ? "unreported" : Array.isArray(props.npmPackages) ? "reported" : "invalid";
  const packages: PackageEntry[] = Array.isArray(props.npmPackages) ? props.npmPackages.map((entry) => {
    const item = object(entry);
    return item ? { name: field(item.name, text), version: field(item.version, text) }
      : { name: { kind: "invalid" }, version: { kind: "invalid" } };
  }) : [];
  const declaredCount = field(props.npmPackageCount, count);
  const scope = field(props.npmPackageInventoryScope, text);
  const inventoryVersion = field(props.npmPackageInventoryVersion, count);
  const truncated = field(props.npmPackageInventoryTruncated, boolean);
  const unresolved = field(props.npmPackageUnresolvedCount, count);
  const invalidItems = packages.filter((entry) => entry.name.kind !== "reported" || entry.version.kind !== "reported").length;
  const warnings: string[] = [];
  if (listKind === "invalid") warnings.push("The package list has an invalid shape; package coverage is unknown.");
  if (invalidItems) warnings.push(`${invalidItems} returned package entries have missing or invalid names or versions.`);
  if (truncated.kind === "reported" && truncated.value) warnings.push("The returned package inventory is truncated.");
  if (unresolved.kind === "reported" && unresolved.value > 0) warnings.push(`${unresolved.value} unresolved packages were reported.`);
  if (listKind === "reported" && declaredCount.kind === "reported" && declaredCount.value !== packages.length) {
    warnings.push(`Declared package count (${declaredCount.value}) differs from returned entries (${packages.length}).`);
  }
  if ([declaredCount, scope, inventoryVersion, truncated, unresolved].some((entry) => entry.kind === "invalid")) {
    warnings.push("Some package coverage metadata is invalid; completeness is unknown.");
  }
  const complete = listKind === "reported" && !warnings.length
    && declaredCount.kind === "reported" && scope.kind === "reported" && scope.value === "directProduction"
    && inventoryVersion.kind === "reported" && inventoryVersion.value === 1
    && truncated.kind === "reported" && !truncated.value && unresolved.kind === "reported" && unresolved.value === 0;
  return {
    origin: readAppOrigin({ properties: props }),
    customMiddleTier: props.hasCustomMiddleTier === null ? { kind: "unreported" as const } : field(props.hasCustomMiddleTier, boolean),
    edit: access("edit"), run: access("run"),
    listKind, packages, declaredCount, scope, inventoryVersion, truncated, unresolved, warnings, complete,
  };
}

export function managedAppPackageText(row: AppRow): string {
  return isManagedApp(row)
    ? readManagedAppProperties(readRowProperty(row, "properties")).packages.map(packageSearchText).join(" ")
    : "";
}

export function managedAppPackageLabel(row: AppRow): string {
  if (!isManagedApp(row)) return "Not applicable";
  const report = readManagedAppProperties(readRowProperty(row, "properties"));
  return report.listKind === "unreported" ? "Not reported" : report.listKind === "invalid" ? "Invalid inventory"
    : `${report.packages.length} returned${report.complete ? "" : " (coverage incomplete or unknown)"}`;
}
