/**
 * `<GovernanceRuleCard>` and `<GovernanceRulesGrid>` — the unified
 * surface for rendering both Model B rule-based-policy rules and
 * Model A parameter-bucket rulesets as one combined set of cards in a
 * responsive 2-column grid.
 *
 * The two governance models (see `docs/governance-rules-catalog.md`)
 * surface different slices of policy, but from an admin's perspective
 * they're all just "governance rules" — so we flatten them into a
 * single `GovernanceRuleItem[]` and render them uniformly here.
 *
 * Each model contributes items through a small builder:
 *
 * - `getPolicyRuleItems(policy)` in `RuleSetRenderer.tsx`
 * - `getRulesetBucketItems(ruleset, currentGroupId?)` in
 *   `ModelARulesetRenderer.tsx`
 */
import type { ReactNode } from "react";
import { Badge, Text, makeStyles, tokens } from "@fluentui/react-components";

export interface GovernanceRuleItem {
  /** React key for the card. Must be unique across both models. */
  key: string;
  /** Human-friendly rule/bucket name shown bold in the card header. */
  title: string;
  /** Short status hint shown muted on the right of the header. */
  summary: string;
  /** Full friendly rendering shown in the card body. */
  body: ReactNode;
  /** Optional warning badge in the header (e.g. "Unknown rule id"). */
  warning?: string;
  /** Optional muted footnote line at the bottom of the card. */
  footnote?: string;
}

const useStyles = makeStyles({
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
    gap: tokens.spacingHorizontalM,
    alignItems: "start",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  header: {
    display: "flex",
    width: "100%",
    alignItems: "baseline",
    gap: tokens.spacingHorizontalM,
    minWidth: 0,
  },
  headerName: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
  headerSummary: {
    marginLeft: "auto",
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    textAlign: "right",
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  footnote: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontStyle: "italic",
  },
});

export function GovernanceRuleCard({ item }: { item: GovernanceRuleItem }) {
  const styles = useStyles();
  return (
    <div className={styles.card}>
      <span className={styles.header}>
        <span className={styles.headerName}>
          <Text weight="semibold">{item.title}</Text>
          {item.warning && (
            <Badge appearance="outline" color="warning">
              {item.warning}
            </Badge>
          )}
        </span>
        <span className={styles.headerSummary}>{item.summary}</span>
      </span>
      <div className={styles.body}>{item.body}</div>
      {item.footnote && <Text className={styles.footnote}>{item.footnote}</Text>}
    </div>
  );
}

export function GovernanceRulesGrid({ items }: { items: GovernanceRuleItem[] }) {
  const styles = useStyles();
  return (
    <div className={styles.grid}>
      {items.map((item) => (
        <GovernanceRuleCard key={item.key} item={item} />
      ))}
    </div>
  );
}
