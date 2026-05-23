/**
 * Side panel for the Tier 2 Kanban — lists envs eligible to bring
 * INTO the focused zone (i.e., not currently in any group placed in
 * this zone).
 *
 * Two buckets:
 *  - 📦 Loose Standard (eligible for any custom group in this zone) —
 *    selectable, the multi-select Add-to-Group target
 *  - ⚡ Loose Managed (not eligible via this app — needs a PPAC action
 *    to join an MS env group) — read-only with deep-link
 *
 * Envs in groups placed in OTHER zones don't appear here in v1. To
 * move them into this zone, the user works from the source zone.
 * Keeps the side panel focused on "what's loose and could be claimed."
 */

import { useMemo } from "react";
import {
  Caption1,
  makeStyles,
  SearchBox,
  Text,
  tokens,
  type SearchBoxChangeEvent,
  type InputOnChangeData,
} from "@fluentui/react-components";
import { InfoRegular } from "@fluentui/react-icons";
import type { EnvironmentRow } from "../../data/inventory";
import { EnvRow } from "./EnvRow";

interface Props {
  /** Every env in the tenant. */
  allEnvs: EnvironmentRow[];
  /** Env IDs that are currently inside SOME group placed in this zone —
   *  excluded from this panel (they're already visible in the main area). */
  envIdsInZone: Set<string>;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selection: {
    isSelected: (id: string) => boolean;
    toggle: (id: string) => void;
  };
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

export function EligibleEnvsPanel({
  allEnvs,
  envIdsInZone,
  searchQuery,
  onSearchChange,
  selection,
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

  const { looseStandard, looseManaged } = useMemo(() => {
    const looseStandard: EnvironmentRow[] = [];
    const looseManaged: EnvironmentRow[] = [];
    for (const env of allEnvs) {
      if (envIdsInZone.has(env.id)) continue;
      // "Loose" = not in any MS env group. Standard envs by definition
      // can't be in MS groups; Managed envs can be in groups OR loose.
      const isLoose = !env.environmentGroupId;
      if (!isLoose) continue;
      if (!matches(env)) continue;
      if (env.isManaged) {
        looseManaged.push(env);
      } else {
        looseStandard.push(env);
      }
    }
    return { looseStandard, looseManaged };
  }, [allEnvs, envIdsInZone, trimmed]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <aside className={styles.root} aria-label="Eligible environments">
      <div className={styles.header}>
        <Text weight="semibold">Bring envs into this zone</Text>
        <Caption1>
          Select Standard envs and use the action bar to add them to a custom
          group. Managed envs need PPAC.
        </Caption1>
      </div>
      <SearchBox
        size="small"
        placeholder="Search envs…"
        value={searchQuery}
        onChange={(_: SearchBoxChangeEvent, data: InputOnChangeData) =>
          onSearchChange(data.value)
        }
      />
      <div className={styles.list}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <span>📦 Loose Standard</span>
            <Caption1>{looseStandard.length}</Caption1>
          </div>
          {looseStandard.length === 0 ? (
            <div className={styles.empty}>None</div>
          ) : (
            looseStandard.map((env) => (
              <EnvRow
                key={env.id}
                env={env}
                selectable
                selected={selection.isSelected(env.id)}
                onToggle={() => selection.toggle(env.id)}
              />
            ))
          )}
        </section>

        {looseManaged.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>⚡ Loose Managed</span>
              <Caption1>{looseManaged.length}</Caption1>
            </div>
            <div className={styles.hint}>
              <InfoRegular className={styles.hintIcon} />
              <span>
                Paying for Managed governance with no group-level rules. Group
                them in PPAC to get full policy enforcement.
              </span>
            </div>
            {looseManaged.slice(0, 50).map((env) => (
              <EnvRow key={env.id} env={env} showPpacLink />
            ))}
            {looseManaged.length > 50 && (
              <Caption1 className={styles.empty}>
                + {looseManaged.length - 50} more not shown
              </Caption1>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}
