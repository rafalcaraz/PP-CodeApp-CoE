import { useEffect, useSyncExternalStore } from "react";
import {
  makeStyles,
  tokens,
  Text,
  Avatar,
  Button,
  Tooltip,
  Spinner,
} from "@fluentui/react-components";
import { PersonSearchRegular } from "@fluentui/react-icons";
import { useNavigate } from "react-router-dom";
import { useUserLookup } from "../hooks/useUserLookup";
import {
  getScanSnapshot,
  subscribeToScan,
  type ScanSnapshot,
} from "../shared/deep-inventory";

const useStyles = makeStyles({
  root: {
    height: "48px",
    minHeight: "48px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingInline: tokens.spacingHorizontalL,
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    borderBottom: `1px solid ${tokens.colorBrandStroke2}`,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  title: {
    color: tokens.colorNeutralForegroundOnBrand,
    fontWeight: tokens.fontWeightSemibold,
  },
  lookupButton: {
    color: tokens.colorNeutralForegroundOnBrand,
    ":hover": {
      color: tokens.colorNeutralForegroundOnBrand,
    },
  },
  scanPill: {
    color: tokens.colorNeutralForegroundOnBrand,
    backgroundColor: "transparent",
    border: `1px solid ${tokens.colorBrandStroke2}`,
    paddingInline: tokens.spacingHorizontalM,
    minWidth: "auto",
    ":hover": {
      color: tokens.colorNeutralForegroundOnBrand,
      backgroundColor: tokens.colorBrandBackgroundHover,
    },
  },
  scanCount: {
    color: tokens.colorNeutralForegroundOnBrand,
    marginInlineStart: tokens.spacingHorizontalXS,
    fontSize: tokens.fontSizeBase200,
  },
});

/** Subscribe to the shared deep-scan store. Bridges the module-level
 *  store (`shared/deep-inventory/scanStore.ts`) into React's
 *  re-render machinery so the top-bar pill stays in sync even when
 *  the scan started from a now-unmounted view. */
function useScanSnapshot(): ScanSnapshot {
  return useSyncExternalStore(
    subscribeToScan,
    getScanSnapshot,
    getScanSnapshot
  );
}

/**
 * Top app chrome. Owns the global Ctrl+K / Cmd+K hotkey that opens the
 * user lookup dialog (hosted by `<UserLookupProvider>` so anything in
 * the tree — including chips inside list cells — can open it too).
 */
export function TopBar() {
  const styles = useStyles();
  const openLookup = useUserLookup();
  const navigate = useNavigate();
  const snapshot = useScanSnapshot();

  // Global hotkey: Cmd+K (macOS) / Ctrl+K (Windows/Linux). Skipped when
  // the user is typing in an input/textarea/contenteditable so we don't
  // hijack browser find-in-page-style muscle memory inside the queries
  // playground or filter combo boxes.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return target.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const isK = e.key === "k" || e.key === "K";
      if (!isK) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (isTypingInField(e.target)) return;
      e.preventDefault();
      openLookup();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openLookup]);

  return (
    <header className={styles.root}>
      <div className={styles.brand}>
        <Text className={styles.title} size={400}>
          Power Platform Center of Excellence
        </Text>
      </div>
      <div className={styles.actions}>
        {snapshot.kind === "running" && (
          <Tooltip
            content="A tenant scan is running. Click to view progress."
            relationship="label"
          >
            <Button
              appearance="subtle"
              className={styles.scanPill}
              icon={<Spinner size="tiny" />}
              onClick={() => navigate("/tenant-scans")}
            >
              Scanning{" "}
              <span className={styles.scanCount}>
                {snapshot.progress.scopeUnitsDone}/
                {snapshot.progress.scopeUnitsTotal} envs ·{" "}
                {snapshot.progress.matches} matches
              </span>
            </Button>
          </Tooltip>
        )}
        <Tooltip
          content="Look up user by GUID (Ctrl+K)"
          relationship="label"
        >
          <Button
            appearance="subtle"
            className={styles.lookupButton}
            icon={<PersonSearchRegular />}
            aria-label="Look up user by GUID"
            onClick={() => openLookup()}
          />
        </Tooltip>
        <Avatar size={28} name="Admin" />
      </div>
    </header>
  );
}
