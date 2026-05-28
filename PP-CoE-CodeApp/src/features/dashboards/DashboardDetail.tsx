import { useEffect, useMemo, useState } from "react";
import {
  makeStyles,
  tokens,
  Text,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbButton,
  BreadcrumbDivider,
  Button,
  Switch,
  TabList,
  Tab,
  Menu,
  MenuTrigger,
  MenuButton,
  MenuPopover,
  MenuList,
  MenuItem,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Input,
  Radio,
  RadioGroup,
  type SelectTabData,
  type SelectTabEvent,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowClockwiseRegular,
  MoreHorizontalRegular,
} from "@fluentui/react-icons";
import { useNavigate, useParams } from "react-router-dom";
import {
  addTab,
  deleteTab,
  deleteTile,
  getDashboard,
  moveTileToTab,
  newId,
  newTileTemplate,
  renameTab,
  reorderTabs,
  upsertTile,
  type Dashboard,
  type DashboardTab,
  type DashboardTile,
} from "../../data/dashboards";
import { invalidateInventoryCache } from "../../data/inventory";
import { ErrorPane, LoadingPane } from "../../components/Status";
import { TileView } from "../../components/TileView";
import { TileEditorDialog } from "../../components/TileEditorDialog";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: tokens.spacingHorizontalL,
    flexWrap: "wrap",
  },
  headerText: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  subtitle: {
    color: tokens.colorNeutralForeground3,
  },
  controls: {
    display: "flex",
    gap: tokens.spacingHorizontalM,
    alignItems: "center",
    flexWrap: "wrap",
  },
  tabBar: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingBottom: tokens.spacingVerticalXS,
    flexWrap: "wrap",
  },
  tabRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXXS,
  },
  newTabBtn: {
    marginLeft: tokens.spacingHorizontalS,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(12, 1fr)",
    gap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalL,
  },
  xs: {
    gridColumn: "span 3",
  },
  small: {
    gridColumn: "span 4",
  },
  medium: {
    gridColumn: "span 6",
  },
  large: {
    gridColumn: "span 12",
  },
  empty: {
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
    padding: tokens.spacingHorizontalL,
  },
});

type TabDeleteMode = "deleteTiles" | "moveTilesToFirstRemaining";

interface NewTabState {
  open: boolean;
  name: string;
}

interface RenameTabState {
  open: boolean;
  tabId: string | null;
  name: string;
}

interface DeleteTabState {
  open: boolean;
  tabId: string | null;
  mode: TabDeleteMode;
  tileCount: number;
}

