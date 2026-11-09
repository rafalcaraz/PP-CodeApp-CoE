import { useState } from "react";
import { Button, Field, Input, Select, Text, tokens } from "@fluentui/react-components";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ErrorPane, LoadingPane } from "../../components/Status";
import { dayAfter, previousUtcDay } from "../../shared/cost-controls/wave2";
import { Diagnostics } from "./Diagnostics";
import { numberText } from "./domain";
import { getDailyUsage, type UsageDimension, type UsagePage, type UsageRow } from "./usageData";
import { useCostRead } from "./useCostRead";
import { useCostStyles } from "./styles";

export function ConsumptionChart({ rows, label }: { rows: UsageRow[]; label: string }) {
  const styles = useCostStyles();
  const chartRows = rows.filter((row) => row.unit === "copilotCredit" && Number.isFinite(row.consumedQuantity));
  if (!chartRows.length) return null;
  return <div className={styles.chart} role="img" aria-label={label}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartRows} layout="vertical" margin={{ left: 16, right: 24, top: 8, bottom: 8 }} accessibilityLayer>
        <CartesianGrid stroke={tokens.colorNeutralStroke2} horizontal={false} />
        <XAxis type="number" /><YAxis type="category" dataKey="entityId" width={130} tickFormatter={(value: string) => value?.length > 18 ? `${value.slice(0, 15)}...` : value} />
        <Tooltip formatter={(value) => [`${value} Copilot Credits`]} />
        <Bar dataKey="consumedQuantity" name="Consumed credits" fill={tokens.colorBrandBackground} />
      </BarChart>
    </ResponsiveContainer>
  </div>;
}

export function UsageReporting({ onInvestigate }: { onInvestigate: (userId: string, day: string) => void }) {
  const styles = useCostStyles();
  const [dimension, setDimension] = useState<UsageDimension>("services");
  const [day, setDay] = useState(previousUtcDay);
  const read = useCostRead<UsagePage>();
  const result = read.response;

  function load() {
    const snapshot = { day, dimension };
    void read.load(`MAC daily ${snapshot.dimension} · ${snapshot.day} UTC`, () => getDailyUsage(snapshot.dimension, snapshot.day));
  }
  // The result label owns the period. Editable controls describe the next request.
  const resultDay = result?.data.day;
  const resultDimension = result?.data.dimension;
  const unchanged = result?.label === `MAC daily ${dimension} · ${day} UTC`;
  return <section className={styles.panel} aria-labelledby="usage-title">
    <Text as="h2" id="usage-title" size={500} weight="semibold">Daily credit usage</Text>
    <Text className={styles.muted}>One completed UTC day, ranked by consumed credits. MAC reports service categories, users or groups, not individual agents or currency spend.</Text>
    <form className={styles.row} onSubmit={(event) => { event.preventDefault(); load(); }}>
      <Field label="Report dimension"><Select value={dimension} onChange={(_, data) => { if (data.value === "users" || data.value === "groups" || data.value === "services") setDimension(data.value); }}>
        <option value="services">Services</option><option value="users">Users</option><option value="groups">Groups</option>
      </Select></Field>
      <Field label="UTC day" hint="Start inclusive; next midnight exclusive. Current and future days are unavailable.">
        <Input type="date" value={day} max={previousUtcDay()} onChange={(_, data) => setDay(data.value)} />
      </Field>
      <Button appearance="primary" type="submit" disabled={read.busy || !day}>Load daily usage</Button>
      <Button disabled={read.busy || !day} onClick={() => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day))) setDay(new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10));
      }}>Previous day</Button>
      <Button disabled={read.busy || !day || day >= previousUtcDay()} onClick={() => { if (day) setDay(dayAfter(day)); }}>Next day</Button>
    </form>
    {read.busy && <LoadingPane label="Loading daily usage..." />}
    {read.error && <ErrorPane title="Daily usage unavailable" message={`${read.error} A missing or unavailable source is not zero usage.`} />}
    {result ? <>
      <Text weight="semibold" role="status">{result.label}{!unchanged ? " — previous loaded result; controls have not been applied." : ""}</Text>
      {read.error && <Text className={styles.warning}>The refresh failed. The previous successful result remains below with its original period.</Text>}
      <Text>{result.data.value.length} loaded rows{result.data.count === undefined ? "; total count not reported" : `; server count ${numberText(result.data.count)}`}. Requested top 100; this is a ranking, not a tenant consumption total.</Text>
      <Text className={result.data.nextLink ? styles.warning : styles.muted}>{result.data.nextLink
        ? "Partial page: more rows exist. This SDK cannot replay the server's nextLink; complete reporting is unavailable."
        : "No continuation was supplied for this selection. Paging is not snapshot-consistent; no cross-dimension totals are inferred."}</Text>
      {!result.data.value.length ? <Text>No rows were returned for this MAC selection. This does not establish zero tenant consumption or PPAC coverage.</Text> : <>
        <ConsumptionChart rows={result.data.value.slice(0, 10)} label="Copilot Credit values among the first ten loaded ranking rows. Exact values are in the table." />
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Daily usage table scroll area"><table className={styles.table}>
          <caption>{result.label} — loaded ranking</caption>
          <thead><tr><th>{resultDimension === "users" ? "User ID" : resultDimension === "groups" ? "Group ID" : "Service"}</th><th>Consumed</th><th>Unit</th>{resultDimension !== "services" && <th>Sessions</th>}{resultDimension === "users" && <th>Investigate</th>}</tr></thead>
          <tbody>{result.data.value.map((row, i) => <tr key={`${row.entityId}:${i}`}>
            <td>{row.entityId ?? "Not reported"}</td><td>{numberText(row.consumedQuantity)}</td><td>{row.unit ?? "Not reported"}</td>
            {resultDimension !== "services" && <td>{numberText(row.sessionCount)}</td>}
            {resultDimension === "users" && <td><Button disabled={!row.entityId || !resultDay} onClick={() => { if (row.entityId && resultDay) onInvestigate(row.entityId, resultDay); }}>Investigate user</Button></td>}
          </tr>)}</tbody>
        </table></div>
      </>}
    </> : !read.busy && <Text>Choose a day and load a report. Nothing is inferred from current balances.</Text>}
    {read.attempt && <Diagnostics label="Inspect daily usage SDK response" data={read.attempt} />}
  </section>;
}
