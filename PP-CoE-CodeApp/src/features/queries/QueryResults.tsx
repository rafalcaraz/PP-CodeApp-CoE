import { useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Link, makeStyles, tokens } from "@fluentui/react-components";
import { useNavigate } from "react-router-dom";
import { ALL_RESOURCE_TYPES, friendlyConnectorName, getEnvironmentNameMap, resourceTypeShort } from "../../data/inventory";
import { UserChip } from "../../components/UserChip";
import { DateWithRelative } from "../../components/detail/DateWithRelative";
import { getFieldSuggestions } from "../../data/inventory.fields";
import { ResourceTable, type ViewColumn } from "../../shared/resource-table";
import { readPropertyPath } from "../../shared/record-properties";
import { cellText, genericResultShape, getPath, resourceIdentity, resultViewKey } from "./workspace";
import { getQueryResultHref } from "./routeResolver";
import type { Execution } from "./execution";

const useStyles = makeStyles({
  raw: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "60vh", overflow: "auto", fontFamily: tokens.fontFamilyMonospace },
});
export function QueryResults({ execution, columns, onError, exportDisabled = false }: { execution: Execution; columns: string[]; onError: (message: string) => void; exportDisabled?: boolean }) {
  const styles = useStyles();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<{ row: unknown }>();
  const [envNames, setEnvNames] = useState<Map<string, string>>(new Map());
  const projected = genericResultShape(execution.rows, execution.clauses);
  const fields = getFieldSuggestions(execution.resourceTypes ?? ALL_RESOURCE_TYPES, "column").filter((f) => !f.path.startsWith("__"));
  useEffect(() => {
    let active = true;
    if (!projected && execution.rows.some((r) => getPath(r, "properties.environmentId"))) {
      getEnvironmentNameMap().then((names) => { if (active) setEnvNames(names); })
        .catch((e: unknown) => { if (active) onError(e instanceof Error ? e.message : "Environment names could not be resolved. IDs remain available."); });
    }
    return () => { active = false; };
  }, [execution.rows, projected, onError]);
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); }
    catch (e) { onError(`Clipboard failed: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const rawValue = (row: unknown, path: string) =>
    path === "Value" && (row === null || typeof row !== "object") ? row : getPath(row, path);
  const viewValue = (row: unknown, path: string): unknown => {
    const value = rawValue(row, path);
    if (projected) return value;
    if (path === "type" && typeof value === "string") {
      const known = ALL_RESOURCE_TYPES.find((type) => type === value);
      return known ? resourceTypeShort(known) : value;
    }
    if (path === "properties.environmentId" && typeof value === "string") {
      return cellText(getPath(row, "properties.environmentName")) || envNames.get(value) || value;
    }
    if (["properties.ownerId", "properties.createdBy", "properties.lastModifiedBy"].includes(path)) {
      return typeof value === "string" ? value : getPath(value, "id");
    }
    if (["properties.powerPlatformConnectors", "properties.connectors"].includes(path) && Array.isArray(value)) {
      const names = value.map((c: unknown) => getPath(c, "connectorId")).filter((id): id is string => typeof id === "string");
      return names.length ? [...new Set(names.map(friendlyConnectorName))].join(", ") : "No declared references";
    }
    return value;
  };
  const display = (row: unknown, path: string) => {
    const value = rawValue(row, path);
    if (projected) return <span title={cellText(value)}>{cellText(value) || "Not reported"}</span>;
    const identity = projected ? null : resourceIdentity(row);
    const href = identity ? getQueryResultHref({ id: identity.name, type: identity.type, environmentId: identity.environmentId }) : null;
    if (path === "properties.displayName" && href) {
      return <Link href={`#${href}`} onClick={(e) => { e.preventDefault(); navigate(href); }}>{cellText(value) || identity?.name}</Link>;
    }
    if (path === "type" && typeof value === "string") {
      return <span title={value}>{cellText(viewValue(row, path))}</span>;
    }
    if (path === "properties.environmentId" && typeof value === "string") {
      return <span title={value}>{cellText(viewValue(row, path))}</span>;
    }
    if (["properties.ownerId", "properties.createdBy", "properties.lastModifiedBy"].includes(path)) {
      const id = cellText(viewValue(row, path));
      return id ? <UserChip id={id} /> : cellText(value) || "Not reported";
    }
    if (["properties.powerPlatformConnectors", "properties.connectors"].includes(path) && Array.isArray(value)) {
      return <span title={cellText(value)}>{cellText(viewValue(row, path))}</span>;
    }
    if (["properties.lastModifiedAt", "properties.createdAt", "properties.lastPublishedAt"].includes(path) && typeof value === "string") {
      return <span title={value}><DateWithRelative value={value} /></span>;
    }
    return <span title={cellText(value)}>{cellText(value) || "Not reported"}</span>;
  };
  const paths = projected ? columns : [...new Set([...columns, ...fields.map((f) => f.path)])];
  const tableColumns: ViewColumn<unknown>[] = paths.map((path) => {
    const sampleRow = projected ? execution.rows.find((row) => {
      const value = path === "Value" && (row === null || typeof row !== "object") ? row : getPath(row, path);
      return value !== null && value !== undefined;
    }) : undefined;
    const sample = path === "Value" && (sampleRow === null || typeof sampleRow !== "object") ? sampleRow : getPath(sampleRow, path);
    const kind = projected
      ? typeof sample === "number" ? "number" : typeof sample === "boolean" ? "boolean" : "string"
      : fields.find((f) => f.path === path)?.kind;
    return {
      id: path, label: projected ? path : fields.find((f) => f.path === path)?.label ?? path,
      kind: kind === "array" || kind === "object" ? "string" : kind,
      defaultVisible: columns.includes(path),
      value: (row) => viewValue(row, path),
      exportValue: (row) => rawValue(row, path),
      render: (row) => display(row, path),
    };
  });
  let inspectId = "__inspect";
  while (paths.includes(inspectId)) inspectId = `_${inspectId}`;
  tableColumns.push({
    id: inspectId, label: "Inspect", action: true, value: () => undefined,
    render: (row) => {
          const identity = projected ? null : resourceIdentity(row);
          const href = identity ? getQueryResultHref({ id: identity.name, type: identity.type, environmentId: identity.environmentId }) : null;
          return <>{href && <Link href={`#${href}`} aria-label={`Open resource ${identity?.name}`} onClick={(e) => { e.preventDefault(); navigate(href); }}>Open resource</Link>}
            <Button size="small" appearance="subtle" onClick={() => setSelected({ row })}>View raw row</Button></>;
    },
  });
  const viewKey = resultViewKey(execution.rows, execution.clauses, execution.resourceTypes);
  const tableRows = execution.rows.map((row, index) => ({ row, index }));
  return <>
    <ResourceTable key={viewKey} label={projected ? "Projected / aggregate output" : "Inventory results"}
      columns={tableColumns.map((column) => ({
        ...column, value: (item: typeof tableRows[number]) => column.value(item.row),
        exportValue: column.exportValue ? (item: typeof tableRows[number]) => column.exportValue!(item.row) : undefined,
        render: column.render ? (item: typeof tableRows[number]) => column.render!(item.row) : undefined,
      }))} rows={tableRows} getRowId={(item) => String(item.index)}
      persistence={{ key: viewKey, storage: "session" }} exportDisabled={exportDisabled}
      getCustomValue={(item, path) => readPropertyPath(item.row, path)}
      scope={execution.complete ? "All results loaded. Sort and column filters apply to loaded rows only." : "Incomplete result. Sort and column filters apply to loaded rows only; use Load more or Load all results to fetch more."} />
    <Dialog open={selected !== undefined} onOpenChange={(_e, d) => { if (!d.open) setSelected(undefined); }}>
      <DialogSurface><DialogBody>
        <DialogTitle>Raw result</DialogTitle>
        <DialogContent><pre className={styles.raw}>{JSON.stringify(selected?.row, null, 2)}</pre></DialogContent>
        <DialogActions>
          <Button onClick={() => void copy(JSON.stringify(selected?.row, null, 2))}>Copy raw JSON</Button>
          {resourceIdentity(selected?.row) && <Button onClick={() => void copy(resourceIdentity(selected?.row)!.name)}>Copy resource ID</Button>}
          <Button onClick={() => setSelected(undefined)}>Close</Button>
        </DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>
  </>;
}
