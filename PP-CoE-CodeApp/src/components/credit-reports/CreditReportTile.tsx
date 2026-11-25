import { useMemo, useState } from "react";
import { Button, Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import type { DashboardTab, DashboardTile } from "../../data/dashboards";
import {
  consumptionTimeline, creditAmount, creditLabels, groupConsumption, latestFundingSnapshots,
  rankedChartGroups, totalConsumption, filterConsumptionRows, rolling30ConsumptionTimeline, MANAGED_APP_SCENARIO,
  type ConsumptionDimension, type ConsumptionFilter, type ConsumptionTotal,
} from "../../shared/credit-reports";
import { CREDIT_REPORT_DIMENSIONS, CREDIT_REPORT_VIEWS } from "../../data/dashboardCreditReports";
import { ErrorPane } from "../Status";
import { ConsumptionLine, ConsumptionRanking, ConsumptionTrend } from "./ConsumptionCharts";
import { ConsumptionFamily } from "./ConsumptionFamily";
import { useCreditStyles } from "./styles";
import type { CreditDashboardSource } from "./useCreditDashboard";
import { formatApiError } from "../../shared/api-explorer/schema";
import { DashboardTileFrame } from "../DashboardTileFrame";
import { useDashboardTileStyles } from "../dashboardTileStyles";

export interface CreditReportTileProps {
  tile: DashboardTile;
  source?: CreditDashboardSource;
  editable?: boolean;
  className?: string;
  onEdit?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  tabs?: DashboardTab[];
  onMoveToTab?: (id: string) => void;
}
const useTileStyles = makeStyles({
  content: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, gap: tokens.spacingVerticalS },
  tableWrap: { maxHeight: "360px", overflow: "auto" },
  resource: { whiteSpace: "normal", overflowWrap: "anywhere", minWidth: "160px" },
  value: { fontVariantNumeric: "tabular-nums" },
});
export function CreditReportTile({ tile, source, editable, className, onEdit, onDelete, onDuplicate, tabs, onMoveToTab }: CreditReportTileProps) {
  const tileStyles = useTileStyles(), config = tile.creditReport;
  const funding = config?.reportName === "BillingDetailsPerEnvironment";
  return <DashboardTileFrame tile={tile} ariaLabel={tile.title} description={funding ? "Credit funding" : "Credit consumption"}
    actionsLabel={`Actions for ${tile.title}`} editable={editable} className={className} onEdit={onEdit}
    onDelete={onDelete} onDuplicate={onDuplicate} tabs={tabs} onMoveToTab={onMoveToTab}>
    <div className={tileStyles.content}>
      {!source ? <Text>Reporting controls are not available. Open this tile inside its dashboard.</Text> :
        <CreditReportTileBody tile={tile} source={source} />}
    </div>
  </DashboardTileFrame>;
}

