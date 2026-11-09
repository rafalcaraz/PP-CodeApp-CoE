import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, Skeleton, SkeletonItem, Tab, TabList, Text, tokens } from "@fluentui/react-components";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TenantCreditBalance, UserBalance } from "../../generated/models/CostControsl_CustomConnModel";
import { ErrorPane } from "../../components/Status";
import { getTenantBalance, getUserBalance, type Result } from "./data";
import { freshness, numberText, quantityText } from "./domain";
import { useCostStyles } from "./styles";
import { Diagnostics } from "./Diagnostics";
import { UsageReporting } from "./UsageReporting";
import { FundingReporting } from "./FundingReporting";
import { UserInvestigation } from "./UserInvestigation";

export function Reporting() {
  const styles = useCostStyles();
  const [tab, setTab] = useState("usage");
  const [investigation, setInvestigation] = useState<{ userId: string; day: string }>();
  return <div className={styles.root}>
    <Text className={styles.coverage}>Source: Microsoft 365 admin center (MAC), via Graph beta. PPAC-managed Copilot Studio consumption is a separate source; it is not included or added to these reports. Missing source data is not zero.</Text>
    <TabList className={styles.tabs} aria-label="Reporting workflows" selectedValue={tab} onTabSelect={(_, data) => setTab(String(data.value))}>
      <Tab value="usage">Usage</Tab><Tab value="funding">Funding by month</Tab><Tab value="balances">Current balances</Tab><Tab value="investigation">User investigation</Tab>
    </TabList>
    {tab === "usage" && <UsageReporting onInvestigate={(userId, day) => { setInvestigation({ userId, day }); setTab("investigation"); }} />}
    {tab === "funding" && <FundingReporting />}
    {tab === "balances" && <CurrentBalances />}
    {tab === "investigation" && <UserInvestigation initial={investigation} />}
  </div>;
}

