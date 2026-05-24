import { useEffect } from "react";
import {
  makeStyles,
  tokens,
  Text,
  Avatar,
  Button,
  Tooltip,
} from "@fluentui/react-components";
import { PersonSearchRegular } from "@fluentui/react-icons";
import { useUserLookup } from "../hooks/useUserLookup";

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
});

/**
 * Top app chrome. Owns the global Ctrl+K / Cmd+K hotkey that opens the
 * user lookup dialog (hosted by `<UserLookupProvider>` so anything in
 * the tree — including chips inside list cells — can open it too).
 */
export function TopBar() {
  const styles = useStyles();
  const openLookup = useUserLookup();

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
