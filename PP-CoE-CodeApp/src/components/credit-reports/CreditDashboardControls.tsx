import { useId, useMemo, useState } from "react";
import { Button, Field, Input, Select, Text, makeStyles, tokens } from "@fluentui/react-components";
import { DismissRegular, FilterRegular } from "@fluentui/react-icons";
import { MANAGED_APP_SCENARIO, type ConsumptionGrain } from "../../shared/credit-reports";
import { CreditInventoryMatching } from "./CreditInventoryMatching";
import { useCreditStyles } from "./styles";
import type { useCreditDashboard } from "./useCreditDashboard";

const useControlStyles = makeStyles({
  toolbar: {
    display: "grid", gridTemplateColumns: "repeat(2, minmax(120px, 1fr)) minmax(120px, 0.8fr) minmax(180px, 1.2fr) auto",
    gap: tokens.spacingHorizontalM, alignItems: "end",
    "@media (max-width: 1000px)": { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
  },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
  panel: {
    display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL, backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  status: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});
const filterLabels: Record<string, string> = {
  startDate: "From", endDate: "Through", environmentId: "Environment", resourceKey: "Resource",
  family: "Schema", group: "Group", product: "Product", feature: "Feature", channel: "Channel",
  model: "Model", tool: "Tool", search: "Search",
  scenarioName: "Scenario",
};

export function CreditDashboardControls({ dashboard, onManage, matchingInline = false, managedApps = false }: {
  dashboard: ReturnType<typeof useCreditDashboard>; onManage: () => void; matchingInline?: boolean; managedApps?: boolean;
}) {
  const styles = useCreditStyles(), controls = useControlStyles(), panelId = useId(), { source } = dashboard;
  const [open, setOpen] = useState(false);
  const resourceRows = useMemo(() => managedApps ? source.resources.rows.filter((row) => row.source.cells.ScenarioName?.trim() === MANAGED_APP_SCENARIO)
    : source.resources.rows, [source.resources.rows, managedApps]);
  const options = useMemo(() => ({
    environments: [...new Map([...resourceRows, ...managedApps ? [] : source.funding.rows]
      .filter((row) => !!row.source.environmentId).map((row) => [row.source.environmentId!, row.environmentName])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1])),
    schemas: [...new Set(source.resources.rows.map((row) => row.schemaName).filter(Boolean))].sort(),
    groups: [...new Map(resourceRows.map((row) => [row.groupKey, row.groupName])).entries()],
    products: [...new Set(resourceRows.map((row) => row.source.cells.Product).filter(Boolean))].sort(),
    features: [...new Set(resourceRows.map((row) => row.source.cells.Feature).filter(Boolean))].sort(),
  }), [resourceRows, source.resources.rows, source.funding.rows, managedApps]);
  const active = Object.entries(source.filter).filter((entry): entry is [string, string] => typeof entry[1] === "string" && (entry[1] !== "" || entry[0] === "group"));
  const report = source.resources.report || source.funding.report;
  const readableFilter = (key: string, value: string) => key === "resourceKey"
    ? source.resources.rows.find((row) => row.resourceKey === value)?.resourceName || value
    : key === "environmentId" ? options.environments.find(([id]) => id === value)?.[1] || value
    : key === "group" ? options.groups.find(([id]) => id === value)?.[1] || value : value;
  return <section className={styles.root} aria-label="Credit reporting controls">
    <div className={controls.toolbar}>
      <Field label="From (UTC)"><Input aria-label="Reporting from UTC" type="date" value={source.filter.startDate || ""} onChange={(_, data) => source.change({ startDate: data.value })} /></Field>
      <Field label="Through (UTC)"><Input aria-label="Reporting through UTC" type="date" value={source.filter.endDate || ""} onChange={(_, data) => source.change({ endDate: data.value })} /></Field>
      <Field label="Period"><Select aria-label="Reporting granularity" value={source.grain} onChange={(_, data) => {
        if (["day", "week", "month"].includes(data.value)) dashboard.setGrain(data.value as ConsumptionGrain);
      }}><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option></Select></Field>
      <Field label="Environment"><Select aria-label="Reporting environment" value={source.filter.environmentId || ""} onChange={(_, data) => source.change({ environmentId: data.value })}>
        <option value="">All environments</option>{options.environments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </Select></Field>
      <div className={controls.actions}>
        <Button icon={<FilterRegular />} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>Data &amp; filters</Button>
        <Button appearance={report ? "subtle" : "primary"} aria-label="Manage Daily report data" onClick={onManage}>Manage data</Button>
      </div>
    </div>
    {report?.observedRange && <Text className={controls.status}>Loaded dates: {report.observedRange.startDate} - {report.observedRange.endDate} UTC · Blank dates use the loaded report range.</Text>}
    {active.length > 0 && <div className={styles.row} aria-label="Active reporting filters">
      {active.map(([key, value]) => <Button key={key} size="small" appearance="subtle" icon={<DismissRegular />} iconPosition="after"
        aria-label={`Clear ${filterLabels[key] || key}: ${readableFilter(key, value)}`} onClick={() => source.change({ [key]: undefined })}>
        {filterLabels[key] || key}: {readableFilter(key, value)}
      </Button>)}
      <Button size="small" appearance="subtle" aria-label="Reset reporting filters" onClick={dashboard.reset}>Clear all</Button>
    </div>}
    {open && <div id={panelId} className={controls.panel}>
      <div className={styles.row}><Text weight="semibold">Report data</Text>
        <Button appearance="subtle" icon={<DismissRegular />} aria-label="Close data and filters" onClick={() => setOpen(false)} /></div>
      <div className={styles.fields}>
      <Field label="Consumption report scope"><Select disabled={!dashboard.resourceScopes.length} value={dashboard.selectedResourceScope || ""}
        onChange={(_, data) => dashboard.setResourceScope(data.value)}>
        {!dashboard.resourceScopes.length && <option value="">Resources report not loaded</option>}
        {dashboard.resourceScopes.map((scope) => <option key={scope.key} value={scope.key}>{scope.label}</option>)}
      </Select></Field>
      <Field label="Funding report scope"><Select disabled={!dashboard.fundingScopes.length} value={dashboard.selectedFundingScope || ""} onChange={(_, data) => dashboard.setFundingScope(data.value)}>
        {!dashboard.fundingScopes.length && <option value="">Billing report not loaded</option>}
        {dashboard.fundingScopes.map((scope) => <option key={scope.key} value={scope.key}>{scope.label}</option>)}
      </Select></Field>
      </div>
      <Text weight="semibold">Consumption filters</Text>
      <div className={styles.fields}>
        <Field label="Search consumption reports"><Input type="search" value={source.filter.search || ""} onChange={(_, data) => source.change({ search: data.value })} /></Field>
        <Field label="Reporting product"><Select value={source.filter.product || ""} onChange={(_, data) => source.change({ product: data.value })}>
          <option value="">All reported products</option>{options.products.map((product) => <option key={product} value={product}>{product}</option>)}
        </Select></Field>
        <Field label="Reporting feature"><Select value={source.filter.feature || ""} onChange={(_, data) => source.change({ feature: data.value })}>
          <option value="">All reported features</option>{options.features.map((feature) => <option key={feature} value={feature}>{feature}</option>)}
        </Select></Field>
        <Field label="Reporting schema family"><Select value={source.filter.family || ""} onChange={(_, data) => source.change({ family: data.value, resourceKey: undefined })}>
          <option value="">All matched schemas</option>{options.schemas.map((schema) => <option key={schema} value={schema}>{schema}</option>)}
        </Select></Field>
        {(source.inventory || source.appInventory) && <Field label="Reporting current environment group"><Select value={source.filter.group ?? "*"} onChange={(_, data) => source.change({ group: data.value === "*" ? undefined : data.value })}>
          <option value="*">All current groups</option>{options.groups.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </Select></Field>}
      </div>
      {!matchingInline && <details><summary>Match current inventory</summary><CreditInventoryMatching dashboard={dashboard} /></details>}
      <details><summary>About reports and coverage</summary><div className={styles.root}>
        <Text size={200}>Report tiles read reconciled Daily captures, not inventory counts. Consumption uses ConsumptionDate; funding uses BilledDate. Dates and environment apply to both perspectives; product, feature, resource, schema and search apply only to consumption. Resource and funding totals are not expected to reconcile.</Text>
        <Text size={200}>Credits are not currency or business ROI. Nonbilled usage does not prove licensing coverage or savings. Values retain signed adjustments; shares are not shown for negative cohorts. Numbers are rounded for display; originals retain precision.</Text>
        <Text size={200}>The newest loaded capture replaces each reported day. Missing periods and resource activity are unknown, not zero or deleted. * marks partial report-day coverage, not a complete month/week. Weekly buckets start Monday UTC. Tenant scopes are file claims or explicit operator assignments.</Text>
        <Text size={200}>Allocation tables show the latest reported day per environment/entitlement/policy, including duplicate rows. Allocation is never summed across days or interpreted as remaining balance. Manage data contains originals, exports and opt-in browser retention.</Text>
        {([["Consumption", source.resources.report], ["Funding", source.funding.report]] as const).map(([label, report]) => report && <Text key={label} size={200}>
          {label}: {report.observedRange?.startDate} - {report.observedRange?.endDate} UTC · {Object.keys(report.daySources).length} reported days · {report.captureIds.length} reconciled captures · Loaded {report.loadedAt}.
        </Text>)}
      </div></details>
    </div>}
  </section>;
}
