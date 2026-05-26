/**
 * "Demo the future" dialog — fires when the user drags a Managed env
 * onto a different MS env group lane in the Tier 2 Kanban. The point
 * is to *teach* what the eventual mutation feature would do, without
 * actually performing the write yet.
 *
 * Two visual modes via `source.kind`:
 *  - `ms-group` — env moved from one MS group to another. Message
 *    emphasizes rule inheritance ("would inherit X's rules").
 *  - `loose-managed` — env was Loose Managed and got dragged into an
 *    MS group. Message emphasizes promotion ("would join X and start
 *    inheriting governance").
 *
 * On open the dialog also runs a connector impact analysis
 * (`analyzeZoneMoveAcpImpact`): drains the source env's resources,
 * extracts every connector they use, and diffs against the target
 * group's ACP allow-list. The result drives an extra section below
 * the inheritance list with four possible framings:
 *   - target group has no ACP → connector access wouldn't change
 *   - all used connectors allowed → safe move
 *   - some not allowed → list at-risk connectors + affected resources
 *   - env has no resources → nothing to evaluate
 *
 * Dismiss-button behavior tracks the analysis:
 *   - "Analyzing…" (disabled) while the fetch is in flight, so the
 *     user can't dismiss before they've seen what they'd be moving.
 *   - "Got it" once the analysis comes back clean (no ACP, all
 *     allowed, or empty env).
 *   - "Proceed anyway" once at-risk connectors are surfaced — flips
 *     the language from neutral acknowledgment to risk acceptance.
 *
 * Action: a primary "Open target group in PPAC" deep link so the user
 * can do the move manually right now.
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
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Link,
  makeStyles,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  Text,
  tokens,
} from "@fluentui/react-components";
import {
  CheckmarkCircleRegular,
  InfoRegular,
  OpenRegular,
  WarningRegular,
} from "@fluentui/react-icons";
import { useNavigate } from "react-router-dom";
import type { EnvironmentRow } from "../../../data/inventory";
import {
  analyzeZoneMoveAcpImpact,
  type ZoneMoveImpactResult,
} from "../../../data/zoneMoveImpact";
import type { EnvDragSource } from "./EnvRow";

const PPAC_ENV_GROUP_BASE =
  "https://admin.powerplatform.microsoft.com/manage/environment-groups";

export interface EnvMoveDemoTarget {
  groupId: string;
  groupDisplayName: string;
}

interface Props {
  open: boolean;
  env: EnvironmentRow | null;
  source: EnvDragSource | null;
  target: EnvMoveDemoTarget | null;
  onDismiss: () => void;
}

const useStyles = makeStyles({
  surface: {
    maxWidth: "640px",
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  inheritList: {
    margin: 0,
    paddingLeft: tokens.spacingHorizontalL,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  highlight: {
    fontWeight: tokens.fontWeightSemibold,
  },
  impactSection: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    paddingTop: tokens.spacingVerticalS,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  impactHeader: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
  },
  impactStatusRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  iconGood: { color: tokens.colorPaletteGreenForeground1, flexShrink: 0 },
  iconInfo: { color: tokens.colorBrandForeground1, flexShrink: 0 },
  iconWarn: { color: tokens.colorPaletteDarkOrangeForeground1, flexShrink: 0 },
  atRiskAccordion: {
    marginTop: tokens.spacingVerticalXS,
  },
  atRiskHeader: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    width: "100%",
  },
  atRiskHeaderName: {
    fontWeight: tokens.fontWeightSemibold,
  },
  atRiskHeaderCount: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    marginLeft: "auto",
  },
  resourceList: {
    margin: 0,
    paddingLeft: tokens.spacingHorizontalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    fontSize: tokens.fontSizeBase200,
  },
  resourceTypeBadge: {
    marginRight: tokens.spacingHorizontalXS,
  },
});

export function EnvMoveDemoDialog({
  open,
  env,
  source,
  target,
  onDismiss,
}: Props) {
  const styles = useStyles();
  const navigate = useNavigate();
  const ready = env !== null && source !== null && target !== null;

  // Lifted impact state so the dialog actions (Got it / Proceed anyway)
  // can react to it. Stored alongside the (envId, targetGroupId) key
  // it was computed against so a stale result from a previous target
  // doesn't leak into the new analysis between user actions.
  //
  // No synchronous setState in the effect body — `setAnalysisResult`
  // is only called inside the async fetch's resolution callback. The
  // "currently analyzing" status is derived (not stored), via the
  // `effectiveImpactState` calc below.
  const analysisKey =
    env && target ? `${env.id}::${target.groupId}` : null;
  const [analysisResult, setAnalysisResult] = useState<
    { key: string; state: ImpactFetchState } | null
  >(null);

  useEffect(() => {
    if (!open || !env || !target || !analysisKey) return;
    const key = analysisKey;
    let cancelled = false;
    void (async () => {
      const res = await analyzeZoneMoveAcpImpact(
        env.id,
        env.displayName,
        target.groupId,
        target.groupDisplayName,
      );
      if (cancelled) return;
      const next: ImpactFetchState = res.ok
        ? { kind: "ready", data: res.data }
        : { kind: "error", message: res.error };
      setAnalysisResult({ key, state: next });
    })();
    return () => {
      cancelled = true;
    };
  }, [open, env, target, analysisKey]);

  // Derived state — loading until the async fetch reports for the
  // *current* (envId, targetGroupId) key.
  const impactState: ImpactFetchState =
    analysisResult && analysisResult.key === analysisKey
      ? analysisResult.state
      : { kind: "loading" };

  const isAnalyzing = impactState.kind === "loading";
  const hasAtRisk =
    impactState.kind === "ready" &&
    impactState.data.atRiskConnectors.length > 0;
  // Button label flips to "Proceed anyway" the moment we know there's
  // at-risk connectors, signaling the user is acknowledging risk
  // instead of just dismissing a neutral preview.
  const dismissLabel = isAnalyzing
    ? "Analyzing…"
    : hasAtRisk
      ? "Proceed anyway"
      : "Got it";
  // While analyzing, the dismiss button is non-actionable — the user
  // hasn't seen the connector impact yet and could miss a blocker.
  // Once results are in (or errored), they can dismiss either way.
  const dismissDisabled = isAnalyzing;

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        // Don't close the dialog while the analysis is still running —
        // the user might dismiss a result they never saw.
        if (!data.open && !isAnalyzing) onDismiss();
      }}
    >
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>Just this easy — coming soon</DialogTitle>
          <DialogContent>
            {ready ? (
              <div className={styles.body}>
                <MessageBar intent="info">
                  <MessageBarBody>
                    <MessageBarTitle>Preview, not a real move</MessageBarTitle>
                    Nothing changed in Power Platform. This dialog shows
                    what the eventual drag-to-move feature would do.
                  </MessageBarBody>
                </MessageBar>

                {source.kind === "ms-group" ? (
                  <Text>
                    Moving <span className={styles.highlight}>{env.displayName}</span>{" "}
                    from <span className={styles.highlight}>{source.groupDisplayName}</span>{" "}
                    into <span className={styles.highlight}>{target.groupDisplayName}</span>{" "}
                    would be a single drag-and-drop. The environment would
                    automatically inherit the target group's rules:
                  </Text>
                ) : (
                  <Text>
                    <span className={styles.highlight}>{env.displayName}</span>{" "}
                    is a Loose Managed environment — paying for Managed
                    governance with no group-level rules applied. Dropping
                    it into <span className={styles.highlight}>{target.groupDisplayName}</span>{" "}
                    would promote it into the group and start applying
                    that group's rules immediately:
                  </Text>
                )}

                <ul className={styles.inheritList}>
                  <li>
                    <strong>Advanced Connector Policy (ACP)</strong> — this
                    group's connector restrictions (when ACP is configured,
                    it supersedes tenant DLP for envs in this group)
                  </li>
                  <li>Sharing limits + maker welcome content</li>
                  <li>Solution checker enforcement level</li>
                  <li>IP firewall / Lockbox if the group requires them</li>
                  <li>Backup retention + AI feature gating</li>
                </ul>

                <Caption1>
                  Tenant DLP policies still apply unless this group has ACP
                  configured. Microsoft env groups don't bind DLP natively —
                  that's a known gap (the app exists partly to surface it).
                </Caption1>

                <Caption1>
                  For now, you can do this manually in the Power Platform
                  Admin Center. The link below opens the target group's
                  page where you can add or move the environment.
                </Caption1>

                <ConnectorImpactSection
                  state={impactState}
                  onNavigateToImpact={() => {
                    onDismiss();
                    navigate("/security/impact");
                  }}
                />
              </div>
            ) : null}
          </DialogContent>
          <DialogActions>
            <Button
              appearance="secondary"
              onClick={onDismiss}
              disabled={dismissDisabled}
            >
              {dismissLabel}
            </Button>
            {target && (
              <Button
                appearance="primary"
                icon={<OpenRegular />}
                as="a"
                href={`${PPAC_ENV_GROUP_BASE}/${target.groupId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onDismiss}
              >
                Open {target.groupDisplayName} in PPAC
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Connector impact section
// ---------------------------------------------------------------------------

interface ConnectorImpactSectionProps {
  state: ImpactFetchState;
  onNavigateToImpact: () => void;
}

type ImpactFetchState =
  | { kind: "loading" }
  | { kind: "ready"; data: ZoneMoveImpactResult }
  | { kind: "error"; message: string };

/**
 * Renders the "what would the target group's ACP do to this env's
 * connectors?" section underneath the inheritance list. The four
 * states ({not-configured, all-allowed, at-risk, env-has-no-resources})
 * each get their own framing — the goal is to make the dialog stop
 * being a generic "here's what would happen" and start being a
 * specific "here's what would break if you moved THIS env".
 *
 * Stateless. The parent owns the fetch lifecycle so the dialog action
 * buttons can react to the result (the dismiss button flips from
 * "Got it" → "Proceed anyway" when at-risk connectors are found, and
 * is disabled while analyzing).
 */
