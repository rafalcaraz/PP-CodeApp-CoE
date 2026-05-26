/**
 * LinkedDlpPolicyCard — renders the DLP policy linked to a Standard
 * custom group, plus a **drift summary** that compares the group's
 * env membership to what the policy actually covers.
 *
 * The card has four visible states:
 *
 *   1. Unlinked    → empty-state with a single "Link a DLP policy" button.
 *   2. Linked + loading → policy display name, scope badge, spinner.
 *   3. Linked + loaded  → policy + scope + drift summary
 *                         ("X of N envs in this group are covered",
 *                          "Y env(s) covered by this policy aren't in
 *                           the group"). A small expander lists the
 *                         affected envs by name.
 *   4. Linked + error   → cached name + MessageBar with the error.
 *
 * **Read-only by design.** The card never writes to PPAC. The intent
 * is to make any mismatch visible so the user can act in PPAC. A
 * future PR will add a "Sync to PPAC" action that pushes the group's
 * envs into the policy's `OnlyEnvironments` scope.
 *
 * **Drift math.** Defers to `policyAppliesToEnvironment` from
 * `data/dlpPolicies` so the predicate matches what the env-detail
 * coverage view shows. That predicate handles all four scope types
 * (`AllEnvironments`, `OnlyEnvironments`, `ExceptEnvironments`,
 * `SingleEnvironment`) — see comments in `dlpPolicies.ts` for the
 * id-normalization rules.
 */

import { useEffect, useState } from "react";
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Badge,
  Button,
  Caption1,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  LinkRegular,
  EditRegular,
  DismissRegular,
  ShieldRegular,
  OpenRegular,
} from "@fluentui/react-icons";
import {
  getDlpPolicy,
  ppacDlpPolicyUrl,
} from "../../../data/dlpPolicies";
import {
  computeStandardGroupDlpDrift,
  type StandardGroupDlpDrift,
} from "../../../data/standardGroupDlpDrift";
import type { PolicyV2 } from "../../../generated/models/PowerPlatformforAdminsModel";
import type { EnvironmentRow } from "../../../data/inventory";
import type { StandardCustomGroup } from "../../../data/standardGroups";

const useStyles = makeStyles({
  card: {
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  headerTitle: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    fontWeight: tokens.fontWeightSemibold,
    flex: 1,
    minWidth: 0,
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    flexShrink: 0,
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: tokens.spacingVerticalS,
    paddingBlock: tokens.spacingVerticalXS,
  },
  emptyText: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  linkedBody: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  policyRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
  policyName: {
    fontWeight: tokens.fontWeightSemibold,
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  driftRow: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  driftLine: {
    fontSize: tokens.fontSizeBase200,
  },
  driftOk: {
    color: tokens.colorPaletteGreenForeground1,
  },
  driftWarn: {
    color: tokens.colorPaletteDarkOrangeForeground1,
  },
  envList: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    paddingBlock: tokens.spacingVerticalXS,
  },
  envItem: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
});

interface Props {
  group: StandardCustomGroup;
  envsInGroup: EnvironmentRow[];
  allEnvs: EnvironmentRow[];
  onLinkClick: () => void;
  onUnlink: () => void;
}

