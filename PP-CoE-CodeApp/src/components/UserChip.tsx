/**
 * `<UserChip>` — drop-in renderer for an Entra owner / creator GUID.
 *
 * Pass it the raw GUID from any inventory row (`ownerId`, `createdBy`,
 * `lastModifiedBy`) and it does the rest:
 *
 *   - **Already-resolved (cache hit)** → avatar + display name. Hover
 *     shows UPN. Click opens the Cmd+K lookup dialog pre-filled with
 *     the GUID (in case the user wants more details / to copy).
 *   - **Looked up before, not in `aaduser`** → muted "Unknown identity"
 *     tag with a question-mark icon. Hover explains the ambiguity
 *     (deleted user vs. service principal). Click opens the lookup
 *     dialog so the user can see the full "could not locate" message.
 *   - **Not looked up yet (the common case for raw list rows)** → muted
 *     short GUID with a subtle look-up icon. Hover invites the user to
 *     click to resolve. **The chip itself never triggers a network
 *     call.** Resolution only happens when the user explicitly opens
 *     the Cmd+K dialog (via the chip click or the global hotkey).
 *   - **No GUID at all** → renders the `fallback` (default `—`).
 *
 * The chip subscribes to the shared resolver cache via `useUserDisplay`,
 * so as soon as the user resolves a given GUID anywhere in the app
 * every chip currently rendered for that GUID lights up — no re-fetch,
 * no prop drilling.
 *
 * **Why no auto-resolve?** Owner / createdBy GUIDs are frequently
 * service principals (Pipelines deployment SPNs) or deleted users —
 * both return "not found" against `aaduser`. Auto-resolving every chip
 * would burn one `retrieveRecord` per row and surface mostly "Could not
 * locate" results. Lazy / on-demand resolution keeps the page cheap and
 * lets the user decide when they care.
 */

import { useCallback } from "react";
import {
  Avatar,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  PersonQuestionMarkRegular,
  PersonSearchRegular,
} from "@fluentui/react-icons";
import { useUserDisplay } from "../hooks/useUserDisplay";
import { useUserLookup } from "../hooks/useUserLookup";

const useStyles = makeStyles({
  root: {
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    maxWidth: "100%",
    minWidth: 0,
    cursor: "pointer",
    backgroundColor: "transparent",
    border: "none",
    padding: 0,
    color: "inherit",
    font: "inherit",
    textAlign: "left",
    ":hover": {
      textDecoration: "underline",
    },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "2px",
      borderRadius: tokens.borderRadiusSmall,
    },
  },
  label: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  loading: {
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    opacity: 0.7,
  },
  missing: {
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
  },
  missingIcon: {
    color: tokens.colorPaletteYellowForeground1,
  },
  lookupHintIcon: {
    color: tokens.colorNeutralForeground3,
    opacity: 0.6,
  },
  disabledBadge: {
    color: tokens.colorPaletteRedForeground1,
    fontSize: tokens.fontSizeBase200,
  },
});

export interface UserChipProps {
  /** Raw GUID from an inventory row. Safe to pass `undefined` / empty
   *  string; the chip renders `fallback` in that case. */
  id: string | undefined | null;
  /** What to render when there's no GUID at all (vs. unresolved). Default `—`. */
  fallback?: React.ReactNode;
  /** Avatar size in pixels. Pass `0` to hide the avatar entirely (useful
   *  in super-dense tables). Default `20`. */
  avatarSize?: 0 | 16 | 20 | 24 | 28 | 32 | 36;
  /** When set, the chip is a button that opens the lookup dialog
   *  pre-filled. Defaults to `true`. Set `false` for read-only contexts. */
  clickable?: boolean;
  /** Extra class names (e.g. to truncate inside a fixed-width column). */
  className?: string;
}

/** Last 8 chars of a normalized GUID — readable enough to triangulate
 *  in logs / Entra without dominating a column. */
function shortGuid(id: string): string {
  return id.replace(/[{}()]/g, "").slice(-8);
}

export function UserChip({
  id,
  fallback = "—",
  avatarSize = 20,
  clickable = true,
  className,
}: UserChipProps) {
  const styles = useStyles();
  const entry = useUserDisplay(id);
  const openLookup = useUserLookup();

  const handleClick = useCallback(() => {
    if (!id) return;
    openLookup(id);
  }, [id, openLookup]);

  if (!id) {
    return <>{fallback}</>;
  }

  // Compute the wrapper class + the inner content, then assemble
  // either a button (clickable, with Tooltip) or a span. Inlined
  // rather than extracted to a nested component to keep React happy
  // about not creating components during render.
  const mergedClass = mergeClasses(styles.root, className);
  let content: React.ReactNode;
  let tip: string;

  if (entry.status === "resolved") {
    const u = entry.user;
    // Narrow `avatarSize` after the `=== 0` check so TS doesn't complain
    // about `0` not being assignable to Fluent's `AvatarSize` union.
    const visibleAvatarSize: 16 | 20 | 24 | 28 | 32 | 36 | null =
      avatarSize === 0 ? null : avatarSize;
    tip = [
      u.displayName,
      u.upn,
      u.userType === "Guest" ? "(Guest)" : null,
      u.enabled === false ? "(Disabled)" : null,
      `\nClick to view details`,
    ]
      .filter(Boolean)
      .join(" · ");
    content = (
      <>
        {visibleAvatarSize !== null && (
          <Avatar
            size={visibleAvatarSize}
            name={u.displayName}
            color="colorful"
            badge={
              u.enabled === false
                ? { status: "offline" }
                : u.userType === "Guest"
                ? { status: "away" }
                : undefined
            }
          />
        )}
        <span className={styles.label}>{u.displayName}</span>
        {u.enabled === false && (
          <span className={styles.disabledBadge} aria-label="Account disabled">
            (disabled)
          </span>
        )}
      </>
    );
  } else if (entry.status === "missing") {
    tip =
      `Could not locate a current valid user for ${id}. ` +
      `This may be a deleted user account or an Enterprise Application ` +
      `(service principal) Object ID. Click to inspect.`;
    content = (
      <>
        <PersonQuestionMarkRegular className={styles.missingIcon} />
        <span className={mergeClasses(styles.label, styles.missing)}>
          Unknown identity · {shortGuid(id)}
        </span>
      </>
    );
  } else {
    // status === "unknown" → never looked up. Render the short GUID
    // with an invitation to click for resolution. **No network call
    // fires from here** — auto-resolving every owner chip on a 500-row
    // list would burn calls (mostly returning "not found" for SPNs)
    // and isn't what the user wants. They open Ctrl+K when they care.
    tip = `Click to look up ${id}`;
    content = (
      <>
        <PersonSearchRegular className={styles.lookupHintIcon} />
        <span className={mergeClasses(styles.label, styles.loading)}>
          {shortGuid(id)}
        </span>
      </>
    );
  }

  if (!clickable) {
    return (
      <span className={mergedClass} title={tip}>
        {content}
      </span>
    );
  }
  return (
    <Tooltip content={tip} relationship="label" withArrow>
      <button
        type="button"
        className={mergedClass}
        onClick={handleClick}
        aria-label={tip}
      >
        {content}
      </button>
    </Tooltip>
  );
}
