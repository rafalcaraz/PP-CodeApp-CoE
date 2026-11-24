import type { ReactNode } from "react";
import {
  Card, CardHeader, Menu, MenuButton, MenuDivider, MenuItem, MenuList, MenuPopover, MenuTrigger, Text, mergeClasses,
} from "@fluentui/react-components";
import { MoreHorizontalRegular } from "@fluentui/react-icons";
import type { DashboardTab, DashboardTile } from "../data/dashboards";
import { useDashboardTileStyles } from "./dashboardTileStyles";

export function DashboardTileFrame({ tile, description, children, editable, className, ariaLabel, actionsLabel, onEdit, onDelete, onDuplicate, tabs, onMoveToTab }: {
  tile: DashboardTile; description: string; children: ReactNode;
  editable?: boolean; className?: string; ariaLabel?: string; actionsLabel?: string;
  onEdit?: () => void; onDelete?: () => void; onDuplicate?: () => void;
  tabs?: DashboardTab[]; onMoveToTab?: (id: string) => void;
}) {
  const styles = useDashboardTileStyles();
  return <Card role={ariaLabel ? "region" : undefined} aria-label={ariaLabel} className={mergeClasses(styles.root, className)}>
    <CardHeader header={<Text weight="semibold">{tile.title}</Text>}
      description={<Text size={200}>{description}</Text>}
      action={editable ? <Menu>
        <MenuTrigger disableButtonEnhancement><MenuButton appearance="subtle" icon={<MoreHorizontalRegular />} size="small" aria-label={actionsLabel || "Tile actions"} /></MenuTrigger>
        <MenuPopover><MenuList>
          <MenuItem onClick={onEdit}>Edit</MenuItem><MenuItem onClick={onDuplicate}>Duplicate</MenuItem>
          {onMoveToTab && tabs && tabs.length > 1 && <Menu>
            <MenuTrigger disableButtonEnhancement><MenuItem>Move to tab</MenuItem></MenuTrigger>
            <MenuPopover><MenuList>{tabs.filter((tab) => tab.id !== tile.tabId).map((tab) =>
              <MenuItem key={tab.id} onClick={() => onMoveToTab(tab.id)}>{tab.name}</MenuItem>)}</MenuList></MenuPopover>
          </Menu>}
          <MenuDivider /><MenuItem onClick={onDelete}>Delete</MenuItem>
        </MenuList></MenuPopover>
      </Menu> : undefined} />
    <div className={styles.body}>{children}</div>
  </Card>;
}
