/**
 * `<AdminAccessGate>` — preflight permission probe that wraps the routed
 * shell. Runs a single cheap `QueryResources` call against the
 * Power Platform for Admins V2 connector at boot. If it succeeds the
 * children render unchanged; if it fails the gate shows one of four
 * actionable panes (no-access, connection-broken, transient,
 * unknown-error) instead of letting the dashboard cold-start into a
 * cascade of 403 toasts.
 *
 * See `docs/roadmap.md` → "Admin access gate" for the design rationale,
 * including the PIM-vs-no-role ambiguity (both return 403) and the
 * three-way error classification.
 *
 * The granted result is cached at module scope for the session lifetime
 * so the probe never re-runs on navigation. The "Re-check access"
 * button on `<NoAccessPane>` resets that cache and re-probes.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Body1,
  Button,
  Card,
  Link,
  Spinner,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowClockwiseRegular,
  OpenRegular,
  PlugDisconnectedRegular,
  ShieldKeyholeRegular,
  WarningRegular,
} from "@fluentui/react-icons";
import {
  classifyConnectorError,
  probeAdminAccess,
  type ConnectorErrorKind,
} from "../data/inventory";
import {
  AdminAccessContext,
  type AdminAccessContextValue,
  type AdminAccessStatus,
} from "../hooks/useAdminAccess";

const PIM_ACTIVATE_URL =
  "https://portal.azure.com/#blade/Microsoft_Azure_PIMCommon/CommonMenuBlade/quickStart";
const POWER_APPS_CONNECTIONS_URL = "https://make.powerapps.com/connections";

/** Module-level cache. Once the probe returns `granted` we trust it for
 *  the rest of the session — no re-probe on navigation, on provider
 *  re-mount (StrictMode double-invoke), or on rendering a new sibling.
 *  Reset only by the explicit "Re-check access" button. */
let __sessionGranted = false;

/** Max auto-retries for transient errors before showing the manual
 *  Retry pane. Two retries (three total attempts) covers the
 *  vast majority of connector blips without making the user wait
 *  forever on a real outage. */
const MAX_TRANSIENT_RETRIES = 2;

function backoffMs(attempt: number): number {
  // 600ms / 1200ms with up to ~400ms of jitter.
  const base = 600 * 2 ** (attempt - 1);
  return base + Math.random() * 400;
}

export function AdminAccessGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AdminAccessStatus>(() =>
    __sessionGranted ? { kind: "granted" } : { kind: "loading" }
  );

  // Bumping the nonce re-runs the probe effect — used by the "Re-check"
  // button to force a fresh attempt without resorting to self-referencing
  // recursion (which trips `react-hooks/immutability`).
  const [probeNonce, setProbeNonce] = useState(0);

  const recheck = useCallback(() => {
    __sessionGranted = false;
    setStatus({ kind: "loading" });
    setProbeNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    // If a previous mount already proved access in this session, the
    // useState initializer above will have set us to `granted` already
    // (the module-level cache survives provider unmount/remount, e.g.
    // StrictMode double-invoke), so we don't need to setState here.
    if (__sessionGranted) return;
    let cancelled = false;

    const attempt = async (n: number): Promise<void> => {
      if (cancelled) return;
      const res = await probeAdminAccess();
      if (cancelled) return;

      if (res.ok) {
        __sessionGranted = true;
        setStatus({ kind: "granted" });
        return;
      }

      const classification: ConnectorErrorKind = classifyConnectorError(res.error);
      if (classification === "forbidden") {
        setStatus({ kind: "denied", error: res.error });
        return;
      }
      if (classification === "unauthorized") {
        setStatus({ kind: "connection-broken", error: res.error });
        return;
      }
      if (classification === "transient") {
        setStatus({ kind: "transient", error: res.error, attempt: n });
        if (n <= MAX_TRANSIENT_RETRIES) {
          await new Promise<void>((resolve) => setTimeout(resolve, backoffMs(n)));
          if (!cancelled) await attempt(n + 1);
        }
        return;
      }
      setStatus({ kind: "error", error: res.error, classification });
    };

    void attempt(1);
    return () => {
      cancelled = true;
    };
  }, [probeNonce]);

  const ctxValue = useMemo<AdminAccessContextValue>(
    () => ({ status, recheck }),
    [status, recheck]
  );

  return (
    <AdminAccessContext.Provider value={ctxValue}>
      {status.kind === "granted" ? (
        children
      ) : status.kind === "loading" ? (
        <GateLoading />
      ) : status.kind === "denied" ? (
        <NoAccessPane onRecheck={recheck} />
      ) : status.kind === "connection-broken" ? (
        <ConnectionBrokenPane onRecheck={recheck} />
      ) : status.kind === "transient" ? (
        <TransientErrorPane
          attempt={status.attempt}
          retrying={status.attempt <= MAX_TRANSIENT_RETRIES}
          error={status.error}
          onRetry={recheck}
        />
      ) : (
        <GenericErrorPane error={status.error} onRetry={recheck} />
      )}
    </AdminAccessContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Panes. Each follows the same Fluent Card + icon + headline + body +
// actions shape so the gate reads as a coherent set regardless of which
// failure mode the user hits.
// ---------------------------------------------------------------------------

const usePaneStyles = makeStyles({
  shell: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: tokens.spacingHorizontalXXL,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  card: {
    maxWidth: "560px",
    width: "100%",
    padding: tokens.spacingHorizontalXXL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
  },
  icon: {
    fontSize: "32px",
    color: tokens.colorNeutralForeground2,
    flexShrink: 0,
  },
  iconDanger: {
    color: tokens.colorStatusDangerForeground1,
  },
  iconWarning: {
    color: tokens.colorStatusWarningForeground1,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
  },
  techDetail: {
    marginTop: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalM,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    wordBreak: "break-word",
    whiteSpace: "pre-wrap",
  },
  loadingShell: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.colorNeutralBackground1,
  },
});