export function LinkedDlpPolicyCard({
  group,
  envsInGroup,
  allEnvs,
  onLinkClick,
  onUnlink,
}: Props) {
  const styles = useStyles();
  const policyId = group.dlpPolicyId;
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "loaded"; policy: PolicyV2 }
    | { kind: "error"; message: string }
  >(() => (policyId ? { kind: "loading" } : { kind: "idle" }));

  // "Adjust state when a prop changes" pattern (React docs). Tracking
  // the snapshot in state lets us reset to loading/idle synchronously
  // when `policyId` flips, without calling `setState` from inside the
  // effect (which the project's lint rules forbid because it causes
  // cascading renders). The effect below only writes from the async
  // fetch callback.
  const [snapshotPolicyId, setSnapshotPolicyId] = useState<string | undefined>(
    policyId,
  );
  if (policyId !== snapshotPolicyId) {
    setSnapshotPolicyId(policyId);
    setState(policyId ? { kind: "loading" } : { kind: "idle" });
  }

  useEffect(() => {
    if (!policyId) return;
    let cancelled = false;
    (async () => {
      const res = await getDlpPolicy(policyId);
      if (cancelled) return;
      if (res.ok) {
        setState({ kind: "loaded", policy: res.data });
      } else {
        setState({ kind: "error", message: res.error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [policyId]);

  // ---- Empty (unlinked) state -------------------------------------------
  if (!policyId) {
    return (
      <div className={styles.card}>
        <div className={styles.header}>
          <Text className={styles.headerTitle}>
            <ShieldRegular />
            DLP policy
          </Text>
        </div>
        <div className={styles.empty}>
          <Text className={styles.emptyText}>
            No DLP policy is linked to this group. Link one to see which
            environments in this group are covered, and to spot drift
            against the policy's scope in PPAC.
          </Text>
          <Button
            appearance="primary"
            icon={<LinkRegular />}
            onClick={onLinkClick}
          >
            Link a DLP policy
          </Button>
        </div>
      </div>
    );
  }

  // ---- Linked states ----------------------------------------------------
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <Text className={styles.headerTitle}>
          <ShieldRegular />
          DLP policy
        </Text>
        <div className={styles.headerActions}>
          <Button
            size="small"
            appearance="subtle"
            icon={<EditRegular />}
            onClick={onLinkClick}
          >
            Change
          </Button>
          <Button
            size="small"
            appearance="subtle"
            icon={<DismissRegular />}
            onClick={onUnlink}
          >
            Unlink
          </Button>
        </div>
      </div>
      <LinkedPolicyBody
        group={group}
        envsInGroup={envsInGroup}
        allEnvs={allEnvs}
        state={state}
      />
    </div>
  );
}

interface LinkedBodyProps {
  group: StandardCustomGroup;
  envsInGroup: EnvironmentRow[];
  allEnvs: EnvironmentRow[];
  state:
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "loaded"; policy: PolicyV2 }
    | { kind: "error"; message: string };
}

function LinkedPolicyBody({
  group,
  envsInGroup,
  allEnvs,
  state,
}: LinkedBodyProps) {
  const styles = useStyles();
  const policyId = group.dlpPolicyId ?? "";
  const cachedName = group.dlpPolicyDisplayName ?? policyId;

  if (state.kind === "loading" || state.kind === "idle") {
    return (
      <div className={styles.linkedBody}>
        <div className={styles.policyRow}>
          <Text className={styles.policyName} size={300}>
            {cachedName}
          </Text>
        </div>
        <Spinner size="extra-small" label="Loading coverage…" />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className={styles.linkedBody}>
        <div className={styles.policyRow}>
          <Text className={styles.policyName} size={300}>
            {cachedName}
          </Text>
        </div>
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>Couldn't load DLP policy</MessageBarTitle>
            {state.message} — the policy may have been deleted in PPAC.
            Unlink and pick another, or open it in PPAC to verify.
          </MessageBarBody>
        </MessageBar>
      </div>
    );
  }

  // Loaded — compute drift summary.
  const policy = state.policy;
  const drift = computeStandardGroupDlpDrift(policy, envsInGroup, allEnvs);
  const scope = policy.environmentType || "AllEnvironments";

  return (
    <div className={styles.linkedBody}>
      <div className={styles.policyRow}>
        <Text className={styles.policyName} size={300}>
          {policy.displayName || policy.name}
        </Text>
        <Badge appearance="outline">{scope}</Badge>
        <Button
          size="small"
          appearance="subtle"
          icon={<OpenRegular />}
          as="a"
          // Fluent v9 `as="a"` accepts href via spread.
          {...({ href: ppacDlpPolicyUrl(policy.name), target: "_blank", rel: "noreferrer" } as Record<string, string>)}
        >
          Open in PPAC
        </Button>
      </div>

      <DriftSummary drift={drift} envsInGroupCount={envsInGroup.length} />
    </div>
  );
}

function DriftSummary({
  drift,
  envsInGroupCount,
}: {
  drift: StandardGroupDlpDrift;
  envsInGroupCount: number;
}) {
  const styles = useStyles();
  const covered = drift.coveredInGroup.length;
  const uncovered = drift.uncoveredInGroup.length;
  const extraneous = drift.inPolicyNotInGroup.length;

  // No envs to evaluate — the card still shouldn't pretend there's a
  // problem.
  if (envsInGroupCount === 0 && extraneous === 0) {
    return (
      <Caption1 className={styles.meta}>
        This group has no environments yet, so there's nothing to compare
        against the policy's scope.
      </Caption1>
    );
  }

  return (
    <div className={styles.driftRow}>
      <Text
        className={mergeClasses(
          styles.driftLine,
          uncovered === 0 ? styles.driftOk : styles.driftWarn,
        )}
      >
        {covered} of {envsInGroupCount} environment
        {envsInGroupCount === 1 ? "" : "s"} in this group{" "}
        {covered === 1 ? "is" : "are"} covered by this policy.
      </Text>
      {uncovered > 0 && (
        <Accordion collapsible>
          <AccordionItem value="uncovered">
            <AccordionHeader>
              {uncovered} not covered — show details
            </AccordionHeader>
            <AccordionPanel>
              <div className={styles.envList}>
                {drift.uncoveredInGroup.map((env) => (
                  <Text key={env.id} className={styles.envItem}>
                    • {env.displayName || env.id}
                  </Text>
                ))}
              </div>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      )}

      {!drift.scopeIsBroad && extraneous > 0 && (
        <>
          <Text className={mergeClasses(styles.driftLine, styles.driftWarn)}>
            {extraneous} environment{extraneous === 1 ? "" : "s"} covered by
            this policy {extraneous === 1 ? "isn't" : "aren't"} in this
            group.
          </Text>
          <Accordion collapsible>
            <AccordionItem value="extraneous">
              <AccordionHeader>Show details</AccordionHeader>
              <AccordionPanel>
                <div className={styles.envList}>
                  {drift.inPolicyNotInGroup.map((env) => (
                    <Text key={env.id} className={styles.envItem}>
                      • {env.displayName || env.id}
                    </Text>
                  ))}
                </div>
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        </>
      )}

      {drift.scopeIsBroad && (
        <Caption1 className={styles.meta}>
          This policy uses a broad scope — it targets every environment
          (subject to any exclusions configured in PPAC).
        </Caption1>
      )}
    </div>
  );
}