function CreditReportTileBody({ tile, source }: { tile: DashboardTile; source: CreditDashboardSource }) {
  const styles = useCreditStyles(), baseStyles = useDashboardTileStyles(), tileStyles = useTileStyles(), config = tile.creditReport;
  const configuredRows = tile.viz.tableRows;
  const pageSize = typeof configuredRows === "number" && Number.isSafeInteger(configuredRows) && configuredRows > 0 ? configuredRows : 10;
  const [expandedRows, setExpandedRows] = useState(0);
  const funding = config?.reportName === "BillingDetailsPerEnvironment";
  const projection = funding ? source.funding : source.resources;
  const selected = useMemo(() => config?.scope === "managed-apps"
    ? filterConsumptionRows(projection.selected, { scenarioName: MANAGED_APP_SCENARIO }) : projection.selected, [projection.selected, config?.scope]);
  const labels = creditLabels(funding);
  const analysis = useMemo(() => {
    try {
      if (!config || !["FeatureDetailsPerResource", "BillingDetailsPerEnvironment"].includes(config.reportName)
        || !CREDIT_REPORT_VIEWS.some((view) => view.value === config.view)
        || !["total", "billed", "nonbilled"].includes(config.metric)
        || (config.dimension && !CREDIT_REPORT_DIMENSIONS.some((dimension) => dimension.value === config.dimension))
        || (config.grain && !["day", "week", "month"].includes(config.grain))) throw new Error("Invalid report tile configuration. Edit this tile to choose a supported view.");
      if (config.scope !== undefined && config.scope !== "managed-apps") throw new Error("Invalid report population. Edit this tile.");
      if (funding && config.scope) throw new Error("Managed app attribution requires the resource consumption report, not funding.");
      if (config.scope === "managed-apps" && (config.view === "family" || config.dimension === "family")) throw new Error("Managed apps do not support agent schema-family grouping.");
      if (config.scope === "managed-apps" && projection.report && !projection.report.columns.includes("ScenarioName")) throw new Error("This resource report omits ScenarioName. Load a report with ScenarioName to attribute AppStudio consumption.");
      if (funding && (config.view === "family" || (config.dimension && config.dimension !== "environment"))) {
        throw new Error("Funding supports environment grouping only, not resource or feature attribution.");
      }
      if (!funding && config.view === "allocations") throw new Error("Allocation snapshots require the environment billing report.");
      if (projection.error) throw new Error(projection.error);
      const totals = totalConsumption(selected);
      const groups = groupConsumption(selected, config.dimension || "environment", config.metric);
      const needsTrend = config.view === "trend" || config.view === "line" || config.view === "family";
      const buckets = config.view === "rolling30"
        ? rolling30ConsumptionTimeline(filterConsumptionRows(projection.rows, {
          ...(funding ? { environmentId: source.filter.environmentId, endDate: source.filter.endDate } : source.filter),
          startDate: undefined, ...(config.scope === "managed-apps" ? { scenarioName: MANAGED_APP_SCENARIO } : {}),
        }), projection.report?.rows ?? [], projection.range)
        : needsTrend ? consumptionTimeline(selected, projection.report?.rows ?? [], projection.range,
          config.view === "family" ? "month" : config.grain || source.grain) : [];
      const snapshots = config.view === "allocations" ? latestFundingSnapshots(selected.map((row) => row.source), {}) : [];
      return { data: { totals, groups, buckets, snapshots, chartGroups: rankedChartGroups(groups) } };
    } catch (reason) { return { error: formatApiError(reason) }; }
  }, [config, projection, selected, source.grain, source.filter, funding]);
  if (analysis.error) return <ErrorPane title="Report tile unavailable" message={analysis.error} />;
  if (!projection.report) return <Text>This Daily report is not loaded. Use Manage Daily report data to request or upload it. Missing data is not zero credits.</Text>;
  if (config?.scope === "managed-apps" && config.dimension === "group" && !source.appInventory) {
    return <Text className={baseStyles.empty}>{source.appInventoryStatus === "loading" ? "Matching managed app inventory..." :
      source.appInventoryStatus === "error" ? "Managed app matching failed. Review the error above and retry." : "Match managed app inventory above to resolve current environment groups."}</Text>;
  }
  if (config?.scope !== "managed-apps" && (config?.view === "family" || config?.dimension === "family" || config?.dimension === "group") && !source.inventory) {
    return <Text className={baseStyles.empty}>{source.inventoryStatus === "loading" ? "Matching agent inventory..." : source.inventoryStatus === "error"
      ? "Agent matching failed. Review the inventory error above and retry." : "Match agent inventory above to group resources by current schema and environment group."}</Text>;
  }
  const data = analysis.data;
  if (!data || !config) return null;
  if (!selected.length && (config.view !== "rolling30" || !data.buckets.some((bucket) => bucket.total !== null))) return <Text>No reported activity matches the reporting controls. Reset or adjust the filters; absent activity is not inferred as zero.</Text>;
  const rowCount = config.view === "allocations" ? data.snapshots.length : data.groups.length;
  const visibleRows = Math.min(rowCount, pageSize + expandedRows);
  function drill(group: ConsumptionTotal, dimension: ConsumptionDimension) {
    if (group.key === "__other__") return;
    if (dimension === "environment") source.change({ environmentId: group.key });
    else if (dimension === "resource") source.change({ resourceKey: group.key });
    else if (dimension === "group") source.change({ group: group.key });
    else if (dimension === "family") source.change({ family: group.key, resourceKey: undefined });
    else if (group.key) {
      const key = { Product: "product", Feature: "feature", ScenarioName: "scenarioName", Channel: "channel", LLMModel: "model", ToolUsed: "tool" }[dimension];
      source.change({ [key]: group.key });
    }
  }
  const amount = config.metric === "billed" ? data.totals.first : config.metric === "nonbilled" ? data.totals.second : data.totals.total;
  const metricLabel = config.metric === "billed" ? labels.first : config.metric === "nonbilled" ? labels.second : "Total reported credits";
  function familyDrill(patch: Partial<ConsumptionFilter>) {
    const range = projection.range;
    source.change({ ...patch,
      startDate: patch.startDate && range && patch.startDate < range.startDate ? range.startDate : patch.startDate,
      endDate: patch.endDate && range && patch.endDate > range.endDate ? range.endDate : patch.endDate,
    });
  }
  return <>
    {config.view === "summary" && <div className={baseStyles.kpi}>
      <Text className={mergeClasses(baseStyles.kpiValue, tileStyles.value)}>{creditAmount(amount)}</Text><Text className={baseStyles.kpiLabel}>{metricLabel}</Text>
    </div>}
    {config.view === "trend" && <ConsumptionTrend compact buckets={data.buckets} funding={funding} metric={config.metric} />}
    {(config.view === "line" || config.view === "rolling30") && <ConsumptionLine buckets={data.buckets} funding={funding} metric={config.metric} rolling={config.view === "rolling30"} />}
    {config.view === "ranking" && <>
      <ConsumptionRanking compact groups={data.chartGroups} funding={funding} metric={config.metric} onSelect={(group) => drill(group, config.dimension || "environment")} />
      <details className={baseStyles.disclosure}><summary>View values and drill down</summary>
        {data.chartGroups.map((group) => <Button key={group.key} className={styles.button} appearance="subtle" disabled={group.key === "__other__"}
          onClick={() => drill(group, config.dimension || "environment")}>{group.label}: {creditAmount(config.metric === "billed" ? group.first : config.metric === "nonbilled" ? group.second : group.total)}</Button>)}
      </details>
    </>}
    {config.view === "table" && <>
      <div className={tileStyles.tableWrap} tabIndex={0} role="region" aria-label={`${tile.title} table scroll area`}>
        <table className={baseStyles.table} aria-label={tile.title}><thead><tr>
          <th className={baseStyles.th}>{config.scope === "managed-apps" && config.dimension === "resource" ? "Managed app instance" : CREDIT_REPORT_DIMENSIONS.find((dimension) => dimension.value === config.dimension)?.label || "Environment"}</th>
          {config.metric !== "nonbilled" && <th className={baseStyles.th}>{labels.first}</th>}
          {config.metric !== "billed" && <th className={baseStyles.th}>{labels.second}</th>}
          {config.metric === "total" ? <th className={baseStyles.th}>Total credits</th> : <th className={baseStyles.th}>Share</th>}
        </tr></thead>
          <tbody>{data.groups.slice(0, visibleRows).map((group) => {
            const share = amount <= 0 || selected.some((row) => row.source.first < 0 || row.source.second < 0) ? null
              : (config.metric === "billed" ? group.first : config.metric === "nonbilled" ? group.second : group.total) / amount;
            return <tr key={group.key}><td className={mergeClasses(baseStyles.td, tileStyles.resource)}><Button className={styles.button} appearance="subtle" title={group.detail || undefined} disabled={!group.key && config.dimension !== "group"}
              onClick={() => drill(group, config.dimension || "environment")}>{config.dimension === "family" && !group.key ? "Not mapped to an agent schema" : group.label}</Button>
              {config.dimension === "resource" && <div className={styles.muted}>{projection.rows.find((row) => row.resourceKey === group.key)?.environmentName}</div>}</td>
              {config.metric !== "nonbilled" && <td className={baseStyles.td}>{creditAmount(group.first)}</td>}
              {config.metric !== "billed" && <td className={baseStyles.td}>{creditAmount(group.second)}</td>}
              <td className={baseStyles.td}>{config.metric === "total" ? creditAmount(group.total) : share === null ? "Not applicable" : `${(share * 100).toFixed(1)}%`}</td></tr>;
          })}</tbody></table>
      </div>
    </>}
    {config.view === "family" && (source.filter.family
      ? <ConsumptionFamily compact rows={projection.selected} inventory={source.inventory} family={source.filter.family} buckets={data.buckets} metric={config.metric} onDrill={familyDrill} />
      : <Text className={baseStyles.empty}>Choose a matched schema in Data &amp; filters to compare its environments.</Text>)}
    {config.view === "allocations" && <div className={tileStyles.tableWrap} tabIndex={0} role="region" aria-label="Allocation snapshots scroll area">
      <table className={baseStyles.table} aria-label={tile.title}><thead><tr>{["Environment", "Latest reported day", "Entitlement", "Billing policy", "Allocated credits"].map((label) =>
        <th key={label} className={baseStyles.th}>{label}</th>)}</tr></thead>
        <tbody>{data.snapshots.slice(0, visibleRows).map((row, index) => <tr key={index}>
          {[row.environmentName || row.environmentId || "Not reported", row.date, row.cells.EntitlementID || "Not reported", row.cells.BillingPolicyId || "Not reported", row.cells.AllocatedCapacityPackCredits || "Not reported"]
            .map((value, column) => <td className={baseStyles.td} key={column}>{value}</td>)}</tr>)}</tbody>
      </table>
    </div>}
    {(config.view === "table" || config.view === "allocations") && <div className={styles.row}>
      <Text size={200} className={styles.muted}>Showing {visibleRows} of {rowCount.toLocaleString()}</Text>
      {visibleRows < rowCount && <Button appearance="subtle" onClick={() => setExpandedRows((rows) => rows + pageSize)}>Show more</Button>}
    </div>}
  </>;
}
