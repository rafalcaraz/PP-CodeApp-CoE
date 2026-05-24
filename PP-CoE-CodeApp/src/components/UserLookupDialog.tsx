/**
 * Cmd+K / Ctrl+K lookup dialog: paste a GUID, get the Entra user.
 *
 * **Purpose.** Quick spot-resolution for admins/makers who run into a
 * GUID in audit logs, JSON payloads, support tickets, etc. and want to
 * know who that is without leaving the CoE app.
 *
 * **Plumbing.** Thin shell on top of `lookupUser` in
 * `../data/userEnrichment.ts`. Every lookup goes through the same
 * cache/dedupe/batcher that the rest of the app uses, so:
 *   - Hits already-warmed cache instantly when the GUID has been seen
 *     elsewhere (e.g., the user opened an owner-having detail page).
 *   - Warms the cache for subsequent renders if the GUID is new.
 *
 * **Never does a `getAll()` without a filter.** Only one call path
 * (`lookupUser` → `resolveUser` → batched filter). Safe by construction.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Spinner,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  CopyRegular,
  DismissRegular,
  PersonSearchRegular,
} from "@fluentui/react-icons";
import {
  clearUserCache,
  getCacheVersion,
  lookupUser,
  subscribeCacheVersion,
  userCacheStats,
  type UserRef,
} from "../data/userEnrichment";

const useStyles = makeStyles({
  surface: {
    minWidth: "min(520px, 92vw)",
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  resultCard: {
    display: "flex",
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    alignItems: "flex-start",
  },
  details: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    flex: 1,
    minWidth: 0,
  },
  detailRow: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
    alignItems: "baseline",
  },
  detailLabel: {
    color: tokens.colorNeutralForeground3,
    minWidth: "84px",
    fontSize: tokens.fontSizeBase200,
  },
  detailValue: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  errorCard: {
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorStatusDangerBackground1,
    color: tokens.colorStatusDangerForeground1,
    border: `1px solid ${tokens.colorStatusDangerBorder1}`,
  },
  missingCard: {
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorStatusWarningBackground1,
    color: tokens.colorStatusWarningForeground1,
    border: `1px solid ${tokens.colorStatusWarningBorder1}`,
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  badgeRow: {
    display: "flex",
    gap: tokens.spacingHorizontalXS,
    marginTop: tokens.spacingVerticalXXS,
    flexWrap: "wrap",
  },
});

export interface UserLookupDialogProps {
  open: boolean;
  onClose: () => void;
  /** Optional seed value to prefill the input. Useful when invoking from
   *  a "Resolve this owner" affordance on a detail page. */
  initialGuid?: string;
}

type ResultState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; user: UserRef }
  | { kind: "missing"; guid: string }
  | { kind: "error"; message: string };

