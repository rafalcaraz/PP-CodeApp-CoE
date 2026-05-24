/**
 * Visual-only "ghost" of an env row, rendered inside the @dnd-kit
 * `<DragOverlay>` during a drag. Lives outside any DnD context (the
 * overlay portal renders it to document.body), so it has no draggable
 * hook, no checkbox state, no listeners — just a lifted card-style
 * preview of what's being dragged.
 *
 * Without this the dragged element merely transforms inside its
 * original scroll container, which clips and feels janky. With the
 * overlay, the user sees a clearly-lifted ghost following the cursor
 * — the standard drag-and-drop affordance.
 */

import {
  Caption1,
  makeStyles,
  Text,
  tokens,
} from "@fluentui/react-components";
import { ShieldRegular } from "@fluentui/react-icons";
import type { EnvironmentRow } from "../../../data/inventory";

interface Props {
  env: EnvironmentRow;
}

const useStyles = makeStyles({
  ghost: {
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalS,
    paddingInline: tokens.spacingHorizontalM,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorBrandStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    // Lifted shadow + slight scale = "I'm dragging."
    boxShadow: tokens.shadow28,
    cursor: "grabbing",
    transform: "scale(1.02) rotate(1deg)",
    transformOrigin: "center",
    maxWidth: "360px",
  },
  managedIcon: {
    color: tokens.colorBrandForeground1,
    flexShrink: 0,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  name: {
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "280px",
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "280px",
  },
});

export function EnvRowGhost({ env }: Props) {
  const styles = useStyles();
  return (
    <div className={styles.ghost}>
      {env.isManaged && (
        <ShieldRegular className={styles.managedIcon} aria-hidden />
      )}
      {!env.isManaged && <span aria-hidden>📦</span>}
      <div className={styles.body}>
        <Text className={styles.name} size={200}>
          {env.displayName || "(unnamed)"}
        </Text>
        <Caption1 className={styles.meta}>
          {env.isManaged ? "🛡️ Managed" : "📦 Standard"}
          {env.environmentType ? ` · ${env.environmentType}` : ""}
        </Caption1>
      </div>
    </div>
  );
}
