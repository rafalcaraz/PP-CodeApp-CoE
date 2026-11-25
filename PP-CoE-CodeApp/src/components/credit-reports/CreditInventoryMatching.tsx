import { useMemo } from "react";
import { Button, Checkbox, Spinner, Text } from "@fluentui/react-components";
import { ErrorPane } from "../Status";
import type { useCreditDashboard } from "./useCreditDashboard";
import { useCreditStyles } from "./styles";
import { MANAGED_APP_SCENARIO } from "../../shared/credit-reports";

export function CreditInventoryMatching({ dashboard, managedApps = false }: { dashboard: ReturnType<typeof useCreditDashboard>; managedApps?: boolean }) {
  const styles = useCreditStyles(), { source } = dashboard;
  const inventory = managedApps ? source.appInventory : source.inventory;
  const matching = managedApps ? dashboard.appMatching : dashboard.matching;
  const error = managedApps ? dashboard.appMatchError : dashboard.matchError;
  const counts = useMemo(() => {
    const resources = new Map(source.resources.rows.filter((row) => !managedApps || row.source.cells.ScenarioName?.trim() === MANAGED_APP_SCENARIO)
      .map((row) => [row.resourceKey, managedApps ? row.managedAppMatch : row.inventoryMatch]));
    const matched = [...resources.values()].filter((status) => status === "matched").length;
    return { matched, total: resources.size };
  }, [source.resources.rows, managedApps]);
  const scope = dashboard.resourceScopes.find((scope) => scope.key === dashboard.selectedResourceScope);
  return <section className={styles.list} aria-label={managedApps ? "Managed app inventory matching" : "Agent inventory matching"}>
    <div className={styles.row}><Text weight="semibold">{managedApps ? "Managed app inventory" : "Agent inventory"}</Text>
      {matching && <Spinner size="tiny" label="Matching report IDs..." />}
      {inventory && <Text size={200}>{counts.matched.toLocaleString()} of {counts.total.toLocaleString()} reported resource instances {managedApps ? "match current managed app inventory." : "have a matched agent schema."}</Text>}
    </div>
    {managedApps && <Text size={200}>AppStudio usage is reported together; building versus playing is not distinguished. Match environment ID + resource ID for current app names and environment groups.</Text>}
    {!managedApps && !inventory && !matching && <Text size={200}>Match environment ID + agent ID to resolve schema families. Matching has not completed; this does not mean your agents cannot be resolved.</Text>}
    {!dashboard.inventoryConfirmed && <div className={styles.list}>
      <Text size={200} className={styles.muted}>{scope?.label}</Text>
      <Checkbox label="This consumption scope belongs to the connected inventory tenant" checked={dashboard.inventoryConfirmed}
        onChange={(_, data) => dashboard.confirmInventory(data.checked === true)} />
    </div>}
    <Button className={styles.button} appearance={inventory ? "subtle" : "primary"}
      disabled={!dashboard.inventoryConfirmed || dashboard.busyMatching || !source.resources.report}
      onClick={() => void (managedApps ? dashboard.matchManagedApps() : dashboard.matchInventory())}>
      {managedApps ? inventory ? "Refresh managed app matching" : "Match managed apps to inventory" : inventory ? "Refresh agent matching" : "Match report resources to inventory"}
    </Button>
    {inventory && <Text size={200} className={styles.muted}>{managedApps
      ? "Names and group membership are current, not historical. Unmatched AppStudio resources stay in totals; an inventory miss does not prove that an app was deleted."
      : "Unmapped usage stays in totals and may include non-agent resources, agents no longer in inventory, missing schemas or conflicting identities. Current schema equality is a family candidate, not verified ALM lineage."}</Text>}
    {error && <ErrorPane title="Report inventory matching failed" message={error} />}
  </section>;
}
