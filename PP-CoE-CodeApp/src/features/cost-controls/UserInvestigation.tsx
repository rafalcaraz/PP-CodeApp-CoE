import { useState } from "react";
import { Button, Field, Input, Tab, TabList, Text, mergeClasses } from "@fluentui/react-components";
import { ErrorPane, LoadingPane } from "../../components/Status";
import { dayAfter, previousUtcDay } from "../../shared/cost-controls/wave2";
import { investigateUser, type UserInvestigation as Investigation } from "./usageData";
import { Diagnostics } from "./Diagnostics";
import { freshness, numberText } from "./domain";
import { useCostRead } from "./useCostRead";
import { useCostStyles } from "./styles";

export function UserInvestigation({ initial }: { initial?: { userId: string; day: string } }) {
  const styles = useCostStyles();
  const [userId, setUserId] = useState(initial?.userId ?? "");
  const day = initial?.day ?? previousUtcDay();
  const [start, setStart] = useState(`${day}T00:00:00Z`);
  const [end, setEnd] = useState(`${dayAfter(day)}T00:00:00Z`);
  const [tab, setTab] = useState("services");
  const read = useCostRead<Investigation>();
  const result = read.response;
  const detail = result?.data.detail;
  const services = result?.data.services;
  const sessions = result?.data.sessions;
  return <section className={styles.panel} aria-labelledby="investigation-title">
    <Text as="h2" id="investigation-title" size={500} weight="semibold">User investigation</Text>
    <Text>Raw billable-flagged usage for one known user. This does not change policy or eligibility; current access diagnostics are under Current balances.</Text>
    <form className={styles.form} onSubmit={(event) => {
      event.preventDefault();
      void read.load(`MAC raw detail · ${userId.trim()} · [${start}, ${end})`, () => investigateUser(userId, start, end));
    }}>
      <div className={styles.fields}>
        <Field label="Historical directory user ID"><Input value={userId} onChange={(_, data) => setUserId(data.value)} /></Field>
        <Field label="Start UTC timestamp (inclusive)"><Input value={start} onChange={(_, data) => setStart(data.value)} /></Field>
        <Field label="End UTC timestamp (exclusive)"><Input value={end} onChange={(_, data) => setEnd(data.value)} /></Field>
      </div>
      <Text size={200} className={styles.muted}>Use timestamps ending in Z. Maximum 24 hours; no future end or UTC month crossing except an exclusive end at next month midnight.</Text>
      <div><Button appearance="primary" type="submit" disabled={read.busy || !userId.trim()}>Load user usage</Button></div>
    </form>
    {read.busy && <LoadingPane label="Loading user usage detail, services and sessions..." />}
    {read.error && <ErrorPane title="User investigation unavailable" message={read.error} />}
    {result && <>
      <Text weight="semibold" role="status">{result.label}</Text>
      {read.error && <Text className={styles.warning}>Refresh failed; the previous result retains its original user and window.</Text>}
      <Text className={styles.warning}>Raw detail and processed daily reports need not reconcile. Session rows may omit activity without native session IDs and need not sum to the parent. IDs are not agent attribution.</Text>
      {detail && !detail.ok && <ErrorPane title="Raw detail unavailable" message={`${detail.error} A 404 or 503 is not zero usage or proof that this user exists.`} />}
      {detail?.ok && <dl className={styles.summary}>
        <dt>Consumed</dt><dd>{numberText(detail.data.consumedQuantity)} {detail.data.unit ?? "Unit not reported"}</dd>
        <dt>Sessions</dt><dd>{numberText(detail.data.sessionCount)}</dd>
        <dt>Source watermark</dt><dd>{freshness(detail.data.dataStatus?.latestSourceDateTime)} (not proof of completeness)</dd>
      </dl>}
      <TabList aria-label="Raw usage breakdown" selectedValue={tab} onTabSelect={(_, data) => setTab(String(data.value))}>
        <Tab value="services">Services</Tab><Tab value="sessions">Sessions</Tab>
      </TabList>
      {tab === "services" && <>
        {services && !services.ok && <ErrorPane title="Service detail unavailable" message={services.error} />}
        {services?.ok && (!services.data.value?.length ? <Text>No raw service rows were returned. Missing data is not zero.</Text> : <div className={styles.tableWrap}><table className={styles.table}>
          <caption>Raw service breakdown — unpaged, independently rounded</caption>
          <thead><tr><th>Service ID</th><th>Consumed</th><th>Unit</th></tr></thead>
          <tbody>{services.data.value.map((row, i) => <tr key={`${row.id}:${i}`}><td>{row.id ?? "Not reported"}</td><td>{numberText(row.consumedQuantity)}</td><td>{row.unit ?? "Not reported"}</td></tr>)}</tbody>
        </table></div>)}
      </>}
      {tab === "sessions" && <>
        {sessions && !sessions.ok && <ErrorPane title="Session detail unavailable" message={sessions.error} />}
        {sessions?.ok && <>
          {sessions.data["@odata.nextLink"] && <Text className={styles.warning}>Partial session page. The SDK cannot replay nextLink; this is not a complete session list.</Text>}
          {!sessions.data.value?.length ? <Text>No session rows were returned. Session-less activity can be omitted; this does not establish zero consumption.</Text> : <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Session table scroll area"><table className={mergeClasses(styles.table, styles.wideTable)}>
            <caption>Loaded raw sessions — window-scoped row IDs</caption>
            <thead><tr><th>Window row ID</th><th>Native source session ID</th><th>Consumed</th><th>Unit</th><th>First activity</th><th>Last activity</th></tr></thead>
            <tbody>{sessions.data.value.map((row, i) => <tr key={`${row.id}:${i}`}><td>{row.id ?? "Not reported"}</td><td>{row.sourceSessionId ?? "Not reported"}</td>
              <td>{numberText(row.consumedQuantity)}</td><td>{row.unit ?? "Not reported"}</td><td>{row.firstActivityDateTime ?? "Not reported"}</td><td>{row.lastActivityDateTime ?? "Not reported"}</td></tr>)}</tbody>
          </table></div>}
        </>}
      </>}
    </>}
    {read.attempt && <Diagnostics label="Inspect user usage SDK responses" data={read.attempt} />}
  </section>;
}
