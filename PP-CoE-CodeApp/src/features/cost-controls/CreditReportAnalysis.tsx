import { useMemo, useState } from "react";
import { Button, Field, Input, Select, Text, mergeClasses, tokens } from "@fluentui/react-components";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  aggregateReportRows, REPORT_SCHEMAS, selectReportRows,
  type CreditReport, type ReportDimension, type ReportFilter,
} from "../../shared/credit-reports";
import { formatApiError } from "../../shared/api-explorer/schema";
import { ErrorPane } from "../../components/Status";
import { useCostStyles } from "./styles";

const PAGE_SIZE = 25;
const amount = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 20 });

export function CreditReportAnalysis({ report }: { report: CreditReport }) {
  const styles = useCostStyles();
  const [filter, setFilter] = useState<ReportFilter>({});
  const [dimension, setDimension] = useState<ReportDimension>(report.name === "FeatureDetailsPerResource" ? "resource" : "environment");
  const [page, setPage] = useState(0);
  const [rawPage, setRawPage] = useState(0);
  const schema = REPORT_SCHEMAS[report.name];
  const environments = useMemo(() => {
    const values = new Map<string, string>();
    for (const row of report.rows) if (row.environmentId) values.set(row.environmentId, row.environmentName || row.environmentId);
    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [report]);
  const analysis = useMemo(() => {
    try {
      if (filter.startDate && filter.endDate && filter.startDate > filter.endDate) throw new Error("The filter start date must be on or before its end date.");
      const rows = selectReportRows(report, filter);
      const days = aggregateReportRows(rows, "date");
      const totals = days.reduce((sum, day) => ({ first: sum.first + day.first, second: sum.second + day.second }), { first: 0, second: 0 });
      if (![totals.first, totals.second].every(Number.isFinite)) throw new Error("Combined credits exceed the supported numeric range.");
      return { data: { rows, groups: aggregateReportRows(rows, dimension), days, totals } };
    } catch (reason) { return { error: formatApiError(reason) }; }
  }, [report, filter, dimension]);
  const data = analysis.data;
  const totals = data?.totals;
  function changeFilter(patch: Partial<ReportFilter>) {
    setFilter({ ...filter, ...patch }); setPage(0); setRawPage(0);
  }
  const period = report.requestedRange || report.observedRange;

  return <div className={styles.root}>
    <Text weight="semibold">{schema.label} / {period ? `${period.startDate} through ${period.endDate} UTC` : "No dated rows returned"}</Text>
    <Text size={200} className={styles.muted}>
      {report.source === "power-platform-api" ? "Downloaded through Power Platform API"
        : report.source === "connector" ? "Downloaded through V2" : "Uploaded file; tenant and completeness are not verified"} / Loaded {report.loadedAt} / {amount(report.rows.length)} rows.
      {report.source === "upload" && " Dates describe observed rows, not a verified request period."}
    </Text>
    <Text className={styles.coverage}>{report.name === "FeatureDetailsPerResource"
      ? "Billed and nonbilled credits describe resource/feature usage. Resources may include agents and other resource types; inspect ResourceType before interpreting a ranking as agents only."
      : "Capacity-pack and pay-as-you-go values describe environment billing. AllocatedCapacityPackCredits is a daily capacity snapshot, not consumption, and is never summed here."} The two report types are independent views and must not be added together.</Text>
    <div className={styles.fields}>
      <Field label="Filter environment"><Select value={filter.environmentId || ""} onChange={(_, next) => changeFilter({ environmentId: next.value })}>
        <option value="">All reported environments</option>
        {environments.map(([id, name]) => <option key={id} value={id}>{name} ({id})</option>)}
      </Select></Field>
      <Field label="Filter from UTC"><Input type="date" value={filter.startDate || ""} onChange={(_, next) => changeFilter({ startDate: next.value })} /></Field>
      <Field label="Filter through UTC"><Input type="date" value={filter.endDate || ""} onChange={(_, next) => changeFilter({ endDate: next.value })} /></Field>
      <Field label="Search report values" hint="Searches all returned columns, including resource type, feature and model."><Input value={filter.search || ""}
        onChange={(_, next) => changeFilter({ search: next.value })} /></Field>
    </div>
    {analysis.error && <ErrorPane title="Analysis unavailable" message={analysis.error} />}
    {data && totals && <>
      {!data.rows.length ? <Text role="status">{report.rows.length ? "No rows match these filters. Clear the filters to see the loaded report." : "This valid Daily report contains no consumption rows. Missing dates and other reports are not inferred as zero."}</Text> : <>
        <div className={styles.reportTotals} aria-label="Filtered report consumption">
          <Text><strong>{amount(data.rows.length)}</strong> matching rows</Text>
          <Text>{schema.firstLabel}: <strong>{amount(totals.first)}</strong></Text>
          <Text>{schema.secondLabel}: <strong>{amount(totals.second)}</strong></Text>
        </div>
        <section aria-labelledby="daily-credits-title" className={styles.list}>
          <Text as="h3" id="daily-credits-title" size={400} weight="semibold">Daily consumption</Text>
          <Text size={200} className={styles.muted}>Only dates present in the filtered report are plotted. Unreported days are not filled with zero. Exact daily values are available by grouping the table by day.</Text>
          <div className={styles.chart} role="img" aria-label="Daily reported credit consumption; exact values are available in the grouped table">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.days} margin={{ left: 16, right: 24, top: 8, bottom: 8 }} accessibilityLayer>
                <CartesianGrid stroke={tokens.colorNeutralStroke2} vertical={false} />
                <XAxis dataKey="label" tickFormatter={(value: string) => value.slice(5)} minTickGap={24} /><YAxis />
                <Tooltip formatter={(value) => [`${value} credits`]} />
                <Legend />
                <Bar dataKey="first" name={schema.firstLabel} fill={tokens.colorBrandBackground} />
                <Bar dataKey="second" name={schema.secondLabel} fill={tokens.colorPaletteTealForeground2} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <div className={styles.spread}>
          <Text as="h3" size={400} weight="semibold">Consumption breakdown</Text>
          <Field label="Group consumption by"><Select value={dimension} onChange={(_, next) => {
            setDimension(next.value as ReportDimension); setPage(0);
          }}>
            <option value="environment">Environment</option>
            {report.name === "FeatureDetailsPerResource" && <>
              <option value="resource">Resource / agent</option><option value="Feature">Feature</option><option value="Product">Product</option>
            </>}
            <option value="date">UTC day</option>
          </Select></Field>
        </div>
        <Text size={200} className={styles.muted}>{dimension === "date" ? "Ordered by UTC date." : "Ranked by the sum of the two consumption columns within this report only."} Environment and resource IDs are retained for future joins; names are labels, not tenant-wide keys.</Text>
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Consumption breakdown scroll area">
          <table className={mergeClasses(styles.table, styles.reportTable)}>
            <caption>Filtered {schema.label.toLowerCase()} consumption / {data.groups.length} groups</caption>
            <thead><tr><th>Group</th><th>{schema.firstLabel}</th><th>{schema.secondLabel}</th><th>Combined credits</th><th>Rows</th></tr></thead>
            <tbody>{data.groups.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((group) => <tr key={group.key}>
              <td><Text weight="semibold">{group.label}</Text>{group.detail && <div className={styles.muted}>{group.detail}</div>}</td>
              <td>{amount(group.first)}</td><td>{amount(group.second)}</td><td>{amount(group.total)}</td><td>{group.rows}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className={styles.row}>
          <Button disabled={!page} onClick={() => setPage(page - 1)}>Previous groups</Button>
          <Text>Page {page + 1} of {Math.ceil(data.groups.length / PAGE_SIZE)}</Text>
          <Button disabled={(page + 1) * PAGE_SIZE >= data.groups.length} onClick={() => setPage(page + 1)}>Next groups</Button>
        </div>
      </>}
      <details>
        <summary>Inspect all report columns ({data.rows.length} filtered rows)</summary>
        <Text size={200} className={styles.muted}>Original cell values, including additional columns not used by the charts. Download original file retains every row and byte, regardless of filters.</Text>
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Original report columns scroll area">
          <table className={styles.table}>
            <caption>Original Daily report rows</caption>
            <thead><tr>{report.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>{data.rows.slice(rawPage * PAGE_SIZE, (rawPage + 1) * PAGE_SIZE).map((row, index) => <tr key={`${rawPage}:${index}`}>
              {report.columns.map((column) => <td key={column}>{row.cells[column] || "Not reported"}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
        <div className={styles.row}>
          <Button disabled={!rawPage} onClick={() => setRawPage(rawPage - 1)}>Previous rows</Button>
          <Text>Page {rawPage + 1} of {Math.max(1, Math.ceil(data.rows.length / PAGE_SIZE))}</Text>
          <Button disabled={(rawPage + 1) * PAGE_SIZE >= data.rows.length} onClick={() => setRawPage(rawPage + 1)}>Next rows</Button>
        </div>
      </details>
    </>}
  </div>;
}
