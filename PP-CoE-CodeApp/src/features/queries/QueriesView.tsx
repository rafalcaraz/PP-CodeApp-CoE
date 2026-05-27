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
  OptionGroup,
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
  Textarea,
  TabList,
  Tab,
  type InputOnChangeData,
  type TextareaOnChangeData,
} from "@fluentui/react-components";
import {
  AddRegular,
  DeleteRegular,
  PlayRegular,
  CopyRegular,
  ArrowDownloadRegular,
  SaveRegular,
  EditRegular,
} from "@fluentui/react-icons";
import {
  ALL_RESOURCE_TYPES,
  CONNECTOR_FIELD,
  KNOWN_CONNECTORS,
  OPERATION_FIELD,
  QUERY_TEMPLATES,
  ResourceType,
  buildClausesFromSpec,
  friendlyConnectorName,
  friendlyFilterField,
  isSentinelField,
  resourceTypeShort,
  runRawQuery,
  type QueryFilter,
  type QueryFilterOp,
  type QuerySpec,
  type ResourceTypeValue,
} from "../../data/inventory";
import {
  getFieldSuggestions,
  groupFields,
  type FieldPickerIntent,
  type InventoryField,
} from "../../data/inventory.fields";
import type { Clause } from "../../generated/models/PowerPlatformforAdminsV2Model";
import {
  createSavedQuery,
  deleteSavedQuery,
  listSavedQueries,
  updateSavedQuery,
  type SavedQuery,
} from "../../data/savedQueries";
import { LoadingPane } from "../../components/Status";
import { downloadCsv, rowsToCsv } from "../../utils/csv";
import { useConnectorCatalog } from "../../shared/connector-catalog";
import { buildDynamicQueryTemplates } from "./dynamicTemplates";

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
  andDivider: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    paddingLeft: tokens.spacingHorizontalXS,
  },
  andDividerLine: {
    flex: "1 1 auto",
    height: "1px",
    backgroundColor: tokens.colorNeutralStroke2,
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
  savedGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: tokens.spacingHorizontalM,
  },
  savedCard: {
    cursor: "pointer",
    transition: "background-color 120ms ease",
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  savedCardBody: {
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  savedCardHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalS,
  },
  savedActions: {
    display: "flex",
    gap: tokens.spacingHorizontalXXS,
  },
  rawBanner: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
    flexWrap: "wrap",
  },
  rawBannerText: {
    flex: "1 1 auto",
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  pasteTextarea: {
    width: "100%",
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: tokens.fontSizeBase200,
  },
  pasteHelper: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  pasteError: {
    color: tokens.colorPaletteRedForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  dialogField: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
});

const OPERATORS: { value: QueryFilterOp; label: string }[] = [
  { value: "==", label: "equals" },
  { value: "!=", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "!contains", label: "does not contain" },
  { value: "startswith", label: "starts with" },
  { value: "!startswith", label: "does not start with" },
  { value: "endswith", label: "ends with" },
  { value: "!endswith", label: "does not end with" },
  { value: "in~", label: "in (comma-sep)" },
  { value: "has", label: "has token" },
  { value: "has_any", label: "has any token (comma-sep)" },
  { value: ">", label: ">" },
  { value: ">=", label: ">=" },
  { value: "<", label: "<" },
  { value: "<=", label: "<=" },
];

/** Connector ID suggestions used by the value Combobox when the user has
 *  selected the CONNECTOR_FIELD sentinel as the filter field. */
const KNOWN_CONNECTOR_IDS = Object.keys(KNOWN_CONNECTORS).sort();

interface ResultRow {
  name: string;
  type: string;
  displayName: string;
  environmentId: string;
  raw: unknown;
}

/** Renders an `InventoryField[]` as Fluent `<OptionGroup>` sections.
 *  Mirrors the helper in `TileEditorDialog.tsx` so both views surface
 *  the same grouped, type-scoped field options. */