export function DashboardDetail() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { dashboardId } = useParams<{ dashboardId: string }>();
  const [dashboard, setDashboard] = useState<Dashboard | null | undefined>(undefined);
  const [editMode, setEditMode] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTile, setEditingTile] = useState<DashboardTile | null>(null);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [newTab, setNewTab] = useState<NewTabState>({ open: false, name: "" });
  const [renameState, setRenameState] = useState<RenameTabState>({
    open: false,
    tabId: null,
    name: "",
  });
  const [deleteState, setDeleteState] = useState<DeleteTabState>({
    open: false,
    tabId: null,
    mode: "moveTilesToFirstRemaining",
    tileCount: 0,
  });

  /** Bumped by the Refresh button to bypass the inventory cache and
   *  retrigger every tile's data fetch. */
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefreshAll = () => {
    invalidateInventoryCache();
    setRefreshKey((k) => k + 1);
  };

  useEffect(() => {
    if (!dashboardId) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setDashboard(getDashboard(dashboardId));
    })();
    return () => {
      cancelled = true;
    };
  }, [dashboardId]);

  // Self-repair via derivation: `currentTabId` is the user's last selection
  // when it still references a real tab, otherwise the first tab. Switching
  // dashboards, deleting the active tab, or hot-reload all fall back to the
  // first tab automatically without a setState-in-effect cascade.
  const tabs: DashboardTab[] = useMemo(
    () => dashboard?.tabs ?? [],
    [dashboard?.tabs],
  );
  const currentTabId = useMemo(() => {
    if (tabs.length === 0) return null;
    if (activeTabId && tabs.some((t) => t.id === activeTabId)) return activeTabId;
    return tabs[0].id;
  }, [tabs, activeTabId]);

  const refresh = () => {
    if (!dashboardId) return;
    setDashboard(getDashboard(dashboardId));
  };

  const visibleTiles = useMemo(
    () =>
      dashboard
        ? dashboard.tiles.filter((t) => t.tabId === currentTabId)
        : [],
    [dashboard, currentTabId],
  );

  const openNewTile = () => {
    if (!currentTabId) return;
    setEditingTile(newTileTemplate(currentTabId));
    setEditorOpen(true);
  };

  const openEditTile = (tile: DashboardTile) => {
    setEditingTile(tile);
    setEditorOpen(true);
  };

  const handleSaveTile = (tile: DashboardTile) => {
    if (!dashboardId) return;
    // Preserve the tile's tab when editing; new tiles already carry the
    // active tabId from newTileTemplate(currentTabId).
    const next: DashboardTile = tile.tabId
      ? tile
      : { ...tile, tabId: currentTabId ?? undefined };
    upsertTile(dashboardId, next);
    setEditorOpen(false);
    setEditingTile(null);
    refresh();
  };

  const handleDeleteTile = (tileId: string, title: string) => {
    if (!dashboardId) return;
    if (!window.confirm(`Delete tile "${title}"?`)) return;
    deleteTile(dashboardId, tileId);
    refresh();
  };

  const handleDuplicateTile = (tile: DashboardTile) => {
    if (!dashboardId) return;
    const copy: DashboardTile = {
      ...tile,
      id: newId("t"),
      title: `${tile.title} (copy)`,
    };
    upsertTile(dashboardId, copy);
    refresh();
  };

  const handleMoveTileToTab = (tileId: string, tabId: string) => {
    if (!dashboardId) return;
    moveTileToTab(dashboardId, tileId, tabId);
    refresh();
  };

  const onTabSelect = (_e: SelectTabEvent, data: SelectTabData) => {
    setActiveTabId(String(data.value));
  };

  const openNewTabDialog = () =>
    setNewTab({ open: true, name: `Tab ${tabs.length + 1}` });

  const handleCreateTab = () => {
    if (!dashboardId) return;
    const created = addTab(dashboardId, newTab.name);
    setNewTab({ open: false, name: "" });
    refresh();
    if (created) setActiveTabId(created.id);
  };

  const openRenameDialog = (tab: DashboardTab) =>
    setRenameState({ open: true, tabId: tab.id, name: tab.name });

  const handleRenameTab = () => {
    if (!dashboardId || !renameState.tabId) return;
    renameTab(dashboardId, renameState.tabId, renameState.name);
    setRenameState({ open: false, tabId: null, name: "" });
    refresh();
  };

  const openDeleteDialog = (tab: DashboardTab) => {
    const tileCount = dashboard?.tiles.filter((t) => t.tabId === tab.id).length ?? 0;
    setDeleteState({
      open: true,
      tabId: tab.id,
      mode: tileCount > 0 ? "moveTilesToFirstRemaining" : "deleteTiles",
      tileCount,
    });
  };

  const handleDeleteTab = () => {
    if (!dashboardId || !deleteState.tabId) return;
    deleteTab(dashboardId, deleteState.tabId, deleteState.mode);
    // When the deleted tab IS the active tab, the self-repair effect will
    // re-select the first remaining tab on the next render.
    setDeleteState({
      open: false,
      tabId: null,
      mode: "moveTilesToFirstRemaining",
      tileCount: 0,
    });
    refresh();
  };

  const handleMoveTab = (tabId: string, direction: -1 | 1) => {
    if (!dashboardId) return;
    const idx = tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return;
    const target = idx + direction;
    if (target < 0 || target >= tabs.length) return;
    const next = tabs.map((t) => t.id);
    next.splice(idx, 1);
    next.splice(target, 0, tabId);
    reorderTabs(dashboardId, next);
    refresh();
  };

  const gridClass = useMemo(() => styles.grid, [styles.grid]);

  if (dashboard === undefined) return <LoadingPane label="Loading dashboard…" />;
  if (dashboard === null)
    return (
      <ErrorPane
        title="Dashboard not found"
        message="This dashboard may have been deleted from local storage."
      />
    );

  const sizeClass = (size: DashboardTile["size"]) =>
    size === "xs"
      ? styles.xs
      : size === "small"
      ? styles.small
      : size === "large"
      ? styles.large
      : styles.medium;

  const showTabBar = tabs.length > 1 || editMode;

  return (
    <div className={styles.root}>
      <Breadcrumb size="medium">
        <BreadcrumbItem>
          <BreadcrumbButton onClick={() => navigate("/dashboards")}>
            Dashboards
          </BreadcrumbButton>
        </BreadcrumbItem>
        <BreadcrumbDivider />
        <BreadcrumbItem>
          <BreadcrumbButton current>{dashboard.name}</BreadcrumbButton>
        </BreadcrumbItem>
      </Breadcrumb>

      <div className={styles.header}>
        <div className={styles.headerText}>
          <Text size={600} weight="semibold">
            {dashboard.name}
          </Text>
          {dashboard.description && (
            <Text className={styles.subtitle}>{dashboard.description}</Text>
          )}
        </div>
        <div className={styles.controls}>
          <Button icon={<ArrowClockwiseRegular />} onClick={handleRefreshAll}>
            Refresh
          </Button>
          <Switch
            checked={editMode}
            onChange={(_e, data) => setEditMode(data.checked)}
            label="Edit mode"
          />
          {editMode && (
            <Button appearance="primary" icon={<AddRegular />} onClick={openNewTile}>
              Add tile
            </Button>
          )}
        </div>
      </div>

      {showTabBar && (
        <div className={styles.tabBar}>
          <TabList
            selectedValue={currentTabId ?? undefined}
            onTabSelect={onTabSelect}
          >
            {tabs.map((tab) => (
              <Tab key={tab.id} value={tab.id}>
                {tab.name}
              </Tab>
            ))}
          </TabList>
          {editMode && (
            <div className={styles.tabRow}>
              {currentTabId && tabs.length > 0 && (
                <Menu>
                  <MenuTrigger disableButtonEnhancement>
                    <MenuButton
                      appearance="subtle"
                      icon={<MoreHorizontalRegular />}
                      size="small"
                      aria-label={`Actions for tab ${
                        tabs.find((t) => t.id === currentTabId)?.name ?? ""
                      }`}
                    />
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      <MenuItem
                        onClick={() => {
                          const t = tabs.find((x) => x.id === currentTabId);
                          if (t) openRenameDialog(t);
                        }}
                      >
                        Rename
                      </MenuItem>
                      <MenuItem
                        disabled={tabs.findIndex((t) => t.id === currentTabId) <= 0}
                        onClick={() => handleMoveTab(currentTabId, -1)}
                      >
                        Move left
                      </MenuItem>
                      <MenuItem
                        disabled={
                          tabs.findIndex((t) => t.id === currentTabId) >= tabs.length - 1
                        }
                        onClick={() => handleMoveTab(currentTabId, 1)}
                      >
                        Move right
                      </MenuItem>
                      <MenuItem
                        disabled={tabs.length <= 1}
                        onClick={() => {
                          const t = tabs.find((x) => x.id === currentTabId);
                          if (t) openDeleteDialog(t);
                        }}
                      >
                        Delete tab…
                      </MenuItem>
                    </MenuList>
                  </MenuPopover>
                </Menu>
              )}
              <Button
                size="small"
                appearance="subtle"
                icon={<AddRegular />}
                onClick={openNewTabDialog}
                className={styles.newTabBtn}
              >
                New tab
              </Button>
            </div>
          )}
        </div>
      )}

      {visibleTiles.length === 0 ? (
        <div className={styles.empty}>
          {tabs.length > 1 ? "No tiles in this tab yet." : "No tiles yet."}{" "}
          {editMode ? (
            "Click \u201cAdd tile\u201d to create one."
          ) : (
            <>
              Turn on <strong>Edit mode</strong> to add tiles.
            </>
          )}
        </div>
      ) : (
        <div className={gridClass}>
          {visibleTiles.map((tile) => (
            <div key={tile.id} className={sizeClass(tile.size)}>
              <TileView
                tile={tile}
                editable={editMode}
                tabs={tabs}
                onMoveToTab={(tabId) => handleMoveTileToTab(tile.id, tabId)}
                onEdit={() => openEditTile(tile)}
                onDelete={() => handleDeleteTile(tile.id, tile.title)}
                onDuplicate={() => handleDuplicateTile(tile)}
                refreshKey={refreshKey}
              />
            </div>
          ))}
        </div>
      )}

      {editingTile && (
        <TileEditorDialog
          open={editorOpen}
          initialTile={editingTile}
          onClose={() => {
            setEditorOpen(false);
            setEditingTile(null);
          }}
          onSave={handleSaveTile}
        />
      )}

      <Dialog
        open={newTab.open}
        onOpenChange={(_e, data) =>
          !data.open && setNewTab({ open: false, name: "" })
        }
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>New tab</DialogTitle>
            <DialogContent>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                  Tab name
                </Text>
                <Input
                  value={newTab.name}
                  onChange={(_e, data) =>
                    setNewTab((s) => ({ ...s, name: data.value }))
                  }
                  placeholder="e.g. Lifecycle"
                />
              </div>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                onClick={() => setNewTab({ open: false, name: "" })}
              >
                Cancel
              </Button>
              <Button appearance="primary" onClick={handleCreateTab}>
                Create
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={renameState.open}
        onOpenChange={(_e, data) =>
          !data.open && setRenameState({ open: false, tabId: null, name: "" })
        }
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Rename tab</DialogTitle>
            <DialogContent>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                  Tab name
                </Text>
                <Input
                  value={renameState.name}
                  onChange={(_e, data) =>
                    setRenameState((s) => ({ ...s, name: data.value }))
                  }
                />
              </div>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                onClick={() =>
                  setRenameState({ open: false, tabId: null, name: "" })
                }
              >
                Cancel
              </Button>
              <Button appearance="primary" onClick={handleRenameTab}>
                Save
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={deleteState.open}
        onOpenChange={(_e, data) =>
          !data.open &&
          setDeleteState({
            open: false,
            tabId: null,
            mode: "moveTilesToFirstRemaining",
            tileCount: 0,
          })
        }
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Delete tab</DialogTitle>
            <DialogContent>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Text>
                  {deleteState.tileCount === 0 ? (
                    <>This tab has no tiles. Delete it?</>
                  ) : (
                    <>
                      This tab contains <strong>{deleteState.tileCount}</strong>{" "}
                      tile{deleteState.tileCount === 1 ? "" : "s"}. What should
                      happen to {deleteState.tileCount === 1 ? "it" : "them"}?
                    </>
                  )}
                </Text>
                {deleteState.tileCount > 0 && (
                  <RadioGroup
                    value={deleteState.mode}
                    onChange={(_e, data) =>
                      setDeleteState((s) => ({
                        ...s,
                        mode: data.value as TabDeleteMode,
                      }))
                    }
                  >
                    <Radio
                      value="moveTilesToFirstRemaining"
                      label="Move tiles to the first remaining tab"
                    />
                    <Radio value="deleteTiles" label="Delete the tiles too" />
                  </RadioGroup>
                )}
              </div>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                onClick={() =>
                  setDeleteState({
                    open: false,
                    tabId: null,
                    mode: "moveTilesToFirstRemaining",
                    tileCount: 0,
                  })
                }
              >
                Cancel
              </Button>
              <Button appearance="primary" onClick={handleDeleteTab}>
                Delete tab
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
