import { useState } from "react";
import { Badge, Button, Checkbox, Field, Input, Select, Tab, TabList, Text } from "@fluentui/react-components";
import type { UpdateAlertSetting } from "../../generated/models/CostControsl_CustomConnModel";
import { ErrorPane } from "../../components/Status";
import { formatApiError } from "../../shared/api-explorer/schema";
import { concurrency, validateChange, type PolicyChange, type PolicyContext } from "./data";
import { freshness, quantityText } from "./domain";
import { PolicyForm } from "./PolicyForms";
import { Diagnostics } from "./Diagnostics";
import { useCostStyles } from "./styles";

export function PolicyDetails({ context, locked, onReview }: {
  context: PolicyContext;
  locked: boolean;
  onReview: (change: PolicyChange, title: string) => void;
}) {
  const styles = useCostStyles();
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [groupId, setGroupId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [userId, setUserId] = useState("");
  const [alertEnabled, setAlertEnabled] = useState(context.alerts.ok ? context.alerts.data.isEnabled === true : false);
  const [replaceThresholds, setReplaceThresholds] = useState(false);
  const [thresholdMode, setThresholdMode] = useState("percentage");
  const [thresholdValues, setThresholdValues] = useState("");
  const [error, setError] = useState("");
  const token = concurrency(context);
  const disabled = locked || !token.etag;
  const policy = context.policy.ok ? context.policy.data : undefined;
  const selectedGroups = policy?.["@odata.type"] === "#microsoft.graph.selectedGroupsSpendingPolicy";
  const groups = context.groups?.ok ? context.groups.data : undefined;
  const recipients = context.recipients.ok ? context.recipients.data : undefined;

  function review(change: PolicyChange, title: string) {
    try {
      validateChange(change, context);
      setError("");
      onReview(change, title);
    } catch (cause) {
      setError(formatApiError(cause));
    }
  }

  function reviewAlerts() {
    try {
      const body: UpdateAlertSetting = { isEnabled: alertEnabled };
      if (replaceThresholds) {
        const values = thresholdValues.trim() ? thresholdValues.split(",").map((entry) => {
          if (!entry.trim() || !Number.isFinite(Number(entry))) throw new Error("Enter comma-separated numeric thresholds, or leave empty to clear them.");
          return Number(entry);
        }) : [];
        body.thresholds = values.map((value) => thresholdMode === "percentage"
          ? { "@odata.type": "#microsoft.graph.percentageCostManagementAlertThreshold", value }
          : { "@odata.type": "#microsoft.graph.absoluteCostManagementAlertThreshold", value, unit: policy?.periodLimit?.unit });
      }
      review({ kind: "updateAlert", body }, "Save notification settings");
    } catch (cause) { setError(formatApiError(cause)); }
  }

  return <div className={styles.root}>
    <div className={styles.header}>
      <div className={styles.row}>
        <Text as="h2" size={600} weight="semibold">{policy?.displayName ?? context.id}</Text>
        <Badge color={policy?.status === "enabled" ? "success" : "informative"}>{policy?.status ?? "State unavailable"}</Badge>
      </div>
      <Text className={styles.muted}>Policy ID: {context.id}</Text>
      <Text className={styles.muted}>{selectedGroups ? "Selected directory groups" : policy?.["@odata.type"] === "#microsoft.graph.allUsersSpendingPolicy" ? "Everyone in the tenant" : "Audience unavailable"} &middot; {freshness(policy?.lastModifiedDateTime)}</Text>
    </div>
    {!context.policy.ok && <ErrorPane title="Policy unavailable" message={context.policy.error} />}
    {token.blocked && <Text role="status" className={styles.warning}>{token.blocked}</Text>}
    {token.etag && <Text size={200} className={styles.muted}>Concurrency protected: a parent ETag is available. It will be rechecked immediately before any write.</Text>}
    <TabList selectedValue={tab} onTabSelect={(_, data) => { setTab(String(data.value)); setError(""); }}>
      <Tab value="overview" disabled={locked}>Policy</Tab><Tab value="audience" disabled={locked}>Audience</Tab>
      <Tab value="services" disabled={locked}>Services</Tab><Tab value="alerts" disabled={locked}>Notifications</Tab>
    </TabList>
    {error && <ErrorPane title="Check this change" message={error} />}
    {tab === "overview" && policy && <section className={styles.panel} aria-label="Policy settings">
      {editing ? <PolicyForm policy={policy} locked={disabled} onCancel={() => setEditing(false)}
        onReview={(body) => review({ kind: "updatePolicy", body }, "Update policy limits and funding")} /> : <>
        <Text as="h3" size={500} weight="semibold">Limits and funding</Text>
        <dl>
          <dt>Monthly policy limit</dt><dd>{quantityText(policy.periodLimit)}</dd>
          <dt>Monthly per-user limit</dt><dd>{quantityText(policy.perUserLimit)}</dd>
          <dt>Billing methods</dt><dd>{policy.billingMethods ?? "Not reported"}</dd>
          <dt>Created</dt><dd>{policy.createdDateTime ?? "Not reported"}</dd>
        </dl>
        <Text className={styles.muted}>These are configured limits, not policy consumption. Limits reset monthly in UTC. The audience type and lifecycle state are managed by the service, not an editable status switch.</Text>
        <Button appearance="primary" disabled={disabled} onClick={() => setEditing(true)}>Edit limits and funding</Button>
      </>}
      <div className={styles.actions}>
        <Text as="h3" size={400} weight="semibold">Delete this policy</Text>
        <Text as="p">Deletion removes this policy. Recreating it gives a new policy ID and resets the new policy&apos;s accounting. There is no automatic undo.</Text>
        <Button disabled={disabled} onClick={() => review({ kind: "deletePolicy" }, "Delete spending policy")}>Review policy deletion</Button>
      </div>
    </section>}
    {tab === "audience" && <section className={styles.panel} aria-label="Policy audience">
      <Text as="h3" size={500} weight="semibold">{selectedGroups ? "Assigned directory groups" : "Tenant-wide audience"}</Text>
      {!selectedGroups ? <Text>This policy&apos;s audience cannot be changed here. An all-users policy applies tenant-wide; changing audience type requires deleting and recreating the policy.</Text> : <>
        {context.groups && !context.groups.ok && <ErrorPane title="Assigned groups unavailable" message={context.groups.error} />}
        {context.groups?.ok && <>
          {!context.groups.data.value?.length && <Text>No audience groups were returned. Link a group to satisfy the audience requirement of a disabled selected-group policy.</Text>}
          <div className={styles.list}>{context.groups.data.value?.map((group) => <div key={group.id ?? group.displayName} className={styles.spread}>
            <Text>{group.displayName ?? "Directory group"} &middot; {group.id ?? "ID not reported"}</Text>
            <Button disabled={disabled || !group.id || (!groups?.["@odata.nextLink"] && groups?.value?.length === 1)}
              onClick={() => review({ kind: "removeGroup", groupId: group.id! }, "Remove group from policy")}>Remove group</Button>
          </div>)}</div>
          {context.groups.data["@odata.nextLink"] && <Text className={styles.warning}>More assigned groups exist. Only the returned page is shown; this is not the full audience.</Text>}
        </>}
        <form className={styles.row} onSubmit={(event) => { event.preventDefault(); review({ kind: "addGroup", groupId: groupId.trim() }, "Add group to policy"); }}>
          <Field label="Directory group ID" hint="Use the Microsoft Entra object ID; no directory lookup is performed.">
            <Input value={groupId} disabled={disabled} onChange={(_, data) => setGroupId(data.value)} />
          </Field>
          <Button type="submit" disabled={disabled || !groupId.trim()}>Review group addition</Button>
        </form>
        <Text size={200} className={styles.muted}>The last assigned group cannot be removed. Removing a reference never deletes the directory group. Assignment permissions are separate from policy permissions.</Text>
      </>}
    </section>}
    {tab === "services" && <section className={styles.panel} aria-label="Policy services">
      <Text as="h3" size={500} weight="semibold">Governed service categories</Text>
      <Text>Enabled services are governed by this policy. Disabled services are excluded but remain listed; this API has no service-setting DELETE.</Text>
      {!context.services.ok && <ErrorPane title="Service settings unavailable" message={context.services.error} />}
      {context.services.ok && <>
        {!context.services.data.value?.length && <Text>No service settings were returned. A policy must retain at least one enabled service.</Text>}
        <div className={styles.list}>{context.services.data.value?.map((setting, index) => <div key={`${setting.serviceId}:${index}`} className={styles.spread}>
          <div><Text weight="semibold">{setting.serviceId ?? "Service not reported"}</Text> <Badge>{setting.state ?? "Unknown"}</Badge></div>
          <Button disabled={disabled || !setting.serviceId || !["enabled", "disabled"].includes(setting.state ?? "")}
            onClick={() => review({ kind: "updateService", serviceId: setting.serviceId!, state: setting.state === "enabled" ? "disabled" : "enabled" },
              setting.state === "enabled" ? "Exclude service from policy" : "Govern service with policy")}>
            {setting.state === "enabled" ? "Exclude service" : "Enable governance"}
          </Button>
        </div>)}</div>
        {context.services.data["@odata.nextLink"] && <Text className={styles.warning}>More service settings exist. This list is only one page.</Text>}
      </>}
      <form className={styles.row} onSubmit={(event) => { event.preventDefault(); review({ kind: "addService", serviceId: serviceId.trim(), state: "enabled" }, "Add governed service"); }}>
        <Field label="Service category ID" hint="Case-sensitive; for example cowork or workIQ, not an individual agent ID.">
          <Input value={serviceId} disabled={disabled} onChange={(_, data) => setServiceId(data.value)} />
        </Field>
        <Button type="submit" disabled={disabled || !serviceId.trim()}>Review service addition</Button>
      </form>
    </section>}
    {tab === "alerts" && <>
      <section className={styles.panel} aria-label="Notification settings">
        <Text as="h3" size={500} weight="semibold">Credit threshold notifications</Text>
        <Text>Notify-only email alerts do not increase limits or authorize consumption. Configure disabled, add recipient references, then enable.</Text>
        {!context.alerts.ok && <ErrorPane title="Alert configuration could not be read" message={`${context.alerts.error} A 404 may mean it has not been configured; a disabled configuration can be created with Save notification settings.`} />}
        {context.alerts.ok && <Text>Currently {context.alerts.data.isEnabled ? "enabled" : "disabled"}.
          {" "}Thresholds: {context.alerts.data.thresholds?.length ? context.alerts.data.thresholds.map((entry) =>
            `${entry.value}${entry["@odata.type"] === "#microsoft.graph.percentageCostManagementAlertThreshold" ? "%" : ` ${entry.unit ?? "unit not reported"}`}`).join(", ") : "None returned"}.</Text>}
        <Checkbox label="Enable email notifications" checked={alertEnabled} disabled={disabled}
          onChange={(_, data) => setAlertEnabled(data.checked === true)} />
        <Checkbox label="Replace configured thresholds" checked={replaceThresholds} disabled={disabled}
          onChange={(_, data) => setReplaceThresholds(data.checked === true)} />
        {replaceThresholds && <div className={styles.fields}>
          <Field label="Threshold type">
            <Select value={thresholdMode} disabled={disabled} onChange={(_, data) => setThresholdMode(data.value)}>
              <option value="percentage">Percentage of policy limit</option><option value="absolute">Absolute credits</option>
            </Select>
          </Field>
          <Field label={thresholdMode === "percentage" ? "Percentages (1-100)" : "Positive credit quantities"}
            hint="Comma separated. Empty clears all thresholds; unchecked replacement preserves current values.">
            <Input value={thresholdValues} disabled={disabled} onChange={(_, data) => setThresholdValues(data.value)} />
          </Field>
        </div>}
        <div className={styles.row}>
          <Button appearance="primary" disabled={disabled} onClick={reviewAlerts}>Save notification settings</Button>
          <Button disabled={disabled} onClick={() => review({ kind: "deleteAlert" }, "Remove alert configuration")}>Remove alert configuration</Button>
        </div>
        <Text size={200} className={styles.muted}>Removing the configuration turns alerts off but retains separately managed recipient references. Explicit null values are never sent.</Text>
      </section>
      <section className={styles.panel} aria-label="Alert recipients">
        <Text as="h3" size={500} weight="semibold">People to notify</Text>
        {!context.recipients.ok && <ErrorPane title="Recipients unavailable" message={context.recipients.error} />}
        {context.recipients.ok && <>
          {!context.recipients.data.value?.length && <Text>No recipients were returned. Add at least one before enabling notifications.</Text>}
          <div className={styles.list}>{context.recipients.data.value?.map((person, index) => <div key={`${person.id}:${index}`} className={styles.spread}>
            <Text>{person.displayName ?? person.userPrincipalName ?? "Directory user"} &middot; {person.id ?? "ID not reported"}</Text>
            <Button disabled={disabled || !person.id || (context.alerts.ok && context.alerts.data.isEnabled === true &&
              !recipients?.["@odata.nextLink"] && recipients?.value?.length === 1)}
              onClick={() => review({ kind: "removeRecipient", userId: person.id! }, "Remove alert recipient")}>Remove recipient</Button>
          </div>)}</div>
          {context.recipients.data["@odata.nextLink"] && <Text className={styles.warning}>More recipients exist. This list is a partial page.</Text>}
        </>}
        <Diagnostics label="Inspect current policy SDK responses" data={{
          policy: context.policy.raw, services: context.services.raw, groups: context.groups?.raw,
          alerts: context.alerts.raw, recipients: context.recipients.raw,
        }} />
        <form className={styles.row} onSubmit={(event) => { event.preventDefault(); review({ kind: "addRecipient", userId: userId.trim() }, "Add alert recipient"); }}>
          <Field label="Recipient directory user ID" hint="Must resolve to a real user in this tenant; email is resolved at send time.">
            <Input value={userId} disabled={disabled} onChange={(_, data) => setUserId(data.value)} />
          </Field>
          <Button type="submit" disabled={disabled || !userId.trim()}>Review recipient addition</Button>
        </form>
      </section>
    </>}
  </div>;
}
