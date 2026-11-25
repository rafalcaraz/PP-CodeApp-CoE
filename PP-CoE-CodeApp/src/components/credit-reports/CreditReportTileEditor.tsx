import { useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Select, Text } from "@fluentui/react-components";
import type { DashboardTile, TileSize } from "../../data/dashboards";
import { CREDIT_REPORT_DIMENSIONS, CREDIT_REPORT_VIEWS, type CreditReportTileConfig, type CreditReportTileView } from "../../data/dashboardCreditReports";
import type { ConsumptionDimension, ConsumptionGrain, ConsumptionMetric } from "../../shared/credit-reports";
import { CreditReportTile } from "./CreditReportTile";
import { useCreditStyles } from "./styles";
import type { CreditDashboardSource } from "./useCreditDashboard";

export function CreditReportTileEditor({ tile: initial, source, onSave, onClose }: {
  tile: DashboardTile; source: CreditDashboardSource; onSave: (tile: DashboardTile) => void; onClose: () => void;
}) {
  const styles = useCreditStyles(), [tile, setTile] = useState(initial);
  const config = tile.creditReport ?? { reportName: "FeatureDetailsPerResource", view: "trend", metric: "total", dimension: "environment" };
  const funding = config.reportName === "BillingDetailsPerEnvironment";
  function change(patch: Partial<CreditReportTileConfig>) { setTile((tile) => ({ ...tile, creditReport: { ...config, ...patch } })); }
  return <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
    <DialogSurface><DialogBody><DialogTitle>Edit credit report tile</DialogTitle><DialogContent className={styles.root}>
      <Field label="Report tile title"><Input value={tile.title} onChange={(_, data) => setTile({ ...tile, title: data.value })} /></Field>
      <Field label="Report tile size"><Select value={tile.size || "medium"} onChange={(_, data) => setTile({ ...tile, size: data.value as TileSize })}>
        <option value="xs">Quarter width</option><option value="small">Third width</option><option value="medium">Half width</option><option value="large">Full width</option>
      </Select></Field>
      <Field label="Report perspective"><Select value={config.reportName} onChange={(_, data) => {
        const funding = data.value === "BillingDetailsPerEnvironment";
        change({ reportName: funding ? "BillingDetailsPerEnvironment" : "FeatureDetailsPerResource", dimension: "environment", scope: funding ? undefined : config.scope,
          view: (funding && config.view === "family") || (!funding && config.view === "allocations") ? "trend" : config.view });
      }}><option value="FeatureDetailsPerResource">Resource consumption</option><option value="BillingDetailsPerEnvironment">Environment funding</option></Select></Field>
      {!funding && <Field label="Report population"><Select value={config.scope || ""} onChange={(_, data) =>
        change({ scope: data.value === "managed-apps" ? "managed-apps" : undefined,
          ...(data.value === "managed-apps" ? { dimension: config.dimension === "family" ? "environment" : config.dimension, ...(config.view === "family" ? { view: "line" } : {}) } : {}) })}>
        <option value="">All reported resources</option><option value="managed-apps">Managed app scenario (AppStudio)</option>
      </Select></Field>}
      <Field label="Report visualization"><Select value={config.view} onChange={(_, data) => change({ view: data.value as CreditReportTileView })}>
        {CREDIT_REPORT_VIEWS.filter((view) => funding || config.scope === "managed-apps" ? view.value !== "family" && (funding || view.value !== "allocations") : view.value !== "allocations").map((view) => <option key={view.value} value={view.value}>{view.label}</option>)}
      </Select></Field>
      <Field label="Report metric"><Select value={config.metric} onChange={(_, data) => change({ metric: data.value as ConsumptionMetric })}>
        <option value="total">All reported credits</option><option value="billed">{funding ? "Capacity-pack consumed" : "Billed"}</option><option value="nonbilled">{funding ? "PAYG consumed" : "Nonbilled"}</option>
      </Select></Field>
      {(config.view === "ranking" || config.view === "table") && <Field label="Report grouping"><Select value={config.dimension || "environment"} onChange={(_, data) => change({ dimension: data.value as ConsumptionDimension })}>
        {CREDIT_REPORT_DIMENSIONS.filter((dimension) => funding ? dimension.value === "environment" : config.scope !== "managed-apps" || dimension.value !== "family").map((dimension) => <option key={dimension.value} value={dimension.value}>{dimension.label}</option>)}
      </Select></Field>}
      {(config.view === "table" || config.view === "allocations") && <Field label="Rows shown initially"><Select value={tile.viz.tableRows || 10} onChange={(_, data) =>
        setTile({ ...tile, viz: { ...tile.viz, tableRows: Number(data.value) } })}>
        {[10, 25, 50, 100].map((count) => <option key={count} value={count}>{count}</option>)}
      </Select></Field>}
      {(config.view === "trend" || config.view === "line") && <Field label="Report time buckets"><Select value={config.grain || ""} onChange={(_, data) => change({ grain: data.value ? data.value as ConsumptionGrain : undefined })}>
        <option value="">Follow reporting controls</option><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option>
      </Select></Field>}
      {config.view === "rolling30" && <Text size={200}>Trailing 30 calendar days on each UTC date. Available lookback before From is included; incomplete windows are marked.</Text>}
      <details><summary>Preview report tile</summary><CreditReportTile tile={tile} source={source} /></details>
    </DialogContent><DialogActions><Button onClick={onClose}>Cancel</Button>
      <Button appearance="primary" disabled={!tile.title.trim()} onClick={() => onSave({ ...tile, title: tile.title.trim(), source: "credit-report", creditReport: config,
        viz: { ...tile.viz, type: config.view === "summary" ? "kpi" : config.view === "ranking" ? "bar" : config.view === "line" || config.view === "rolling30" ? "line" : config.view === "trend" || config.view === "family" ? "stackedBar" : "table" },
      })}>Save report tile</Button>
    </DialogActions></DialogBody></DialogSurface>
  </Dialog>;
}