function FieldOptions({ fields }: { fields: InventoryField[] }) {
  const groups = useMemo(() => groupFields(fields), [fields]);
  return (
    <>
      {groups.map((g) => (
        <OptionGroup key={g.label} label={g.label}>
          {g.fields.map((f) => (
            <Option key={f.path} value={f.path} text={f.path}>
              {f.label}
              <span style={{ marginLeft: 8, opacity: 0.6, fontSize: "0.85em" }}>
                {f.path}
              </span>
            </Option>
          ))}
        </OptionGroup>
      ))}
    </>
  );
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

/** Known clause discriminators, mirroring the connector's `Clause$type` enum.
 *  Used by the paste-clauses dialog to give an early, friendly error before
 *  the connector itself would reject the payload. Kept loose on purpose —
 *  we don't validate the inner shape; the connector remains the final arbiter. */
const KNOWN_CLAUSE_TYPES = new Set([
  "where",
  "project",
  "take",
  "orderby",
  "distinct",
  "count",
  "summarize",
  "extend",
  "join",
]);

type ParseResult =
  | { ok: true; clauses: Clause[] }
  | { ok: false; error: string };

/** Parse + sanity-check a pasted clauses payload. Accepts either a bare
 *  `Clause[]` array or an object envelope `{ clauses: Clause[] }` (which is
 *  what the JSON.stringify of our internal shape happens to produce when a
 *  user copies a wrapper). */
function parseClausesPayload(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Paste a JSON array of clauses." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? `Invalid JSON: ${e.message}` : "Invalid JSON.",
    };
  }

  let arr: unknown;
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as Record<string, unknown>).clauses)
  ) {
    arr = (parsed as Record<string, unknown>).clauses;
  } else {
    return {
      ok: false,
      error:
        "Expected an array of clauses, or an object with a `clauses` array property.",
    };
  }

  const items = arr as unknown[];
  if (items.length === 0) {
    return { ok: false, error: "Clauses array is empty." };
  }

  for (let i = 0; i < items.length; i++) {
    const c = items[i];
    if (!c || typeof c !== "object") {
      return { ok: false, error: `Clause #${i + 1} is not an object.` };
    }
    const t = (c as Record<string, unknown>).$type;
    if (typeof t !== "string") {
      return { ok: false, error: `Clause #${i + 1} is missing $type.` };
    }
    if (!KNOWN_CLAUSE_TYPES.has(t)) {
      return {
        ok: false,
        error: `Clause #${i + 1} has unknown $type '${t}'. Known: ${[...KNOWN_CLAUSE_TYPES].join(", ")}.`,
      };
    }
  }

  return { ok: true, clauses: items as Clause[] };
}

type BuilderMode = "basic" | "advanced";

