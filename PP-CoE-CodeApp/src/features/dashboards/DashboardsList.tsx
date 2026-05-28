import { useEffect, useState } from "react";
import {
  makeStyles,
  tokens,
  Text,
  Card,
  CardHeader,
  Divider,
  Button,
  Link,
  Input,
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  SplitButton,
  type MenuButtonProps,
} from "@fluentui/react-components";
import { AddRegular } from "@fluentui/react-icons";
import { useNavigate } from "react-router-dom";
import {
  createDashboard,
  createDashboardFromTemplate,
  deleteDashboard,
  listDashboards,
  type Dashboard,
} from "../../data/dashboards";
import { DASHBOARD_TEMPLATES, getDashboardTemplate } from "../../data/dashboardTemplates";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  subtitle: {
    color: tokens.colorNeutralForeground3,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: tokens.spacingHorizontalL,
  },
  card: {
    cursor: "pointer",
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  cardBody: {
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  cardActions: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
    justifyContent: "flex-end",
    padding: `0 ${tokens.spacingHorizontalM} ${tokens.spacingVerticalM}`,
  },
  desc: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export function DashboardsList() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [items, setItems] = useState<Dashboard[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setItems(listDashboards());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = () => setItems(listDashboards());

  const handleCreate = () => {
    const name = newName.trim() || "Untitled dashboard";
    const d = createDashboard(name, newDesc.trim());
    setNewOpen(false);
    setNewName("");
    setNewDesc("");
    navigate(`/dashboards/${d.id}`);
  };

  const handleCreateFromTemplate = (templateId: string) => {
    const tpl = getDashboardTemplate(templateId);
    if (!tpl) return;
    const layout = tpl.buildLayout?.() ?? { tiles: tpl.build() };
    const d = createDashboardFromTemplate(tpl.name, tpl.description, layout);
    refresh();
    navigate(`/dashboards/${d.id}`);
  };

  const handleDelete = (id: string, name: string) => {
    if (!window.confirm(`Delete dashboard "${name}"? This can't be undone.`)) return;
    deleteDashboard(id);
    refresh();
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text size={600} weight="semibold">
          Dashboards
        </Text>
        <Text className={styles.subtitle}>
          Build your own dashboards by composing tiles. Each tile is a query plus a
          visualization. Stored locally in this browser — Dataverse-backed sharing is
          on the roadmap.
        </Text>
      </div>

      <div className={styles.toolbar}>
        <Menu positioning="below-start">
          <MenuTrigger disableButtonEnhancement>
            {(triggerProps: MenuButtonProps) => (
              <SplitButton
                menuButton={triggerProps}
                primaryActionButton={{
                  onClick: () => setNewOpen(true),
                }}
                appearance="primary"
                icon={<AddRegular />}
              >
                New dashboard
              </SplitButton>
            )}
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => setNewOpen(true)}>
                Blank dashboard
              </MenuItem>
              <Divider />
              {DASHBOARD_TEMPLATES.map((tpl) => (
                <MenuItem
                  key={tpl.id}
                  onClick={() => handleCreateFromTemplate(tpl.id)}
                >
                  From template: {tpl.name}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>

      <div className={styles.grid}>
        {items.map((d) => (
          <Card key={d.id} className={styles.card}>
            <div onClick={() => navigate(`/dashboards/${d.id}`)}>
              <div className={styles.cardBody}>
                <Link onClick={() => navigate(`/dashboards/${d.id}`)}>
                  <Text weight="semibold" size={400}>
                    {d.name}
                  </Text>
                </Link>
                {d.description && <Text className={styles.desc}>{d.description}</Text>}
                <Text className={styles.meta}>
                  {d.tiles.length} tile{d.tiles.length === 1 ? "" : "s"} · updated{" "}
                  {formatDate(d.updatedAt)}
                </Text>
              </div>
            </div>
            <div className={styles.cardActions}>
              <Button
                size="small"
                appearance="subtle"
                onClick={() => handleDelete(d.id, d.name)}
              >
                Delete
              </Button>
              <Button
                size="small"
                appearance="primary"
                onClick={() => navigate(`/dashboards/${d.id}`)}
              >
                Open
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={newOpen} onOpenChange={(_e, data) => !data.open && setNewOpen(false)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>New dashboard</DialogTitle>
            <DialogContent>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                    Name
                  </Text>
                  <Input
                    style={{ width: "100%" }}
                    value={newName}
                    onChange={(_e, data) => setNewName(data.value)}
                    placeholder="e.g. Power Apps governance"
                  />
                </div>
                <div>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                    Description
                  </Text>
                  <Input
                    style={{ width: "100%" }}
                    value={newDesc}
                    onChange={(_e, data) => setNewDesc(data.value)}
                    placeholder="Optional"
                  />
                </div>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setNewOpen(false)}>
                Cancel
              </Button>
              <Button appearance="primary" onClick={handleCreate}>
                Create
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Divider />
      <CardHeader header={<Text weight="semibold">Tip</Text>} />
      <Text className={styles.desc}>
        Need an exact query before pinning it? Build and try it under <strong>Queries</strong>{" "}
        first, then translate the same filters into a tile here.
      </Text>
    </div>
  );
}
