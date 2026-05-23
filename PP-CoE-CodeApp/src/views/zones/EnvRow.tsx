/**
 * Single env row inside a group lane or in the eligible-envs panel.
 *
 * Renders an env with type-aware provenance (🛡️ Managed / 📦 Standard /
 * ⚡ Loose Managed), an optional checkbox for multi-select, and an
 * optional Remove button (used inside custom group lanes to evict).
 *
 * Click-to-drill (the row itself) opens the existing EnvironmentDetail
 * view. Checkbox click is intercepted (stopPropagation) so it doesn't
 * also fire the row click.
 */

import {
  Caption1,
  Checkbox,
  Link,
  makeStyles,
  Text,
  tokens,
} from "@fluentui/react-components";
import type { CheckboxOnChangeData } from "@fluentui/react-components";
import {
  DismissRegular,
  OpenRegular,
  ShieldRegular,
} from "@fluentui/react-icons";
import { Button } from "@fluentui/react-components";
import { useNavigate } from "react-router-dom";
import type { EnvironmentRow } from "../../data/inventory";

interface Props {
  env: EnvironmentRow;
  /** Show the checkbox + selection styling. Omit to render a read-only row. */
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  /** When present, renders a small × button. Used in custom group lanes. */
  onRemove?: () => void;
  /**
   * When true, append a deep link to PPAC for managing this env.
   * Useful for Loose Managed envs ("promote to a group in PPAC").
   */
  showPpacLink?: boolean;
}

const PPAC_BASE = "https://admin.powerplatform.microsoft.com/manage/environments";

const useStyles = makeStyles({
  row: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalS,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    transition: "background-color 80ms ease, border-color 80ms ease",
    ":hover": {
      border: `1px solid ${tokens.colorNeutralStroke1}`,
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  rowSelected: {
    backgroundColor: tokens.colorBrandBackground2,
    border: `1px solid ${tokens.colorBrandStroke1}`,
    ":hover": {
      backgroundColor: tokens.colorBrandBackground2,
      border: `1px solid ${tokens.colorBrandStroke1}`,
    },
  },
  rowReadOnly: {
    cursor: "default",
    backgroundColor: tokens.colorNeutralBackground3,
  },
  body: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
  name: {
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  managedIcon: {
    color: tokens.colorBrandForeground1,
    flexShrink: 0,
  },
  ppacLink: {
    fontSize: tokens.fontSizeBase200,
  },
});

export function EnvRow({
  env,
  selectable = false,
  selected = false,
  onToggle,
  onRemove,
  showPpacLink = false,
}: Props) {
  const styles = useStyles();
  const navigate = useNavigate();

  const handleRowClick = () => {
    navigate(`/environments/${env.id}`);
  };

  const classes = [styles.row];
  if (selected) classes.push(styles.rowSelected);
  if (!selectable && !onRemove) classes.push(styles.rowReadOnly);

  return (
    <div className={classes.join(" ")} onClick={handleRowClick}>
      {selectable && (
        <Checkbox
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={(_, data: CheckboxOnChangeData) => {
            // Intercept; the checkbox owns selection, not the row.
            if (onToggle) onToggle();
            void data;
          }}
          aria-label={`Select ${env.displayName}`}
        />
      )}
      {env.isManaged && !selectable && (
        <ShieldRegular className={styles.managedIcon} aria-hidden />
      )}
      <div className={styles.body}>
        <Text className={styles.name} size={200}>
          {env.displayName || "(unnamed)"}
        </Text>
        <Caption1 className={styles.meta}>
          {env.isManaged ? "🛡️ Managed · " : "📦 Standard · "}
          {env.environmentType}
          {env.region ? ` · ${env.region}` : ""}
          {showPpacLink && (
            <>
              {" · "}
              <Link
                href={`${PPAC_BASE}/${env.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.ppacLink}
                onClick={(e) => e.stopPropagation()}
              >
                Manage in PPAC <OpenRegular fontSize={10} />
              </Link>
            </>
          )}
        </Caption1>
      </div>
      {onRemove && (
        <Button
          size="small"
          appearance="subtle"
          icon={<DismissRegular />}
          aria-label={`Remove ${env.displayName}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        />
      )}
    </div>
  );
}
