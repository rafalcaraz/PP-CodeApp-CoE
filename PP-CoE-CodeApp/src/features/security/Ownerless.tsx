/**
 * Ownerless Resources — Stage 1 + 2.
 *
 * Walks tenant inventory, buckets each distinct owner GUID by its
 * `aaduser` lookup result (owner-health), and lets the user drill
 * into the affected resources per owner.
 *
 * Service-principal disambiguation is intentionally NOT attempted —
 * Microsoft does not expose a Dataverse virtual table for service
 * principals (only `aaduser` and `aadgroup` exist), so any GUID that
 * misses on `aaduser` is surfaced in the `unresolved` bucket with
 * UI copy that explicitly calls out the ambiguity. Users disambiguate
 * via the Entra portal. See `docs/inventory-schema-samples.md`.
 *
 * The actual scan runs on a module-level singleton controller in
 * `_ownerless/ownerScanController.ts` so it survives route changes
 * (the user explicitly asked for "doesn't cancel if I go away").
 * This component only renders and dispatches; it owns no scan state.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Link,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  Tab,
  TabList,
  Text,
  Tooltip,
  makeStyles,
  tokens,
  type SelectTabData,
  type SelectTabEvent,
} from "@fluentui/react-components";
import {
  ArrowClockwiseRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  DeleteRegular,
  DismissRegular,
  OpenRegular,
  PersonAccountsRegular,
  PersonAvailableRegular,
  PersonProhibitedRegular,
  PersonQuestionMarkRegular,
  PlayRegular,
  BotRegular,
  SettingsRegular,
} from "@fluentui/react-icons";
import { useNavigate } from "react-router-dom";

import { UserChip } from "../../components/UserChip";
import { friendlyResourceType } from "../../data/inventory";
import { fetchServicePrincipalOwners, type ServicePrincipalOwner } from "../../data/spnEnrichment";
import {
  cancelScan,
  clearLastSnapshot,
  startScan,
} from "./_ownerless/ownerScanController";
import {
  useOwnerScanProgress,
  useOwnerScanResult,
} from "./_ownerless/useOwnerScan";
import {
  OWNER_BUCKETS,
  type OwnerBucket,
  type OwnerEntry,
  type ScanProgress,
} from "./_ownerless/types";
import {
  bucketDescription,
  bucketLabel,
  detailPathFor,
  formatElapsed,
  formatRelative,
  formatTypeBreakdown,
  spKindBadgeColor,
  spKindLabel,
} from "./_ownerless/format";

// ─── Styles ──────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  subtitle: {
    color: tokens.colorNeutralForeground3,
    maxWidth: "70ch",
  },
  actionBar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
  },
  spacer: { flex: 1 },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  progressRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXL,
    alignItems: "center",
  },
  metric: {
    display: "flex",
    flexDirection: "column",
    minWidth: "120px",
  },
  metricLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  metricValue: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
  tabRow: {
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    textAlign: "left",
    padding: tokens.spacingHorizontalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  td: {
    padding: tokens.spacingHorizontalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    verticalAlign: "middle",
  },
  ownerCell: {
    minWidth: "240px",
  },
  numericCell: {
    width: "100px",
    fontVariantNumeric: "tabular-nums",
  },
  expanderCell: {
    width: "32px",
  },
  expanderButton: {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground2,
    ":hover": { color: tokens.colorNeutralForeground1 },
  },
  drillRow: {
    backgroundColor: tokens.colorNeutralBackground2,
  },
  drillContainer: {
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  drillTable: {
    width: "100%",
    borderCollapse: "collapse",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  drillTh: {
    textAlign: "left",
    padding: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  drillTd: {
    padding: tokens.spacingHorizontalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  empty: {
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
    paddingBlock: tokens.spacingVerticalXL,
    textAlign: "center",
  },
  summaryChips: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
    alignItems: "center",
  },
  bucketIcon: {
    marginRight: tokens.spacingHorizontalXS,
    verticalAlign: "middle",
  },
});

// ─── Icon + tone per bucket ──────────────────────────────────────────────

function bucketIcon(bucket: OwnerBucket) {
  switch (bucket) {
    case "unresolved":
      return <PersonQuestionMarkRegular />;
    case "service-principal":
      return <BotRegular />;
    case "disabled":
      return <PersonProhibitedRegular />;
    case "guest":
      return <PersonAccountsRegular />;
    case "active":
      return <PersonAvailableRegular />;
    case "sentinel":
      return <SettingsRegular />;
  }
}

function bucketBadgeColor(
  bucket: OwnerBucket,
): "danger" | "warning" | "subtle" | "success" | "informative" {
  switch (bucket) {
    case "unresolved":
      return "danger";
    case "service-principal":
      return "informative";
    case "disabled":
      return "warning";
    case "guest":
      return "informative";
    case "active":
      return "success";
    case "sentinel":
      return "subtle";
  }
}

// ─── Live "elapsed time" helper ──────────────────────────────────────────

/** Forces a re-render every second while the scan is running so the
 *  elapsed-time string stays current. Cheap — one component, one
 *  setInterval, no global broadcast. */
