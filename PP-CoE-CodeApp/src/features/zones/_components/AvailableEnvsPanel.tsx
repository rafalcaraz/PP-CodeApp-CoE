/**
 * Side panel for the Standard Custom Group Detail view: lists envs
 * eligible to be added to the focused group. Click [+] to add.
 *
 * Type purity is enforced *visibly* here: Managed envs are shown in a
 * separate "Not eligible" subsection with a one-line explanation,
 * never with an Add button. This is the "warning, not enforcement"
 * pattern flipped on its head — we *do* enforce, and we surface the
 * reason in the UI so users learn the rule.
 */

import { useMemo } from "react";
import {
  Button,
  Caption1,
  makeStyles,
  SearchBox,
  Text,
  Tooltip,
  tokens,
  type SearchBoxChangeEvent,
  type InputOnChangeData,
} from "@fluentui/react-components";
import {
  AddRegular,
  InfoRegular,
  ShieldRegular,
} from "@fluentui/react-icons";
import type { EnvironmentRow } from "../../../data/inventory";
import { findStandardGroupForEnv } from "../../../data/standardGroups";

interface Props {
  /** The custom group being viewed. */
  groupId: string;
  /** Every env in the tenant. */
  allEnvs: EnvironmentRow[];
  /** Env IDs currently in the focused group — excluded from this list. */
  envIdsInGroup: Set<string>;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onAdd: (env: EnvironmentRow) => void;
}

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    width: "360px",
    minWidth: "320px",
    maxWidth: "400px",
    height: "100%",
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    padding: tokens.spacingHorizontalM,
    overflow: "hidden",
    flexShrink: 0,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    overflowY: "auto",
    flex: 1,
    minHeight: 0,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "baseline",
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  empty: {
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase200,
    fontStyle: "italic",
    paddingBlock: tokens.spacingVerticalS,
    textAlign: "center",
  },
  envRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalS,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    ":hover": {
      border: `1px solid ${tokens.colorNeutralStroke1}`,
    },
  },
  ineligibleRow: {
    backgroundColor: tokens.colorNeutralBackground3,
    opacity: 0.75,
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
  hint: {
    display: "flex",
    gap: tokens.spacingHorizontalXS,
    alignItems: "flex-start",
    padding: tokens.spacingHorizontalS,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  hintIcon: {
    color: tokens.colorBrandForeground1,
    flexShrink: 0,
    marginTop: "2px",
  },
});

export function AvailableEnvsPanel({
  groupId,
  allEnvs,
  envIdsInGroup,
  searchQuery,
  onSearchChange,
  onAdd,
}: Props) {
  const styles = useStyles();

  const trimmed = searchQuery.trim().toLowerCase();
  const matches = (env: EnvironmentRow): boolean => {
    if (!trimmed) return true;
    const haystack = [
      env.displayName,
      env.region,
      env.environmentType,
      env.environmentGroup,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(trimmed);
  };

  // Three buckets: loose Standard (eligible, free), Standard in another
  // custom group (eligible, will be moved), Managed (ineligible).
  const { looseStandard, inOtherGroup, managed } = useMemo(() => {
    const looseStandard: EnvironmentRow[] = [];
    const inOtherGroup: { env: EnvironmentRow; otherGroupName: string }[] = [];
    const managed: EnvironmentRow[] = [];
    for (const env of allEnvs) {
      if (envIdsInGroup.has(env.id)) continue;
      if (!matches(env)) continue;
      if (env.isManaged) {
        managed.push(env);
        continue;
      }
      const owner = findStandardGroupForEnv(env.id);
      if (owner && owner.id !== groupId) {
        inOtherGroup.push({ env, otherGroupName: owner.displayName });
      } else {
        looseStandard.push(env);
      }
    }
    return { looseStandard, inOtherGroup, managed };
  }, [allEnvs, envIdsInGroup, groupId, trimmed]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <aside className={styles.root} aria-label="Available environments">
      <div className={styles.header}>
        <Text weight="semibold">Add environments</Text>
        <Caption1>
          Only Standard environments are eligible. Managed envs belong in a
          Microsoft env group instead.
        </Caption1>
      </div>
      <SearchBox
        size="small"
        placeholder="Search environments…"
        value={searchQuery}
        onChange={(_: SearchBoxChangeEvent, data: InputOnChangeData) =>
          onSearchChange(data.value)
        }
      />
      <div className={styles.list}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <span>Loose Standard</span>
            <Caption1>{looseStandard.length}</Caption1>
          </div>
          {looseStandard.length === 0 ? (
            <div className={styles.empty}>None</div>
          ) : (
            looseStandard.map((env) => (
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
                  appearance="primary"
                  icon={<AddRegular />}
                  onClick={() => onAdd(env)}
                >
                  Add
                </Button>
              </div>
            ))
          )}
        </section>

        {inOtherGroup.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>In another custom group</span>
              <Caption1>{inOtherGroup.length}</Caption1>
            </div>
            <div className={styles.hint}>
              <InfoRegular className={styles.hintIcon} />
              <span>
                Adding these moves them out of their current custom group
                (exclusive membership).
              </span>
            </div>
            {inOtherGroup.map(({ env, otherGroupName }) => (
              <div key={env.id} className={styles.envRow}>
                <div className={styles.envBody}>
                  <Text className={styles.envName} size={200}>
                    {env.displayName || "(unnamed)"}
                  </Text>
                  <Caption1 className={styles.envMeta}>
                    Currently in: {otherGroupName}
                  </Caption1>
                </div>
                <Button
                  size="small"
                  appearance="secondary"
                  icon={<AddRegular />}
                  onClick={() => onAdd(env)}
                >
                  Move
                </Button>
              </div>
            ))}
          </section>
        )}

        {managed.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>Not eligible — Managed envs</span>
              <Caption1>{managed.length}</Caption1>
            </div>
            <div className={styles.hint}>
              <InfoRegular className={styles.hintIcon} />
              <span>
                Managed envs belong in a Microsoft env group (or, if loose,
                should be promoted to one in PPAC). Standard custom groups are
                Standard-only.
              </span>
            </div>
            {managed.slice(0, 50).map((env) => (
              <Tooltip
                key={env.id}
                content="Managed envs cannot be added to a Standard custom group"
                relationship="description"
                withArrow
              >
                <div className={`${styles.envRow} ${styles.ineligibleRow}`}>
                  <ShieldRegular />
                  <div className={styles.envBody}>
                    <Text className={styles.envName} size={200}>
                      {env.displayName || "(unnamed)"}
                    </Text>
                    <Caption1 className={styles.envMeta}>
                      {env.environmentGroup
                        ? `In MS group: ${env.environmentGroup}`
                        : "Loose Managed — promote to a group in PPAC"}
                    </Caption1>
                  </div>
                </div>
              </Tooltip>
            ))}
            {managed.length > 50 && (
              <Caption1 className={styles.empty}>
                + {managed.length - 50} more not shown
              </Caption1>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}
