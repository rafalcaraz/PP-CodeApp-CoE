/**
 * `<SupplementalAdminCard>` — the on-demand admin-enrichment card shell.
 *
 * Wraps the `idle → loading → ready | error` state machine that every
 * supplemental admin call follows (per the pattern documented in
 * `PP-CoE-CodeApp/docs/admin-connector-inventory.md` →
 * "Implementation pattern"). Pages provide `loadFn` + `renderReady` and
 * the component handles the button, the Fluent `Card` + `CardHeader` +
 * `Divider`, the Refresh link in the header, the spinner/error pane
 * wiring, and the padding/spacing wrappers.
 *
 * **Usage.**
 *
 * ```tsx
 * <SupplementalAdminCard
 *   title="Admin details (supplemental)"
 *   description="..."
 *   helpText={<>Click to call <code>GetEnvironmentByIdForUser</code>.</>}
 *   loadFn={() => getEnvironmentAdminDetails(row.id)}
 *   renderReady={(details) => <EnvironmentAdminBody details={details} />}
 * />
 * ```
 *
 * **What this component intentionally does NOT do:**
 * - Cache results across navigation (state is component-local; a parent
 *   that remounts the card will reset it). Cross-nav caching belongs at
 *   the data-layer if it's ever needed; see `adminEnrichment.ts`.
 * - Fan out / batch / throttle multiple calls. One card = one call. If
 *   a page needs N calls, render N cards (or compose a wrapper that
 *   fires them in parallel and returns a combined `DataResult`).
 * - Auto-refresh on a timer. By design — admins click Refresh when
 *   they want fresh.
 */
import { useCallback, useState, type ReactNode } from "react";
import {
  Card,
  CardHeader,
  Divider,
  Text,
  Button,
  Link,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ErrorPane, LoadingPane } from "../Status";
import type { DataResult } from "../../data/inventory";

/** Internal state machine for a supplemental admin enrichment call.
 *  Kept private so callers can't misuse intermediate states. */
type AdminSlot<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: T };

export interface SupplementalAdminCardProps<T> {
  /** Card header title. */
  title: string;
  /** Card header description. The Refresh link is automatically appended
   *  in the ready state — don't include "(Refresh)" in this string.
   *  Optional: omit for a title-only header (Refresh still renders). */
  description?: ReactNode;
  /** Optional help text rendered above the load button in the idle
   *  state. Good place to mention which connector op fires. */
  helpText?: ReactNode;
  /** Idle-state button label. Defaults to "Load admin details". */
  buttonLabel?: string;
  /** Loading-state spinner label. Defaults to "Loading admin details…". */
  loadingLabel?: string;
  /** The async call to make on click. Should return the standard
   *  `DataResult<T>` shape (see `data/inventory.ts`). */
  loadFn: () => Promise<DataResult<T>>;
  /** Renderer for the ready state's body. The component wraps your
   *  output in a padded container; just return the inner content. */
  renderReady: (data: T) => ReactNode;
  /** Optional className for the outer `<Card>` (typically a colHalf /
   *  colFull from `useDetailStyles`). */
  className?: string;
}

const useStyles = makeStyles({
  cta: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalL,
  },
  ctaHelp: {
    color: tokens.colorNeutralForeground3,
  },
  readyWrap: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
  },
  // Re-uses the same padding shape pages were using for their card
  // bodies so the spinner inside the loading state matches surrounding
  // cards visually.
  loadingWrap: {
    padding: tokens.spacingHorizontalL,
  },
  errorWrap: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
  },
});

export function SupplementalAdminCard<T>({
  title,
  description,
  helpText,
  buttonLabel = "Load admin details",
  loadingLabel = "Loading admin details…",
  loadFn,
  renderReady,
  className,
}: SupplementalAdminCardProps<T>) {
  const styles = useStyles();
  const [slot, setSlot] = useState<AdminSlot<T>>({ kind: "idle" });

  // `loadFn` is captured per render but we don't want re-renders to
  // re-create the click handler if the caller passes a stable function.
  // Keeping this as a regular function (not useCallback'd against the
  // loadFn) is fine — click handlers don't need referential stability.
  const onLoad = useCallback(async () => {
    setSlot({ kind: "loading" });
    const res = await loadFn();
    setSlot(
      res.ok
        ? { kind: "ready", data: res.data }
        : { kind: "error", message: res.error }
    );
  }, [loadFn]);

  // The header description grows a Refresh link once we have data, so
  // re-fetch is one click without leaving the card. If `description` is
  // omitted we render Refresh on its own (ready state) or nothing
  // (idle/loading/error states).
  const headerDescription =
    slot.kind === "ready" ? (
      <Text size={200}>
        {description}
        {description ? " " : null}
        <Link onClick={onLoad}>Refresh</Link>
      </Text>
    ) : description ? (
      <Text size={200}>{description}</Text>
    ) : undefined;

  return (
    <Card className={className}>
      <CardHeader
        header={<Text weight="semibold">{title}</Text>}
        description={headerDescription}
      />
      <Divider />
      {slot.kind === "idle" && (
        <div className={styles.cta}>
          {helpText && (
            <Text size={200} className={styles.ctaHelp}>
              {helpText}
            </Text>
          )}
          <Button appearance="primary" onClick={onLoad}>
            {buttonLabel}
          </Button>
        </div>
      )}
      {slot.kind === "loading" && (
        <div className={styles.loadingWrap}>
          <LoadingPane label={loadingLabel} />
        </div>
      )}
      {slot.kind === "error" && (
        <div className={styles.errorWrap}>
          <ErrorPane title="Couldn't load admin details" message={slot.message} />
          <div>
            <Button onClick={onLoad}>Retry</Button>
          </div>
        </div>
      )}
      {slot.kind === "ready" && (
        <div className={styles.readyWrap}>{renderReady(slot.data)}</div>
      )}
    </Card>
  );
}
