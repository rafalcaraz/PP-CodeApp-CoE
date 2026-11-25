import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Checkbox, Field, Input, Select, Tab, TabList, Text } from "@fluentui/react-components";
import {
  creditReportScopes, reconcileCreditReports, useCreditReportCaptures,
  type ReconciledCreditReport,
} from "../../shared/credit-reports";
import { ErrorPane, LoadingPane } from "../../components/Status";
import { formatApiError } from "../../shared/api-explorer/schema";
import {
  concentration, consumptionRange, consumptionTimeline, creditAmount, creditLabels, filterConsumptionRows, groupConsumption,
  latestFundingSnapshots, prepareConsumptionRows, rankedChartGroups, totalConsumption,
  type ConsumptionDimension, type ConsumptionFilter, type ConsumptionGrain, type ConsumptionInventory,
  type ConsumptionMetric, type ConsumptionTotal,
} from "../../shared/credit-reports";
import { loadConsumptionInventory } from "../../data/dashboardCreditInventory";
import { ConsumptionRanking, ConsumptionTrend } from "../../components/credit-reports/ConsumptionCharts";
import { ConsumptionFamily } from "../../components/credit-reports/ConsumptionFamily";
import { useCostStyles } from "./styles";

type View = "overview" | "explorer" | "families" | "funding";
const PAGE_SIZE = 25;
const dimensions: { value: ConsumptionDimension; label: string }[] = [
  { value: "environment", label: "Environment" }, { value: "resource", label: "Resource" },
  { value: "Product", label: "Product" }, { value: "Feature", label: "Feature" },
  { value: "Channel", label: "Channel" }, { value: "LLMModel", label: "Model" }, { value: "ToolUsed", label: "Tool" },
  { value: "group", label: "Current environment group" }, { value: "family", label: "Schema family candidates" },
];

