import { useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Link, makeStyles, tokens } from "@fluentui/react-components";
import { useNavigate } from "react-router-dom";
import { ALL_RESOURCE_TYPES, friendlyConnectorName, getEnvironmentNameMap, resourceTypeShort } from "../../data/inventory";
import { UserChip } from "../../components/UserChip";
import { DateWithRelative } from "../../components/detail/DateWithRelative";
import { getFieldSuggestions } from "../../data/inventory.fields";
import { cellText, genericResultShape, getPath, resourceIdentity } from "./workspace";
import { getQueryResultHref } from "./routeResolver";
import type { Execution } from "./execution";

const useStyles = makeStyles({
  scroll: { overflowX: "auto", maxWidth: "100%" },
  table: { width: "100%", borderCollapse: "collapse", textAlign: "left",
    "& th": { backgroundColor: tokens.colorNeutralBackground2, fontWeight: tokens.fontWeightSemibold },
    "& th, & td": { padding: tokens.spacingHorizontalM, borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, verticalAlign: "top", maxWidth: "360px", overflowWrap: "anywhere", minWidth: "120px" } },
  raw: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "60vh", overflow: "auto", fontFamily: tokens.fontFamilyMonospace },
});
const FIELD_LABELS = new Map(getFieldSuggestions(ALL_RESOURCE_TYPES, "column").map((f) => [f.path, f.label]));
export function QueryResults({ execution, columns, onError }: { execution: Execution; columns: string[]; onError: (message: string) => void }) {
  const styles = useStyles();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<{ row: unknown }>();
  const [envNames, setEnvNames] = useState<Map<string, string>>(new Map());
  const projected = genericResultShape(execution.rows, execution.clauses);
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
  const display = (row: unknown, path: string) => {
    const value = getPath(row, path);
    const identity = projected ? null : resourceIdentity(row);
    const href = identity ? getQueryResultHref({ id: identity.name, type: identity.type, environmentId: identity.environmentId }) : null;
    if (path === "properties.displayName" && href) {
      return <Link href={`#${href}`} onClick={(e) => { e.preventDefault(); navigate(href); }}>{cellText(value) || identity?.name}</Link>;
    }
    if (path === "type" && typeof value === "string") {
      const known = ALL_RESOURCE_TYPES.find((type) => type === value);
      return <span title={value}>{known ? resourceTypeShort(known) : value}</span>;
    }
    if (path === "properties.environmentId" && typeof value === "string") {
      return <span title={value}>{cellText(getPath(row, "properties.environmentName")) || envNames.get(value) || value}</span>;
    }
    if (["properties.ownerId", "properties.createdBy", "properties.lastModifiedBy"].includes(path)) {
      const id = typeof value === "string" ? value : cellText(getPath(value, "id"));
      return id ? <UserChip id={id} /> : cellText(value) || "Not reported";
    }
    if (["properties.powerPlatformConnectors", "properties.connectors"].includes(path) && Array.isArray(value)) {
      const names = value.map((c: unknown) => getPath(c, "connectorId")).filter((id): id is string => typeof id === "string");
      return <span title={cellText(value)}>{names.length ? [...new Set(names.map(friendlyConnectorName))].join(", ") : "No declared references"}</span>;
    }
    if (["properties.lastModifiedAt", "properties.createdAt", "properties.lastPublishedAt"].includes(path) && typeof value === "string") {
      return <span title={value}><DateWithRelative value={value} /></span>;
    }
    return <span title={cellText(value)}>{cellText(value) || "Not reported"}</span>;
  };
  return <>
    <div className={styles.scroll}>
      <table className={styles.table}>
        <caption>{projected ? "Projected / aggregate output. Columns reflect the returned shape." : "Inventory results. IDs are retained in raw data and CSV."}</caption>
        <thead><tr>{columns.map((c) => <th key={c} scope="col" title={c}>{projected ? c : FIELD_LABELS.get(c) ?? c}</th>)}<th scope="col">Inspect</th></tr></thead>
        <tbody>{execution.rows.map((row, index) => {
          const identity = projected ? null : resourceIdentity(row);
          const href = identity ? getQueryResultHref({ id: identity.name, type: identity.type, environmentId: identity.environmentId }) : null;
          return <tr key={index}>
          {columns.map((c) => <td key={c}>{c === "Value" && (typeof row !== "object" || row === null) ? cellText(row) : display(row, c)}</td>)}
          <td>{href && <Link href={`#${href}`} aria-label={`Open resource ${identity?.name}`} onClick={(e) => { e.preventDefault(); navigate(href); }}>Open resource</Link>}
            <Button size="small" appearance="subtle" onClick={() => setSelected({ row })}>View raw row {index + 1}</Button></td>
        </tr>; })}</tbody>
      </table>
    </div>
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
