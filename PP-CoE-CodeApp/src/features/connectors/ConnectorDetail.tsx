import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Breadcrumb,
  BreadcrumbButton,
  BreadcrumbDivider,
  BreadcrumbItem,
  Button,
  Card,
  CardHeader,
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridRow,
  Divider,
  Link,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  Tab,
  TabList,
  Text,
  createTableColumn,
  makeStyles,
  tokens,
  type SelectTabData,
  type SelectTabEvent,
  type TableColumnDefinition,
} from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  ChevronLeftRegular,
  ChevronRightRegular,
} from "@fluentui/react-icons";
import { useNavigate, useParams } from "react-router-dom";
import { ErrorPane, LoadingPane } from "../../components/Status";
import { Meta, useDetailStyles } from "../../components/detail";
import { downloadCsv, rowsToCsv } from "../../utils/csv";
import {
  exportConnectorUsage,
  getConnectorDetail,
  listConnectorUsagePage,
  loadConnectorUsageSummary,
  shortResourceType,
  type ConnectorDetailData,
  type ConnectorUsageKind,
  type ConnectorUsagePage,
  type ConnectorUsageRecord,
  type ConnectorUsageSummary,
} from "./data";

const PAGE_SIZE = 15;

const usePageStyles = makeStyles({
  overview: {
    maxWidth: "75ch",
    color: tokens.colorNeutralForeground2,
  },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    gap: tokens.spacingHorizontalL,
    padding: tokens.spacingHorizontalL,
    "@media (max-width: 900px)": {
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    },
    "@media (max-width: 600px)": {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    },
  },
  stat: {
    display: "flex",
    minWidth: 0,
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  statValue: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero700,
  },
  statLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  operations: {
    maxHeight: "420px",
    overflow: "auto",
  },
  usageHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
  },
  usageActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
  },
  usageBody: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL} ${tokens.spacingVerticalL}`,
  },
  pager: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalM,
  },
  pagerButtons: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
  },
  muted: {
    color: tokens.colorNeutralForeground3,
  },
  mono: {
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: tokens.fontSizeBase200,
  },
  cellText: {
    display: "block",
    maxWidth: "320px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

type DetailState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "missing" }
  | { kind: "ready"; data: ConnectorDetailData };

type SummaryState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ConnectorUsageSummary };

interface CachedPage extends ConnectorUsagePage {
  offset: number;
}

interface UsageTabState {
  status: "idle" | "loading" | "ready" | "error";
  pages: CachedPage[];
  pageIndex: number;
  error: string;
}

const emptyTab = (): UsageTabState => ({
  status: "idle",
  pages: [],
  pageIndex: 0,
  error: "",
});

const emptyTabs = (): Record<ConnectorUsageKind, UsageTabState> => ({
  apps: emptyTab(),
  flows: emptyTab(),
  agents: emptyTab(),
});

function tierBadgeColor(
  tier: string,
): "warning" | "informative" | "subtle" {
  const normalized = tier.toLowerCase();
  if (normalized === "premium") return "warning";
  if (normalized === "standard") return "informative";
  return "subtle";
}

function resourcePath(record: ConnectorUsageRecord): string {
  const base =
    record.kind === "apps"
      ? "/apps"
      : record.kind === "flows"
        ? "/flows"
        : "/agents";
  const environment = record.row.environmentId
    ? `?envId=${encodeURIComponent(record.row.environmentId)}`
    : "";
  return `${base}/${encodeURIComponent(record.row.id)}${environment}`;
}

function lastActivity(record: ConnectorUsageRecord): string {
  if (record.kind === "agents") return record.row.lastPublishedAt;
  return record.row.lastModifiedAt;
}

function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function usageToCsvRow(
  record: ConnectorUsageRecord,
): Record<string, string> {
  return {
    Category:
      record.kind === "apps"
        ? "App"
        : record.kind === "flows"
          ? "Flow"
          : "Agent",
    Name: record.row.displayName || record.row.id,
    "Resource type": shortResourceType(record.row.type),
    Environment: record.row.environmentName,
    "Environment ID": record.row.environmentId,
    Owner: record.row.ownerDisplayName || record.row.ownerId,
    "Last activity": lastActivity(record),
    "Resource ID": record.row.id,
  };
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: number | undefined;
}) {
  const styles = usePageStyles();
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>
        {value === undefined ? "—" : value.toLocaleString()}
      </span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

export function ConnectorDetail() {
  const detailStyles = useDetailStyles();
  const page = usePageStyles();
  const navigate = useNavigate();
  const { connectorId } = useParams<{ connectorId: string }>();
  const [detail, setDetail] = useState<DetailState>({ kind: "loading" });
  const [summary, setSummary] = useState<SummaryState>({ kind: "loading" });
  const [activeTab, setActiveTab] = useState<ConnectorUsageKind>("apps");
  const [tabs, setTabs] = useState(emptyTabs);
  const [exporting, setExporting] = useState<"active" | "all" | null>(null);
  const [exportError, setExportError] = useState("");
  const connectorIdRef = useRef(connectorId);

  useEffect(() => {
    connectorIdRef.current = connectorId;
  }, [connectorId]);

  useEffect(() => {
    if (!connectorId) return;
    let cancelled = false;

    void (async () => {
      setDetail({ kind: "loading" });
      setSummary({ kind: "loading" });
      setTabs(emptyTabs());
      const detailResult = await getConnectorDetail(connectorId);
      if (cancelled) return;
      if (!detailResult.ok) {
        setDetail({ kind: "error", message: detailResult.error });
        return;
      }
      if (!detailResult.data) {
        setDetail({ kind: "missing" });
        return;
      }
      setDetail({ kind: "ready", data: detailResult.data });

      const summaryResult = await loadConnectorUsageSummary(connectorId);
      if (cancelled) return;
      setSummary(
        summaryResult.ok
          ? { kind: "ready", data: summaryResult.data }
          : { kind: "error", message: summaryResult.error },
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [connectorId]);

  useEffect(() => {
    if (
      !connectorId ||
      detail.kind !== "ready" ||
      tabs[activeTab].status !== "idle"
    ) {
      return;
    }
    void (async () => {
      setTabs((current) => ({
        ...current,
        [activeTab]: {
          ...current[activeTab],
          status: "loading",
          error: "",
        },
      }));
      const result = await listConnectorUsagePage(
        activeTab,
        connectorId,
        undefined,
        PAGE_SIZE,
        0,
      );
      if (connectorIdRef.current !== connectorId) return;
      setTabs((current) => ({
        ...current,
        [activeTab]: result.ok
          ? {
              status: "ready",
              pages: [{ ...result.data, offset: 0 }],
              pageIndex: 0,
              error: "",
            }
          : {
              ...current[activeTab],
              status: "error",
              error: result.error,
            },
      }));
    })();
  }, [activeTab, connectorId, detail.kind, tabs]);

  const onTabSelect = useCallback(
    (_event: SelectTabEvent, data: SelectTabData) => {
      setActiveTab(data.value as ConnectorUsageKind);
      setExportError("");
    },
    [],
  );

  const goPrevious = useCallback(() => {
    setTabs((current) => {
      const tab = current[activeTab];
      return {
        ...current,
        [activeTab]: {
          ...tab,
          pageIndex: Math.max(0, tab.pageIndex - 1),
        },
      };
    });
  }, [activeTab]);

  const retryActiveTab = useCallback(() => {
    setTabs((current) => ({
      ...current,
      [activeTab]: emptyTab(),
    }));
  }, [activeTab]);

  const goNext = useCallback(async () => {
    if (!connectorId) return;
    const tab = tabs[activeTab];
    const currentPage = tab.pages[tab.pageIndex];
    if (!currentPage?.nextSkipToken) return;

    if (tab.pages[tab.pageIndex + 1]) {
      setTabs((current) => ({
        ...current,
        [activeTab]: {
          ...current[activeTab],
          pageIndex: current[activeTab].pageIndex + 1,
        },
      }));
      return;
    }

    setTabs((current) => ({
      ...current,
      [activeTab]: { ...current[activeTab], status: "loading", error: "" },
    }));
    const nextOffset = currentPage.offset + currentPage.records.length;
    const result = await listConnectorUsagePage(
      activeTab,
      connectorId,
      currentPage.nextSkipToken,
      PAGE_SIZE,
      nextOffset,
    );
    if (connectorIdRef.current !== connectorId) return;
    setTabs((current) => {
      const latest = current[activeTab];
      if (!result.ok) {
        return {
          ...current,
          [activeTab]: {
            ...latest,
            status: "error",
            error: result.error,
          },
        };
      }
      if (
        result.data.records.length === 0 ||
        result.data.pagingWarning
      ) {
        const pages = [...latest.pages];
        pages[latest.pageIndex] = {
          ...pages[latest.pageIndex],
          nextSkipToken: undefined,
          pagingWarning: result.data.pagingWarning,
        };
        return {
          ...current,
          [activeTab]: { ...latest, status: "ready", pages },
        };
      }
      return {
        ...current,
        [activeTab]: {
          status: "ready",
          pages: [
            ...latest.pages.slice(0, latest.pageIndex + 1),
            { ...result.data, offset: nextOffset },
          ],
          pageIndex: latest.pageIndex + 1,
          error: "",
        },
      };
    });
  }, [activeTab, connectorId, tabs]);

  const exportUsage = useCallback(
    async (scope: ConnectorUsageKind | "all") => {
      if (!connectorId || detail.kind !== "ready") return;
      setExporting(scope === "all" ? "all" : "active");
      setExportError("");
      try {
        const result = await exportConnectorUsage(scope, connectorId);
        if (!result.ok) {
          setExportError(result.error);
          return;
        }
        const slug = detail.data.entry.connectorId.replace(
          /[^a-z0-9_-]+/gi,
          "-",
        );
        const suffix = scope === "all" ? "all-usage" : `${scope}-usage`;
        downloadCsv(
          `connector-${slug}-${suffix}`,
          rowsToCsv(result.data.map(usageToCsvRow)),
        );
      } finally {
        setExporting(null);
      }
    },
    [connectorId, detail],
  );

  const columns = useMemo<TableColumnDefinition<ConnectorUsageRecord>[]>(
    () => [
      createTableColumn<ConnectorUsageRecord>({
        columnId: "name",
        renderHeaderCell: () => "Name",
        renderCell: (record) => (
          <Link onClick={() => navigate(resourcePath(record))}>
            {record.row.displayName || record.row.id}
          </Link>
        ),
      }),
      createTableColumn<ConnectorUsageRecord>({
        columnId: "type",
        renderHeaderCell: () => "Type",
        renderCell: (record) => shortResourceType(record.row.type),
      }),
      createTableColumn<ConnectorUsageRecord>({
        columnId: "environment",
        renderHeaderCell: () => "Environment",
        renderCell: (record) =>
          record.row.environmentId ? (
            <Link
              onClick={() =>
                navigate(
                  `/environments/${encodeURIComponent(record.row.environmentId)}`,
                )
              }
            >
              {record.row.environmentName || record.row.environmentId}
            </Link>
          ) : (
            "—"
          ),
      }),
      createTableColumn<ConnectorUsageRecord>({
        columnId: "owner",
        renderHeaderCell: () => "Owner",
        renderCell: (record) => (
          <span
            className={page.cellText}
            title={record.row.ownerDisplayName || record.row.ownerId}
          >
            {record.row.ownerDisplayName || record.row.ownerId || "—"}
          </span>
        ),
      }),
      createTableColumn<ConnectorUsageRecord>({
        columnId: "activity",
        renderHeaderCell: () =>
          activeTab === "agents" ? "Last published" : "Last modified",
        renderCell: (record) => formatDate(lastActivity(record)),
      }),
    ],
    [activeTab, navigate, page.cellText],
  );

  const operationColumns = useMemo<
    TableColumnDefinition<ConnectorDetailData["entry"]["operations"][number]>[]
  >(
    () => [
      createTableColumn({
        columnId: "method",
        renderHeaderCell: () => "Method",
        renderCell: (operation) =>
          operation.method ? (
            <Badge appearance="outline">{operation.method}</Badge>
          ) : (
            "—"
          ),
      }),
      createTableColumn({
        columnId: "name",
        renderHeaderCell: () => "Operation",
        renderCell: (operation) =>
          operation.displayName || operation.operationId,
      }),
      createTableColumn({
        columnId: "id",
        renderHeaderCell: () => "Operation ID",
        renderCell: (operation) => (
          <span className={page.mono}>{operation.operationId}</span>
        ),
      }),
      createTableColumn({
        columnId: "description",
        renderHeaderCell: () => "Description",
        renderCell: (operation) => operation.description || "—",
      }),
    ],
    [page.mono],
  );

  return (
    <div className={detailStyles.root}>
      <div className={detailStyles.colFull}>
        <Breadcrumb size="medium">
          <BreadcrumbItem>
            <BreadcrumbButton onClick={() => navigate("/connectors")}>
              Connectors
            </BreadcrumbButton>
          </BreadcrumbItem>
          <BreadcrumbDivider />
          <BreadcrumbItem>
            <BreadcrumbButton current>
              {detail.kind === "ready"
                ? detail.data.entry.displayName
                : connectorId}
            </BreadcrumbButton>
          </BreadcrumbItem>
        </Breadcrumb>
      </div>

      {detail.kind === "loading" && (
        <div className={detailStyles.colFull}>
          <LoadingPane label="Loading connector…" />
        </div>
      )}

      {detail.kind === "error" && (
        <div className={detailStyles.colFull}>
          <ErrorPane
            title="Couldn't load connector"
            message={detail.message}
          />
        </div>
      )}

      {detail.kind === "missing" && (
        <div className={detailStyles.colFull}>
          <ErrorPane
            title="Connector not found"
            message="The connector is not present in the available tenant catalog."
          />
        </div>
      )}

      {detail.kind === "ready" && (
        <>
          <div className={`${detailStyles.header} ${detailStyles.colFull}`}>
            <Text size={700} weight="semibold">
              {detail.data.entry.displayName}
            </Text>
            <div className={detailStyles.badgeRow}>
              {detail.data.entry.tier && (
                <Badge
                  appearance="filled"
                  color={tierBadgeColor(detail.data.entry.tier)}
                >
                  {detail.data.entry.tier}
                </Badge>
              )}
              {detail.data.entry.releaseTag && (
                <Badge appearance="outline">
                  {detail.data.entry.releaseTag}
                </Badge>
              )}
              <Badge
                appearance={
                  detail.data.entry.isDeprecated ? "filled" : "outline"
                }
                color={
                  detail.data.entry.isDeprecated ? "danger" : "success"
                }
              >
                {detail.data.entry.isDeprecated ? "Deprecated" : "Active"}
              </Badge>
            </div>
            {detail.data.entry.description && (
              <Text className={page.overview}>
                {detail.data.entry.description}
              </Text>
            )}
          </div>

          <Card className={detailStyles.colFull}>
            <div className={page.stats}>
              <Stat
                label="Total usage"
                value={
                  summary.kind === "ready" ? summary.data.total : undefined
                }
              />
              <Stat
                label="Apps"
                value={
                  summary.kind === "ready" ? summary.data.apps : undefined
                }
              />
              <Stat
                label="Flows"
                value={
                  summary.kind === "ready" ? summary.data.flows : undefined
                }
              />
              <Stat
                label="Agents"
                value={
                  summary.kind === "ready" ? summary.data.agents : undefined
                }
              />
              <Stat
                label="Environments"
                value={
                  summary.kind === "ready"
                    ? summary.data.environments
                    : undefined
                }
              />
            </div>
          </Card>

          {summary.kind === "error" && (
            <div className={detailStyles.colFull}>
              <ErrorPane
                title="Couldn't load usage totals"
                message={summary.message}
              />
            </div>
          )}

          <Card className={detailStyles.colFull}>
            <CardHeader
              header={<Text weight="semibold">Catalog metadata</Text>}
              description={
                <Text size={200}>
                  Tenant catalog identity and publication details.
                </Text>
              }
            />
            <Divider />
            <div className={detailStyles.cardBody}>
              <div className={detailStyles.metaGrid}>
                <Meta label="Publisher">
                  {detail.data.entry.publisher || "—"}
                </Meta>
                <Meta label="Tier">{detail.data.entry.tier || "—"}</Meta>
                <Meta label="Release stage">
                  {detail.data.entry.releaseTag || "—"}
                </Meta>
                <Meta label="Catalog source">
                  {detail.data.source === "inventory"
                    ? "Inventory preview"
                    : "ListConnectors fallback"}
                </Meta>
                <Meta label="Catalog completeness">
                  {detail.data.complete ? "Complete" : "Partial"}
                </Meta>
                <Meta label="Connector ID">
                  <span className={page.mono}>
                    {detail.data.entry.connectorId}
                  </span>
                </Meta>
              </div>
            </div>
          </Card>

          <Card className={detailStyles.colFull}>
            <CardHeader
              header={
                <Text weight="semibold">
                  Operations ({detail.data.entry.operations.length})
                </Text>
              }
              description={
                <Text size={200}>
                  Actions and triggers exposed by this connector.
                </Text>
              }
            />
            <Divider />
            {detail.data.entry.operations.length === 0 ? (
              <div className={detailStyles.cardBody}>
                <span className={detailStyles.empty}>
                  No operation metadata reported.
                </span>
              </div>
            ) : (
              <div className={page.operations}>
                <DataGrid
                  items={detail.data.entry.operations}
                  columns={operationColumns}
                  getRowId={(operation) => operation.operationId}
                  focusMode="composite"
                >
                  <DataGridHeader>
                    <DataGridRow>
                      {({ renderHeaderCell }) => (
                        <DataGridHeaderCell>
                          {renderHeaderCell()}
                        </DataGridHeaderCell>
                      )}
                    </DataGridRow>
                  </DataGridHeader>
                  <DataGridBody>
                    {({ item, rowId }) => (
                      <DataGridRow key={rowId}>
                        {({ renderCell }) => (
                          <DataGridCell>{renderCell(item)}</DataGridCell>
                        )}
                      </DataGridRow>
                    )}
                  </DataGridBody>
                </DataGrid>
              </div>
            )}
          </Card>

          <Card className={detailStyles.colFull}>
            <div className={page.usageHeader}>
              <TabList
                selectedValue={activeTab}
                onTabSelect={onTabSelect}
                aria-label="Resources using this connector"
              >
                <Tab value="apps">
                  Apps
                  {summary.kind === "ready" && ` (${summary.data.apps})`}
                </Tab>
                <Tab value="flows">
                  Flows
                  {summary.kind === "ready" && ` (${summary.data.flows})`}
                </Tab>
                <Tab value="agents">
                  Agents
                  {summary.kind === "ready" && ` (${summary.data.agents})`}
                </Tab>
              </TabList>
              <div className={page.usageActions}>
                <Button
                  appearance="secondary"
                  icon={
                    exporting === "active" ? (
                      <Spinner size="tiny" />
                    ) : (
                      <ArrowDownloadRegular />
                    )
                  }
                  disabled={exporting !== null}
                  onClick={() => void exportUsage(activeTab)}
                >
                  Export {activeTab}
                </Button>
                <Button
                  appearance="secondary"
                  icon={
                    exporting === "all" ? (
                      <Spinner size="tiny" />
                    ) : (
                      <ArrowDownloadRegular />
                    )
                  }
                  disabled={exporting !== null}
                  onClick={() => void exportUsage("all")}
                >
                  Export all usage
                </Button>
              </div>
            </div>
            <Divider />
            <div className={page.usageBody}>
              {exportError && (
                <MessageBar intent="error">
                  <MessageBarBody>
                    <MessageBarTitle>Export couldn't finish</MessageBarTitle>
                    {exportError}
                  </MessageBarBody>
                </MessageBar>
              )}
              <UsageGrid
                kind={activeTab}
                state={tabs[activeTab]}
                columns={columns}
                onPrevious={goPrevious}
                onNext={() => void goNext()}
                onRetry={retryActiveTab}
              />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function UsageGrid({
  kind,
  state,
  columns,
  onPrevious,
  onNext,
  onRetry,
}: {
  kind: ConnectorUsageKind;
  state: UsageTabState;
  columns: TableColumnDefinition<ConnectorUsageRecord>[];
  onPrevious: () => void;
  onNext: () => void;
  onRetry: () => void;
}) {
  const page = usePageStyles();
  const current = state.pages[state.pageIndex];

  if (state.status === "loading" && !current) {
    return <LoadingPane label={`Loading ${kind}…`} />;
  }

  if (state.status === "error") {
    return (
      <>
        <ErrorPane title={`Couldn't load ${kind}`} message={state.error} />
        <Button appearance="secondary" onClick={onRetry}>
          Try again
        </Button>
      </>
    );
  }

  if (!current || current.records.length === 0) {
    return (
      <Text className={page.muted}>
        No {kind} report using this connector.
      </Text>
    );
  }

  const first = current.offset + 1;
  const last = current.offset + current.records.length;
  return (
    <>
      {current.pagingWarning && (
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>Paging stopped</MessageBarTitle>
            {current.pagingWarning}
          </MessageBarBody>
        </MessageBar>
      )}
      <DataGrid
        items={current.records}
        columns={columns}
        getRowId={(record) =>
          `${record.kind}::${record.row.environmentId}::${record.row.id}`
        }
        focusMode="composite"
      >
        <DataGridHeader>
          <DataGridRow>
            {({ renderHeaderCell }) => (
              <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
            )}
          </DataGridRow>
        </DataGridHeader>
        <DataGridBody<ConnectorUsageRecord>>
          {({ item, rowId }) => (
            <DataGridRow<ConnectorUsageRecord> key={rowId}>
              {({ renderCell }) => (
                <DataGridCell>{renderCell(item)}</DataGridCell>
              )}
            </DataGridRow>
          )}
        </DataGridBody>
      </DataGrid>
      <div className={page.pager}>
        <Text size={200} className={page.muted}>
          Page {state.pageIndex + 1} · rows {first.toLocaleString()}–
          {last.toLocaleString()}
        </Text>
        <div className={page.pagerButtons}>
          <Button
            appearance="secondary"
            icon={<ChevronLeftRegular />}
            disabled={state.pageIndex === 0 || state.status === "loading"}
            onClick={onPrevious}
          >
            Previous
          </Button>
          <Button
            appearance="secondary"
            icon={<ChevronRightRegular />}
            iconPosition="after"
            disabled={
              !current.nextSkipToken || state.status === "loading"
            }
            onClick={onNext}
          >
            {state.status === "loading" ? "Loading…" : "Next"}
          </Button>
        </div>
      </div>
    </>
  );
}
