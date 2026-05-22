/* eslint-disable react-refresh/only-export-components -- this file
 * exports both per-id body components and the `getPolicyRuleItems`
 * builder consumed by the unified `<GovernanceRulesGrid>`. Splitting
 * them across two files would just shuffle code around without making
 * anything clearer; we accept the Fast Refresh trade-off (component
 * state isn't preserved across HMR for this module). */
/**
 * Friendly per-id renderers for the **Model B** rule-based-policy
 * `ruleSets[]` payloads (the named, versioned ones with structured
 * `inputs`).
 *
 * Each known rule id gets:
 *
 * - a **`displayName`** — the human-friendly label Microsoft surfaces
 *   in the PPAC "Add rules" picker (inferred from screenshots, may
 *   need correction as we learn more);
 * - a **`summary(inputs)`** — a short one-line status hint shown in
 *   the accordion header so the user gets at-a-glance information
 *   without expanding;
 * - a **`render(inputs)`** — the full friendly rendering shown in
 *   the accordion panel when the user expands.
 *
 * Unknown rule ids fall through to a raw JSON viewer with a warning
 * badge so we never silently drop data when Microsoft ships a new id.
 *
 * Live payload samples for every renderer here live in
 * `PP-CoE-CodeApp/docs/admin-payload-samples.md` → Sample 3, and the
 * full per-rule schema reference lives in
 * `PP-CoE-CodeApp/docs/governance-rules-catalog.md`.
 *
 * **Adding a new rule renderer.**
 * 1. Look at the live `inputs` shape (capture into samples doc).
 * 2. Add an entry to `RULE_METADATA` below.
 * 3. Update the catalog doc with the same schema.
 * 4. The accordion picks it up automatically.
 *
 * Don't try to make the renderers data-driven from the connector model
 * — the model types `inputs` as `Record<string, unknown>` precisely
 * because each id has its own shape. Per-id hand-written components
 * are the right tool.
 */