function ConnectorImpactSection({
  state,
  onNavigateToImpact,
}: ConnectorImpactSectionProps) {
  const styles = useStyles();

  return (
    <div className={styles.impactSection}>
      <div className={styles.impactHeader}>
        <InfoRegular className={styles.iconInfo} aria-hidden />
        Connector impact for this environment
      </div>

      {state.kind === "loading" ? (
        <div className={styles.impactStatusRow}>
          <Spinner size="tiny" label="Analyzing connector usage…" />
        </div>
      ) : state.kind === "error" ? (
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>Couldn't run the analysis</MessageBarTitle>
            {state.message}
          </MessageBarBody>
        </MessageBar>
      ) : (
        <ConnectorImpactReady
          data={state.data}
          onNavigateToImpact={onNavigateToImpact}
        />
      )}
    </div>
  );
}

function ConnectorImpactReady({
  data,
  onNavigateToImpact,
}: {
  data: ZoneMoveImpactResult;
  onNavigateToImpact: () => void;
}) {
  const styles = useStyles();
  const { targetAcpState, atRiskConnectors, usedConnectors, summary } = data;

  // Branch 1: env has no resources at all. Surface explicitly so the
  // user doesn't conflate "no impact" with "didn't run".
  if (summary.totalResources === 0) {
    return (
      <div className={styles.impactStatusRow}>
        <InfoRegular className={styles.iconInfo} aria-hidden />
        <Text>
          No apps, flows, or agents live in this environment — nothing to
          evaluate.
        </Text>
      </div>
    );
  }

  // Branch 2: target group has no ACP configured. Tenant DLP still
  // applies but no ACP-specific restriction would kick in for the move.
  if (targetAcpState === "not-configured") {
    return (
      <div className={styles.impactStatusRow}>
        <CheckmarkCircleRegular className={styles.iconGood} aria-hidden />
        <Text>
          Target group has no Advanced Connector Policy configured —
          connector access wouldn't change for this environment. Tenant DLP
          policies still apply.
        </Text>
      </div>
    );
  }

  // Branch 3: ACP configured but every used connector is on the
  // allow-list. Best-case outcome; surface it explicitly so the user
  // can move with confidence.
  if (atRiskConnectors.length === 0) {
    return (
      <div className={styles.impactStatusRow}>
        <CheckmarkCircleRegular className={styles.iconGood} aria-hidden />
        <Text>
          All {summary.totalConnectors} connector
          {summary.totalConnectors === 1 ? "" : "s"} used by this
          environment {summary.totalConnectors === 1 ? "is" : "are"} on the
          target group's ACP allow-list. Nothing in scope would lose access
          from this move.
          {targetAcpState === "enforced" && (
            <>
              {" "}
              <em>(ACP-only is on — ACP supersedes tenant DLP for envs in
              this group.)</em>
            </>
          )}
        </Text>
      </div>
    );
  }

  // Branch 4: at-risk connectors. The actionable case the dialog now
  // exists to surface.
  const stronglyFramed = targetAcpState === "enforced";
  return (
    <>
      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>
            {summary.atRiskConnectors} connector
            {summary.atRiskConnectors === 1 ? "" : "s"} used by this
            environment {summary.atRiskConnectors === 1 ? "isn't" : "aren't"}{" "}
            on the target group's ACP allow-list
          </MessageBarTitle>
          {stronglyFramed
            ? "ACP-only is on for the target group — ACP supersedes tenant DLP, so the resources below would lose access to these connectors after the move."
            : "The target group has an ACP allow-list. Resources below would be blocked from these connectors by the ACP once the move happens."}{" "}
          {summary.impactedResources} resource
          {summary.impactedResources === 1 ? "" : "s"} affected in total
          out of {usedConnectors.length} connector
          {usedConnectors.length === 1 ? "" : "s"} used by this environment.
        </MessageBarBody>
      </MessageBar>

      <Accordion className={styles.atRiskAccordion} multiple collapsible>
        {atRiskConnectors.map((c) => (
          <AccordionItem key={c.slug} value={c.slug}>
            <AccordionHeader expandIconPosition="end">
              <div className={styles.atRiskHeader}>
                <WarningRegular className={styles.iconWarn} aria-hidden />
                <span className={styles.atRiskHeaderName}>
                  {c.displayName}
                  {c.riskLevel === "action-restricted" && (
                    <Badge
                      appearance="tint"
                      color="warning"
                      size="small"
                      style={{ marginLeft: "6px" }}
                    >
                      action-restricted
                    </Badge>
                  )}
                </span>
                <span className={styles.atRiskHeaderCount}>
                  {c.resources.length} resource
                  {c.resources.length === 1 ? "" : "s"}
                </span>
              </div>
            </AccordionHeader>
            <AccordionPanel>
              {c.riskLevel === "action-restricted" &&
                c.restrictedOperations.length > 0 && (
                  <Text size={200} style={{ display: "block", marginBottom: "4px" }}>
                    Disallowed operations:{" "}
                    {c.restrictedOperations.map((op) => (
                      <code key={op} style={{ marginRight: "4px" }}>
                        {op}
                      </code>
                    ))}
                  </Text>
                )}
              <ul className={styles.resourceList}>
                {c.topResources.map((r) => (
                  <li key={`${r.type}::${r.id}`}>
                    <Badge
                      appearance="outline"
                      size="extra-small"
                      className={styles.resourceTypeBadge}
                    >
                      {shortType(r.type)}
                    </Badge>
                    {r.detailHref ? (
                      <Link href={`#${r.detailHref}`}>{r.displayName || r.id}</Link>
                    ) : (
                      <span>{r.displayName || r.id}</span>
                    )}
                  </li>
                ))}
                {c.resources.length > c.topResources.length && (
                  <li>
                    <Caption1>
                      + {c.resources.length - c.topResources.length} more —{" "}
                      <Link onClick={onNavigateToImpact}>
                        view full impact
                      </Link>
                    </Caption1>
                  </li>
                )}
              </ul>
            </AccordionPanel>
          </AccordionItem>
        ))}
      </Accordion>

      <Caption1>
        Detection only — this dialog never blocks the move (which is
        manual today). Use the Security → Impact view for the full
        per-connector picture.
      </Caption1>
    </>
  );
}

/** Compact resource-type label for the inline badge. Kept local to
 *  avoid pulling the larger `friendlyResourceType` chain into the
 *  dialog bundle. */
function shortType(type: string): string {
  switch (type) {
    case "microsoft.powerapps/canvasapps":
      return "Canvas";
    case "microsoft.powerapps/modeldrivenapps":
      return "Model";
    case "microsoft.powerapps/codeapps":
      return "Code";
    case "microsoft.powerapps/apps":
      return "App";
    case "microsoft.powerautomate/cloudflows":
      return "Flow";
    case "microsoft.powerautomate/agentflows":
      return "Agent flow";
    case "microsoft.powerautomate/m365agentflows":
      return "M365 flow";
    case "microsoft.copilotstudio/agents":
      return "Agent";
    default:
      return "Resource";
  }
}
