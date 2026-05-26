/**
 * DLP policy picker — modal that lists all DLP policies in the tenant
 * and lets the user pick one to link to a Standard custom group.
 *
 * Drains `listDlpPolicies()` on first open. The result is small (DLP
 * counts are tens, not thousands) and `listDlpPolicies` already pages
 * through `nextLink`, so no virtualization or incremental loading is
 * needed.
 *
 * Why a dialog (not a side panel like `AvailableEnvsPanel`): linking
 * a DLP is a focused, single-decision action, not a workflow you'd
 * keep open while doing other things. Modal matches the user's intent.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Spinner,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
  type InputOnChangeData,
} from "@fluentui/react-components";
import { SearchRegular } from "@fluentui/react-icons";
import { listDlpPolicies } from "../../../data/dlpPolicies";
import type { PolicyV2 } from "../../../generated/models/PowerPlatformforAdminsModel";
import { ErrorPane } from "../../../components/Status";

const useStyles = makeStyles({
  surface: {
    maxWidth: "640px",
    width: "min(640px, 92vw)",
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  searchRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    maxHeight: "420px",
    overflowY: "auto",
    paddingRight: tokens.spacingHorizontalXS,
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalS,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    backgroundColor: tokens.colorNeutralBackground1,
    textAlign: "left",
    width: "100%",
    ":hover": {
      borderTopColor: tokens.colorBrandStroke1,
      borderRightColor: tokens.colorBrandStroke1,
      borderBottomColor: tokens.colorBrandStroke1,
      borderLeftColor: tokens.colorBrandStroke1,
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  rowSelected: {
    borderTopColor: tokens.colorBrandStroke1,
    borderRightColor: tokens.colorBrandStroke1,
    borderBottomColor: tokens.colorBrandStroke1,
    borderLeftColor: tokens.colorBrandStroke1,
    backgroundColor: tokens.colorBrandBackground2,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  rowName: {
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  rowMeta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  badges: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    flexShrink: 0,
  },
  loadingRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    paddingBlock: tokens.spacingVerticalL,
  },
  emptyRow: {
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
    textAlign: "center",
    paddingBlock: tokens.spacingVerticalL,
  },
});

interface Props {
  open: boolean;
  /** GUID of the currently-linked policy, if any. Shown as "Selected"
   *  in the list to confirm the current state. */
  currentPolicyId: string | undefined;
  onDismiss: () => void;
  onSelect: (policy: { id: string; displayName: string }) => void;
}

export function DlpPolicyPickerDialog({
  open,
  currentPolicyId,
  onDismiss,
  onSelect,
}: Props) {
  const styles = useStyles();
  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open) onDismiss();
      }}
    >
      <DialogSurface className={styles.surface}>
        {open && (
          <PickerBody
            currentPolicyId={currentPolicyId}
            onDismiss={onDismiss}
            onSelect={onSelect}
          />
        )}
      </DialogSurface>
    </Dialog>
  );
}

interface BodyProps {
  currentPolicyId: string | undefined;
  onDismiss: () => void;
  onSelect: (policy: { id: string; displayName: string }) => void;
}

function PickerBody({ currentPolicyId, onDismiss, onSelect }: BodyProps) {
  const styles = useStyles();
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; policies: PolicyV2[] }
    | { kind: "error"; message: string }
  >({ kind: "loading" });
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listDlpPolicies();
      if (cancelled) return;
      if (res.ok) {
        setState({ kind: "ready", policies: res.data });
      } else {
        setState({ kind: "error", message: res.error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (state.kind !== "ready") return [];
    const q = search.trim().toLowerCase();
    if (!q) return state.policies;
    return state.policies.filter((p) =>
      (p.displayName || p.name || "").toLowerCase().includes(q),
    );
  }, [state, search]);

  return (
    <DialogBody>
      <DialogTitle>Link a DLP policy</DialogTitle>
      <DialogContent>
        <div className={styles.body}>
          <Text className={styles.rowMeta}>
            Linking is local to this app — no changes are written to PPAC.
            The link is used to surface drift between the group's
            environments and the policy's scope.
          </Text>
          <div className={styles.searchRow}>
            <Input
              contentBefore={<SearchRegular />}
              value={search}
              placeholder="Search policies by name"
              onChange={(_, d: InputOnChangeData) => setSearch(d.value)}
              style={{ flex: 1 }}
            />
          </div>
          {state.kind === "loading" && (
            <div className={styles.loadingRow}>
              <Spinner label="Loading DLP policies…" />
            </div>
          )}
          {state.kind === "error" && (
            <ErrorPane
              title="Couldn't load DLP policies"
              message={state.message}
            />
          )}
          {state.kind === "ready" && (
            <div className={styles.list}>
              {filtered.length === 0 ? (
                <div className={styles.emptyRow}>
                  No policies match that search.
                </div>
              ) : (
                filtered.map((p) => {
                  const isCurrent = p.name === currentPolicyId;
                  const envCount = p.environments?.length ?? 0;
                  const scope = p.environmentType || "AllEnvironments";
                  return (
                    <button
                      key={p.name}
                      type="button"
                      className={mergeClasses(
                        styles.row,
                        isCurrent && styles.rowSelected,
                      )}
                      onClick={() =>
                        onSelect({
                          id: p.name,
                          displayName: p.displayName || p.name,
                        })
                      }
                    >
                      <div className={styles.rowBody}>
                        <Text className={styles.rowName} size={300}>
                          {p.displayName || p.name}
                        </Text>
                        <Text className={styles.rowMeta}>
                          {scope}
                          {scope !== "AllEnvironments"
                            ? ` · ${envCount} env${envCount === 1 ? "" : "s"}`
                            : ""}
                        </Text>
                      </div>
                      <div className={styles.badges}>
                        {isCurrent && (
                          <Badge appearance="filled" color="brand">
                            Linked
                          </Badge>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </DialogContent>
      <DialogActions>
        <Button appearance="secondary" onClick={onDismiss}>
          Close
        </Button>
      </DialogActions>
    </DialogBody>
  );
}