import type { ReactNode } from "react";
import {
  Badge,
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
import type { GovernanceRuleItem } from "./GovernanceRuleCard";

// ─── Style + small primitives ──────────────────────────────────────────────

const useStyles = makeStyles({
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

interface Policy {
  id?: string;
  name?: string;
  lastModified?: string;
  ruleSets?: RuleSet[];
}

function readBool(inputs: Record<string, unknown>, key: string): boolean {
  return inputs[key] === true;
}

function readStr(inputs: Record<string, unknown>, key: string): string {
  const v = inputs[key];
  return typeof v === "string" ? v : "";
}

function pluralize(n: number, single: string, plural: string = `${single}s`): string {
  return `${n} ${n === 1 ? single : plural}`;
}

// ─── Per-id renderers (full panel body) ───────────────────────────────────

function CopilotTranscriptsBody({ inputs }: { inputs: Record<string, unknown> }) {
  const styles = useStyles();
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

function ConnectorManagementBody({ inputs }: { inputs: Record<string, unknown> }) {
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

function CopilotChannelPublishSettingsBody({
  inputs,
}: {
  inputs: Record<string, unknown>;
}) {
  const styles = useStyles();
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

function CopilotEnablePromptsBody({ inputs }: { inputs: Record<string, unknown> }) {
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

function CopilotFeaturesForMakersBody({ inputs }: { inputs: Record<string, unknown> }) {
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

function MakerOnboardingContentBody({ inputs }: { inputs: Record<string, unknown> }) {
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

function UnknownRuleBody({ inputs, id }: { inputs: Record<string, unknown>; id?: string }) {
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

// ─── Per-id metadata ──────────────────────────────────────────────────────

interface RuleMetadata {
  /** PPAC-style display name. */
  displayName: string;
  /** Short status hint shown in the accordion header (right-aligned). */
  summary: (inputs: Record<string, unknown>) => string;
  /** Full friendly renderer shown in the expanded accordion panel. */
  render: (inputs: Record<string, unknown>) => ReactNode;
}

const RULE_METADATA: Record<string, RuleMetadata> = {
  CopilotTranscripts: {
    displayName: "Accessing transcripts from conversations in Copilot Studio agents",
    summary: (i) => {
      const access = readBool(i, "BlockAccessToSessionTranscriptsForCopilotStudio");
      const recording = readBool(i, "BlockTranscriptRecordingForCopilotStudio");
      return [
        access ? "Access blocked" : "Access allowed",
        recording ? "Recording blocked" : "Recording allowed",
      ].join(" · ");
    },
    render: (i) => <CopilotTranscriptsBody inputs={i} />,
  },
  ConnectorManagement: {
    displayName: "Advanced connector policies (preview)",
    summary: (i) => {
      const list = Array.isArray(i.AllowedConnectorList) ? (i.AllowedConnectorList as unknown[]) : [];
      return list.length === 0 ? "No connectors configured" : pluralize(list.length, "allowed connector");
    },
    render: (i) => <ConnectorManagementBody inputs={i} />,
  },
  CopilotChannelPublishSettings: {
    displayName: "Agent access channels (preview)",
    summary: (i) => {
      const keys = [
        "AllowAgentPublishToTeams",
        "AllowAgentPublishToDirectLines",
        "AllowAgentPublishToOmniChannel",
        "AllowAgentPublishToSharePoint",
        "AllowAgentPublishToFacebook",
        "AllowAgentPublishToWhatsApp",
      ];
      const allowed = keys.filter((k) => readBool(i, k)).length;
      return `${allowed} of ${keys.length} channels allowed`;
    },
    render: (i) => <CopilotChannelPublishSettingsBody inputs={i} />,
  },
  CopilotEnablePrompts: {
    displayName: "AI prompts",
    summary: (i) => (readBool(i, "AiPromptsEnabled") ? "Enabled" : "Disabled"),
    render: (i) => <CopilotEnablePromptsBody inputs={i} />,
  },
  CopilotFeaturesForMakers: {
    displayName: "AI-powered Copilot features (preview)",
    summary: (i) => (readBool(i, "PowerAppsMakerBotEnabled") ? "Maker bot enabled" : "Maker bot disabled"),
    render: (i) => <CopilotFeaturesForMakersBody inputs={i} />,
  },
  MakerOnboardingContent: {
    displayName: "Maker welcome content",
    summary: (i) => {
      const hasMd = !!readStr(i, "makerOnboardingMarkdown");
      const hasUrl = !!readStr(i, "makerOnboardingUrl");
      const consent = readBool(i, "makerOnboardingConsentRequired");
      const parts: string[] = [];
      if (hasMd) parts.push("Markdown set");
      if (hasUrl) parts.push("URL set");
      parts.push(consent ? "Consent required" : "No consent");
      return parts.join(" · ");
    },
    render: (i) => <MakerOnboardingContentBody inputs={i} />,
  },
};

// ─── Item builder ──────────────────────────────────────────────────────────

/** Flatten one Model B `Policy`'s `ruleSets[]` into the unified
 *  `GovernanceRuleItem[]` shape consumed by `<GovernanceRulesGrid>`.
 *  Each rule becomes one card; unknown rule ids surface as a card with
 *  a warning badge + raw-inputs body. */
export function getPolicyRuleItems(policy: Policy): GovernanceRuleItem[] {
  const ruleSets = policy.ruleSets ?? [];
  const policyKey = policy.id ?? policy.name ?? "unnamed-policy";
  return ruleSets.map((rule, idx) => {
    const id = rule.id ?? "";
    const inputs = rule.inputs ?? {};
    const meta = RULE_METADATA[id];
    const displayName = meta?.displayName ?? id ?? "(unnamed rule)";
    const summary = meta?.summary(inputs) ?? "Unknown rule — raw inputs below";
    return {
      key: `policy:${policyKey}:${id}-${idx}`,
      title: displayName,
      summary,
      body: meta ? meta.render(inputs) : <UnknownRuleBody inputs={inputs} id={id} />,
      warning: meta ? undefined : "Unknown rule id",
    };
  });
}
