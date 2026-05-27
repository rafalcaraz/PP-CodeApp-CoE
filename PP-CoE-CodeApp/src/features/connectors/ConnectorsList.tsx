/**
 * Connectors view — per-environment connector inventory.
 *
 * Discovery surface: pick an environment, hit Run, see every connector
 * available there along with its tier (Standard/Premium), publisher,
 * and a custom-or-not flag. Powers manual investigation of how the
 * underlying `ListConnectors` payload looks before we wire the same
 * fanout into the tenant-wide premium-detection layer (see
 * `shared/deep-inventory/` for the eventual home).
 */
import { useCallback, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Caption1,
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridRow,
  Input,
  Text,
  Title2,
  createTableColumn,
  makeStyles,
  tokens,
  type InputOnChangeData,
  type TableColumnDefinition,
} from "@fluentui/react-components";
import { EnvironmentPicker } from "../../components/EnvironmentPicker";
import { LoadingPane, ErrorPane, EmptyPane } from "../../components/Status";
import { RawJsonAccordion } from "../../components/RawJsonAccordion";
import { listConnectorsForEnv, type ConnectorRow } from "./data";

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
  controls: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: tokens.spacingHorizontalM,
  },
  controlGroup: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    minWidth: "240px",
  },
  controlLabel: {
    color: tokens.colorNeutralForeground3,
  },
  filterInput: {
    minWidth: "240px",
  },
  summary: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    color: tokens.colorNeutralForeground3,
  },
});

function tierBadgeAppearance(
  tier: string,
): "outline" | "tint" | "filled" | "ghost" {
  return tier.toLowerCase() === "premium" ? "filled" : "outline";
}

function tierBadgeColor(
  tier: string,
):
  | "brand"
  | "danger"
  | "important"
  | "informative"
  | "severe"
  | "subtle"
  | "success"
  | "warning" {
  const t = tier.toLowerCase();
  if (t === "premium") return "warning";
  if (t === "standard") return "informative";
  return "subtle";
}

const COLUMNS: TableColumnDefinition<ConnectorRow>[] = [
  createTableColumn<ConnectorRow>({
    columnId: "displayName",
    compare: (a, b) => a.displayName.localeCompare(b.displayName),
    renderHeaderCell: () => "Display name",
    renderCell: (row) => <Text weight="semibold">{row.displayName}</Text>,
  }),
  createTableColumn<ConnectorRow>({
    columnId: "tier",
    compare: (a, b) => a.tier.localeCompare(b.tier),
    renderHeaderCell: () => "Tier",
    renderCell: (row) =>
      row.tier ? (
        <Badge appearance={tierBadgeAppearance(row.tier)} color={tierBadgeColor(row.tier)}>
          {row.tier}
        </Badge>
      ) : (
        <Caption1>—</Caption1>
      ),
  }),
  createTableColumn<ConnectorRow>({
    columnId: "publisher",
    compare: (a, b) => a.publisher.localeCompare(b.publisher),
    renderHeaderCell: () => "Publisher",
    renderCell: (row) => row.publisher || <Caption1>—</Caption1>,
  }),
  createTableColumn<ConnectorRow>({
    columnId: "isCustomApi",
    compare: (a, b) => Number(a.isCustomApi) - Number(b.isCustomApi),
    renderHeaderCell: () => "Custom",
    renderCell: (row) =>
      row.isCustomApi ? (
        <Badge appearance="outline" color="brand">
          Custom
        </Badge>
      ) : (
        <Caption1>—</Caption1>
      ),
  }),
  createTableColumn<ConnectorRow>({
    columnId: "connectorId",
    compare: (a, b) => a.connectorId.localeCompare(b.connectorId),
    renderHeaderCell: () => "Connector id",
    renderCell: (row) => <Caption1>{row.connectorId}</Caption1>,
  }),
];

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ok"; rows: ConnectorRow[]; raw: unknown };

