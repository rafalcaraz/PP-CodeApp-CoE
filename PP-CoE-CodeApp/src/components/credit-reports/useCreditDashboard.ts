import { useEffect, useMemo, useRef, useState } from "react";
import {
  consumptionRange, creditReportScopes, filterConsumptionRows, initializeCreditReportRetention,
  prepareConsumptionRows, reconcileCreditReports, useCreditReportCaptures,
  type ConsumptionFilter, type ConsumptionGrain, type ConsumptionInventory, type ConsumptionRow,
  type ReconciledCreditReport, type ReportRange, type ManagedAppConsumptionInventory,
} from "../../shared/credit-reports";
import { loadConsumptionInventory, loadManagedAppConsumptionInventory } from "../../data/dashboardCreditInventory";
import { formatApiError } from "../../shared/api-explorer/schema";

export interface CreditDashboardProjection {
  report?: ReconciledCreditReport;
  rows: readonly ConsumptionRow[];
  selected: readonly ConsumptionRow[];
  range: ReportRange | null;
  error?: string;
}
export interface CreditDashboardSource {
  resources: CreditDashboardProjection;
  funding: CreditDashboardProjection;
  filter: ConsumptionFilter;
  grain: ConsumptionGrain;
  inventory?: ConsumptionInventory;
  inventoryStatus: "idle" | "loading" | "ready" | "error";
  appInventory?: ManagedAppConsumptionInventory;
  appInventoryStatus: "idle" | "loading" | "ready" | "error";
  change: (patch: Partial<ConsumptionFilter>) => void;
}
function projection(report: ReconciledCreditReport | undefined, filter: ConsumptionFilter, inventory?: ConsumptionInventory, appInventory?: ManagedAppConsumptionInventory): CreditDashboardProjection {
  try {
    const rows = prepareConsumptionRows(report?.rows ?? [], inventory, appInventory);
    return { report, rows, selected: filterConsumptionRows(rows, filter), range: consumptionRange(report?.rows ?? [], filter) };
  } catch (error) { return { report, rows: [], selected: [], range: null, error: formatApiError(error) }; }
}
export function useCreditDashboard(enabled = true) {
  const captures = useCreditReportCaptures();
  const [filter, setFilter] = useState<ConsumptionFilter>({});
  const [grain, setGrain] = useState<ConsumptionGrain>("month");
  const [resourceScope, setResourceScope] = useState(""), [fundingScope, setFundingScope] = useState("");
  const [matchedInventory, setInventory] = useState<{ scope: string; data: ConsumptionInventory }>();
  const [matchedApps, setApps] = useState<{ scope: string; data: ManagedAppConsumptionInventory }>();
  const [matching, setMatching] = useState(false), [matchError, setMatchError] = useState("");
  const [matchingKind, setMatchingKind] = useState<"agents" | "apps">("agents"), [appMatchError, setAppMatchError] = useState("");
  const [confirmedScope, setConfirmedScope] = useState<string>();
  const controller = useRef<AbortController | null>(null);
  const resourceScopes = useMemo(() => creditReportScopes(captures, "FeatureDetailsPerResource"), [captures]);
  const fundingScopes = useMemo(() => creditReportScopes(captures, "BillingDetailsPerEnvironment"), [captures]);
  const selectedResourceScope = resourceScopes.find((scope) => scope.key === resourceScope)?.key || resourceScopes[0]?.key;
  const selectedFundingScope = fundingScopes.find((scope) => scope.key === fundingScope)?.key || fundingScopes[0]?.key;
  const inventory = matchedInventory?.scope === selectedResourceScope ? matchedInventory?.data : undefined;
  const appInventory = matchedApps?.scope === selectedResourceScope ? matchedApps?.data : undefined;
  const inventoryConfirmed = !!selectedResourceScope && confirmedScope === selectedResourceScope;
  const resourceReport = useMemo(() => selectedResourceScope
    ? reconcileCreditReports(captures, "FeatureDetailsPerResource", selectedResourceScope) : undefined, [captures, selectedResourceScope]);
  const fundingReport = useMemo(() => selectedFundingScope
    ? reconcileCreditReports(captures, "BillingDetailsPerEnvironment", selectedFundingScope) : undefined, [captures, selectedFundingScope]);
  const resources = useMemo(() => projection(resourceReport, filter, inventory, appInventory), [resourceReport, filter, inventory, appInventory]);
  // Only shared date/environment controls cross to funding; never feature/resource filters.
  const fundingFilter = useMemo(() => ({ startDate: filter.startDate, endDate: filter.endDate, environmentId: filter.environmentId }),
    [filter.startDate, filter.endDate, filter.environmentId]);
  const funding = useMemo(() => projection(fundingReport, fundingFilter), [fundingReport, fundingFilter]);
  useEffect(() => {
    if (enabled) void initializeCreditReportRetention();
    return () => controller.current?.abort();
  }, [enabled]);
  function change(patch: Partial<ConsumptionFilter>) { setFilter((filter) => ({ ...filter, ...patch })); }
  async function runMatch(kind: "agents" | "apps") {
    if (controller.current || !selectedResourceScope) return;
    const setError = kind === "agents" ? setMatchError : setAppMatchError;
    if (!inventoryConfirmed) { setError("Confirm that this report scope belongs to the connected inventory tenant before matching."); return; }
    const next = new AbortController(); controller.current = next;
    setMatchingKind(kind); setMatching(true); setError("");
    try {
      if (kind === "agents") {
        const result = await loadConsumptionInventory(next.signal);
        if (!next.signal.aborted) setInventory({ scope: selectedResourceScope, data: result });
      } else {
        const result = await loadManagedAppConsumptionInventory(next.signal);
        if (!next.signal.aborted) setApps({ scope: selectedResourceScope, data: result });
      }
    } catch (reason) { if (!next.signal.aborted) setError(formatApiError(reason)); }
    finally { if (controller.current === next) controller.current = null; if (!next.signal.aborted) setMatching(false); }
  }
  return {
    source: { resources, funding, filter, grain, inventory,
      inventoryStatus: matching && matchingKind === "agents" ? "loading" : inventory ? "ready" : matchError ? "error" : "idle",
      appInventory, appInventoryStatus: matching && matchingKind === "apps" ? "loading" : appInventory ? "ready" : appMatchError ? "error" : "idle", change } satisfies CreditDashboardSource,
    resourceScopes, fundingScopes, selectedResourceScope, selectedFundingScope,
    setResourceScope: (key: string) => {
      controller.current?.abort(); controller.current = null; setMatching(false); setMatchError("");
      setResourceScope(key); setInventory(undefined); setApps(undefined); setAppMatchError(""); setFilter({});
      setConfirmedScope(undefined);
    },
    setFundingScope, setGrain, reset: () => setFilter({}), matchInventory: () => runMatch("agents"),
    matchManagedApps: () => runMatch("apps"), matching: matching && matchingKind === "agents", appMatching: matching && matchingKind === "apps",
    busyMatching: matching, matchError, appMatchError,
    inventoryConfirmed, confirmInventory: (confirmed: boolean) => setConfirmedScope(confirmed ? selectedResourceScope : undefined),
  };
}