function CurrentBalances() {
  const styles = useCostStyles();
  const [tenant, setTenant] = useState<Result<TenantCreditBalance> | null>(null);
  const [busy, setBusy] = useState(false);
  const loading = useRef(false);
  const mounted = useRef(true);
  const [userId, setUserId] = useState("");
  const [userRun, setUserRun] = useState<{ id: string; result: Result<UserBalance> } | null>(null);
  const [userBusy, setUserBusy] = useState(false);
  const userLoading = useRef(false);

  async function refresh() {
    if (loading.current) return;
    loading.current = true;
    setBusy(true);
    const result = await getTenantBalance();
    if (mounted.current) { setTenant(result); setBusy(false); }
    loading.current = false;
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, []);

  async function diagnose() {
    if (userLoading.current || !userId.trim()) return;
    userLoading.current = true;
    setUserBusy(true);
    const id = userId.trim();
    const result = await getUserBalance(id);
    if (mounted.current) { setUserRun({ id, result }); setUserBusy(false); }
    userLoading.current = false;
  }

  const balances = tenant?.ok ? tenant.data.billingMethodBalances ?? [] : [];
  const creditRows = balances.filter((entry) => entry.unit === "copilotCredit");
  const chartRows = creditRows.map((entry) => ({
    method: entry.billingMethod ?? "Unspecified",
    consumed: Number.isFinite(entry.consumedQuantity) ? entry.consumedQuantity : undefined,
    remaining: Number.isFinite(entry.remainingQuantity) ? entry.remainingQuantity : undefined,
  }));
  const user = userRun?.result.ok ? userRun.result.data : undefined;
  const services = user?.serviceBalances ?? [];
  const userChartRows = services.filter((entry) => entry.unit === "copilotCredit" && Number.isFinite(entry.consumedQuantity))
    .map((entry) => ({ service: entry.serviceId ?? "Unspecified", consumed: entry.consumedQuantity }));

  return <div className={styles.root}>
    <section className={styles.panel} aria-labelledby="tenant-balance-title">
      <div className={styles.spread}>
        <div><Text as="h2" id="tenant-balance-title" size={500} weight="semibold">Tenant credit snapshot</Text>
          <Text as="p" className={styles.muted}>One balance per billing method. No currency conversion or inferred totals.</Text></div>
        <Button disabled={busy} onClick={() => void refresh()}>Refresh snapshot</Button>
      </div>
      {busy && <Skeleton aria-label="Loading tenant credit snapshot"><SkeletonItem size={32} /><SkeletonItem size={128} /></Skeleton>}
      {!busy && tenant && !tenant.ok && <ErrorPane title="Credit snapshot unavailable" message={tenant.error} />}
      {!busy && tenant?.ok && !balances.length && <Text>No billing-method balances were returned. This is not a reported zero balance. Check tenant entitlement and API availability.</Text>}
      {!busy && balances.length > 0 && <>
        {chartRows.some((row) => row.consumed !== undefined || row.remaining !== undefined) && <div className={styles.chart} role="img"
          aria-label="Consumed and remaining Copilot Credits by billing method. Exact values and source timestamps are in the table below.">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartRows} margin={{ left: 16, right: 16, top: 16, bottom: 8 }} accessibilityLayer>
              <CartesianGrid stroke={tokens.colorNeutralStroke2} vertical={false} />
              <XAxis dataKey="method" /><YAxis />
              <Tooltip formatter={(value) => [`${value} Copilot Credits`]} /><Legend />
              <Bar dataKey="consumed" name="Consumed credits" fill={tokens.colorBrandBackground} />
              <Bar dataKey="remaining" name="Remaining credits" fill={tokens.colorPaletteTealBackground2} />
            </BarChart>
          </ResponsiveContainer>
        </div>}
        <div className={styles.tableWrap}><table className={styles.table}>
          <caption>Authoritative billing-method balances</caption>
          <thead><tr><th>Billing method</th><th>Purchased</th><th>Consumed</th><th>Remaining</th><th>Unit</th><th>Source freshness</th></tr></thead>
          <tbody>{balances.map((entry, index) => <tr key={`${entry.billingMethod}:${index}`}>
            <td>{entry.billingMethod ?? "Not reported"}</td><td>{numberText(entry.purchasedQuantity)}</td>
            <td>{numberText(entry.consumedQuantity)}</td><td>{numberText(entry.remainingQuantity)}</td>
            <td>{entry.unit ?? "Not reported"}</td><td>{freshness(entry.dataStatus?.lastModifiedDateTime)}</td>
          </tr>)}</tbody>
        </table></div>
        <Text size={200} className={styles.muted}>Purchased or remaining quantities can be absent for pay-as-you-go. Remaining credits are calculated by the service, not purchased minus consumed. Charts include only reported copilotCredit values; missing values are not zero.</Text>
      </>}
      {!busy && tenant && <Diagnostics label="Inspect tenant snapshot SDK response" data={tenant.raw} />}
    </section>
    <section className={styles.panel} aria-labelledby="diagnostic-title">
      <Text as="h2" id="diagnostic-title" size={500} weight="semibold">Understand a user&apos;s consumption</Text>
      <Text>Look up one known directory user to see current-month service consumption, the selected policy and why access is allowed or blocked. No user-directory scan runs.</Text>
      <form className={styles.row} onSubmit={(event) => { event.preventDefault(); void diagnose(); }}>
        <Field label="Directory user ID" hint="Use the user's Microsoft Entra object ID.">
          <Input value={userId} disabled={userBusy} onChange={(_, data) => setUserId(data.value)} />
        </Field>
        <Button appearance="primary" type="submit" disabled={userBusy || !userId.trim()}>Check user consumption</Button>
      </form>
      {userBusy && <Skeleton aria-label="Loading user diagnostics"><SkeletonItem size={32} /><SkeletonItem size={64} /></Skeleton>}
      {!userBusy && userRun && <>
        <Text weight="semibold">Results for {userRun.id}</Text>
        {!userRun.result.ok && <ErrorPane title="User diagnostics unavailable" message={userRun.result.error} />}
        {user && <>
          <Text className={styles.muted}>
            Evaluated: {user.selectionDataStatus?.evaluatedDateTime ?? "Not reported"}.
            {" "}Usage as of: {user.selectionDataStatus?.usageAsOfDateTime ?? "Not reported"}.
            {" "}Policy as of: {user.selectionDataStatus?.policyConfigurationAsOfDateTime ?? "Not reported"}.
            {" "}Group membership as of: {user.selectionDataStatus?.groupMembershipAsOfDateTime ?? "Not reported"}.
          </Text>
          {!!user.unevaluatedServices?.length && <div className={styles.warning}>
            <Text weight="semibold">Partial results: some services could not be evaluated</Text>
            <ul>{user.unevaluatedServices.map((entry, index) => <li key={`${entry.serviceId}:${index}`}>{entry.serviceId ?? "Unknown service"}: {entry.reason ?? "Reason not reported"}</li>)}</ul>
            These are unavailable balances, not zero consumption.
          </div>}
          {!services.length && <Text>No evaluated service balances were returned. The user may have no consumption or no applicable policy; check the diagnostics above.</Text>}
          {!!userChartRows.length && <div className={styles.chart} role="img" aria-label="User's month-to-date consumed Copilot Credits by service. Exact values are in the table below.">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={userChartRows} margin={{ left: 16, right: 16, top: 16, bottom: 8 }} accessibilityLayer>
                <CartesianGrid stroke={tokens.colorNeutralStroke2} vertical={false} /><XAxis dataKey="service" /><YAxis />
                <Tooltip formatter={(value) => [`${value} Copilot Credits`]} />
                <Bar dataKey="consumed" name="Consumed credits" fill={tokens.colorBrandBackground} />
              </BarChart>
            </ResponsiveContainer>
          </div>}
          {!!services.length && <div className={styles.tableWrap}><table className={styles.table}>
            <caption>Month-to-date service balances (UTC calendar month)</caption>
            <thead><tr><th>Service</th><th>Consumed</th><th>Remaining</th><th>Per-user limit</th><th>Policy limit</th><th>Effective capacity</th><th>Access</th><th>Selected policy</th><th>Freshness</th></tr></thead>
            <tbody>{services.map((entry, index) => <tr key={`${entry.serviceId}:${index}`}>
              <td>{entry.serviceId ?? "Not reported"}</td><td>{numberText(entry.consumedQuantity)} {entry.unit}</td>
              <td>{quantityText(entry.remainingQuantity)}</td><td>{quantityText(entry.configuredPerUserLimit)}</td>
              <td>{quantityText(entry.configuredPeriodLimit)}</td><td>{quantityText(entry.effectiveCapacityQuantity)}</td>
              <td>{entry.isConsumptionAllowed === undefined ? "Not reported" : entry.isConsumptionAllowed ? "Allowed" : "Blocked"}: {entry.accessDecisionReason ?? "Reason not reported"}</td>
              <td>{entry.spendingPolicyId ?? "Not reported"}</td><td>{freshness(entry.dataStatus?.lastModifiedDateTime)}</td>
            </tr>)}</tbody>
          </table></div>}
          {user["serviceBalances@odata.nextLink"] && <Text className={styles.warning}>More user-service rows exist. This is a partial page; the connector has no supported continuation action.</Text>}
        </>}
        <Diagnostics label={`Inspect user ${userRun.id} SDK response`} data={userRun.result.raw} />
      </>}
    </section>
    <Text className={styles.muted}>These are current balances and eligibility diagnostics, not historical usage. Use Usage or User investigation for history. Currency spend, per-agent attribution and policy-consumption aggregation are not supplied. Reporting never makes changes.</Text>
  </div>;
}
