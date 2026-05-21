import { useCallback, useMemo, useState } from "react";
import {
  makeStyles,
  tokens,
  Text,
  Card,
  CardHeader,
  Divider,
  Badge,
  Button,
  Dropdown,
  Option,
  Input,
  Combobox,
  Spinner,
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  type InputOnChangeData,
} from "@fluentui/react-components";
import {
  AddRegular,
  DeleteRegular,
  PlayRegular,
  CopyRegular,
  ArrowDownloadRegular,
} from "@fluentui/react-icons";
import {
  ALL_RESOURCE_TYPES,
  COMMON_FIELD_SUGGESTIONS,
  QUERY_TEMPLATES,
  ResourceType,
  buildClausesFromSpec,
  resourceTypeShort,
  runRawQuery,
  type QueryFilter,
  type QueryFilterOp,
  type QuerySpec,
  type ResourceTypeValue,
} from "../data/inventory";
import { LoadingPane } from "../components/Status";
import { downloadCsv, rowsToCsv } from "../utils/csv";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  subtitle: {
    color: tokens.colorNeutralForeground3,
  },
  cardBody: {
    padding: tokens.spacingHorizontalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  templates: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalM,
  },
  templateCard: {
    minWidth: "260px",
    maxWidth: "320px",
    cursor: "pointer",
    transition: "background-color 120ms ease",
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  templateBody: {
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  templateName: {
    fontWeight: tokens.fontWeightSemibold,
  },
  templateDesc: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  fieldRow: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 2fr) 150px minmax(220px, 2fr) auto",
    gap: tokens.spacingHorizontalS,
    alignItems: "center",
  },
  inlineRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalM,
    alignItems: "center",
  },
  label: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  runRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
  },
  count: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  resultRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 2fr) auto",
    gap: tokens.spacingHorizontalM,
    alignItems: "center",
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  resultHeader: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 2fr) auto",
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    fontWeight: tokens.fontWeightSemibold,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  ellipsis: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  json: {
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground2,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusMedium,
    overflow: "auto",
    maxHeight: "480px",
    whiteSpace: "pre",
  },
  err: {
    color: tokens.colorPaletteRedForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  helper: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    justifyContent: "center",
    paddingBlock: tokens.spacingVerticalM,
  },
});

const OPERATORS: { value: QueryFilterOp; label: string }[] = [
  { value: "==", label: "equals" },
  { value: "!=", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "startswith", label: "starts with" },
  { value: "endswith", label: "ends with" },
  { value: "in~", label: "in (comma-sep)" },
  { value: ">", label: ">" },
  { value: ">=", label: ">=" },
  { value: "<", label: "<" },
  { value: "<=", label: "<=" },
];

const ORDER_FIELD_SUGGESTIONS = [
  "properties.lastModifiedAt",
  "properties.createdAt",
  "properties.displayName",
  "properties.lastPublishedAt",
  "properties.environmentId",
  "name",
  "location",
];

interface ResultRow {
  name: string;
  type: string;
  displayName: string;
  environmentId: string;
  raw: unknown;
}

function toResultRow(item: Record<string, unknown>): ResultRow {
  const props = (item.properties ?? {}) as Record<string, unknown>;
  return {
    name: (item.name as string) ?? "",
    type: (item.type as string) ?? "",
    displayName: (props.displayName as string) ?? "",
    environmentId: (props.environmentId as string) ?? "",
    raw: item,
  };
}

const DEFAULT_SPEC: QuerySpec = {
  resourceTypes: [ResourceType.CanvasApp],
  filters: [],
  orderField: "properties.lastModifiedAt",
  orderDirection: "desc",
  limit: 50,
};

