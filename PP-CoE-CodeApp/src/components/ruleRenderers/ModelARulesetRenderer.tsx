/* eslint-disable react-refresh/only-export-components -- this file
 * exports both per-id body components and the `getRulesetBucketItems`
 * builder consumed by the unified `<GovernanceRulesGrid>`. Splitting
 * them across two files would just shuffle code around without making
 * anything clearer; we accept the Fast Refresh trade-off (component
 * state isn't preserved across HMR for this module). */
/**
 * Friendly renderer for **Model A** (`parameters`-bucket) rulesets —
 * the legacy-shape governance data returned by `GetRuleSetListForTenant`
 * (filtered client-side to a single env group).
 *
 * Sibling to `RuleSetRenderer.tsx` (which handles Model B). The two
 * models cover different governance slices and render differently;
 * see `docs/admin-payload-samples.md` and
 * `docs/governance-rules-catalog.md` for the schemas.
 *
 * Same flat-rendering UX as Model B: every `(type, resourceType)`
 * bucket is one always-visible section with a friendly heading + a
 * short status summary, then per-setting rows below. No chevrons.
 *
 * **Adding a new parameter renderer.**
 * 1. Capture a live payload sample with the new triple into
 *    `docs/admin-payload-samples.md` and
 *    `docs/governance-rules-catalog.md`.
 * 2. Add a row to `PARAM_REGISTRY` keyed by
 *    `${type}/${resourceType}/${id}`.
 * 3. (Optional) Add or extend the `BUCKET_METADATA` entry for the
 *    `${type}/${resourceType}` pair to control the accordion header
 *    display name + status summary.
 * 4. The accordion picks it up automatically.
 */
import type { ReactNode } from "react";
import {
  Badge,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  CheckmarkCircleFilled,
  DismissCircleFilled,
  WarningRegular,
} from "@fluentui/react-icons";
import type { GovernanceRuleItem } from "./GovernanceRuleCard";

// ─── Style + small primitives ──────────────────────────────────────────────

const useStyles = makeStyles({
  mono: {
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: tokens.fontSizeBase200,
  },
  bucketBody: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "minmax(180px, 1fr) 2fr",
    gap: tokens.spacingHorizontalM,
    alignItems: "baseline",
    paddingBlock: tokens.spacingVerticalXXS,
  },
  rowLabel: {
    color: tokens.colorNeutralForeground2,
  },
  rowValue: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    flexWrap: "wrap",
  },
  iconGood: {
    color: tokens.colorPaletteGreenForeground1,
  },
  iconBad: {
    color: tokens.colorPaletteRedForeground1,
  },
  iconWarn: {
    color: tokens.colorPaletteYellowForeground1,
  },
  empty: {
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
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
    <>
      {good ? (
        <CheckmarkCircleFilled className={styles.iconGood} />
      ) : (
        <DismissCircleFilled className={styles.iconBad} />
      )}
      <Text size={300}>{label}</Text>
    </>
  );
}

// ─── Value-render helpers ─────────────────────────────────────────────────

function isTrueString(v: string): boolean {
  return v === "true";
}