function useNowWhileRunning(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  return now;
}

// ─── Main component ──────────────────────────────────────────────────────

export function Ownerless() {
  const styles = useStyles();
  const progress = useOwnerScanProgress();
  const result = useOwnerScanResult();

  const running =
    progress.phase === "loading-inventory" ||
    progress.phase === "resolving-owners";

  // Pick whichever bucket has the most owners — that's the
  // highest-action-value tab on first paint. Falls back to the first
  // bucket (`unresolved`) when there are no results.
  const pickBestBucket = (r: typeof result): OwnerBucket => {
    if (!r) return "unresolved";
    let best: OwnerBucket = "unresolved";
    let bestN = -1;
    for (const b of OWNER_BUCKETS) {
      const n = r.buckets[b].length;
      if (n > bestN) {
        bestN = n;
        best = b;
      }
    }
    return best;
  };
  const [selectedBucket, setSelectedBucket] = useState<OwnerBucket>(() =>
    pickBestBucket(result),
  );
  // Tracks the result identity that drove the last auto-pick so we
  // can detect a *new* scan result and snap selection to its highest-
  // count bucket. Per the React docs, setState during render based on
  // a changed previous-value comparison is the canonical replacement
  // for an effect that would otherwise mirror prop-derived state
  // (https://react.dev/reference/react/useState#storing-information-from-previous-renders).
  // The alternative (`useEffect`) trips `react-hooks/set-state-in-effect`
  // because it cascades renders.
  const [lastAutoPickedResult, setLastAutoPickedResult] =
    useState<typeof result>(result);
  if (result !== lastAutoPickedResult) {
    setLastAutoPickedResult(result);
    if (result) setSelectedBucket(pickBestBucket(result));
  }

  const onSelect = (_e: SelectTabEvent, data: SelectTabData) => {
    setSelectedBucket(data.value as OwnerBucket);
  };

  const onScan = () => {
    void startScan();
  };
  const onCancel = () => {
    cancelScan();
  };
  const onClear = () => {
    clearLastSnapshot();
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <Text size={700} weight="semibold">
          Ownerless Resources
        </Text>
        <Text className={styles.subtitle}>
          Scan tenant inventory for apps, flows, and Copilot Studio agents
          whose owner GUID can&apos;t be matched to a current valid Entra
          user. Results are bucketed by owner-health so you can prioritize
          unresolved owners (likely deleted accounts or service principals)
          and disabled accounts (often departed employees).
        </Text>
      </header>

      <ActionBar
        running={running}
        hasResult={result !== null}
        onScan={onScan}
        onCancel={onCancel}
        onClear={onClear}
      />

      {progress.phase === "error" && progress.error && (
        <MessageBar intent="error">
          <MessageBarBody>
            <MessageBarTitle>Scan failed</MessageBarTitle>
            {progress.error}
          </MessageBarBody>
        </MessageBar>
      )}

      {progress.phase === "cancelled" && (
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>Scan cancelled</MessageBarTitle>
            Showing the last completed scan, if any. Click Scan to start a
            new one.
          </MessageBarBody>
        </MessageBar>
      )}

      {running && <ProgressCard progress={progress} />}

      {!running && result && result.fromSnapshot && (
        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>
              Last scan {formatRelative(result.scannedAt)}
            </MessageBarTitle>
            This is a summary loaded from your previous session — affected
            resources weren&apos;t persisted. Click <strong>Re-scan</strong>{" "}
            to refresh the data and view per-owner drill-ins.
          </MessageBarBody>
        </MessageBar>
      )}

      {!running && result && !result.fromSnapshot && (
        <MessageBar intent="success">
          <MessageBarBody>
            <MessageBarTitle>
              Scan complete · {formatRelative(result.scannedAt)}
            </MessageBarTitle>
            Walked {result.totalResources.toLocaleString()} resources,
            found {result.ownerIndex.size} distinct owners
            {result.noOwnerCount > 0
              ? ` (${result.noOwnerCount} rows had no ownerId)`
              : ""}
            .
          </MessageBarBody>
        </MessageBar>
      )}

      {result ? (
        <BucketsSection
          result={result}
          selectedBucket={selectedBucket}
          onSelect={onSelect}
        />
      ) : (
        !running &&
        progress.phase !== "error" && (
          <div className={styles.empty}>
            No scan yet. Click <strong>Scan tenant</strong> to enumerate
            owners across all apps, flows, and Copilot Studio agents.
          </div>
        )
      )}
    </div>
  );
}