export function ConsumptionDashboard({ onAcquire }: { onAcquire: () => void }) {
  const styles = useCostStyles(), captures = useCreditReportCaptures();
  const [view, setView] = useState<View>("overview");
  const [consumptionScope, setConsumptionScope] = useState(""), [fundingScope, setFundingScope] = useState("");
  const funding = view === "funding";
  const name = funding ? "BillingDetailsPerEnvironment" : "FeatureDetailsPerResource";
  const scopes = useMemo(() => creditReportScopes(captures, name), [captures, name]);
  const key = funding ? fundingScope : consumptionScope;
  const scope = scopes.find((scope) => scope.key === key) ?? scopes[0];
  const report = useMemo(() => scope ? reconcileCreditReports(captures, name, scope.key) : undefined, [captures, name, scope]);
  return <section className={styles.root} aria-label="Consumption and value dashboard">
    <div className={styles.header}>
      <div className={styles.spread}><Text as="h2" size={600} weight="semibold">Consumption &amp; Value</Text>
        <Button onClick={onAcquire}>Manage report data</Button></div>
      <Text className={styles.coverage}>Understand the scale, the drivers and the individual workloads behind reported Copilot Credits. Consumption is evidence of usage, not proof of business outcomes or license savings.</Text>
    </div>
    <TabList aria-label="Consumption views" selectedValue={view} className={styles.tabs}
      onTabSelect={(_, data) => {
        if (["overview", "explorer", "families", "funding"].includes(String(data.value))) setView(data.value as View);
      }}>
      <Tab value="overview">Overview</Tab><Tab value="explorer">Consumption explorer</Tab>
      <Tab value="families">Agent families</Tab><Tab value="funding">Funding</Tab>
    </TabList>
    <Text className={styles.coverage}>{funding
      ? "Funding perspective / BilledDate: capacity-pack and PAYG consumption. This is separate from billed/nonbilled resource consumption; totals are not expected to reconcile. Product, feature, resource and model filters do not apply here."
      : "Resource perspective / ConsumptionDate: billed and nonbilled credits. Nonbilled does not establish Microsoft 365 Copilot coverage, avoided cost or a billing exemption reason."}</Text>
    {scope && <Field label={funding ? "Funding data scope" : "Consumption data scope"} className={styles.reportPicker}>
      <Select value={scope.key} onChange={(_, data) => funding ? setFundingScope(data.value) : setConsumptionScope(data.value)}>
        {scopes.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
      </Select>
    </Field>}
    {scope?.key.startsWith("capture:") && <Text size={200} className={styles.warning}>
      This capture has no single reported tenant. Its history stays isolated. To deliberately combine files from the same tenant, assign each capture's tenant in Capture analysis.
    </Text>}
    {report ? <ConsumptionWorkspace key={`${name}:${scope.key}`} report={report} view={view} onView={setView} /> :
      <div className={styles.emptyReport}><Text as="h3" size={400} weight="semibold">{funding ? "Load an environment billing report" : "Load a resources & features report"}</Text>
        <Text>This perspective is not loaded. Request or upload its Daily report in Manage report data. The other report is not a substitute; missing data is not zero consumption.</Text>
        <Button className={styles.resumeButton} onClick={onAcquire}>Request or upload reports</Button>
      </div>}
  </section>;
}

function ConsumptionWorkspace({ report, view, onView }: {
  report: ReconciledCreditReport; view: View; onView: (view: View) => void;
}) {
  const styles = useCostStyles(), funding = report.name === "BillingDetailsPerEnvironment", labels = creditLabels(funding);
  const [filter, setFilter] = useState<ConsumptionFilter>({});
  const [metric, setMetric] = useState<ConsumptionMetric>("total");
  const [grain, setGrain] = useState<ConsumptionGrain>("month");
  const [dimension, setDimension] = useState<ConsumptionDimension>("environment");
  const [share, setShare] = useState(false), [page, setPage] = useState(0);
  const [inventory, setInventory] = useState<ConsumptionInventory>();
  const [confirmed, setConfirmed] = useState(false), [matching, setMatching] = useState(false), [inventoryError, setInventoryError] = useState("");
  const matchingController = useRef<AbortController | null>(null);
  const search = useDeferredValue(filter.search);
  const rows = useMemo(() => prepareConsumptionRows(report.rows, inventory), [report.rows, inventory]);
  const options = useMemo(() => {
    const values = (column: string) => [...new Set(report.rows.map((row) => row.cells[column]).filter(Boolean))].sort();
    return {
      environments: [...new Map(rows.map((row) => [row.source.environmentId || "", row.environmentName])).entries()].filter(([id]) => id).sort((a, b) => a[1].localeCompare(b[1])),
      groups: [...new Map(rows.map((row) => [row.groupKey, row.groupName])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
      families: [...new Set(rows.map((row) => row.schemaName).filter(Boolean))].sort(),
      Product: values("Product"), Feature: values("Feature"), Channel: values("Channel"), LLMModel: values("LLMModel"), ToolUsed: values("ToolUsed"),
    };
  }, [report.rows, rows]);
  const analysis = useMemo(() => {
    try {
      const range = consumptionRange(report.rows, filter);
      const selected = filterConsumptionRows(rows, { ...filter, search });
      const totals = totalConsumption(selected);
      const groups = groupConsumption(selected, view === "overview" ? "environment" : dimension, metric);
      const resources = groupConsumption(selected, "resource", metric);
      return { data: {
        selected, totals, groups, resources, range,
        buckets: consumptionTimeline(selected, report.rows, range, grain),
        monthly: view === "families" ? consumptionTimeline(selected, report.rows, range, "month") : [],
        concentration: selected.some((row) => row.source.first < 0 || row.source.second < 0) ? null : concentration(resources, metric, 1),
        ranked: rankedChartGroups(groups),
        matched: totalConsumption(selected.filter((row) => !!row.schemaName)),
        negative: selected.some((row) => row.source.first < 0 || row.source.second < 0),
      } };
    } catch (reason) { return { error: formatApiError(reason) }; }
  }, [report.rows, rows, filter, search, grain, dimension, metric, view]);
  const data = analysis.data;
  useEffect(() => () => matchingController.current?.abort(), []);

  function change(patch: Partial<ConsumptionFilter>) { setFilter((previous) => ({ ...previous, ...patch })); setPage(0); }
  function drill(group: ConsumptionTotal, selectedDimension: ConsumptionDimension) {
    if (group.key === "__other__") { setPage(0); if (!funding) onView("explorer"); return; }
    if (selectedDimension === "environment" && group.key) change({ environmentId: group.key });
    else if (selectedDimension === "resource") { change({ resourceKey: group.key }); setDimension("Feature"); }
    else if (selectedDimension === "family" && group.key) { change({ family: group.key }); onView("families"); return; }
    else if (selectedDimension === "group") change({ group: group.key });
    else if (["Product", "Feature", "Channel", "LLMModel", "ToolUsed"].includes(selectedDimension) && group.key) {
      const key = { Product: "product", Feature: "feature", Channel: "channel", LLMModel: "model", ToolUsed: "tool" }[selectedDimension as "Product" | "Feature" | "Channel" | "LLMModel" | "ToolUsed"];
      change({ [key]: group.key });
    } else return;
    if (!funding) onView("explorer");
  }
  async function matchInventory() {
    const controller = new AbortController();
    matchingController.current = controller; setMatching(true); setInventoryError("");
    try {
      const result = await loadConsumptionInventory(controller.signal);
      if (!controller.signal.aborted) setInventory(result);
    } catch (reason) { if (!controller.signal.aborted) setInventoryError(formatApiError(reason)); }
    finally { if (!controller.signal.aborted) setMatching(false); }
  }
  const activeFilters = Object.entries(filter).filter(([, value]) => value !== undefined && value !== "");
  const selectedResource = filter.resourceKey ? rows.find((row) => row.resourceKey === filter.resourceKey) : undefined;
  const effectiveDimension = view === "overview" ? "environment" : dimension;
  const currentPage = Math.min(page, Math.max(0, Math.ceil((data?.groups.length ?? 0) / PAGE_SIZE) - 1));
  return <div className={styles.root}>
    {report.observedRange && <Text size={200} className={styles.muted}>Loaded reported dates: {report.observedRange.startDate} through {report.observedRange.endDate} UTC. Blank date filters use this loaded range, not a new report request.</Text>}
    <div className={styles.fields}>
      <Field label="Analysis from UTC"><Input type="date" value={filter.startDate || ""} onChange={(_, data) => change({ startDate: data.value })} /></Field>
      <Field label="Analysis through UTC"><Input type="date" value={filter.endDate || ""} onChange={(_, data) => change({ endDate: data.value })} /></Field>
      <Field label="Consumption metric"><Select value={metric} onChange={(_, data) => {
        if (["total", "billed", "nonbilled"].includes(data.value)) { setMetric(data.value as ConsumptionMetric); setPage(0); }
      }}>
        <option value="total">All reported consumption</option><option value="billed">{labels.first}</option><option value="nonbilled">{labels.second}</option>
      </Select></Field>
      <Field label="Trend granularity"><Select value={grain} onChange={(_, data) => {
        if (["day", "week", "month"].includes(data.value)) setGrain(data.value as ConsumptionGrain);
      }}><option value="day">Daily</option><option value="week">Weekly (Monday UTC)</option><option value="month">Monthly</option></Select></Field>
      <Field label="Consumption environment"><Select value={filter.environmentId || ""} onChange={(_, data) => change({ environmentId: data.value })}>
        <option value="">All reported environments</option>{options.environments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </Select></Field>
      {!funding && <Field label="Search consumption" hint="Search report values and matched schema names."><Input type="search" value={filter.search || ""} onChange={(_, data) => change({ search: data.value })} /></Field>}
    </div>
    {!funding && <details><summary>Product, feature and technical filters</summary><div className={styles.fields}>
      {([
        ["product", "Product", "Product"], ["feature", "Feature", "Feature"], ["channel", "Channel", "Channel"],
        ["model", "LLMModel", "Model"], ["tool", "ToolUsed", "Tool"],
      ] as const).map(([key, column, label]) => <Field key={key} label={`Consumption ${label.toLowerCase()}`}>
        <Select value={filter[key] || ""} onChange={(_, data) => change({ [key]: data.value })}>
          <option value="">All reported values</option>{options[column].map((value) => <option key={value} value={value}>{value}</option>)}
        </Select></Field>)}
      {inventory && <Field label="Current environment group"><Select value={filter.group ?? "*"} onChange={(_, data) => change({ group: data.value === "*" ? undefined : data.value })}>
        <option value="*">All current groups</option>{options.groups.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </Select></Field>}
    </div></details>}
    <div className={styles.row} aria-label="Active consumption filters">
      {activeFilters.map(([key, value]) => <Button key={key} size="small" appearance="subtle" onClick={() => change({ [key]: undefined })}>
        Clear {key}: {key === "resourceKey" ? selectedResource?.resourceName || value : value}
      </Button>)}
      <Button disabled={!activeFilters.length} onClick={() => { setFilter({}); setPage(0); }}>Reset consumption filters</Button>
    </div>
    {analysis.error && <ErrorPane title="Consumption analysis unavailable" message={analysis.error} />}
    {selectedResource && <div className={styles.header}>
      <Text as="h3" size={500} weight="semibold">{selectedResource.resourceName}</Text>
      <Text>{selectedResource.environmentName} / {selectedResource.source.cells.ResourceID} / {selectedResource.schemaName || "Schema not resolved"}</Text>
      {selectedResource.schemaName && <Button className={styles.resumeButton} onClick={() => {
        change({ family: selectedResource.schemaName, resourceKey: undefined, environmentId: undefined }); onView("families");
      }}>Compare matching schema deployments</Button>}
    </div>}
    {!funding && <details open={view === "families" ? true : undefined}><summary>Inventory matching and current group context</summary>
      <div className={styles.form}>
        <Text className={styles.coverage}>Optional read from the connected inventory. Confirm this report scope belongs to that tenant before matching IDs. No name-based joins. Schema matches are family candidates, not verified ALM relationships. Current groups/types are not historical membership.</Text>
        <Checkbox label="I confirm this report scope belongs to the connected inventory tenant" checked={confirmed} onChange={(_, data) => setConfirmed(data.checked === true)} />
        <Button className={styles.resumeButton} disabled={!confirmed || matching} onClick={() => void matchInventory()}>{inventory ? "Refresh current inventory match" : "Match current inventory"}</Button>
        {matching && <LoadingPane label="Reading current environments and agent inventory. No partial matches will be applied." />}
        {inventoryError && <ErrorPane title="Inventory matching failed" message={inventoryError} />}
        {inventory && <Text size={200}>Matched using inventory loaded {inventory.loadedAt}. {inventory.agents.length} agent records read. Unresolved resources remain in all consumption totals.</Text>}
      </div>
    </details>}
    {data && <>
      <div className={styles.reportTotals} aria-label="Consumption summary">
        <Text>{labels.first}: <strong>{creditAmount(data.totals.first)}</strong></Text>
        <Text>{labels.second}: <strong>{creditAmount(data.totals.second)}</strong></Text>
        <Text>Total reported credits: <strong>{creditAmount(data.totals.total)}</strong></Text>
        {!funding && <Text>{data.resources.length} resource instances / {new Set(data.selected.map((row) => row.source.environmentId).filter(Boolean)).size} identified environments</Text>}
      </div>
      {!data.selected.length ? <Text role="status">No reported activity matches this scope and these filters. Missing activity is not inferred as zero. Adjust or reset the filters.</Text> : <>
        {!funding && view === "overview" && <div className={styles.insights} aria-label="Consumption observations">
          <Text>{!data.negative && data.totals.total > 0
            ? `${(data.totals.second / data.totals.total * 100).toFixed(1)}% of reported credits are nonbilled. This is a consumption mix, not a savings estimate.`
            : "Signed adjustments or zero consumption prevent a meaningful percentage mix."}</Text>
          {data.concentration !== null && <Button appearance="subtle" className={styles.insightButton} onClick={() => drill(data.resources[0], "resource")}>
            Largest resource: {data.resources[0].label} / {(data.concentration * 100).toFixed(1)}% of the selected metric. Inspect resource
          </Button>}
          <Text size={200}>Schema-resolved credits: {creditAmount(data.matched.total)} of {creditAmount(data.totals.total)}. Unresolved usage is included, not discarded.</Text>
        </div>}
        <Checkbox label="Show percentage mix" checked={share && metric === "total" && !data.negative} disabled={metric !== "total" || data.negative}
          onChange={(_, value) => setShare(value.checked === true)} />
        <ConsumptionTrend buckets={data.buckets} metric={metric} funding={funding} share={share && metric === "total" && !data.negative} />
        {view === "families" ? <>
          <Field label="Agent schema family"><Select value={filter.family || ""} onChange={(_, next) => change({ family: next.value, resourceKey: undefined })}>
            <option value="">Choose a matched schema</option>{options.families.map((family) => <option key={family} value={family}>{family}</option>)}
          </Select></Field>
          {filter.family ? <ConsumptionFamily rows={data.selected} inventory={inventory} family={filter.family} buckets={data.monthly} metric={metric}
            onDrill={(patch) => {
              const startDate = data.range && patch.startDate && patch.startDate < data.range.startDate ? data.range.startDate : patch.startDate;
              const endDate = data.range && patch.endDate && patch.endDate > data.range.endDate ? data.range.endDate : patch.endDate;
              change({ ...patch, startDate, endDate }); setDimension("Feature"); onView("explorer");
            }} /> : <Text>Match current inventory, then choose a schema name. All resource consumption remains available in the explorer even when no schema can be resolved.</Text>}
        </> : <>
          <div className={styles.spread}><Text as="h3" size={400} weight="semibold">{view === "overview" ? "Where consumption is concentrated" : "Consumption breakdown"}</Text>
            {view !== "overview" && <Field label="Explore consumption by"><Select value={dimension} onChange={(_, next) => {
              if (dimensions.some((entry) => entry.value === next.value)) { setDimension(next.value as ConsumptionDimension); setPage(0); }
            }}>
              {dimensions.filter((entry) => funding ? entry.value === "environment" : true).map((entry) =>
                <option key={entry.value} value={entry.value} disabled={!inventory && (entry.value === "family" || entry.value === "group")}>{entry.label}</option>)}
            </Select></Field>}
          </div>
          <ConsumptionRanking groups={data.ranked} metric={metric} funding={funding} onSelect={(group) => drill(group, effectiveDimension)} />
          <Text size={200} className={styles.muted}>Top eight plus Other; the table includes every group. Sorted by the selected metric. Names are labels; resource identities include their environment.</Text>
          <div className={styles.tableWrap} role="region" aria-label="Consumption breakdown scroll area" tabIndex={0}>
            <table className={styles.table}><caption>Consumption explorer breakdown</caption>
              <thead><tr><th>Group</th><th>{labels.first}</th><th>{labels.second}</th><th>Total credits</th><th>Selected metric share</th></tr></thead>
              <tbody>{data.groups.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((group) => {
                const share = data.negative ? null : concentration([group, ...data.groups.filter((entry) => entry !== group)], metric, 1);
                return <tr key={group.key}><td>
                  <Button appearance="subtle" className={styles.insightButton} onClick={() => drill(group, effectiveDimension)}
                    disabled={!group.key && effectiveDimension !== "group"}>{group.label}</Button>
                  {group.detail && <div className={styles.muted}>{group.detail}</div>}
                </td><td>{creditAmount(group.first)}</td><td>{creditAmount(group.second)}</td><td>{creditAmount(group.total)}</td><td>{share === null ? "Not applicable" : `${(share * 100).toFixed(1)}%`}</td></tr>;
              })}</tbody>
            </table>
          </div>
          <div className={styles.row}><Button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous consumption groups</Button>
            <Text>Page {currentPage + 1} of {Math.max(1, Math.ceil(data.groups.length / PAGE_SIZE))}</Text>
            <Button disabled={(currentPage + 1) * PAGE_SIZE >= data.groups.length} onClick={() => setPage(currentPage + 1)}>Next consumption groups</Button></div>
          {!funding && view === "overview" && <Button className={styles.resumeButton} onClick={() => { setDimension("resource"); onView("explorer"); }}>Explore individual resources</Button>}
        </>}
        {funding && <FundingSnapshots report={report} filter={filter} />}
      </>}
      <details><summary>Data coverage and provenance</summary><div className={styles.list}>
        <Badge appearance="outline">{Object.keys(report.daySources).length} reported UTC days in loaded scope</Badge>
        <Text>{report.captureIds.length} retained captures; newest loaded capture wins per reported UTC day. Loaded {report.loadedAt}. This is retrieval time, not service generation time. Report rows do not prove complete environment/resource coverage.</Text>
        <Text>Tenant scope is a file claim or explicit operator assignment, not identity verification. Unassigned files without TenantID stay separate; assign a tenant in Capture analysis to deliberately combine their history.</Text>
        <Text size={200}>Credits are not currency. Daily allocation snapshots are never added as consumption. Export all captures for originals and the winning-day provenance manifest.</Text>
      </div></details>
    </>}
  </div>;
}

function FundingSnapshots({ report, filter }: { report: ReconciledCreditReport; filter: ConsumptionFilter }) {
  const styles = useCostStyles(), [page, setPage] = useState(0);
  const rows = useMemo(() => latestFundingSnapshots(report.rows, filter), [report.rows, filter]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1));
  return <details><summary>Latest reported allocation snapshots ({rows.length})</summary>
    <Text className={styles.coverage}>Latest reported snapshot day per environment, entitlement and billing policy inside the selected dates. Multiple rows on that day are preserved, not silently deduplicated. Values may be older than the period end. Not summed across dates, not remaining balance, and not a capacity-utilization percentage.</Text>
    <div className={styles.tableWrap} role="region" aria-label="Funding allocation snapshots scroll area" tabIndex={0}>
      <table className={styles.table}><caption>Latest reported allocation by billing scope</caption>
        <thead><tr><th>Environment</th><th>Snapshot date</th><th>Entitlement</th><th>Billing policy</th><th>Allocated capacity credits</th></tr></thead>
        <tbody>{rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((row, i) => <tr key={i}>
          <td>{row.environmentName || row.environmentId || "Not reported"}</td><td>{row.date}</td>
          <td>{row.cells.EntitlementID || "Not reported"}</td><td>{row.cells.BillingPolicyId || "Not reported"}</td><td>{row.cells.AllocatedCapacityPackCredits || "Not reported"}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className={styles.row}><Button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous snapshots</Button>
      <Text>Page {currentPage + 1} of {Math.max(1, Math.ceil(rows.length / PAGE_SIZE))}</Text>
      <Button disabled={(currentPage + 1) * PAGE_SIZE >= rows.length} onClick={() => setPage(currentPage + 1)}>Next snapshots</Button></div>
  </details>;
}