export function QueriesView() {
  const styles = useStyles();
  const [spec, setSpec] = useState<QuerySpec>(DEFAULT_SPEC);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [skipToken, setSkipToken] = useState<string | undefined>();
  const [phase, setPhase] = useState<"idle" | "running" | "ready" | "error">("idle");
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const clauses = useMemo(() => buildClausesFromSpec(spec), [spec]);
  const clausesJson = useMemo(() => JSON.stringify(clauses, null, 2), [clauses]);

  const applyTemplate = (next: QuerySpec) => {
    setSpec(next);
    setPhase("idle");
    setRows([]);
    setSkipToken(undefined);
    setTotalRecords(0);
    setErrorMsg("");
  };

  const updateSpec = useCallback(
    (patch: Partial<QuerySpec>) => setSpec((prev) => ({ ...prev, ...patch })),
    []
  );

  const updateFilter = (idx: number, patch: Partial<QueryFilter>) => {
    setSpec((prev) => {
      const filters = prev.filters.map((f, i) => (i === idx ? { ...f, ...patch } : f));
      return { ...prev, filters };
    });
  };

  const addFilter = () =>
    setSpec((prev) => ({
      ...prev,
      filters: [...prev.filters, { field: "", op: "==", value: "" }],
    }));

  const removeFilter = (idx: number) =>
    setSpec((prev) => ({
      ...prev,
      filters: prev.filters.filter((_, i) => i !== idx),
    }));

  const run = async () => {
    setPhase("running");
    setRows([]);
    setSkipToken(undefined);
    setTotalRecords(0);
    setErrorMsg("");
    const res = await runRawQuery(clauses, { Top: spec.limit || 100 });
    if (!res.ok) {
      setErrorMsg(res.error);
      setPhase("error");
      return;
    }
    setRows(res.data.items.map((it) => toResultRow(it as Record<string, unknown>)));
    setSkipToken(res.data.skipToken);
    setTotalRecords(res.data.totalRecords);
    setPhase("ready");
  };

  const loadMore = async () => {
    if (!skipToken || loadingMore) return;
    setLoadingMore(true);
    const res = await runRawQuery(clauses, {
      Top: spec.limit || 100,
      SkipToken: skipToken,
    });
    setLoadingMore(false);
    if (!res.ok) {
      setErrorMsg(res.error);
      return;
    }
    setRows((prev) =>
      prev.concat(res.data.items.map((it) => toResultRow(it as Record<string, unknown>)))
    );
    setSkipToken(res.data.skipToken);
    if (res.data.totalRecords) setTotalRecords(res.data.totalRecords);
  };

  const copyClauses = async () => {
    try {
      await navigator.clipboard.writeText(clausesJson);
    } catch {
      /* clipboard may be blocked — silent */
    }
  };

  const exportLoaded = () => {
    if (rows.length === 0) return;
    const csv = rowsToCsv(rows.map((r) => r.raw));
    downloadCsv("inventory-query", csv);
  };

  const [exportingAll, setExportingAll] = useState(false);
  const exportAll = async () => {
    if (rows.length === 0) return;
    setExportingAll(true);
    // Start with what we already have; keep paginating until exhausted.
    const all: unknown[] = rows.map((r) => r.raw);
    let token: string | undefined = skipToken;
    let safety = 200; // hard cap to avoid runaway loops
    while (token && safety-- > 0) {
      const res = await runRawQuery(clauses, {
        Top: spec.limit || 100,
        SkipToken: token,
      });
      if (!res.ok) {
        setErrorMsg(res.error);
        break;
      }
      for (const it of res.data.items) all.push(it);
      token = res.data.skipToken;
    }
    setExportingAll(false);
    const csv = rowsToCsv(all);
    downloadCsv("inventory-query-all", csv);
  };

  const typeText =
    spec.resourceTypes.length === 0
      ? "All resource types"
      : spec.resourceTypes.map(resourceTypeShort).join(", ");

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text size={600} weight="semibold">
          Queries
        </Text>
        <Text className={styles.subtitle}>
          Build a custom inventory query. Start from a template or assemble
          your own filters — the connector clauses are generated for you.
        </Text>
      </div>

      <Card>
        <CardHeader
          header={<Text weight="semibold">Templates</Text>}
          description={
            <Text size={200}>Click any template to load it into the builder.</Text>
          }
        />
        <Divider />
        <div className={styles.cardBody}>
          <div className={styles.templates}>
            {QUERY_TEMPLATES.map((tpl) => (
              <Card
                key={tpl.id}
                className={styles.templateCard}
                onClick={() => applyTemplate(tpl.spec)}
              >
                <div className={styles.templateBody}>
                  <Text className={styles.templateName}>{tpl.name}</Text>
                  <Text className={styles.templateDesc}>{tpl.description}</Text>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader header={<Text weight="semibold">Builder</Text>} />
        <Divider />
        <div className={styles.cardBody}>
          <div className={styles.inlineRow}>
            <Text className={styles.label} style={{ minWidth: 120 }}>
              Resource types
            </Text>
            <Dropdown
              style={{ minWidth: 360 }}
              multiselect
              placeholder="All resource types"
              value={typeText}
              selectedOptions={spec.resourceTypes}
              onOptionSelect={(_e, data) =>
                updateSpec({ resourceTypes: data.selectedOptions as ResourceTypeValue[] })
              }
            >
              {ALL_RESOURCE_TYPES.map((t) => (
                <Option key={t} value={t} text={resourceTypeShort(t)}>
                  {resourceTypeShort(t)}
                  <span className={styles.helper}> · {t}</span>
                </Option>
              ))}
            </Dropdown>
          </div>

          <div>
            <div className={styles.inlineRow} style={{ marginBottom: 8 }}>
              <Text className={styles.label} style={{ minWidth: 120 }}>
                Filters
              </Text>
              <Button
                icon={<AddRegular />}
                appearance="subtle"
                onClick={addFilter}
                size="small"
              >
                Add filter
              </Button>
            </div>
            {spec.filters.length === 0 ? (
              <Text className={styles.helper}>No filters. Click "Add filter" to add one.</Text>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {spec.filters.map((f, idx) => (
                  <div key={idx} className={styles.fieldRow}>
                    <Combobox
                      placeholder="Field path (e.g. properties.displayName)"
                      value={f.field}
                      freeform
                      onChange={(e) =>
                        updateFilter(idx, { field: (e.target as HTMLInputElement).value })
                      }
                      onOptionSelect={(_e, data) =>
                        updateFilter(idx, { field: data.optionValue ?? "" })
                      }
                    >
                      {COMMON_FIELD_SUGGESTIONS.map((s) => (
                        <Option key={s} value={s} text={s}>
                          {s}
                        </Option>
                      ))}
                    </Combobox>
                    <Dropdown
                      value={OPERATORS.find((o) => o.value === f.op)?.label ?? f.op}
                      selectedOptions={[f.op]}
                      onOptionSelect={(_e, data) =>
                        updateFilter(idx, { op: (data.optionValue as QueryFilterOp) ?? "==" })
                      }
                    >
                      {OPERATORS.map((o) => (
                        <Option key={o.value} value={o.value} text={o.label}>
                          {o.label}
                        </Option>
                      ))}
                    </Dropdown>
                    <Input
                      placeholder={
                        f.op === "in~" ? "value1, value2, value3" : "Value"
                      }
                      value={f.value}
                      onChange={(_e, data: InputOnChangeData) =>
                        updateFilter(idx, { value: data.value })
                      }
                    />
                    <Button
                      icon={<DeleteRegular />}
                      appearance="subtle"
                      aria-label="Remove filter"
                      onClick={() => removeFilter(idx)}
                    />
                  </div>
                ))}
                <Text className={styles.helper}>
                  Tip: <code>true</code>/<code>false</code> and numbers are sent unquoted;
                  everything else is quoted as a string.
                </Text>
              </div>
            )}
          </div>

          <div className={styles.inlineRow}>
            <Text className={styles.label} style={{ minWidth: 120 }}>
              Sort by
            </Text>
            <Combobox
              style={{ minWidth: 320 }}
              placeholder="Field"
              value={spec.orderField}
              freeform
              onChange={(e) =>
                updateSpec({ orderField: (e.target as HTMLInputElement).value })
              }
              onOptionSelect={(_e, data) =>
                updateSpec({ orderField: data.optionValue ?? "" })
              }
            >
              {ORDER_FIELD_SUGGESTIONS.map((s) => (
                <Option key={s} value={s} text={s}>
                  {s}
                </Option>
              ))}
            </Combobox>
            <Dropdown
              style={{ minWidth: 120 }}
              value={spec.orderDirection === "asc" ? "Ascending" : "Descending"}
              selectedOptions={[spec.orderDirection]}
              onOptionSelect={(_e, data) =>
                updateSpec({
                  orderDirection: (data.optionValue as "asc" | "desc") ?? "desc",
                })
              }
            >
              <Option value="asc" text="Ascending">Ascending</Option>
              <Option value="desc" text="Descending">Descending</Option>
            </Dropdown>
          </div>

          <div className={styles.inlineRow}>
            <Text className={styles.label} style={{ minWidth: 120 }}>
              Page size
            </Text>
            <Input
              type="number"
              style={{ width: 120 }}
              value={String(spec.limit)}
              onChange={(_e, data) =>
                updateSpec({ limit: Math.max(1, Math.min(500, Number(data.value) || 0)) })
              }
            />
            <Text className={styles.helper}>
              1–500 rows per request. The full tenant-wide count is shown in the results
              header; use <strong>Load more</strong> to walk additional pages.
            </Text>
          </div>

          <Divider />

          <div className={styles.runRow}>
            <Button
              appearance="primary"
              icon={<PlayRegular />}
              onClick={run}
              disabled={phase === "running"}
            >
              {phase === "running" ? "Running…" : "Run query"}
            </Button>
            {phase === "ready" && (
              <Text className={styles.count}>
                {rows.length.toLocaleString()} of {totalRecords.toLocaleString()} loaded
              </Text>
            )}
          </div>

          <Accordion collapsible>
            <AccordionItem value="adv">
              <AccordionHeader>
                <Text weight="semibold">Advanced — generated clauses</Text>
              </AccordionHeader>
              <AccordionPanel>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div>
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<CopyRegular />}
                      onClick={copyClauses}
                    >
                      Copy JSON
                    </Button>
                  </div>
                  <pre className={styles.json}>{clausesJson}</pre>
                </div>
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        </div>
      </Card>

      {phase === "running" && <LoadingPane label="Running query…" />}

      {phase === "error" && (
        <Card>
          <CardHeader header={<Text weight="semibold">Query failed</Text>} />
          <Divider />
          <div className={styles.cardBody}>
            <Text className={styles.err}>{errorMsg}</Text>
          </div>
        </Card>
      )}

      {phase === "ready" && (
        <Card>
          <CardHeader
            header={<Text weight="semibold">Results</Text>}
            description={
              <Text size={200}>
                {rows.length === 0
                  ? "No matching items."
                  : `${rows.length.toLocaleString()} loaded of ${totalRecords.toLocaleString()} total`}
              </Text>
            }
            action={
              rows.length > 0 ? (
                <div style={{ display: "flex", gap: tokens.spacingHorizontalS }}>
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={<ArrowDownloadRegular />}
                    onClick={exportLoaded}
                    disabled={exportingAll}
                  >
                    Export loaded ({rows.length.toLocaleString()})
                  </Button>
                  {skipToken && (
                    <Button
                      size="small"
                      appearance="primary"
                      icon={<ArrowDownloadRegular />}
                      onClick={exportAll}
                      disabled={exportingAll}
                    >
                      {exportingAll
                        ? "Fetching all…"
                        : `Export all (${totalRecords.toLocaleString()})`}
                    </Button>
                  )}
                </div>
              ) : undefined
            }
          />
          <Divider />
          {rows.length > 0 && (
            <div>
              <div className={styles.resultHeader}>
                <span>Display name</span>
                <span>Type</span>
                <span>Environment ID</span>
                <span></span>
              </div>
              {rows.map((row) => (
                <div key={`${row.type}|${row.name}`} className={styles.resultRow}>
                  <span className={styles.ellipsis}>{row.displayName || row.name || "—"}</span>
                  <span className={styles.ellipsis}>
                    <Badge appearance="outline" color="informative" size="small">
                      {row.type}
                    </Badge>
                  </span>
                  <span className={styles.ellipsis}>{row.environmentId || "—"}</span>
                  <Dialog>
                    <DialogTrigger disableButtonEnhancement>
                      <Button size="small" appearance="subtle">
                        View raw
                      </Button>
                    </DialogTrigger>
                    <DialogSurface>
                      <DialogBody>
                        <DialogTitle>{row.displayName || row.name || "Raw item"}</DialogTitle>
                        <DialogContent>
                          <pre className={styles.json}>
                            {JSON.stringify(row.raw, null, 2)}
                          </pre>
                        </DialogContent>
                        <DialogActions>
                          <DialogTrigger disableButtonEnhancement>
                            <Button appearance="secondary">Close</Button>
                          </DialogTrigger>
                        </DialogActions>
                      </DialogBody>
                    </DialogSurface>
                  </Dialog>
                </div>
              ))}
            </div>
          )}
          {skipToken && (
            <div className={styles.footer}>
              {loadingMore ? (
                <>
                  <Spinner size="tiny" />
                  <Text className={styles.helper}>Loading more…</Text>
                </>
              ) : (
                <Button appearance="primary" onClick={loadMore}>
                  Load more
                </Button>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
