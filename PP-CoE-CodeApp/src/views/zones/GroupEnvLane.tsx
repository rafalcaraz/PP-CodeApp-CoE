/**
 * A lane in the Tier 2 Kanban representing ONE group (MS env group or
 * Standard custom group) and the envs inside it.
 *
 * MS groups:
 *  - Header shows 🛡️ Microsoft badge + "View in PPAC ↗"
 *  - Env rows are read-only (no checkboxes, no remove buttons)
 *  - Reflects what Microsoft says is in the group on every fetch
 *
 * Custom groups:
 *  - Header has a kebab menu (Open / Edit / Delete)
 *  - Env rows are selectable + each has a × Remove button
 *  - Mutations write to localStorage
 */

import {
  Badge,
  Button,
  Caption1,
  Link,
  makeStyles,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Text,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowRightRegular,
  DeleteRegular,
  EditRegular,
  MoreVerticalRegular,
  OpenRegular,
} from "@fluentui/react-icons";
import type { EnvironmentRow } from "../../data/inventory";
import type { GroupKind } from "../../data/zones";
import { EnvRow } from "./EnvRow";

const PPAC_ENV_GROUP_BASE =
  "https://admin.powerplatform.microsoft.com/manage/environment-groups";

interface CustomGroupActions {
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

interface Props {
  groupKind: GroupKind;
  groupId: string;
  displayName: string;
  description?: string;
  color?: string;
  icon?: string;
  envs: EnvironmentRow[];
  /** When provided AND a custom group, env rows are selectable. */
  selection?: {
    isSelected: (envId: string) => boolean;
    toggle: (envId: string) => void;
  };
  /** When provided AND a custom group, each env row gets a × button. */
  onRemoveEnv?: (envId: string) => void;
  /** Custom-group only. Kebab menu actions in the header. */
  customActions?: CustomGroupActions;
}

const useStyles = makeStyles({
  lane: {
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    overflow: "hidden",
    minWidth: "300px",
    maxWidth: "380px",
    flexShrink: 0,
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalM,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  colorStripe: {
    width: "4px",
    alignSelf: "stretch",
    borderRadius: tokens.borderRadiusSmall,
    flexShrink: 0,
  },
  headerBody: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    minWidth: 0,
  },
  icon: {
    fontSize: tokens.fontSizeBase400,
    flexShrink: 0,
  },
  title: {
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    minWidth: 0,
  },
  description: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  ppacLink: {
    fontSize: tokens.fontSizeBase200,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingHorizontalM,
    maxHeight: "420px",
    overflowY: "auto",
    minHeight: "60px",
  },
  empty: {
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase200,
    fontStyle: "italic",
    textAlign: "center",
    paddingBlock: tokens.spacingVerticalM,
  },
});

export function GroupEnvLane({
  groupKind,
  groupId,
  displayName,
  description,
  color,
  icon,
  envs,
  selection,
  onRemoveEnv,
  customActions,
}: Props) {
  const styles = useStyles();
  const isMs = groupKind === "ms";
  const stripeColor = color ?? (isMs ? tokens.colorNeutralStroke1 : "#525252");
  const displayIcon = icon ?? (isMs ? "🛡️" : "📦");

  return (
    <div className={styles.lane}>
      <div className={styles.header}>
        <div
          className={styles.colorStripe}
          style={{ backgroundColor: stripeColor }}
          aria-hidden
        />
        <div className={styles.headerBody}>
          <div className={styles.titleRow}>
            <span className={styles.icon} aria-hidden>
              {displayIcon}
            </span>
            <Text className={styles.title}>{displayName}</Text>
            <Badge
              size="extra-small"
              appearance="outline"
              color={isMs ? "informative" : "subtle"}
            >
              {isMs ? "Microsoft" : "Standard"}
            </Badge>
          </div>
          {description && (
            <Caption1 className={styles.description}>{description}</Caption1>
          )}
          <Text className={styles.meta}>
            {envs.length} env{envs.length === 1 ? "" : "s"}
            {isMs && (
              <>
                {" · "}
                <Link
                  href={`${PPAC_ENV_GROUP_BASE}/${groupId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.ppacLink}
                >
                  View in PPAC <OpenRegular fontSize={10} />
                </Link>
              </>
            )}
          </Text>
        </div>
        {!isMs && customActions && (
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button
                size="small"
                appearance="subtle"
                icon={<MoreVerticalRegular />}
                aria-label={`${displayName} actions`}
              />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem
                  icon={<ArrowRightRegular />}
                  onClick={customActions.onOpen}
                >
                  Open
                </MenuItem>
                <MenuItem
                  icon={<EditRegular />}
                  onClick={customActions.onEdit}
                >
                  Edit…
                </MenuItem>
                <MenuItem
                  icon={<DeleteRegular />}
                  onClick={customActions.onDelete}
                >
                  Delete
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        )}
      </div>
      <div className={styles.body}>
        {envs.length === 0 ? (
          <div className={styles.empty}>
            {isMs
              ? "No environments in this MS group"
              : "No environments yet. Add Standard envs from the side panel."}
          </div>
        ) : (
          envs.map((env) => (
            <EnvRow
              key={env.id}
              env={env}
              selectable={!isMs && selection !== undefined}
              selected={selection?.isSelected(env.id) ?? false}
              onToggle={
                !isMs && selection
                  ? () => selection.toggle(env.id)
                  : undefined
              }
              onRemove={!isMs && onRemoveEnv ? () => onRemoveEnv(env.id) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}
