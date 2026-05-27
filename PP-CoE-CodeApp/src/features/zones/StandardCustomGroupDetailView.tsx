/**
 * Standard Custom Group Detail — the focused workspace for ONE custom
 * group. Mirrors the existing `EnvironmentGroupDetail` (which serves
 * Microsoft env groups) in layout and purpose, with two differences:
 *
 *   1. The data lives in localStorage (our `data/standardGroups.ts`),
 *      so adds + removes happen instantly with no API round-trip.
 *   2. Type purity is enforced — adding a Managed env is rejected at
 *      the data layer and surfaced as a toast / inline note.
 *
 * Drag is intentionally NOT used here. Adding envs into a group is a
 * focused, possibly bulk action — click-to-add is faster and more
 * reliable on touch devices than dragging from a side panel.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Breadcrumb,
  BreadcrumbButton,
  BreadcrumbDivider,
  BreadcrumbItem,
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  makeStyles,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Text,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowLeftRegular,
  ChartMultipleRegular,
  DeleteRegular,
  DismissRegular,
  EditRegular,
} from "@fluentui/react-icons";
import { useNavigate, useParams } from "react-router-dom";
import {
  listEnvironments,
  type EnvironmentRow,
} from "../../data/inventory";
import {
  addEnvToStandardGroup,
  deleteStandardGroup,
  getStandardGroup,
  pruneDeletedEnvs,
  removeEnvFromStandardGroup,
  setStandardGroupDlpPolicy,
  updateStandardGroup,
  type StandardCustomGroup,
} from "../../data/standardGroups";
import { useZones } from "../../hooks/useZones";
import { ErrorPane, LoadingPane } from "../../components/Status";
import { StandardGroupEditorDialog } from "./_components/StandardGroupEditorDialog";
import { AvailableEnvsPanel } from "./_components/AvailableEnvsPanel";
import { LinkedDlpPolicyCard } from "./_components/LinkedDlpPolicyCard";
import { DlpPolicyPickerDialog } from "./_components/DlpPolicyPickerDialog";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    height: "100%",
    minHeight: 0,
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: tokens.spacingHorizontalM,
    paddingBlock: tokens.spacingVerticalS,
  },
  colorStripe: {
    width: "6px",
    minHeight: "60px",
    borderRadius: tokens.borderRadiusSmall,
    flexShrink: 0,
  },
  headerBody: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    minWidth: 0,
  },
  groupIcon: {
    fontSize: tokens.fontSizeBase600,
  },
  groupTitle: {
    fontWeight: tokens.fontWeightSemibold,
  },
  description: {
    color: tokens.colorNeutralForeground3,
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    flexShrink: 0,
  },
  body: {
    display: "flex",
    gap: tokens.spacingHorizontalL,
    flex: 1,
    minHeight: 0,
  },
  main: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    overflowY: "auto",
    paddingInline: tokens.spacingHorizontalXS,
  },
  envListCard: {
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  envRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalS,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  envBody: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
  envName: {
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  envMeta: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  emptyEnvs: {
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase200,
    fontStyle: "italic",
    textAlign: "center",
    paddingBlock: tokens.spacingVerticalL,
  },
});

export function StandardCustomGroupDetailView() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { groupId = "" } = useParams<{ groupId: string }>();
  // Subscribe to the localStorage change event so adds + removes
  // reflect immediately. We re-read the group from storage on every
  // render because the hook drives re-renders on any zones-related change.
  const { refresh } = useZones();
  const [group, setGroup] = useState<StandardCustomGroup | null>(() =>
    getStandardGroup(groupId),
  );
  const [envsState, setEnvsState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; rows: EnvironmentRow[] }
    | { kind: "error"; message: string }
  >({ kind: "loading" });
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dlpPickerOpen, setDlpPickerOpen] = useState(false);
  const [panelSearch, setPanelSearch] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Re-read the group whenever storage changes (useZones drives refresh).
  // Avoid useEffect-driven setState by deriving the latest value each
  // render — useZones already triggers re-renders on every relevant
  // change.
  const currentGroup = getStandardGroup(groupId);
  if (currentGroup?.updatedAt !== group?.updatedAt) {
    setGroup(currentGroup);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listEnvironments();
      if (cancelled) return;
      if (res.ok) {
        setEnvsState({ kind: "ready", rows: res.data });
        // Silently drop any envIds in any custom group that no longer
        // exist in the tenant (env was deleted in PPAC). Cheap, runs
        // once per detail-page load.
        pruneDeletedEnvs(new Set(res.data.map((e) => e.id)));
        refresh();
      } else {
        setEnvsState({ kind: "error", message: res.error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const envsInGroup = useMemo(() => {
    if (!group || envsState.kind !== "ready") return [];
    const memberIds = new Set(group.envIds);
    return envsState.rows.filter((env) => memberIds.has(env.id));
  }, [group, envsState]);

  const envIdsInGroup = useMemo(
    () => new Set(group?.envIds ?? []),
    [group],
  );

  if (envsState.kind === "loading") {
    return <LoadingPane label="Loading environments…" />;
  }
  if (envsState.kind === "error") {
    return (
      <ErrorPane
        title="Couldn't load environments"
        message={envsState.message}
      />
    );
  }
  if (!group) {
    return (
      <ErrorPane
        title="Custom group not found"
        message="That Standard custom group may have been deleted. Go back to the Zones board."
      />
    );
  }

  const handleAdd = (env: EnvironmentRow) => {
    setErrorMessage(null);
    const result = addEnvToStandardGroup(group.id, env);
    if (!result.ok) {
      setErrorMessage(result.reason);
    }
  };

  const handleRemove = (envId: string) => {
    removeEnvFromStandardGroup(envId);
  };

  const handleEditSubmit = (input: {
    displayName: string;
    description: string;
    color: string;
    icon: string;
  }) => {
    updateStandardGroup(group.id, input);
    setEditorOpen(false);
  };

  const handleDeleteConfirm = () => {
    deleteStandardGroup(group.id);
    setDeleteOpen(false);
    navigate("/zones");
  };

  const handleDlpSelect = (policy: { id: string; displayName: string }) => {
    setStandardGroupDlpPolicy(group.id, policy);
    setDlpPickerOpen(false);
  };

  const handleDlpUnlink = () => {
    setStandardGroupDlpPolicy(group.id, null);
  };

  return (
    <div className={styles.root}>
      <Breadcrumb>
        <BreadcrumbItem>
          <BreadcrumbButton
            icon={<ArrowLeftRegular />}
            onClick={() => navigate("/zones")}
          >
            Zones board
          </BreadcrumbButton>
        </BreadcrumbItem>
        <BreadcrumbDivider />
        <BreadcrumbItem>
          <BreadcrumbButton current>{group.displayName}</BreadcrumbButton>
        </BreadcrumbItem>
      </Breadcrumb>

      <div className={styles.header}>
        <div
          className={styles.colorStripe}
          style={{ backgroundColor: group.color }}
          aria-hidden="true"
        />
        <div className={styles.headerBody}>
          <div className={styles.titleRow}>
            <span className={styles.groupIcon} aria-hidden="true">
              {group.icon}
            </span>
            <Text size={600} className={styles.groupTitle}>
              {group.displayName}
            </Text>
            <Badge appearance="outline" color="subtle">
              Standard custom group
            </Badge>
          </div>
          {group.description && (
            <Text className={styles.description}>{group.description}</Text>
          )}
          <Text className={styles.meta}>
            {envsInGroup.length} environment
            {envsInGroup.length === 1 ? "" : "s"}
          </Text>
        </div>
        <div className={styles.headerActions}>
          <Button
            appearance="subtle"
            icon={<ChartMultipleRegular />}
            onClick={() => navigate(`/zones/custom-groups/${group.id}/reporting`)}
          >
            Reporting
          </Button>
          <Button
            appearance="subtle"
            icon={<EditRegular />}
            onClick={() => setEditorOpen(true)}
          >
            Edit
          </Button>
          <Button
            appearance="subtle"
            icon={<DeleteRegular />}
            onClick={() => setDeleteOpen(true)}
          >
            Delete
          </Button>
        </div>
      </div>

      {errorMessage && (
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>Couldn't add environment</MessageBarTitle>
            {errorMessage}
          </MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.body}>
        <div className={styles.main}>
          <LinkedDlpPolicyCard
            group={group}
            envsInGroup={envsInGroup}
            allEnvs={envsState.rows}
            onLinkClick={() => setDlpPickerOpen(true)}
            onUnlink={handleDlpUnlink}
          />
          <div className={styles.envListCard}>
            <Caption1>Environments in this group</Caption1>
            {envsInGroup.length === 0 ? (
              <div className={styles.emptyEnvs}>
                No environments yet. Add Standard envs from the side panel.
              </div>
            ) : (
              envsInGroup.map((env) => (
                <div key={env.id} className={styles.envRow}>
                  <div className={styles.envBody}>
                    <Text className={styles.envName} size={200}>
                      {env.displayName || "(unnamed)"}
                    </Text>
                    <Caption1 className={styles.envMeta}>
                      {env.environmentType}
                      {env.region ? ` · ${env.region}` : ""}
                    </Caption1>
                  </div>
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={<DismissRegular />}
                    aria-label={`Remove ${env.displayName}`}
                    onClick={() => handleRemove(env.id)}
                  >
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>
          <Caption1 className={styles.meta}>
            Type purity: only Standard envs can be added. Managed envs show as
            "Not eligible" in the side panel — they belong in a Microsoft env
            group instead.
          </Caption1>
        </div>
        <AvailableEnvsPanel
          groupId={group.id}
          allEnvs={envsState.rows}
          envIdsInGroup={envIdsInGroup}
          searchQuery={panelSearch}
          onSearchChange={setPanelSearch}
          onAdd={handleAdd}
        />
      </div>

      <StandardGroupEditorDialog
        open={editorOpen}
        group={group}
        onDismiss={() => setEditorOpen(false)}
        onSubmit={(input) => handleEditSubmit(input)}
      />

      <DlpPolicyPickerDialog
        open={dlpPickerOpen}
        currentPolicyId={group.dlpPolicyId}
        onDismiss={() => setDlpPickerOpen(false)}
        onSelect={handleDlpSelect}
      />

      <Dialog
        open={deleteOpen}
        onOpenChange={(_, data) => {
          if (!data.open) setDeleteOpen(false);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Delete Standard custom group?</DialogTitle>
            <DialogContent>
              <Text>
                Deleting <strong>{group.displayName}</strong> removes the
                group entirely. Its environments return to "loose Standard"
                status; the environments themselves are not affected.
              </Text>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                onClick={() => setDeleteOpen(false)}
              >
                Cancel
              </Button>
              <Button appearance="primary" onClick={handleDeleteConfirm}>
                Delete group
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
