import { useState } from "react";
import { Button, Checkbox, Field, Input, Select, Text } from "@fluentui/react-components";
import type { CreateSpendingPolicy, SpendingPolicy, UpdateSpendingPolicy } from "../../generated/models/CostControsl_CustomConnModel";
import { formatApiError } from "../../shared/api-explorer/schema";
import { makeQuantity } from "./domain";
import { useCostStyles } from "./styles";

export function PolicyForm({ policy, locked, onReview, onCancel }: {
  policy?: SpendingPolicy;
  locked: boolean;
  onReview: (body: CreateSpendingPolicy | UpdateSpendingPolicy) => void;
  onCancel: () => void;
}) {
  const styles = useCostStyles();
  const [name, setName] = useState(policy?.displayName ?? "");
  const [audience, setAudience] = useState<"allUsers" | "selectedGroups">("selectedGroups");
  const [period, setPeriod] = useState(policy?.periodLimit?.value?.toString() ?? "");
  const [perUser, setPerUser] = useState(policy?.perUserLimit?.value?.toString() ?? "");
  const [periodUnlimited, setPeriodUnlimited] = useState(policy?.periodLimit?.["@odata.type"] === "#microsoft.graph.unlimitedCostManagementQuantity");
  const [userUnlimited, setUserUnlimited] = useState(policy ? policy.perUserLimit?.["@odata.type"] === "#microsoft.graph.unlimitedCostManagementQuantity" : true);
  const [serviceId, setServiceId] = useState("");
  const [prepaid, setPrepaid] = useState(policy?.billingMethods?.split(",").includes("prepaidCredits") ?? false);
  const [payg, setPayg] = useState(policy?.billingMethods?.split(",").includes("payAsYouGo") ?? false);
  const [fundingChanged, setFundingChanged] = useState(false);
  const [error, setError] = useState("");
  const incompatibleUnits = policy && [policy.periodLimit, policy.perUserLimit].some((quantity) => quantity?.unit !== "copilotCredit");

  function submit() {
    try {
      if (incompatibleUnits) throw new Error("This policy uses an unsupported or unreported unit. Do not rewrite its limits here.");
      if (name.length < 10 || name.length > 64 || !/^[\p{L}\p{N} ]+$/u.test(name)) throw new Error("Use a 10-64 character name with letters, digits and spaces.");
      const body: UpdateSpendingPolicy = {
        displayName: name,
        periodLimit: makeQuantity(period, periodUnlimited),
        perUserLimit: makeQuantity(perUser, userUnlimited),
      };
      if (!policy || fundingChanged) body.billingMethods = [prepaid ? "prepaidCredits" : "", payg ? "payAsYouGo" : ""].filter(Boolean).join(",") || "notSpecified";
      if (policy) onReview(body);
      else {
        if (!serviceId.trim()) throw new Error("Enter an initial service category ID.");
        onReview({
          ...body, displayName: name, periodLimit: body.periodLimit!, perUserLimit: body.perUserLimit!,
          "@odata.type": audience === "allUsers" ? "#microsoft.graph.allUsersSpendingPolicy" : "#microsoft.graph.selectedGroupsSpendingPolicy",
          serviceSettings: [{ serviceId: serviceId.trim(), state: "enabled" }],
        });
      }
      setError("");
    } catch (cause) {
      setError(formatApiError(cause));
    }
  }

  return <form className={styles.form} onSubmit={(event) => { event.preventDefault(); submit(); }}>
    <Text as="h3" size={400} weight="semibold">{policy ? "Edit policy limits and funding" : "Create a spending policy"}</Text>
    {!policy && <Text>New policies start disabled. For selected groups, add the audience after creation. Creating a policy also requires the Billing Administrator or Global Administrator role.</Text>}
    <div className={styles.fields}>
      <Field label="Policy name" required hint="10-64 characters; letters, digits and spaces.">
        <Input value={name} disabled={locked} onChange={(_, data) => setName(data.value)} />
      </Field>
      {!policy && <Field label="Audience" required>
        <Select value={audience} disabled={locked} onChange={(_, data) => setAudience(data.value === "allUsers" ? "allUsers" : "selectedGroups")}>
          <option value="selectedGroups">Selected directory groups</option><option value="allUsers">Everyone in the tenant</option>
        </Select>
      </Field>}
      <div>
        <Field label="Monthly policy limit (Copilot Credits)" required={!periodUnlimited}>
          <Input value={period} disabled={locked || periodUnlimited} onChange={(_, data) => setPeriod(data.value)} />
        </Field>
        <Checkbox label="Unlimited policy credits" checked={periodUnlimited} disabled={locked} onChange={(_, data) => setPeriodUnlimited(data.checked === true)} />
      </div>
      <div>
        <Field label="Monthly per-user limit (Copilot Credits)" required={!userUnlimited}>
          <Input value={perUser} disabled={locked || userUnlimited} onChange={(_, data) => setPerUser(data.value)} />
        </Field>
        <Checkbox label="Unlimited per-user credits" checked={userUnlimited} disabled={locked} onChange={(_, data) => setUserUnlimited(data.checked === true)} />
      </div>
      {!policy && <Field label="Initial service category ID" required hint="For example cowork or workIQ; not an agent ID.">
        <Input value={serviceId} disabled={locked} onChange={(_, data) => setServiceId(data.value)} />
      </Field>}
    </div>
    <Text weight="semibold">Funding methods</Text>
    <div className={styles.row}>
      <Checkbox label="Prepaid credits" checked={prepaid} disabled={locked} onChange={(_, data) => { setPrepaid(data.checked === true); setFundingChanged(true); }} />
      <Checkbox label="Pay as you go" checked={payg} disabled={locked} onChange={(_, data) => { setPayg(data.checked === true); setFundingChanged(true); }} />
    </div>
    <Text size={200} className={styles.muted}>Both methods can be selected. Neither means not specified. Limits reset at the start of each UTC calendar month. Zero is a finite limit, not unlimited.</Text>
    {error && <Text role="alert" className={styles.warning}>{error}</Text>}
    {incompatibleUnits && <Text className={styles.warning}>Unsupported or unreported unit: editing limits is blocked to avoid changing their meaning.</Text>}
    <div className={styles.row}>
      <Button appearance="primary" type="submit" disabled={locked || Boolean(incompatibleUnits)}>Review policy</Button>
      <Button disabled={locked} onClick={onCancel}>Cancel editing</Button>
    </div>
  </form>;
}