// ─── Action bar ──────────────────────────────────────────────────────────

interface ActionBarProps {
  running: boolean;
  hasResult: boolean;
  onScan: () => void;
  onCancel: () => void;
  onClear: () => void;
}

function ActionBar({
  running,
  hasResult,
  onScan,
  onCancel,
  onClear,
}: ActionBarProps) {
  const styles = useStyles();
  return (
    <div className={styles.actionBar}>
      {running ? (
        <Button
          appearance="secondary"
          icon={<DismissRegular />}
          onClick={onCancel}
        >
          Cancel scan
        </Button>
      ) : (
        <Button
          appearance="primary"
          icon={
            hasResult ? <ArrowClockwiseRegular /> : <PlayRegular />
          }
          onClick={onScan}
        >
          {hasResult ? "Re-scan" : "Scan tenant"}
        </Button>
      )}
      {hasResult && !running && (
        <Tooltip
          content="Clear the last scan summary (in-memory + saved snapshot)"
          relationship="description"
        >
          <Button
            appearance="subtle"
            icon={<DeleteRegular />}
            onClick={onClear}
          >
            Clear last scan
          </Button>
        </Tooltip>
      )}
    </div>
  );
}

// ─── Live progress card ──────────────────────────────────────────────────

function ProgressCard({ progress }: { progress: ScanProgress }) {
  const styles = useStyles();
  const now = useNowWhileRunning(true);
  const elapsed = progress.startedAt
    ? formatElapsed(now - progress.startedAt)
    : "—";
  const phaseLabel =
    progress.phase === "loading-inventory"
      ? "Loading inventory…"
      : progress.phase === "resolving-owners"
        ? "Resolving owners…"
        : "Resolving service principals…";
  return (
    <div className={styles.card}>
      <div className={styles.actionBar}>
        <Spinner size="small" label={phaseLabel} labelPosition="after" />
        <span className={styles.spacer} />
        <Text size={200}>Elapsed: {elapsed}</Text>
      </div>
      <div className={styles.progressRow}>
        <Metric
          label="Resources walked"
          value={`${progress.inventoryWalked.toLocaleString()}${
            progress.inventoryTotal !== null
              ? ` / ~${progress.inventoryTotal.toLocaleString()}`
              : ""
          }`}
        />
        <Metric
          label="Distinct owners"
          value={progress.distinctOwners.toLocaleString()}
        />
        <Metric
          label="Owners resolved"
          value={progress.ownersResolved.toLocaleString()}
        />
        {progress.phase === "resolving-spns" && (
          <Metric
            label="Service principals checked"
            value={progress.spnsResolved.toLocaleString()}
          />
        )}
        {progress.noOwnerCount > 0 && (
          <Metric
            label="Rows with no owner"
            value={progress.noOwnerCount.toLocaleString()}
          />
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue}>{value}</span>
    </div>
  );
}

// ─── Buckets + drill-in ──────────────────────────────────────────────────

interface BucketsSectionProps {
  result: NonNullable<ReturnType<typeof useOwnerScanResult>>;
  selectedBucket: OwnerBucket;
  onSelect: (e: SelectTabEvent, data: SelectTabData) => void;
}

function BucketsSection({
  result,
  selectedBucket,
  onSelect,
}: BucketsSectionProps) {
  const styles = useStyles();

  // Entries for the active tab, sorted by impact (most affected first).
  const activeEntries = useMemo<OwnerEntry[]>(() => {
    const ids = result.buckets[selectedBucket];
    const entries = ids
      .map((id) => result.ownerIndex.get(id))
      .filter((e): e is OwnerEntry => e !== undefined);
    return entries.sort(
      (a, b) => b.affectedResources.length - a.affectedResources.length,
    );
  }, [result, selectedBucket]);

  return (
    <div className={styles.root}>
      <div className={styles.tabRow}>
        <TabList
          selectedValue={selectedBucket}
          onTabSelect={onSelect}
          size="large"
        >
          {OWNER_BUCKETS.map((b) => (
            <Tab key={b} value={b} icon={bucketIcon(b)}>
              {bucketLabel(b)} ({result.buckets[b].length})
            </Tab>
          ))}
        </TabList>
      </div>

      <BucketHeading
        bucket={selectedBucket}
        count={activeEntries.length}
      />

      {activeEntries.length === 0 ? (
        <div className={styles.empty}>
          No owners in this bucket.
        </div>
      ) : (
        <BucketTable
          entries={activeEntries}
          fromSnapshot={result.fromSnapshot}
        />
      )}
    </div>
  );
}

function BucketHeading({
  bucket,
  count,
}: {
  bucket: OwnerBucket;
  count: number;
}) {
  const styles = useStyles();
  return (
    <div className={styles.summaryChips}>
      <Badge appearance="filled" color={bucketBadgeColor(bucket)}>
        {bucketLabel(bucket)} · {count}
      </Badge>
      <Text className={styles.subtitle}>{bucketDescription(bucket)}</Text>
    </div>
  );
}

interface BucketTableProps {
  entries: OwnerEntry[];
  fromSnapshot: boolean;
}

function BucketTable({ entries, fromSnapshot }: BucketTableProps) {
  const styles = useStyles();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (ownerId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ownerId)) next.delete(ownerId);
      else next.add(ownerId);
      return next;
    });
  };

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th className={styles.th}>Owner</th>
          <th className={styles.th}># resources</th>
          <th className={styles.th}>Breakdown</th>
          <th className={styles.th} aria-label="Expand"></th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const isExpanded = expanded.has(entry.ownerId);
          return (
            <Fragment key={entry.ownerId}>
              <tr>
                <td className={`${styles.td} ${styles.ownerCell}`}>
                  <OwnerCell entry={entry} />
                </td>
                <td className={`${styles.td} ${styles.numericCell}`}>
                  {entry.affectedResources.length.toLocaleString()}
                </td>
                <td className={styles.td}>
                  {formatTypeBreakdown(entry)}
                </td>
                <td className={`${styles.td} ${styles.expanderCell}`}>
                  <button
                    type="button"
                    className={styles.expanderButton}
                    aria-label={isExpanded ? "Collapse" : "Expand"}
                    aria-expanded={isExpanded}
                    onClick={() => toggle(entry.ownerId)}
                  >
                    {isExpanded ? (
                      <ChevronDownRegular />
                    ) : (
                      <ChevronRightRegular />
                    )}
                  </button>
                </td>
              </tr>
              {isExpanded && (
                <tr className={styles.drillRow}>
                  <td className={styles.td} colSpan={4}>
                    <DrillIn entry={entry} fromSnapshot={fromSnapshot} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function DrillIn({
  entry,
  fromSnapshot,
}: {
  entry: OwnerEntry;
  fromSnapshot: boolean;
}) {
  const styles = useStyles();
  const navigate = useNavigate();

  if (fromSnapshot) {
    return (
      <div className={styles.drillContainer}>
        <Text size={200}>
          Affected-resource details aren&apos;t available from the saved
          snapshot. Click <strong>Re-scan</strong> at the top of the page
          to load them.
        </Text>
      </div>
    );
  }

  const isSp = entry.servicePrincipal !== null;

  return (
    <div className={styles.drillContainer}>
      {isSp && <SpOwnersSection entry={entry} />}

      {entry.affectedResources.length === 0 ? (
        <Text size={200}>No affected resources recorded for this owner.</Text>
      ) : (
        <table className={styles.drillTable}>
          <thead>
            <tr>
              <th className={styles.drillTh}>Affected resource</th>
              <th className={styles.drillTh}>Type</th>
              <th className={styles.drillTh}>Environment</th>
              <th className={styles.drillTh} aria-label="Open"></th>
            </tr>
          </thead>
          <tbody>
            {entry.affectedResources.map((r) => {
              const path = detailPathFor(r);
              return (
                <tr key={`${r.environmentId}::${r.id}`}>
                  <td className={styles.drillTd}>
                    {path ? (
                      <Link onClick={() => navigate(path)} as="button">
                        {r.displayName || r.id}
                      </Link>
                    ) : (
                      (r.displayName || r.id)
                    )}
                  </td>
                  <td className={styles.drillTd}>
                    {friendlyResourceType(r.type)}
                  </td>
                  <td className={styles.drillTd}>{r.environmentId}</td>
                  <td className={styles.drillTd}>
                    {path && (
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<OpenRegular />}
                        onClick={() => navigate(path)}
                        aria-label={`Open ${r.displayName || r.id}`}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Cell renderer for the Owner column. For SP rows, shows the SP's
 *  display name + classification badge in place of the standard
 *  `<UserChip>`. For user / unresolved / sentinel rows, falls back to
 *  the chip (which already handles the missing case neutrally). */
function OwnerCell({ entry }: { entry: OwnerEntry }) {
  const styles = useStyles();
  const sp = entry.servicePrincipal;
  if (sp) {
    return (
      <span className={styles.summaryChips}>
        <BotRegular className={styles.bucketIcon} aria-hidden />
        <Text weight="semibold">{sp.displayName || sp.id}</Text>
        <Badge appearance="filled" color={spKindBadgeColor(sp.kind)} size="small">
          {spKindLabel(sp.kind)}
        </Badge>
        {sp.accountEnabled === false && (
          <Badge appearance="filled" color="warning" size="small">
            disabled
          </Badge>
        )}
      </span>
    );
  }
  return <UserChip id={entry.ownerId} />;
}

/**
 * Drill-in section that lazily fetches and renders the SP's Entra
 * owners via `fetchServicePrincipalOwners`. Fires on first expand;
 * caches the result in component state so subsequent re-expands of
 * the same row don't re-fetch.
 *
 * User-typed owners render through the shared `<UserChip>` — which
 * means resolving the SP owners passively populates the `aaduser`
 * cache and lights up every other user chip across the app for free.
 * The lookup is on-demand only (not pre-fetched during the scan) so
 * the scan stays fast; only rows the user actually clicks pay the cost.
 */
function SpOwnersSection({ entry }: { entry: OwnerEntry }) {
  const styles = useStyles();
  const [owners, setOwners] = useState<ServicePrincipalOwner[] | null>(null);
  // Start in loading=true since the effect will fire immediately. Initial
  // state covers the "just-mounted, fetching" UI without needing a
  // setState-in-effect to flip a default `false` to `true` (which
  // trips `react-hooks/set-state-in-effect`).
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchServicePrincipalOwners(entry.ownerId)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setOwners(res.data);
        } else {
          setError(res.error);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entry.ownerId]);

  return (
    <div className={styles.drillContainer}>
      <Text size={300} weight="semibold">
        Service principal owners
      </Text>
      {loading && <Spinner size="extra-small" label="Loading owners…" labelPosition="after" />}
      {error && (
        <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>
          Could not load owners: {error}
        </Text>
      )}
      {!loading && !error && owners && owners.length === 0 && (
        <Text size={200}>
          No Entra owners assigned to this service principal. Common for
          Microsoft first-party SPs — Microsoft manages them, no in-tenant
          escalation contact exists.
        </Text>
      )}
      {!loading && !error && owners && owners.length > 0 && (
        <div className={styles.summaryChips}>
          {owners.map((o) => (
            <UserChip key={o.id} id={o.id} />
          ))}
        </div>
      )}
    </div>
  );
}
