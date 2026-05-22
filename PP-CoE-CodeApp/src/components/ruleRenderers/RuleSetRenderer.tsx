/**
 * Friendly per-id renderers for the **Model B** rule-based-policy
 * `ruleSets[]` payloads (the named, versioned ones with structured
 * `inputs`).
 *
 * Each known rule id gets its own small component that knows the input
 * schema for that rule and renders it in plain English. Unknown ids
 * fall through to a raw JSON viewer so we never lose data.
 *
 * Live payload samples for every renderer here live in
 * `PP-CoE-CodeApp/docs/admin-payload-samples.md` → Sample 3.
 *
 * **Adding a new rule renderer.**
 * 1. Look at the live `inputs` shape (capture into the samples doc).
 * 2. Add the component below.
 * 3. Register it in `RULE_RENDERERS`.
 *
 * Don't try to make the renderers data-driven from the connector model
 * — the model types `inputs` as `Record<string, unknown>` precisely
 * because each id has its own shape. Per-id hand-written components
 * are the right tool.
 */
import type { ComponentType, ReactNode } from "react";
import {
  Badge,
  Card,
  CardHeader,
  Divider,
  Text,
  Link,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  CheckmarkCircleFilled,
  DismissCircleFilled,
} from "@fluentui/react-icons";
import { friendlyConnectorName } from "../../data/inventory";
import { RawJsonAccordion } from "../RawJsonAccordion";

// ─── Style + small primitives ──────────────────────────────────────────────