/** Pretty-print a .NET TimeSpan ("D.HH:MM:SS" or "HH:MM:SS"). */
function formatTimeSpan(v: string): string {
  if (!v) return "—";
  const dayMatch = v.match(/^(\d+)\.(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (dayMatch) {
    const [, d, h, m, s] = dayMatch;
    const parts: string[] = [];
    const dn = Number(d), hn = Number(h), mn = Number(m), sn = Number(s);
    if (dn) parts.push(`${dn} day${dn === 1 ? "" : "s"}`);
    if (hn) parts.push(`${hn} hour${hn === 1 ? "" : "s"}`);
    if (mn) parts.push(`${mn} min`);
    if (sn) parts.push(`${sn} sec`);
    return parts.length ? parts.join(" ") : "0";
  }
  const hourMatch = v.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (hourMatch) {
    const [, h, m, s] = hourMatch;
    const parts: string[] = [];
    const hn = Number(h), mn = Number(m), sn = Number(s);
    if (hn) parts.push(`${hn} hour${hn === 1 ? "" : "s"}`);
    if (mn) parts.push(`${mn} min`);
    if (sn) parts.push(`${sn} sec`);
    return parts.length ? parts.join(" ") : "0";
  }
  return v;
}

// ─── Per-(type, resourceType, id) parameter registry ──────────────────────

interface ParamMeta {
  /** Friendly setting label shown in the row's left column. */
  label: string;
  /** Short value rendering for the accordion header summary. */
  shortValue?: (value: string) => string;
  /** Full-row value renderer for the expanded panel. */
  render: (value: string) => ReactNode;
}

function boolPositive(trueLabel: string, falseLabel: string): ParamMeta["render"] {
  return (v) => (
    <Indicator active={isTrueString(v)} positive={true} label={isTrueString(v) ? trueLabel : falseLabel} />
  );
}

function boolInverted(trueLabel: string, falseLabel: string): ParamMeta["render"] {
  return (v) => (
    <Indicator active={isTrueString(v)} positive={false} label={isTrueString(v) ? trueLabel : falseLabel} />
  );
}

const SHARE_ENUM_FRIENDLY: Record<string, { label: string; tone: "success" | "warning" | "danger" | "informative" }> = {
  noLimit: { label: "No limit — share freely", tone: "informative" },
  excludeSharingToSecurityGroups: { label: "Block sharing to security groups", tone: "warning" },
  disableSharing: { label: "Sharing disabled entirely", tone: "danger" },
};

function shareEnumShort(v: string): string {
  return SHARE_ENUM_FRIENDLY[v]?.label ?? v;
}

function shareEnumRender(v: string): ReactNode {
  const meta = SHARE_ENUM_FRIENDLY[v];
  if (!meta) return <Text size={300}>{v}</Text>;
  return (
    <Badge appearance="filled" color={meta.tone}>
      {meta.label}
    </Badge>
  );
}

function maximumShareLimitShort(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (n < 0) return "No limit";
  if (n === 0) return "Disabled";
  return n.toLocaleString();
}

function maximumShareLimitRender(v: string): ReactNode {
  const n = Number(v);
  if (!Number.isFinite(n)) return <Text size={300}>{v}</Text>;
  if (n < 0) return <Badge appearance="outline" color="informative">No limit ({v})</Badge>;
  if (n === 0) return <Badge appearance="filled" color="danger">Disabled ({v})</Badge>;
  return <Text size={300}>{n.toLocaleString()}</Text>;
}

const SOLUTION_CHECKER_MODE_TONE: Record<string, "success" | "warning" | "danger" | "informative"> = {
  none: "informative",
  warn: "warning",
  block: "danger",
};

function solutionCheckerModeShort(v: string): string {
  return v === "block" ? "Block" : v === "warn" ? "Warn" : v === "none" ? "Disabled" : v;
}

function solutionCheckerModeRender(v: string): ReactNode {
  const tone = SOLUTION_CHECKER_MODE_TONE[v] ?? "informative";
  return (
    <Badge appearance="filled" color={tone}>
      {solutionCheckerModeShort(v)}
    </Badge>
  );
}

function makerContentPolicyRefRender(v: string): ReactNode {
  // Observed shape: `MakerContentRuleBasedPolicy-<guid>` — the GUID
  // points at a Model B Policy that contains the actual
  // `MakerOnboardingContent` rule.
  const prefix = "MakerContentRuleBasedPolicy-";
  const guid = v.startsWith(prefix) ? v.slice(prefix.length) : v;
  return (
    <>
      <Badge appearance="outline" color="informative">
        Model B policy ref
      </Badge>
      <span style={{ fontFamily: "Consolas, 'Courier New', monospace", fontSize: 12 }}>{guid}</span>
    </>
  );
}

const PARAM_REGISTRY: Record<string, ParamMeta> = {
  "SolutionChecker/NotSpecified/solutionCheckerMode": {
    label: "Solution checker mode",
    shortValue: solutionCheckerModeShort,
    render: solutionCheckerModeRender,
  },
  "SolutionChecker/NotSpecified/suppressValidationEmails": {
    label: "Suppress validation emails",
    shortValue: (v) => (isTrueString(v) ? "Suppressed" : "Sent"),
    render: boolPositive("Yes — emails suppressed", "No — emails sent"),
  },
  "SolutionChecker/NotSpecified/solutionCheckerRuleOverrides": {
    label: "Rule overrides",
    shortValue: (v) => (v ? "Overrides set" : "(none)"),
    render: (v) =>
      v ? <span style={{ fontFamily: "monospace", fontSize: 12 }}>{v}</span> : <Text size={300}>(none)</Text>,
  },

  "GenerativeAISettings/NotSpecified/crossGeoCopilotDataMovementEnabled": {
    label: "Cross-geo Copilot data movement",
    shortValue: (v) => (isTrueString(v) ? "Allowed" : "Blocked"),
    render: boolPositive("Allowed", "Blocked"),
  },
  "GenerativeAISettings/NotSpecified/bingChatEnabled": {
    label: "Bing Chat integration",
    shortValue: (v) => (isTrueString(v) ? "Enabled" : "Disabled"),
    render: boolPositive("Enabled", "Disabled"),
  },

  "Copilot/App/DisableAiGeneratedDescriptions": {
    label: "AI-generated app descriptions",
    shortValue: (v) => (isTrueString(v) ? "Disabled" : "Enabled"),
    render: boolInverted("Disabled", "Enabled"),
  },

  "Lifecycle/NotSpecified/RetentionPeriod": {
    label: "Recycle bin retention",
    shortValue: formatTimeSpan,
    render: (v) => <Text size={300}>{formatTimeSpan(v)}</Text>,
  },

  "Sharing/App/CanShareWithSecurityGroups": {
    label: "Share with security groups",
    shortValue: shareEnumShort,
    render: shareEnumRender,
  },
  "Sharing/App/IsGroupSharingDisabled": {
    label: "Group sharing",
    shortValue: (v) => (isTrueString(v) ? "Disabled" : "Enabled"),
    render: boolInverted("Disabled", "Enabled"),
  },
  "Sharing/App/MaximumShareLimit": {
    label: "Maximum share limit",
    shortValue: maximumShareLimitShort,
    render: maximumShareLimitRender,
  },
  "Sharing/Flow/CanShareWithSecurityGroups": {
    label: "Share with security groups",
    shortValue: shareEnumShort,
    render: shareEnumRender,
  },
  "Sharing/Flow/MaximumShareLimit": {
    label: "Maximum share limit",
    shortValue: maximumShareLimitShort,
    render: maximumShareLimitRender,
  },
  "Sharing/AuthoringBot/CanShareWithSecurityGroups": {
    label: "Share with security groups",
    shortValue: shareEnumShort,
    render: shareEnumRender,
  },
  "Sharing/UsersBot/CanShareWithSecurityGroups": {
    label: "Share with security groups",
    shortValue: shareEnumShort,
    render: shareEnumRender,
  },
  "Sharing/UsersBot/MaximumShareLimit": {
    label: "Maximum share limit",
    shortValue: maximumShareLimitShort,
    render: maximumShareLimitRender,
  },

  "CopilotAuth/NotSpecified/allowchatswithoutentraauth": {
    label: "Anonymous chat (no Entra auth)",
    shortValue: (v) => (isTrueString(v) ? "Allowed" : "Blocked"),
    render: boolPositive("Allowed", "Blocked"),
  },

  "AdminDigest/NotSpecified/IncludeOnHomePageInsights": {
    label: "Include in home-page insights",
    shortValue: (v) => (isTrueString(v) ? "Yes" : "No"),
    render: boolPositive("Yes", "No"),
  },
  "AdminDigest/NotSpecified/ExcludeEnvironmentFromAnalysis": {
    label: "Exclude from analysis",
    shortValue: (v) => (isTrueString(v) ? "Yes" : "No"),
    render: boolPositive("Yes", "No"),
  },

  "MakerOnboarding/NotSpecified/MakerContentRuleBasedPolicy": {
    label: "Maker onboarding policy",
    shortValue: (v) => {
      const prefix = "MakerContentRuleBasedPolicy-";
      return v.startsWith(prefix) ? `→ ${v.slice(prefix.length, prefix.length + 8)}…` : v;
    },
    render: makerContentPolicyRefRender,
  },
};

// ─── Per-(type, resourceType) bucket metadata ─────────────────────────────

interface BucketMeta {
  displayName: string;
}

const BUCKET_METADATA: Record<string, BucketMeta> = {
  "SolutionChecker/NotSpecified": { displayName: "Solution checker enforcement" },
  "GenerativeAISettings/NotSpecified": { displayName: "Generative AI settings" },
  "Copilot/App": { displayName: "AI-generated descriptions (preview)" },
  "Lifecycle/NotSpecified": { displayName: "Recycle bin retention" },
  "Sharing/App": { displayName: "Sharing controls for canvas apps" },
  "Sharing/Flow": { displayName: "Sharing controls for solution-aware cloud flows" },
  "Sharing/AuthoringBot": { displayName: "Sharing agents with editor permissions" },
  "Sharing/UsersBot": { displayName: "Sharing agents with viewer permissions" },
  "CopilotAuth/NotSpecified": { displayName: "Authentication for agents (preview)" },
  "AdminDigest/NotSpecified": { displayName: "Usage insights" },
  "MakerOnboarding/NotSpecified": { displayName: "Maker welcome content (pointer to Model B)" },
};

const TYPE_FALLBACK_NAMES: Record<string, string> = {
  AdminDigest: "Admin digest",
  Copilot: "Copilot",
  CopilotAuth: "Copilot authentication",
  GenerativeAISettings: "Generative AI settings",
  Lifecycle: "Environment lifecycle",
  MakerOnboarding: "Maker onboarding",
  Sharing: "Sharing limits",
  SolutionChecker: "Solution checker",
};

const RESOURCE_TYPE_FALLBACK_NAMES: Record<string, string> = {
  NotSpecified: "",
  App: "Apps",
  Flow: "Flows",
  AuthoringBot: "Authoring bots",
  UsersBot: "User-facing bots",
};

function bucketDisplayName(bucketKey: string, type: string, resourceType: string): string {
  const meta = BUCKET_METADATA[bucketKey];
  if (meta) return meta.displayName;
  const typeName = TYPE_FALLBACK_NAMES[type] || type;
  const rtName = RESOURCE_TYPE_FALLBACK_NAMES[resourceType] ?? resourceType;
  return rtName ? `${typeName} · ${rtName}` : typeName;
}

function bucketSummary(bucketKey: string, values: RuleValue[]): string {
  const parts: string[] = [];
  for (const v of values) {
    const id = v.id ?? "";
    const raw = v.value ?? "";
    const meta = PARAM_REGISTRY[`${bucketKey}/${id}`];
    if (meta?.shortValue) {
      parts.push(meta.shortValue(raw));
    } else if (id) {
      parts.push(`${id}: ${raw || "(empty)"}`);
    }
  }
  return parts.join(" · ");
}

// ─── Rendering ─────────────────────────────────────────────────────────────

interface RuleValue {
  id?: string;
  value?: string;
}

interface RuleParameters {
  type: string;
  resourceType: string;
  value?: RuleValue[];
}

interface EnvironmentFilterValue {
  id?: string;
  type?: string;
}

interface EnvironmentFilter {
  type?: string;
  values?: EnvironmentFilterValue[];
}

interface RuleSetDto {
  id?: string;
  lastModified?: string;
  environmentFilter?: EnvironmentFilter;
  parameters?: RuleParameters[];
}

function ParameterRow({
  bucketKey,
  value,
}: {
  bucketKey: string;
  value: RuleValue;
}) {
  const styles = useStyles();
  const id = value.id ?? "";
  const raw = value.value ?? "";
  const meta = PARAM_REGISTRY[`${bucketKey}/${id}`];
  if (!meta) {
    return (
      <div className={styles.row}>
        <Text className={styles.rowLabel}>
          <span className={styles.mono}>{id}</span>
        </Text>
        <div className={styles.rowValue}>
          <WarningRegular className={styles.iconWarn} />
          <Text size={300}>{raw || <span className={styles.empty}>(empty)</span>}</Text>
          <Badge appearance="outline" color="warning">
            Unknown setting
          </Badge>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.row}>
      <Text className={styles.rowLabel}>{meta.label}</Text>
      <div className={styles.rowValue}>{meta.render(raw)}</div>
    </div>
  );
}

// ─── Item builder ──────────────────────────────────────────────────────────

/** Flatten one Model A `RuleSetDto`'s `parameters` buckets into the
 *  unified `GovernanceRuleItem[]` shape consumed by
 *  `<GovernanceRulesGrid>`. Each bucket becomes one card; the optional
 *  cross-group note ("also applies to N other groups") rides along as
 *  a footnote on every bucket card produced by this ruleset. */
export function getRulesetBucketItems(
  ruleset: RuleSetDto,
  currentGroupId?: string,
): GovernanceRuleItem[] {
  const buckets = ruleset.parameters ?? [];
  const rulesetKey = ruleset.id ?? "unnamed-ruleset";
  const filterValues = ruleset.environmentFilter?.values ?? [];
  const otherGroupCount = currentGroupId
    ? filterValues.filter((v) => v.id !== currentGroupId).length
    : 0;
  const footnote =
    otherGroupCount > 0
      ? `Also applies to ${otherGroupCount} other group${otherGroupCount === 1 ? "" : "s"}`
      : undefined;
  return buckets.map((b, idx) => {
    const bucketKey = `${b.type}/${b.resourceType}`;
    const display = bucketDisplayName(bucketKey, b.type, b.resourceType);
    const values = b.value ?? [];
    const summary =
      bucketSummary(bucketKey, values) ||
      `${values.length} setting${values.length === 1 ? "" : "s"}`;
    return {
      key: `ruleset:${rulesetKey}:${bucketKey}-${idx}`,
      title: display,
      summary,
      body: <BucketBody bucketKey={bucketKey} values={values} />,
      footnote,
    };
  });
}

function BucketBody({ bucketKey, values }: { bucketKey: string; values: RuleValue[] }) {
  const styles = useStyles();
  if (values.length === 0) {
    return (
      <Text size={300} className={styles.empty}>
        No values in this bucket.
      </Text>
    );
  }
  return (
    <div className={styles.bucketBody}>
      {values.map((v, vIdx) => (
        <ParameterRow key={v.id ?? `value-${vIdx}`} bucketKey={bucketKey} value={v} />
      ))}
    </div>
  );
}