/** Lazy-evaluated initials so we don't pay the cost when there's no user. */
function initialsOf(user: UserRef): string {
  const src = user.displayName || user.upn || user.id;
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function userToMarkdown(user: UserRef): string {
  const lines = [
    `**${user.displayName}**`,
    user.upn ? `- UPN: \`${user.upn}\`` : null,
    user.mail && user.mail !== user.upn ? `- Mail: \`${user.mail}\`` : null,
    user.jobTitle ? `- Title: ${user.jobTitle}` : null,
    user.userType ? `- Type: ${user.userType}` : null,
    `- ID: \`${user.id}\``,
    user.enabled === false ? `- ⚠️ Account disabled` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

export function UserLookupDialog({
  open,
  onClose,
  initialGuid,
}: UserLookupDialogProps) {
  const styles = useStyles();
  // Lazy-initialized from `initialGuid` once per mount. The parent
  // remounts us via a `key` prop when the dialog re-opens, so we never
  // need a setState-in-effect dance to reset between sessions.
  const [input, setInput] = useState<string>(() => initialGuid ?? "");
  const [result, setResult] = useState<ResultState>(() => ({ kind: "idle" }));
  const inputRef = useRef<HTMLInputElement>(null);
  // Tracks the latest in-flight request so a stale resolve doesn't
  // clobber a newer one (e.g., user pastes GUID-A then immediately
  // GUID-B before A's lookup returns).
  const reqIdRef = useRef(0);

  // Mount-only focus — DOM call, not setState, so this doesn't trip the
  // "no setState in effect" rule.
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => inputRef.current?.focus());
  }, [open]);

  // Subscribe to the cache version so the stats footer stays live as
  // other parts of the app (in-page chips, batched list renders) populate
  // entries. `getCacheVersion` returns a monotonically increasing number
  // — a stable snapshot identity that `useSyncExternalStore` is happy with.
  useSyncExternalStore(subscribeCacheVersion, getCacheVersion, getCacheVersion);
  const stats = userCacheStats();

  const run = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setResult({ kind: "idle" });
      return;
    }
    const myReq = ++reqIdRef.current;
    setResult({ kind: "loading" });
    const res = await lookupUser(trimmed);
    if (myReq !== reqIdRef.current) return;
    if (!res.ok) {
      setResult({ kind: "error", message: res.error });
      return;
    }
    if (res.data === null) {
      setResult({ kind: "missing", guid: trimmed });
      return;
    }
    setResult({ kind: "found", user: res.data });
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void run(input);
    },
    [input, run]
  );

  const handleCopy = useCallback(() => {
    if (result.kind !== "found") return;
    void navigator.clipboard?.writeText(userToMarkdown(result.user));
  }, [result]);

  return (
    <Dialog
      open={open}
      onOpenChange={(_e, data) => {
        if (!data.open) onClose();
      }}
    >
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle
            action={
              <Button
                appearance="subtle"
                icon={<DismissRegular />}
                aria-label="Close"
                onClick={onClose}
              />
            }
          >
            Look up user by GUID
          </DialogTitle>
          <DialogContent>
            <form onSubmit={handleSubmit} className={styles.body}>
              <Text className={styles.hint} size={200}>
                Paste an Entra object ID. Resolved live from the Dataverse{" "}
                <code>aaduser</code> virtual table.
              </Text>
              <Field>
                <Input
                  ref={inputRef}
                  value={input}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  onChange={(_, data) => setInput(data.value)}
                  contentBefore={<PersonSearchRegular />}
                  spellCheck={false}
                  autoComplete="off"
                />
              </Field>
              <div>
                <Button
                  type="submit"
                  appearance="primary"
                  disabled={!input.trim() || result.kind === "loading"}
                  icon={
                    result.kind === "loading" ? <Spinner size="tiny" /> : undefined
                  }
                >
                  Resolve
                </Button>
              </div>

              {result.kind === "found" && (
                <ResultCard user={result.user} onCopy={handleCopy} />
              )}
              {result.kind === "missing" && (
                <div className={styles.missingCard}>
                  <Text weight="semibold">
                    Could not locate a current valid user with this GUID
                  </Text>
                  <div>
                    No <code>aaduser</code> row for{" "}
                    <code>{result.guid}</code>. This can mean one of two
                    things:
                    <ul style={{ marginTop: 4, marginBottom: 4, paddingInlineStart: 20 }}>
                      <li>
                        <strong>Deleted user account</strong> — the user once
                        existed but has been removed from Entra.
                      </li>
                      <li>
                        <strong>Service principal (Enterprise Application)</strong>{" "}
                        — e.g. a Power Platform Pipelines deployment identity.
                        Service principals live under{" "}
                        <em>Entra → Enterprise Applications</em> and don't
                        appear in <code>aaduser</code>. Look this GUID up
                        there as the SP's Object ID.
                      </li>
                    </ul>
                  </div>
                </div>
              )}
              {result.kind === "error" && (
                <div className={styles.errorCard}>
                  <Text weight="semibold">Lookup failed</Text>
                  <div>{result.message}</div>
                </div>
              )}
            </form>
          </DialogContent>
          <DialogActions>
            <div className={styles.footer}>
              <span>
                Cache: {stats.resolved} resolved · {stats.missing} missing
              </span>
              <Button
                appearance="subtle"
                size="small"
                onClick={() => {
                  clearUserCache();
                  setResult({ kind: "idle" });
                }}
              >
                Clear cache
              </Button>
            </div>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

interface ResultCardProps {
  user: UserRef;
  onCopy: () => void;
}

function ResultCard({ user, onCopy }: ResultCardProps) {
  const styles = useStyles();
  return (
    <div className={styles.resultCard}>
      <Avatar
        size={40}
        name={user.displayName}
        initials={initialsOf(user)}
        color="colorful"
      />
      <div className={styles.details}>
        <Text weight="semibold" size={400}>
          {user.displayName}
        </Text>
        <div className={styles.badgeRow}>
          {user.userType && (
            <Badge
              appearance="tint"
              color={user.userType === "Guest" ? "warning" : "informative"}
            >
              {user.userType}
            </Badge>
          )}
          {user.enabled === false && (
            <Badge appearance="tint" color="danger">
              Disabled
            </Badge>
          )}
        </div>
        {user.upn && (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>UPN</span>
            <span className={styles.detailValue}>{user.upn}</span>
          </div>
        )}
        {user.mail && user.mail !== user.upn && (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Mail</span>
            <span className={styles.detailValue}>{user.mail}</span>
          </div>
        )}
        {user.jobTitle && (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Title</span>
            <span className={styles.detailValue}>{user.jobTitle}</span>
          </div>
        )}
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>ID</span>
          <span className={styles.detailValue}>{user.id}</span>
        </div>
      </div>
      <Tooltip content="Copy as Markdown" relationship="label">
        <Button
          appearance="subtle"
          icon={<CopyRegular />}
          aria-label="Copy as Markdown"
          onClick={onCopy}
        />
      </Tooltip>
    </div>
  );
}