const useStyles = makeStyles({
  ruleCard: {
    padding: 0,
  },
  ruleBody: {
    padding: tokens.spacingHorizontalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  ruleHeader: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  toggleRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalM,
    rowGap: tokens.spacingVerticalS,
  },
  toggleItem: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
  connectorList: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  connectorRow: {
    display: "flex",
    alignItems: "baseline",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
  connectorId: {
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  markdownPreview: {
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground2,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusMedium,
    whiteSpace: "pre-wrap",
    margin: 0,
    maxHeight: "200px",
    overflow: "auto",
  },
  emptyHint: {
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
  },
  iconGood: {
    color: tokens.colorPaletteGreenForeground1,
  },
  iconBad: {
    color: tokens.colorPaletteRedForeground1,
  },
});

/** Small green/red indicator with a human label. Pick `positive=true`
 *  when the boolean truthy state is the "good / allowed" answer, and
 *  `positive=false` when truthy means "blocked / restricted". */
function Indicator({
  active,
  positive,
  label,
}: {
  active: boolean;
  positive: boolean;
  label: string;
}) {
  const styles = useStyles();
  const good = active === positive;
  return (
    <span className={styles.toggleItem}>
      {good ? (
        <CheckmarkCircleFilled className={styles.iconGood} />
      ) : (
        <DismissCircleFilled className={styles.iconBad} />
      )}
      <Text size={300}>{label}</Text>
    </span>
  );
}

interface RuleSet {
  id?: string;
  version?: string;
  inputs?: Record<string, unknown>;
}

/** Read a boolean off `Record<string, unknown>` safely. Defaults to false. */
function readBool(inputs: Record<string, unknown>, key: string): boolean {
  return inputs[key] === true;
}

/** Read a string off `Record<string, unknown>` safely. */
function readStr(inputs: Record<string, unknown>, key: string): string {
  const v = inputs[key];
  return typeof v === "string" ? v : "";
}

// ─── Per-id renderers ──────────────────────────────────────────────────────

function CopilotTranscriptsRule({ inputs }: { inputs: Record<string, unknown> }) {
  const styles = useStyles();
  // `Block…: true` means access is BLOCKED — invert for "good / open" reading.
  const accessBlocked = readBool(inputs, "BlockAccessToSessionTranscriptsForCopilotStudio");
  const recordingBlocked = readBool(inputs, "BlockTranscriptRecordingForCopilotStudio");
  return (
    <div className={styles.toggleRow}>
      <Indicator
        active={accessBlocked}
        positive={false}
        label={accessBlocked ? "Session-transcript access blocked" : "Session-transcript access allowed"}
      />
      <Indicator
        active={recordingBlocked}
        positive={false}
        label={recordingBlocked ? "Transcript recording blocked" : "Transcript recording allowed"}
      />
    </div>
  );
}

function ConnectorManagementRule({ inputs }: { inputs: Record<string, unknown> }) {
  const styles = useStyles();
  const list = inputs.AllowedConnectorList;
  if (!Array.isArray(list) || list.length === 0) {
    return <Text size={300} className={styles.emptyHint}>No allowed connectors configured.</Text>;
  }
  return (
    <div className={styles.connectorList}>
      <Text size={300}>
        <strong>{list.length}</strong> allowed connector{list.length === 1 ? "" : "s"}:
      </Text>
      {list.map((entry, idx) => {
        const e = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
        const armId = typeof e.AllowedConnector === "string" ? e.AllowedConnector : "";
        const mode = typeof e.AllowedActionsMode === "string" ? e.AllowedActionsMode : "";
        // Connector IDs in this payload are full ARM paths like
        // `/providers/Microsoft.PowerApps/apis/shared_<slug>`. Strip
        // down to the slug before looking up a friendly name.
        const slug = armId.lastIndexOf("/") >= 0 ? armId.slice(armId.lastIndexOf("/") + 1) : armId;
        const friendly = friendlyConnectorName(slug) || slug || "(unknown connector)";
        return (
          <div key={`${armId}-${idx}`} className={styles.connectorRow}>
            <Text weight="semibold">{friendly}</Text>
            {mode && (
              <Badge appearance="outline" color={mode === "AllAllowed" ? "success" : "informative"}>
                {mode}
              </Badge>
            )}
            {armId && armId !== slug && <span className={styles.connectorId}>{slug}</span>}
          </div>
        );
      })}
    </div>
  );
}

function CopilotChannelPublishSettingsRule({
  inputs,
}: {
  inputs: Record<string, unknown>;
}) {
  const styles = useStyles();
  // Each Allow* key here means "publish allowed" when true — positive=true.
  const channels: Array<[string, string]> = [
    ["AllowAgentPublishToTeams", "Teams"],
    ["AllowAgentPublishToDirectLines", "Direct Line"],
    ["AllowAgentPublishToOmniChannel", "Omnichannel"],
    ["AllowAgentPublishToSharePoint", "SharePoint"],
    ["AllowAgentPublishToFacebook", "Facebook"],
    ["AllowAgentPublishToWhatsApp", "WhatsApp"],
  ];
  return (
    <div className={styles.toggleRow}>
      {channels.map(([key, label]) => {
        const allowed = readBool(inputs, key);
        return (
          <Indicator
            key={key}
            active={allowed}
            positive={true}
            label={`${label}: ${allowed ? "Allowed" : "Blocked"}`}
          />
        );
      })}
    </div>
  );
}

function CopilotEnablePromptsRule({ inputs }: { inputs: Record<string, unknown> }) {
  const styles = useStyles();
  const enabled = readBool(inputs, "AiPromptsEnabled");
  return (
    <div className={styles.toggleRow}>
      <Indicator
        active={enabled}
        positive={true}
        label={`AI prompts: ${enabled ? "Enabled" : "Disabled"}`}
      />
    </div>
  );
}

function CopilotFeaturesForMakersRule({ inputs }: { inputs: Record<string, unknown> }) {
  const styles = useStyles();
  const enabled = readBool(inputs, "PowerAppsMakerBotEnabled");
  return (
    <div className={styles.toggleRow}>
      <Indicator
        active={enabled}
        positive={true}
        label={`Power Apps maker bot: ${enabled ? "Enabled" : "Disabled"}`}
      />
    </div>
  );
}

function MakerOnboardingContentRule({ inputs }: { inputs: Record<string, unknown> }) {
  const styles = useStyles();
  const url = readStr(inputs, "makerOnboardingUrl");
  const markdown = readStr(inputs, "makerOnboardingMarkdown");
  const portals = readStr(inputs, "makerOnboardingPortals");
  const timestamp = readStr(inputs, "makerOnboardingTimestamp");
  const consentRequired = readBool(inputs, "makerOnboardingConsentRequired");
  return (
    <>
      <div className={styles.toggleRow}>
        <Indicator
          active={consentRequired}
          positive={true}
          label={consentRequired ? "Consent required" : "Consent not required"}
        />
        {url && (
          <span className={styles.toggleItem}>
            <Text size={300}>URL:</Text>
            <Link href={url} target="_blank" rel="noopener noreferrer">
              {url}
            </Link>
          </span>
        )}
        {portals && (
          <span className={styles.toggleItem}>
            <Text size={300}>Portals: {portals}</Text>
          </span>
        )}
        {timestamp && (
          <span className={styles.toggleItem}>
            <Text size={300} className={styles.emptyHint}>
              Authored {timestamp}
            </Text>
          </span>
        )}
      </div>
      {markdown ? (
        <>
          <Text size={200} className={styles.emptyHint}>
            Welcome markdown (raw source):
          </Text>
          <pre className={styles.markdownPreview}>{markdown}</pre>
        </>
      ) : (
        <Text size={300} className={styles.emptyHint}>
          No welcome markdown configured.
        </Text>
      )}
    </>
  );
}

function UnknownRule({ inputs, id }: { inputs: Record<string, unknown>; id?: string }) {
  const styles = useStyles();
  return (
    <>
      <Text size={300} className={styles.emptyHint}>
        No friendly renderer yet for rule id <code>{id ?? "(unknown)"}</code>. Raw inputs below.
      </Text>
      <RawJsonAccordion data={inputs} title="Raw inputs" defaultOpen />
    </>
  );
}

// ─── Dispatcher ────────────────────────────────────────────────────────────

const RULE_RENDERERS: Record<string, ComponentType<{ inputs: Record<string, unknown> }>> = {
  CopilotTranscripts: CopilotTranscriptsRule,
  ConnectorManagement: ConnectorManagementRule,
  CopilotChannelPublishSettings: CopilotChannelPublishSettingsRule,
  CopilotEnablePrompts: CopilotEnablePromptsRule,
  CopilotFeaturesForMakers: CopilotFeaturesForMakersRule,
  MakerOnboardingContent: MakerOnboardingContentRule,
};

/**
 * Render a single rule set in its own small bordered card with the
 * rule id + version in the header and the friendly body inside. Falls
 * through to a raw-inputs renderer for unknown ids so we never silently
 * drop data.
 */
export function RuleSetRenderer({ rule }: { rule: RuleSet }) {
  const styles = useStyles();
  const id = rule.id ?? "";
  const inputs = rule.inputs ?? {};
  const Renderer = RULE_RENDERERS[id];
  const headerBody: ReactNode = (
    <div className={styles.ruleHeader}>
      <Text weight="semibold">{id || "(unnamed rule)"}</Text>
      {rule.version && <Badge appearance="outline">v{rule.version}</Badge>}
      {!Renderer && (
        <Badge appearance="outline" color="warning">
          Unknown rule id
        </Badge>
      )}
    </div>
  );
  return (
    <Card className={styles.ruleCard} appearance="outline">
      <CardHeader header={headerBody} />
      <Divider />
      <div className={styles.ruleBody}>
        {Renderer ? <Renderer inputs={inputs} /> : <UnknownRule inputs={inputs} id={id} />}
      </div>
    </Card>
  );
}