export function ConnectorsList() {
  const styles = useStyles();
  const [envId, setEnvId] = useState<string | undefined>(undefined);
  const [filterText, setFilterText] = useState("");
  const [state, setState] = useState<FetchState>({ kind: "idle" });

  const run = useCallback(async () => {
    if (!envId) return;
    setState({ kind: "loading" });
    const result = await listConnectorsForEnv(envId);
    if (!result.ok) {
      setState({ kind: "error", message: result.error });
      return;
    }
    setState({ kind: "ok", rows: result.data.rows, raw: result.data.raw });
  }, [envId]);

  const filteredRows = useMemo(() => {
    if (state.kind !== "ok") return [];
    const q = filterText.trim().toLowerCase();
    if (!q) return state.rows;
    return state.rows.filter(
      (r) =>
        r.displayName.toLowerCase().includes(q) ||
        r.connectorId.toLowerCase().includes(q) ||
        r.publisher.toLowerCase().includes(q),
    );
  }, [state, filterText]);

  const premiumCount = useMemo(
    () =>
      state.kind === "ok"
        ? state.rows.filter((r) => r.tier.toLowerCase() === "premium").length
        : 0,
    [state],
  );

  const customCount = useMemo(
    () =>
      state.kind === "ok" ? state.rows.filter((r) => r.isCustomApi).length : 0,
    [state],
  );

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Title2>Connectors</Title2>
        <Text className={styles.subtitle}>
          List every connector available in a single environment. Backed by
          the Power Platform for Admins V2 <code>ListConnectors</code> action.
          Per-connector <code>tier</code> is what drives the premium signal
          we&apos;ll later join into apps and flows.
        </Text>
      </div>

      <div className={styles.controls}>
        <div className={styles.controlGroup}>
          <Caption1 className={styles.controlLabel}>Environment</Caption1>
          <EnvironmentPicker
            value={envId}
            onChange={setEnvId}
            placeholder="Pick an environment…"
          />
        </div>
        <div className={styles.controlGroup}>
          <Caption1 className={styles.controlLabel}>Filter (name / id / publisher)</Caption1>
          <Input
            className={styles.filterInput}
            value={filterText}
            placeholder="Type to filter loaded results…"
            disabled={state.kind !== "ok"}
            onChange={(_e, data: InputOnChangeData) => setFilterText(data.value)}
          />
        </div>
        <Button
          appearance="primary"
          disabled={!envId || state.kind === "loading"}
          onClick={run}
        >
          {state.kind === "loading" ? "Running…" : "Run ListConnectors"}
        </Button>
      </div>

      {state.kind === "idle" && (
        <EmptyPane message="Pick an environment and hit Run to see its connectors." />
      )}

      {state.kind === "loading" && <LoadingPane label="Calling ListConnectors…" />}

      {state.kind === "error" && (
        <ErrorPane title="ListConnectors failed" message={state.message} />
      )}

      {state.kind === "ok" && (
        <>
          <div className={styles.summary}>
            <Text>
              <strong>{state.rows.length}</strong> connectors returned
            </Text>
            <Text>•</Text>
            <Text>
              <strong>{premiumCount}</strong> premium
            </Text>
            <Text>•</Text>
            <Text>
              <strong>{customCount}</strong> custom
            </Text>
            {filterText.trim() && (
              <>
                <Text>•</Text>
                <Text>
                  showing <strong>{filteredRows.length}</strong> after filter
                </Text>
              </>
            )}
          </div>

          {filteredRows.length === 0 ? (
            <EmptyPane message="No connectors match the current filter." />
          ) : (
            <DataGrid
              items={filteredRows}
              columns={COLUMNS}
              sortable
              getRowId={(row) => row.id || row.connectorId}
              focusMode="composite"
            >
              <DataGridHeader>
                <DataGridRow>
                  {({ renderHeaderCell }) => (
                    <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                  )}
                </DataGridRow>
              </DataGridHeader>
              <DataGridBody<ConnectorRow>>
                {({ item, rowId }) => (
                  <DataGridRow<ConnectorRow> key={rowId}>
                    {({ renderCell }) => (
                      <DataGridCell>{renderCell(item)}</DataGridCell>
                    )}
                  </DataGridRow>
                )}
              </DataGridBody>
            </DataGrid>
          )}

          <RawJsonAccordion data={state.raw} title="Raw ListConnectors response" />
        </>
      )}
    </div>
  );
}
