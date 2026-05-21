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
} from "@fluentui/react-components";
import { AddRegular } from "@fluentui/react-icons";
import { useNavigate, useParams } from "react-router-dom";
import {
  deleteTile,
  getDashboard,
  newId,
  newTileTemplate,
  upsertTile,
  type Dashboard,
  type DashboardTile,
} from "../data/dashboards";
import { ErrorPane, LoadingPane } from "../components/Status";
import { TileView } from "../components/TileView";
import { TileEditorDialog } from "../components/TileEditorDialog";

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

export function DashboardDetail() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { dashboardId } = useParams<{ dashboardId: string }>();
  const [dashboard, setDashboard] = useState<Dashboard | null | undefined>(undefined);
  const [editMode, setEditMode] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTile, setEditingTile] = useState<DashboardTile | null>(null);

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

  const refresh = () => {
    if (!dashboardId) return;
    setDashboard(getDashboard(dashboardId));
  };

  const openNewTile = () => {
    setEditingTile(newTileTemplate());
    setEditorOpen(true);
  };

  const openEditTile = (tile: DashboardTile) => {
    setEditingTile(tile);
    setEditorOpen(true);
  };

  const handleSaveTile = (tile: DashboardTile) => {
    if (!dashboardId) return;
    upsertTile(dashboardId, tile);
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

      {dashboard.tiles.length === 0 ? (
        <div className={styles.empty}>
          No tiles yet.{" "}
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
          {dashboard.tiles.map((tile) => (
            <div key={tile.id} className={sizeClass(tile.size)}>
              <TileView
                tile={tile}
                editable={editMode}
                onEdit={() => openEditTile(tile)}
                onDelete={() => handleDeleteTile(tile.id, tile.title)}
                onDuplicate={() => handleDuplicateTile(tile)}
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
    </div>
  );
}