function GateLoading() {
  const styles = usePaneStyles();
  return (
    <div className={styles.loadingShell}>
      <Spinner label="Checking access…" />
    </div>
  );
}

interface NoAccessPaneProps {
  onRecheck: () => void;
}

function NoAccessPane({ onRecheck }: NoAccessPaneProps) {
  const styles = usePaneStyles();
  return (
    <div className={styles.shell}>
      <Card className={styles.card}>
        <div className={styles.header}>
          <ShieldKeyholeRegular className={`${styles.icon} ${styles.iconDanger}`} />
          <Title2>Admin access required</Title2>
        </div>
        <div className={styles.body}>
          <Body1>
            You need the <strong>Power Platform Administrator</strong> role
            (or <strong>Global Administrator</strong>) to use this app.
          </Body1>
          <Body1>
            If you have it through Privileged Identity Management (PIM), you may
            need to <strong>activate it</strong> before this app will load. PIM
            activations can take a few seconds to propagate — once you've
            activated, come back here and hit <em>Re-check access</em>.
          </Body1>
        </div>
        <div className={styles.actions}>
          <Button
            appearance="primary"
            icon={<ArrowClockwiseRegular />}
            onClick={onRecheck}
          >
            Re-check access
          </Button>
          <Button
            as="a"
            href={PIM_ACTIVATE_URL}
            target="_blank"
            rel="noopener noreferrer"
            icon={<OpenRegular />}
          >
            Open PIM
          </Button>
        </div>
      </Card>
    </div>
  );
}

interface ConnectionBrokenPaneProps {
  onRecheck: () => void;
}

function ConnectionBrokenPane({ onRecheck }: ConnectionBrokenPaneProps) {
  const styles = usePaneStyles();
  return (
    <div className={styles.shell}>
      <Card className={styles.card}>
        <div className={styles.header}>
          <PlugDisconnectedRegular className={`${styles.icon} ${styles.iconWarning}`} />
          <Title2>Connection needs to be re-authorised</Title2>
        </div>
        <div className={styles.body}>
          <Body1>
            The Power Platform for Admins connection used by this app isn't
            authenticating. This usually means the connection has expired or
            was revoked, and needs to be re-consented.
          </Body1>
          <Body1>
            Open the{" "}
            <Link href={POWER_APPS_CONNECTIONS_URL} target="_blank" rel="noopener noreferrer">
              Power Apps connections page
            </Link>
            , find the <strong>Power Platform for Admins V2</strong> connection,
            and confirm it shows a healthy status (re-create it if needed).
            Then return here and hit <em>Re-check access</em>.
          </Body1>
        </div>
        <div className={styles.actions}>
          <Button
            appearance="primary"
            icon={<ArrowClockwiseRegular />}
            onClick={onRecheck}
          >
            Re-check access
          </Button>
          <Button
            as="a"
            href={POWER_APPS_CONNECTIONS_URL}
            target="_blank"
            rel="noopener noreferrer"
            icon={<OpenRegular />}
          >
            Open connections page
          </Button>
        </div>
      </Card>
    </div>
  );
}

interface TransientErrorPaneProps {
  attempt: number;
  retrying: boolean;
  error: string;
  onRetry: () => void;
}

function TransientErrorPane({ attempt, retrying, error, onRetry }: TransientErrorPaneProps) {
  const styles = usePaneStyles();
  return (
    <div className={styles.shell}>
      <Card className={styles.card}>
        <div className={styles.header}>
          {retrying ? (
            <Spinner size="medium" />
          ) : (
            <WarningRegular className={`${styles.icon} ${styles.iconWarning}`} />
          )}
          <Title2>
            {retrying ? "Retrying…" : "Couldn't reach the admin service"}
          </Title2>
        </div>
        <div className={styles.body}>
          <Body1>
            {retrying
              ? `The admin connector returned a transient error (attempt ${attempt}). Retrying automatically…`
              : `We tried ${attempt} time${attempt === 1 ? "" : "s"} and the admin connector still isn't responding. This is usually rate limiting or a brief service blip — try again in a moment.`}
          </Body1>
          {!retrying && <div className={styles.techDetail}>{error}</div>}
        </div>
        {!retrying && (
          <div className={styles.actions}>
            <Button
              appearance="primary"
              icon={<ArrowClockwiseRegular />}
              onClick={onRetry}
            >
              Try again
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

interface GenericErrorPaneProps {
  error: string;
  onRetry: () => void;
}

function GenericErrorPane({ error, onRetry }: GenericErrorPaneProps) {
  const styles = usePaneStyles();
  return (
    <div className={styles.shell}>
      <Card className={styles.card}>
        <div className={styles.header}>
          <WarningRegular className={`${styles.icon} ${styles.iconWarning}`} />
          <Title2>Something went wrong loading the app</Title2>
        </div>
        <div className={styles.body}>
          <Body1>
            The preflight access check failed with an error we don't recognise.
            The raw message is below — if it persists, share it with the app
            owner.
          </Body1>
          <div className={styles.techDetail}>{error}</div>
        </div>
        <div className={styles.actions}>
          <Button
            appearance="primary"
            icon={<ArrowClockwiseRegular />}
            onClick={onRetry}
          >
            Try again
          </Button>
        </div>
      </Card>
    </div>
  );
}
