import { useState } from "react";
import { Button, Field, Input, Text } from "@fluentui/react-components";
import type { FundingUsageRecordCollection } from "../../generated/models/CostControsl_CustomConnModel";
import { ErrorPane, LoadingPane } from "../../components/Status";
import { Diagnostics } from "./Diagnostics";
import { freshness, numberText } from "./domain";
import { getFundingUsage } from "./usageData";
import { ConsumptionChart } from "./UsageReporting";
import { useCostRead } from "./useCostRead";
import { useCostStyles } from "./styles";

export function FundingReporting() {
  const styles = useCostStyles();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const read = useCostRead<FundingUsageRecordCollection>();
  const result = read.response;
  const rows = result?.data.value ?? [];
  return <section className={styles.panel} aria-labelledby="funding-title">
    <Text as="h2" id="funding-title" size={500} weight="semibold">Funding by month</Text>
    <Text>Historical MAC consumption by funding class. Overage means unbilled consumption, not an invoice or a currency amount.</Text>
    <form className={styles.row} onSubmit={(event) => { event.preventDefault(); void read.load(`MAC funding · ${month}`, () => getFundingUsage(month)); }}>
      <Field label="UTC calendar month"><Input type="month" value={month} onChange={(_, data) => setMonth(data.value)} /></Field>
      <Button appearance="primary" type="submit" disabled={read.busy || !month}>Load funding usage</Button>
    </form>
    {read.busy && <LoadingPane label="Loading funding usage..." />}
    {read.error && <ErrorPane title="Funding usage unavailable" message={`${read.error} Missing data is not zero consumption.`} />}
    {result && <>
      <Text weight="semibold" role="status">{result.label}{result.label !== `MAC funding · ${month}` ? " — controls have not been applied." : ""}</Text>
      {read.error && <Text className={styles.warning}>Refresh failed; showing the previous successful period.</Text>}
      <Text className={styles.muted}>Unpaged funding-class collection. Source freshness is a snapshot synchronization time, not evidence that the month is closed or complete.</Text>
      {!rows.length ? <Text>No funding-class rows were returned for this month. This is not a reported zero.</Text> : <>
        <ConsumptionChart rows={rows.map((row) => ({ ...row, entityId: row.fundingClass ?? row.id }))} label="Reported MAC funding classes in Copilot Credits. Exact values and freshness are in the table." />
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Funding table scroll area"><table className={styles.table}>
          <caption>{result.label} — reported funding classes</caption>
          <thead><tr><th>Funding class</th><th>Consumed</th><th>Unit</th><th>Source watermark</th></tr></thead>
          <tbody>{rows.map((row, i) => <tr key={`${row.id}:${i}`}><td>{row.fundingClass ?? row.id ?? "Not reported"}{row.fundingClass === "overage" ? " (unbilled)" : ""}</td>
            <td>{numberText(row.consumedQuantity)}</td><td>{row.unit ?? "Not reported"}</td><td>{freshness(row.dataStatus?.latestSourceDateTime)}</td></tr>)}</tbody>
        </table></div>
      </>}
    </>}
    {read.attempt && <Diagnostics label="Inspect funding usage SDK response" data={read.attempt} />}
  </section>;
}