export function QueriesView() {
  const styles = useStyles();
  const { catalog: connectorCatalog } = useConnectorCatalog();
  const [spec, setSpec] = useState<QuerySpec>(DEFAULT_SPEC);
  const [mode, setMode] = useState<BuilderMode>("basic");
  const [advancedText, setAdvancedText] = useState("");
  const [advancedError, setAdvancedError] = useState("");
  const [rawClauses, setRawClauses] = useState<Clause[]>([]);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [skipToken, setSkipToken] = useState<string | undefined>();
  const [phase, setPhase] = useState<"idle" | "running" | "ready" | "error">("idle");
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Saved-queries state.
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(() =>
    listSavedQueries()
  );
  const [lastSavedId, setLastSavedId] = useState<string | undefined>();

  // Save-query dialog.
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDescription, setSaveDescription] = useState("");

  // Rename-saved-query dialog.
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTargetId, setRenameTargetId] = useState<string | undefined>();
  const [renameName, setRenameName] = useState("");
  const [renameDescription, setRenameDescription] = useState("");

  // Delete-saved-query confirm dialog.
  const [deleteTargetId, setDeleteTargetId] = useState<string | undefined>();

  const builderClauses = useMemo(() => buildClausesFromSpec(spec), [spec]);
  const activeClauses = mode === "advanced" ? rawClauses : builderClauses;
  const clausesJson = useMemo(
    () => JSON.stringify(activeClauses, null, 2),
    [activeClauses]
  );

  /** Clear ephemeral results — used by every "I just changed the active query"
   *  code path so stale rows don't linger. */
  const resetResults = useCallback(() => {
    setPhase("idle");
    setRows([]);
    setSkipToken(undefined);
    setTotalRecords(0);
    setErrorMsg("");
  }, []);

  const refreshSaved = useCallback(() => {
    setSavedQueries(listSavedQueries());
  }, []);

  /** Parse + apply the textarea contents in Advanced mode. */
  const setAdvancedFromText = (value: string) => {
    setAdvancedText(value);
    setLastSavedId(undefined);
    if (!value.trim()) {
      setAdvancedError("");
      setRawClauses([]);
      return;
    }
    const parsed = parseClausesPayload(value);
    if (parsed.ok) {
      setRawClauses(parsed.clauses);
      setAdvancedError("");
    } else {
      // Keep rawClauses cleared while the JSON is invalid so the user can't
      // accidentally Run a stale-but-valid prior payload.
      setRawClauses([]);
      setAdvancedError(parsed.error);
    }
  };

  const switchMode = (next: BuilderMode) => {
    if (next === mode) return;
    if (next === "advanced") {
      // First time entering Advanced for this session: seed the textarea with
      // whatever the Basic builder currently produces. That way users see the
      // shape they need to match and can extend it (joins, summarize, etc.).
      // Subsequent toggles preserve the user's edits.
      if (!advancedText.trim()) {
        const seed = JSON.stringify(builderClauses, null, 2);
        setAdvancedText(seed);
        setRawClauses(builderClauses);
        setAdvancedError("");
      }
    }
    setMode(next);
    setLastSavedId(undefined);
    resetResults();
  };

  const applyTemplate = (next: QuerySpec) => {
    setSpec(next);
    setMode("basic");
    setLastSavedId(undefined);
    resetResults();
  };

  const applySaved = (q: SavedQuery) => {
    if (q.source === "builder" && q.spec) {
      setSpec(q.spec);
      setMode("basic");
    } else {
      const text = JSON.stringify(q.clauses, null, 2);
      setAdvancedText(text);
      setRawClauses(q.clauses);
      setAdvancedError("");
      setMode("advanced");
      if (typeof q.pageSize === "number" && q.pageSize > 0) {
        setSpec((prev) => ({ ...prev, limit: q.pageSize as number }));
      }
    }
    setLastSavedId(q.id);
    resetResults();
  };

  const openSaveDialog = () => {
    // Pre-fill from the currently-loaded saved query, if any — makes
    // "rename + re-save" a one-keystroke change.
    const loaded =
      lastSavedId !== undefined
        ? savedQueries.find((q) => q.id === lastSavedId)
        : undefined;
    setSaveName(loaded?.name ?? "");
    setSaveDescription(loaded?.description ?? "");
    setSaveOpen(true);
  };

  const doSave = () => {
    const name = saveName.trim();
    if (!name) return;
    const created = createSavedQuery({
      name,
      description: saveDescription,
      source: mode === "advanced" ? "raw" : "builder",
      spec: mode === "basic" ? spec : undefined,
      clauses: activeClauses,
      pageSize: spec.limit,
    });
    refreshSaved();
    setLastSavedId(created.id);
    setSaveOpen(false);
  };

  const openRenameDialog = (q: SavedQuery) => {
    setRenameTargetId(q.id);
    setRenameName(q.name);
    setRenameDescription(q.description);
    setRenameOpen(true);
  };

  const doRename = () => {
    if (!renameTargetId) return;
    updateSavedQuery(renameTargetId, {
      name: renameName,
      description: renameDescription,
    });
    refreshSaved();
    setRenameOpen(false);
    setRenameTargetId(undefined);
  };

  const doDelete = () => {
    if (!deleteTargetId) return;
    deleteSavedQuery(deleteTargetId);
    refreshSaved();
    if (lastSavedId === deleteTargetId) setLastSavedId(undefined);
    setDeleteTargetId(undefined);
  };

  /** Spec mutator. Wraps setSpec and also clears the "last saved" pill so
   *  the badge stops claiming the in-memory state matches the saved row. */
  const mutateSpec = useCallback(
    (updater: (prev: QuerySpec) => QuerySpec) => {
      setSpec(updater);
      setLastSavedId(undefined);
    },
    []
  );

  const updateSpec = useCallback(
    (patch: Partial<QuerySpec>) =>
      mutateSpec((prev) => ({ ...prev, ...patch })),
    [mutateSpec]
  );

  const updateFilter = (idx: number, patch: Partial<QueryFilter>) => {
    mutateSpec((prev) => {
      const filters = prev.filters.map((f, i) => (i === idx ? { ...f, ...patch } : f));
      return { ...prev, filters };
    });
  };

  const addFilter = () =>
    mutateSpec((prev) => ({
      ...prev,
      filters: [...prev.filters, { field: "", op: "==", value: "" }],
    }));

  const removeFilter = (idx: number) =>
    mutateSpec((prev) => ({
      ...prev,
      filters: prev.filters.filter((_, i) => i !== idx),
    }));

  const run = async () => {
    setPhase("running");
    setRows([]);
    setSkipToken(undefined);
    setTotalRecords(0);
    setErrorMsg("");
    const res = await runRawQuery(activeClauses, { Top: spec.limit || 100 });
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
    const res = await runRawQuery(activeClauses, {
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
      const res = await runRawQuery(activeClauses, {
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

  const suggestionsFor = useMemo(() => {
    const make = (intent: FieldPickerIntent) =>
      getFieldSuggestions(spec.resourceTypes, intent);
    return {
      filter: make("filter"),
      sort: make("sort"),
    };
  }, [spec.resourceTypes]);

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
          header={
            <Text weight="semibold">
              Saved queries{" "}
              <span className={styles.helper}>
                ({savedQueries.length})
              </span>
            </Text>
          }
          description={
            <Text size={200}>
              Stored locally in this browser. Click a card to load it into the
              builder. To share, use <strong>Copy JSON</strong> under Basic, or
              copy the textarea contents under Advanced — recipients paste them
              into the same place.
            </Text>
          }
        />
        <Divider />
        <div className={styles.cardBody}>
          {savedQueries.length === 0 ? (
            <Text className={styles.helper}>
              No saved queries yet. Build (or paste) a query and click{" "}
              <strong>Save query</strong>.
            </Text>
          ) : (
            <div className={styles.savedGrid}>
              {savedQueries.map((q) => (
                <Card
                  key={q.id}
                  className={styles.savedCard}
                  onClick={() => applySaved(q)}
                >
                  <div className={styles.savedCardBody}>
                    <div className={styles.savedCardHead}>
                      <Text className={styles.templateName}>{q.name}</Text>
                      <div
                        className={styles.savedActions}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Badge
                          appearance="outline"
                          color={q.source === "raw" ? "important" : "informative"}
                          size="small"
                        >
                          {q.source === "raw" ? "Advanced" : "Basic"}
                        </Badge>
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<EditRegular />}
                          aria-label="Rename"
                          onClick={() => openRenameDialog(q)}
                        />
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<DeleteRegular />}
                          aria-label="Delete"
                          onClick={() => setDeleteTargetId(q.id)}
                        />
                      </div>
                    </div>
                    {q.description && (
                      <Text className={styles.templateDesc}>{q.description}</Text>
                    )}
                    <Text className={styles.helper}>
                      {q.clauses.length} clause{q.clauses.length === 1 ? "" : "s"}
                      {q.pageSize ? ` · page ${q.pageSize}` : ""}
                    </Text>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </Card>

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
            {[
              // Dynamic, catalog-aware templates first — they reflect the
              // tenant's actual premium-connector list, so they're the
              // most useful "I just want the answer" starting point.
              // Hidden until the catalog loads to avoid empty/disabled UI.
              ...buildDynamicQueryTemplates(connectorCatalog),
              ...QUERY_TEMPLATES,
            ].map((tpl) => (
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
        <CardHeader
          header={
            <Text weight="semibold">
              Builder{" "}
              {lastSavedId &&
                savedQueries.find((q) => q.id === lastSavedId) && (
                  <Badge
                    appearance="outline"
                    color="success"
                    size="small"
                    style={{ marginLeft: 8 }}
                  >
                    Saved as "
                    {savedQueries.find((q) => q.id === lastSavedId)?.name}"
                  </Badge>
                )}
            </Text>
          }
        />
        <Divider />
        <div className={styles.cardBody}>
          <TabList
            selectedValue={mode}
            onTabSelect={(_e, data) => switchMode(data.value as BuilderMode)}
          >
            <Tab value="basic">Basic</Tab>
            <Tab value="advanced">Advanced</Tab>
          </TabList>

          {mode === "basic" && (
            <>
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
                      <div key={idx} style={{ display: "contents" }}>
                        {idx > 0 && (
                          <div
                            className={styles.andDivider}
                            aria-label="and"
                            title="Filters are combined with AND"
                          >
                            <div className={styles.andDividerLine} />
                            <Badge appearance="outline" size="small">
                              AND
                            </Badge>
                            <div className={styles.andDividerLine} />
                          </div>
                        )}
                        <div className={styles.fieldRow}>
                        <Combobox
                          placeholder="Field path (e.g. properties.displayName)"
                          value={friendlyFilterField(f.field)}
                          freeform
                          onChange={(e) =>
                            updateFilter(idx, { field: (e.target as HTMLInputElement).value })
                          }
                          onOptionSelect={(_e, data) =>
                            updateFilter(idx, { field: data.optionValue ?? "" })
                          }
                        >
                          <FieldOptions fields={suggestionsFor.filter} />
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
                        {f.field === CONNECTOR_FIELD ? (
                          <Combobox
                            placeholder="e.g. shared_office365"
                            value={f.value}
                            freeform
                            onChange={(e) =>
                              updateFilter(idx, {
                                value: (e.target as HTMLInputElement).value,
                              })
                            }
                            onOptionSelect={(_e, data) =>
                              updateFilter(idx, { value: data.optionValue ?? "" })
                            }
                          >
                            {KNOWN_CONNECTOR_IDS.map((id) => (
                              <Option
                                key={id}
                                value={id}
                                text={`${id} — ${friendlyConnectorName(id)}`}
                              >
                                {`${id} — ${friendlyConnectorName(id)}`}
                              </Option>
                            ))}
                          </Combobox>
                        ) : (
                          <Input
                            placeholder={
                              f.field === OPERATION_FIELD
                                ? "e.g. SearchUserV2"
                                : f.op === "in~" || f.op === "has_any"
                                ? "value1, value2, value3"
                                : "Value"
                            }
                            value={f.value}
                            onChange={(_e, data: InputOnChangeData) =>
                              updateFilter(idx, { value: data.value })
                            }
                          />
                        )}
                        <Button
                          icon={<DeleteRegular />}
                          appearance="subtle"
                          aria-label="Remove filter"
                          onClick={() => removeFilter(idx)}
                        />
                        </div>
                      </div>
                    ))}
                    <Text className={styles.helper}>
                      Tip: <code>true</code>/<code>false</code> and numbers are sent unquoted;
                      everything else is quoted as a string.
                    </Text>
                    {spec.filters.length > 1 && (
                      <Text className={styles.helper}>
                        Rows are combined with <strong>AND</strong> — all must match.
                        For <strong>OR</strong> within a single field use{" "}
                        <code>in (comma-sep)</code> (or <code>has any token</code> for
                        connector / operation). Cross-field <code>OR</code> isn't
                        supported in Basic; use the Advanced tab.
                      </Text>
                    )}
                    {spec.filters.some((f) => isSentinelField(f.field)) && (
                      <Text className={styles.helper}>
                        <strong>Connector / Operation</strong> fields scan across
                        canvas, flow, agent, and app-builder schemas in one tokenised{" "}
                        <code>has</code> — so <code>==</code> finds{" "}
                        <code>shared_office365</code> without also matching{" "}
                        <code>shared_office365users</code>.
                      </Text>
                    )}
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
                  <FieldOptions fields={suggestionsFor.sort} />
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
            </>
          )}

          {mode === "advanced" && (
            <div className={styles.dialogField}>
              <Text className={styles.pasteHelper}>
                Paste or write a JSON array of connector clauses. This is the
                exact payload sent to <code>QueryResources</code> — supports
                <code> where</code>, <code>extend</code>, <code>project</code>,
                <code> summarize</code>, <code>orderby</code>, <code>join</code>,
                etc.
              </Text>
              <Textarea
                className={styles.pasteTextarea}
                rows={16}
                resize="vertical"
                placeholder='[{"$type":"where","FieldName":"type","Operator":"==","Values":["\u0027microsoft.powerapps/canvasapps\u0027"]}]'
                value={advancedText}
                onChange={(_e, data: TextareaOnChangeData) =>
                  setAdvancedFromText(data.value)
                }
              />
              {advancedError ? (
                <Text className={styles.pasteError}>{advancedError}</Text>
              ) : (
                <Text className={styles.helper}>
                  {rawClauses.length > 0
                    ? `Parsed ${rawClauses.length} clause${rawClauses.length === 1 ? "" : "s"}.`
                    : "Empty — paste some clauses to enable Run."}
                </Text>
              )}
            </div>
          )}

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
              disabled={
                phase === "running" ||
                activeClauses.length === 0 ||
                (mode === "advanced" && advancedError !== "")
              }
            >
              {phase === "running" ? "Running…" : "Run query"}
            </Button>
            <Button
              icon={<SaveRegular />}
              onClick={openSaveDialog}
              disabled={
                activeClauses.length === 0 ||
                (mode === "advanced" && advancedError !== "")
              }
            >
              Save query
            </Button>
            {phase === "ready" && (
              <Text className={styles.count}>
                {rows.length.toLocaleString()} of {totalRecords.toLocaleString()} loaded
              </Text>
            )}
          </div>

          {mode === "basic" && (
            <Accordion collapsible>
              <AccordionItem value="adv">
                <AccordionHeader>
                  <Text weight="semibold">Generated clauses (read-only)</Text>
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
          )}
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

      <Dialog
        open={saveOpen}
        onOpenChange={(_e, data) => !data.open && setSaveOpen(false)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Save query</DialogTitle>
            <DialogContent>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className={styles.dialogField}>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                    Name
                  </Text>
                  <Input
                    value={saveName}
                    onChange={(_e, data: InputOnChangeData) => setSaveName(data.value)}
                    placeholder="e.g. Risky tenant-wide agents"
                  />
                </div>
                <div className={styles.dialogField}>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                    Description (optional)
                  </Text>
                  <Textarea
                    rows={3}
                    resize="vertical"
                    value={saveDescription}
                    onChange={(_e, data: TextareaOnChangeData) =>
                      setSaveDescription(data.value)
                    }
                    placeholder="What this query is for, who should run it, etc."
                  />
                </div>
                <Text className={styles.helper}>
                  Saves to this browser's local storage. To share, click{" "}
                  <strong>Copy JSON</strong> under Advanced and send the result.
                </Text>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setSaveOpen(false)}>
                Cancel
              </Button>
              <Button
                appearance="primary"
                onClick={doSave}
                disabled={!saveName.trim() || activeClauses.length === 0}
              >
                Save
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={renameOpen}
        onOpenChange={(_e, data) => !data.open && setRenameOpen(false)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Edit saved query</DialogTitle>
            <DialogContent>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className={styles.dialogField}>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                    Name
                  </Text>
                  <Input
                    value={renameName}
                    onChange={(_e, data: InputOnChangeData) => setRenameName(data.value)}
                  />
                </div>
                <div className={styles.dialogField}>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                    Description
                  </Text>
                  <Textarea
                    rows={3}
                    resize="vertical"
                    value={renameDescription}
                    onChange={(_e, data: TextareaOnChangeData) =>
                      setRenameDescription(data.value)
                    }
                  />
                </div>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setRenameOpen(false)}>
                Cancel
              </Button>
              <Button
                appearance="primary"
                onClick={doRename}
                disabled={!renameName.trim()}
              >
                Save
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={deleteTargetId !== undefined}
        onOpenChange={(_e, data) => !data.open && setDeleteTargetId(undefined)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Delete saved query?</DialogTitle>
            <DialogContent>
              <Text>
                "
                {savedQueries.find((q) => q.id === deleteTargetId)?.name ??
                  "This query"}
                " will be removed from this browser. This cannot be undone.
              </Text>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                onClick={() => setDeleteTargetId(undefined)}
              >
                Cancel
              </Button>
              <Button appearance="primary" onClick={doDelete}>
                Delete
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
