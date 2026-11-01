import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Combobox,
  Dropdown,
  Field,
  Link,
  Option,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ArrowDownloadRegular, DismissRegular } from "@fluentui/react-icons";
import { useNavigate } from "react-router-dom";
import { ErrorPane, LoadingPane } from "../../components/Status";
import { downloadCsv, rowsToCsv } from "../../utils/csv";
import {
  filterConnectorOperationUsage,
  loadConnectorOperationUsage,
  shortResourceType,
  type ConnectorEntry,
  type ConnectorOperationRecord,
  type ConnectorUsageKind,
  type OperationMatch,
} from "./data";

const PAGE_SIZE = 25;

const useStyles = makeStyles({
  root: { minWidth: 0 },
  controls: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: tokens.spacingHorizontalM,
  },
  picker: { minWidth: 0, flexBasis: "260px", flexGrow: 1, maxWidth: "600px" },
  chips: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalS },
  evidence: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXS,
    overflowWrap: "anywhere",
  },
  badge: { whiteSpace: "normal", height: "auto", maxWidth: "100%" },
  muted: { color: tokens.colorNeutralForeground3 },
  scroll: { overflowX: "auto" },
  table: { tableLayout: "fixed", minWidth: "900px", width: "100%" },
  cell: { overflowWrap: "anywhere", verticalAlign: "top" },
  operationsColumn: { width: "35%" },
  resourceColumn: { width: "30%" },
  pager: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
  },
});

type UsageState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; records: ConnectorOperationRecord[] };

export interface ConnectorOperationUsageHandle {
  find: (operationId: string) => void;
}

function operationLabel(operation: ConnectorOperationRecord["operations"][number]): string {
  return `${operation.operationId}${operation.role === "trigger" ? " (trigger)" : ""}${
    operation.isEnabled === false ? " (disabled)" : ""
  }`;
}

