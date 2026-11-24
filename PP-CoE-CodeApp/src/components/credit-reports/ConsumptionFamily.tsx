import { useMemo, useState } from "react";
import { Button, Text, tokens } from "@fluentui/react-components";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  consumptionTimeline, creditAmount, filterConsumptionRows, metricValue, totalConsumption,
  type ConsumptionBucket, type ConsumptionFilter, type ConsumptionInventory, type ConsumptionMetric, type ConsumptionRow,
} from "../../shared/credit-reports";
import { useCreditStyles as useCostStyles } from "./styles";

const colors = [tokens.colorBrandBackground, tokens.colorPalettePurpleForeground2, tokens.colorPaletteTealForeground2,
  tokens.colorPaletteMarigoldForeground1, tokens.colorPaletteBerryForeground2, tokens.colorPaletteBlueForeground2];

export function ConsumptionFamily({ rows, inventory, family, buckets, metric, onDrill, compact = false }: {
  rows: readonly ConsumptionRow[]; inventory?: ConsumptionInventory; family: string;
  buckets: readonly ConsumptionBucket[]; metric: ConsumptionMetric; onDrill: (patch: ConsumptionFilter) => void; compact?: boolean;
}) {
  const styles = useCostStyles();
  const [page, setPage] = useState(0);
  const environments = useMemo(() => {
    const ids = new Set(rows.filter((row) => row.schemaName === family).map((row) => row.source.environmentId).filter((id): id is string => !!id));
    for (const agent of inventory?.agents ?? []) if (agent.schemaName.toLowerCase() === family) ids.add(agent.environmentId);
    return [...ids].map((id) => ({
      id, name: rows.find((row) => row.source.environmentId === id)?.environmentName
        || inventory?.environments.find((env) => env.id === id)?.name || id,
    }));
  }, [rows, inventory, family]);
  const matrix = useMemo(() => environments.map((env) => {
    const envRows = filterConsumptionRows(rows, { family, environmentId: env.id });
    const values = consumptionTimeline(envRows, rows.map((row) => row.source), buckets.length
      ? { startDate: buckets[0].key, endDate: buckets[buckets.length - 1].key } : null, "month");
    // The main monthly buckets define the columns, including unreported months.
    return { env, total: envRows.length ? metricValue(totalConsumption(envRows), metric) : null,
      values: new Map(values.map((bucket) => [bucket.key, bucket.total === null ? null : metricValue({
        first: bucket.first ?? 0, second: bucket.second ?? 0, total: bucket.total,
      }, metric)])) };
  }), [environments, rows, family, buckets, metric]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matrix.length / 25) - 1));
  const visible = matrix.slice(currentPage * 25, (currentPage + 1) * 25);
  const data = buckets.map((bucket) => Object.fromEntries([
    ["label", `${bucket.label}${bucket.partial ? " *" : ""}`],
    ...matrix.map((row, i) => [`env${i}`, row.values.get(bucket.key) ?? null]),
  ]));
  const chartEnvironments = matrix.slice(0, 6);
  return <section className={styles.list} aria-label="Agent family timeline">
    {compact ? <Text size={200} className={styles.muted}>{family} · Current schema matches{matrix.length > 6 ? " · First six environments charted" : ""}</Text>
      : <><Text as="h3" size={400} weight="semibold">Matching schema deployments: {family}</Text>
        <Text className={styles.coverage}>Candidates matched by exact schema name after environment ID + resource ID inventory matching. This is not a verified ALM pipeline. Current identity and environment metadata are applied to historical usage. No reported activity does not prove a deployment was absent.</Text>
        <Text size={200} className={styles.muted}>Monthly grouped columns compare environments using the selected metric. {matrix.length > 6 ? "The chart shows the first six environments; the matrix includes all." : ""} * means partial report-day coverage.</Text></>}
    <div className={styles.chart} role="img" aria-label="Monthly consumption by matching schema environment; all values are in the activity matrix">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} accessibilityLayer><CartesianGrid stroke={tokens.colorNeutralStroke2} vertical={false} />
          <XAxis dataKey="label" /><YAxis /><Tooltip formatter={(value) => [`${creditAmount(typeof value === "number" ? value : null)} credits`]} /><Legend />
          {chartEnvironments.map((row, i) => <Bar key={row.env.id} dataKey={`env${i}`} name={row.env.name} fill={colors[i]} isAnimationActive={false} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
    <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Agent family activity matrix scroll area">
      <table className={styles.table}><caption>Monthly reported activity by environment</caption>
        <thead><tr><th>Environment</th><th>Selected metric total</th>{buckets.map((bucket) => <th key={bucket.key}>{bucket.label}{bucket.partial ? " *" : ""}</th>)}</tr></thead>
        <tbody>{visible.map((row) => <tr key={row.env.id}><th>{row.env.name}</th><td>{creditAmount(row.total)}</td>
          {buckets.map((bucket) => <td key={bucket.key}>{row.values.get(bucket.key) == null ? "No reported activity" :
            <Button appearance="subtle" onClick={() => onDrill({
              family, environmentId: row.env.id, startDate: bucket.key,
              endDate: new Date(Date.UTC(Number(bucket.key.slice(0, 4)), Number(bucket.key.slice(5, 7)), 0)).toISOString().slice(0, 10),
            })}>{creditAmount(row.values.get(bucket.key) ?? null)}</Button>}</td>)}</tr>)}</tbody>
      </table>
    </div>
    <div className={styles.row}><Button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous family environments</Button>
      <Text>Page {currentPage + 1} of {Math.max(1, Math.ceil(matrix.length / 25))}</Text>
      <Button disabled={(currentPage + 1) * 25 >= matrix.length} onClick={() => setPage(currentPage + 1)}>Next family environments</Button></div>
  </section>;
}
