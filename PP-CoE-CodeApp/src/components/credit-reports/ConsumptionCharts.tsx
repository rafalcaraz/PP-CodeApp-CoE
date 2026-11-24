import { useId } from "react";
import { Text, tokens } from "@fluentui/react-components";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { creditAmount, creditLabels, type ConsumptionBucket, type ConsumptionMetric, type ConsumptionTotal } from "../../shared/credit-reports";
import { useCreditStyles as useCostStyles } from "./styles";

export function ConsumptionLine({ buckets, metric, funding, rolling = false }: {
  buckets: readonly ConsumptionBucket[]; metric: ConsumptionMetric; funding: boolean; rolling?: boolean;
}) {
  const styles = useCostStyles(), labels = creditLabels(funding);
  const key = metric === "billed" ? "first" : metric === "nonbilled" ? "second" : "total";
  const label = metric === "billed" ? labels.first : metric === "nonbilled" ? labels.second : "Reported credits";
  return <section className={styles.list} aria-label={rolling ? "Rolling 30-day credit trend" : "Credit line trend"}>
    <div className={styles.chart} role="img" aria-label={`${label} over UTC dates; values and coverage below`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={buckets.map((bucket) => ({ ...bucket, label: `${bucket.label}${bucket.partial ? " *" : ""}` }))}
          margin={{ left: 8, right: 16, bottom: 8, top: 8 }} accessibilityLayer>
          <CartesianGrid stroke={tokens.colorNeutralStroke2} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" minTickGap={24} tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} />
          <Tooltip formatter={(value) => [`${creditAmount(typeof value === "number" ? value : null)} credits`, label]} />
          <Line dataKey={key} name={label} type="linear" stroke={tokens.colorBrandForeground1} strokeWidth={2}
            connectNulls={false} dot={buckets.length <= 90 ? { r: 3 } : false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
    {rolling && <Text size={200} className={styles.muted}>Observed credits in the trailing 30 calendar days, including each UTC date. * marks incomplete report-day coverage.</Text>}
    <details><summary>View values and coverage</summary>
      <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Credit line values scroll area">
        <table className={styles.table}><caption>{rolling ? "Rolling 30-day credits" : "Credit line values"}</caption>
          <thead><tr><th>{rolling ? "Window (UTC)" : "Period (UTC)"}</th><th>{labels.first}</th><th>{labels.second}</th><th>Total credits</th><th>Reported / calendar days</th></tr></thead>
          <tbody>{buckets.map((bucket) => <tr key={bucket.key}>
            <td>{bucket.windowStart ? `${bucket.windowStart} - ${bucket.key}` : bucket.label}{bucket.partial ? " (partial)" : ""}</td>
            <td>{creditAmount(bucket.first)}</td><td>{creditAmount(bucket.second)}</td><td>{creditAmount(bucket.total)}</td><td>{bucket.reportedDays} / {bucket.calendarDays}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  </section>;
}

export function ConsumptionTrend({ buckets, metric, funding, share = false, compact = false }: {
  buckets: readonly ConsumptionBucket[]; metric: ConsumptionMetric; funding: boolean; share?: boolean; compact?: boolean;
}) {
  const styles = useCostStyles(), id = useId(), labels = creditLabels(funding);
  const chartRows = buckets.map((bucket) => ({
    ...bucket, label: `${bucket.label}${bucket.partial ? " *" : ""}`,
    first: share && bucket.first !== null && bucket.total !== null ? bucket.total > 0 ? bucket.first / bucket.total * 100 : null : bucket.first,
    second: share && bucket.second !== null && bucket.total !== null ? bucket.total > 0 ? bucket.second / bucket.total * 100 : null : bucket.second,
  }));
  return <section className={styles.list} aria-labelledby={compact ? undefined : id} aria-label={compact ? "Credit consumption trend" : undefined}>
    {!compact && <Text as="h3" id={id} size={400} weight="semibold">{share ? "Consumption mix over time" : "Consumption over time"}</Text>}
    {!compact && <Text size={200} className={styles.muted}>UTC periods. * marks partial report-day coverage, not a complete month/week. Gaps and missing resource activity are not filled with zero. Display values are rounded; originals retain full precision.</Text>}
    <div className={styles.chart} role="img" aria-label="Consumption timeline; values and period coverage follow in the table">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartRows} stackOffset="sign" margin={{ left: 8, right: 16, bottom: 8, top: 8 }} accessibilityLayer>
          <CartesianGrid stroke={tokens.colorNeutralStroke2} strokeDasharray={compact ? "3 3" : undefined} vertical={false} />
          <XAxis dataKey="label" minTickGap={24} tick={{ fontSize: compact ? 11 : 12 }} /><YAxis tick={{ fontSize: compact ? 11 : 12 }} domain={share ? [0, 100] : undefined} unit={share ? "%" : undefined} />
          <Tooltip formatter={(value) => [`${creditAmount(typeof value === "number" ? value : null)}${share ? "%" : " credits"}`]} />
          <Legend wrapperStyle={compact ? { fontSize: 11 } : undefined} />
          {metric !== "nonbilled" && <Bar dataKey="first" name={compact ? funding ? "Capacity pack" : "Billed" : labels.first} stackId="credits" fill={tokens.colorBrandBackground} isAnimationActive={false} />}
          {metric !== "billed" && <Bar dataKey="second" name={compact ? funding ? "PAYG" : "Nonbilled" : labels.second} stackId="credits" fill={tokens.colorPalettePurpleForeground2} isAnimationActive={false} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
    <details><summary>{compact ? "View values and coverage" : "Timeline values and coverage"}</summary>
      {compact && <Text size={200} className={styles.muted}>* Partial report-day coverage. Missing activity is not zero. UTC dates; values rounded for display.</Text>}
      <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Timeline values scroll area">
        <table className={styles.table}><caption>Consumption timeline in credits</caption>
          <thead><tr><th>Period</th><th>{labels.first}</th><th>{labels.second}</th><th>Reported / calendar days</th></tr></thead>
          <tbody>{buckets.map((bucket) => <tr key={bucket.key}><td>{bucket.label}{bucket.partial ? " (partial)" : ""}</td>
            <td>{creditAmount(bucket.first)}</td><td>{creditAmount(bucket.second)}</td><td>{bucket.reportedDays} / {bucket.calendarDays}</td></tr>)}</tbody>
        </table>
      </div>
    </details>
  </section>;
}

export function ConsumptionRanking({ groups, metric, funding, onSelect, compact = false }: {
  groups: readonly ConsumptionTotal[]; metric: ConsumptionMetric; funding: boolean; onSelect: (group: ConsumptionTotal) => void; compact?: boolean;
}) {
  const styles = useCostStyles(), labels = creditLabels(funding);
  return <div className={compact ? styles.chartHost : styles.rankingChart} role="img" aria-label="Ranked credit consumption; select a bar or open values to drill down">
    <ResponsiveContainer width="100%" height={compact ? Math.max(220, groups.length * 36 + 48) : "100%"}>
      <BarChart data={[...groups]} stackOffset="sign" layout="vertical" margin={{ left: 8, right: 24 }} accessibilityLayer>
        <CartesianGrid stroke={tokens.colorNeutralStroke2} strokeDasharray={compact ? "3 3" : undefined} horizontal={false} />
        <XAxis type="number" tick={{ fontSize: compact ? 11 : 12 }} /><YAxis type="category" dataKey="label" width={compact ? 130 : 150} tick={{ fontSize: compact ? 11 : 12 }} tickFormatter={(value: string) => value.length > 23 ? `${value.slice(0, 22)}...` : value} />
        <Tooltip formatter={(value) => [`${creditAmount(typeof value === "number" ? value : null)} credits`]} /><Legend wrapperStyle={compact ? { fontSize: 11 } : undefined} />
        {metric !== "nonbilled" && <Bar dataKey="first" name={compact ? funding ? "Capacity pack" : "Billed" : labels.first} stackId="credits" fill={tokens.colorBrandBackground}
          isAnimationActive={false} onClick={(_, index) => { if (groups[index]) onSelect(groups[index]); }} />}
        {metric !== "billed" && <Bar dataKey="second" name={compact ? funding ? "PAYG" : "Nonbilled" : labels.second} stackId="credits" fill={tokens.colorPalettePurpleForeground2}
          isAnimationActive={false} onClick={(_, index) => { if (groups[index]) onSelect(groups[index]); }} />}
      </BarChart>
    </ResponsiveContainer>
  </div>;
}