export function ConnectorOperationUsage({
  entry,
  ref,
}: {
  entry: ConnectorEntry;
  ref?: Ref<ConnectorOperationUsageHandle>;
}) {
  const styles = useStyles();
  const navigate = useNavigate();
  const [state, setState] = useState<UsageState>({ kind: "idle" });
  const [operationIds, setOperationIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [match, setMatch] = useState<OperationMatch>("any");
  const [category, setCategory] = useState<ConnectorUsageKind | "all">("all");
  const [pageIndex, setPageIndex] = useState(0);
  const request = useRef<AbortController | null>(null);
  const cached = useRef<ConnectorOperationRecord[] | null>(null);
  const section = useRef<HTMLDivElement>(null);

  const load = useCallback(async (refresh = false) => {
    if (!refresh && cached.current) {
      setState({ kind: "ready", records: cached.current });
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ kind: "loading" });
    setPageIndex(0);
    const result = await loadConnectorOperationUsage(entry.connectorId, controller.signal);
    if (controller.signal.aborted) return;
    cached.current = result.ok ? result.data : null;
    setState(result.ok
      ? { kind: "ready", records: result.data }
      : { kind: "error", message: result.error });
  }, [entry.connectorId]);

  useEffect(() => () => request.current?.abort(), []);

  useImperativeHandle(ref, () => ({
    find(operationId) {
      setOperationIds([operationId]);
      setMatch("any");
      setCategory("all");
      setPageIndex(0);
      setQuery("");
      section.current?.scrollIntoView?.({ block: "start" });
      void load();
    },
  }), [load]);

  const options = useMemo(() => {
    const all = new Map(
      entry.operations.map((operation) => [
        operation.operationId.toLowerCase(),
        { id: operation.operationId, label: operation.displayName || operation.operationId },
      ]),
    );
    if (state.kind === "ready") {
      for (const record of state.records) {
        for (const operation of record.operations) {
          if (!all.has(operation.operationId.toLowerCase())) {
            all.set(operation.operationId.toLowerCase(), {
              id: operation.operationId, label: operation.operationId,
            });
          }
        }
      }
    }
    for (const id of operationIds) {
      if (!all.has(id.toLowerCase())) all.set(id.toLowerCase(), { id, label: id });
    }
    return [...all.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [entry.operations, operationIds, state]);
  const visibleOptions = options.filter(
    (option) => `${option.id} ${option.label}`.toLowerCase().includes(query.trim().toLowerCase()),
  ).slice(0, 100);
  const canAdd = query.trim() !== "" &&
    !options.some((option) => option.id.toLowerCase() === query.trim().toLowerCase());

  const matches = useMemo(() => state.kind === "ready"
    ? filterConnectorOperationUsage(state.records, operationIds, match)
    : [], [state, operationIds, match]);
  const filtered = matches.filter(
    ({ resource }) => category === "all" || resource.kind === category,
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const start = currentPage * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  const noOperations = state.kind === "ready"
    ? state.records.filter((record) => record.operations.length === 0).length : 0;

  const changeOperations = (ids: string[]) => {
    setOperationIds(ids);
    setQuery("");
    setPageIndex(0);
  };

  const exportResults = () => {
    downloadCsv(
      `connector-${entry.connectorId.replace(/[^a-z0-9_-]+/gi, "-")}-direct-operations`,
      rowsToCsv(filtered.map(({ resource, operations }) => ({
        Name: resource.row.displayName || resource.row.id,
        "Resource type": shortResourceType(resource.row.type,
          resource.kind === "apps" ? resource.row.subType : undefined),
        Environment: resource.row.environmentName || resource.row.environmentId,
        "Environment ID": resource.row.environmentId,
        "Resource ID": resource.row.id,
        "Reported operations": operations.map(operationLabel).join("; "),
        "Selected operations": operationIds.join("; "),
        Match: match,
      }))),
    );
  };

  return (
    <Card ref={section} className={styles.root}>
      <CardHeader
        header={<Text weight="semibold">Direct operation usage</Text>}
        description={<Text size={200}>
          Find resources reporting specific actions or triggers on this connector.
          Catalog capabilities alone do not count as usage.
        </Text>}
      />
      <Text size={200} className={styles.muted}>
        Operation IDs are matched within this connector, not against other connectors
        on the same resource. With no selection, all reported operations are included.
        A connector reference without operation IDs (such as a SQL data source)
        does not prove any specific action is used. Reported configuration is not
        execution telemetry; disabled operations are labeled.
      </Text>
      <div className={styles.controls}>
        <Field label="Operations" className={styles.picker}>
          <Combobox
            multiselect
            aria-label="Operations"
            placeholder="Search operation name or ID"
            value={query}
            selectedOptions={operationIds}
            onChange={(event) => setQuery(event.target.value)}
            onOptionSelect={(_event, data) => changeOperations(data.selectedOptions)}
          >
            {visibleOptions.map((option) => (
              <Option key={option.id} value={option.id} text={option.id}>
                {option.label === option.id ? option.id : `${option.label} — ${option.id}`}
              </Option>
            ))}
          </Combobox>
        </Field>
        {canAdd && <Button onClick={() => changeOperations([...operationIds, query.trim()])}>
          Add operation ID
        </Button>}
        <Field label="Match">
          <Dropdown
            aria-label="Operation match"
            selectedOptions={[match]}
            value={match === "any" ? "Any selected operation" : "All selected operations"}
            onOptionSelect={(_event, data) => {
              if (data.optionValue === "any" || data.optionValue === "all") {
                setMatch(data.optionValue);
                setPageIndex(0);
              }
            }}
          >
            <Option value="any">Any selected operation</Option>
            <Option value="all">All selected operations</Option>
          </Dropdown>
        </Field>
        <Button appearance="primary" disabled={state.kind === "loading"} onClick={() => void load(true)}>
          {state.kind === "ready" ? "Refresh reported usage" : "Load reported usage"}
        </Button>
      </div>
      {operationIds.length > 0 && (
        <div className={styles.chips} aria-label="Selected operations">
          {operationIds.map((id) => (
            <Button key={id} size="small" icon={<DismissRegular />}
              aria-label={`Remove ${id}`}
              onClick={() => changeOperations(operationIds.filter((selected) => selected !== id))}>
              {id}
            </Button>
          ))}
          <Button size="small" onClick={() => changeOperations([])}>Clear operations</Button>
        </div>
      )}
      {state.kind === "idle" && <Text className={styles.muted}>
        Load usage to inspect all reported connector references across apps, flows, and agents.
      </Text>}
      {state.kind === "loading" && <LoadingPane label="Reading connector references across apps, flows, and agents…" />}
      {state.kind === "error" && (
        <>
          <ErrorPane title="Couldn't load operation usage" message={state.message} />
          <Button onClick={() => void load()}>Try again</Button>
        </>
      )}
      {state.kind === "ready" && (
        <>
          <Text aria-live="polite">
            {matches.length.toLocaleString()} resources match:{" "}
            {matches.filter(({ resource }) => resource.kind === "apps").length} apps,{" "}
            {matches.filter(({ resource }) => resource.kind === "flows").length} flows,{" "}
            {matches.filter(({ resource }) => resource.kind === "agents").length} agents.
            {" "}{state.records.length.toLocaleString()} references inspected;{" "}
            {noOperations.toLocaleString()} have no operation IDs reported.
          </Text>
          <div className={styles.controls}>
            <Field label="Resource category">
              <Dropdown
                aria-label="Operation usage resource category"
                value={category === "all" ? "All resources" : category}
                selectedOptions={[category]}
                onOptionSelect={(_event, data) => {
                  const value = data.optionValue;
                  if (value === "all" || value === "apps" || value === "flows" || value === "agents") {
                    setCategory(value);
                    setPageIndex(0);
                  }
                }}
              >
                <Option value="all">All resources</Option>
                <Option value="apps">Apps</Option>
                <Option value="flows">Flows</Option>
                <Option value="agents">Agents</Option>
              </Dropdown>
            </Field>
            <Button icon={<ArrowDownloadRegular />} disabled={filtered.length === 0} onClick={exportResults}>
              Export matching resources
            </Button>
          </div>
          {filtered.length === 0 ? (
            <Text>No resources report matching operations on this connector.</Text>
          ) : (
            <>
              <div className={styles.scroll} role="region" aria-label="Direct operation results" tabIndex={0}>
                <Table className={styles.table} aria-label="Direct operation usage">
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell className={styles.resourceColumn}>Resource</TableHeaderCell>
                      <TableHeaderCell>Type</TableHeaderCell>
                      <TableHeaderCell>Environment</TableHeaderCell>
                      <TableHeaderCell className={styles.operationsColumn}>Reported operations</TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map(({ resource, operations }) => (
                      <TableRow key={`${resource.kind}|${resource.row.environmentId}|${resource.row.id}`}>
                        <TableCell className={styles.cell}>
                          <Link onClick={() => navigate(
                            `/${resource.kind}/${encodeURIComponent(resource.row.id)}${
                              resource.row.environmentId ? `?envId=${encodeURIComponent(resource.row.environmentId)}` : ""
                            }`,
                          )}>{resource.row.displayName || resource.row.id}</Link>
                        </TableCell>
                        <TableCell className={styles.cell}>
                          {shortResourceType(resource.row.type, resource.kind === "apps" ? resource.row.subType : undefined)}
                        </TableCell>
                        <TableCell className={styles.cell}>
                          {resource.row.environmentName || resource.row.environmentId || "—"}
                        </TableCell>
                        <TableCell className={styles.cell}>
                          <div className={styles.evidence}>
                            {operations.map((operation, index) => (
                              <Badge key={index} appearance="outline" className={styles.badge}>
                                {operationLabel(operation)}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className={styles.pager}>
                <Text>Page {currentPage + 1} of {pageCount} · {start + 1}–
                  {Math.min(start + PAGE_SIZE, filtered.length)} of {filtered.length} resources</Text>
                <div className={styles.chips}>
                  <Button disabled={currentPage === 0} onClick={() => setPageIndex(currentPage - 1)}>
                    Previous results
                  </Button>
                  <Button disabled={currentPage >= pageCount - 1} onClick={() => setPageIndex(currentPage + 1)}>
                    Next results
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}
