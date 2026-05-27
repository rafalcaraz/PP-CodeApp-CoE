import { useCallback, useMemo, useState } from "react";
import {
  Dropdown,
  Option,
  Badge,
  Link,
  Input,
  type TableColumnDefinition,
  createTableColumn,
  makeStyles,
  tokens,
  type InputOnChangeData,
} from "@fluentui/react-components";
import { useNavigate } from "react-router-dom";
import {
  ALL_APP_TYPES,
  ResourceType,
  listAppsPage,
  shortResourceType,
  type AppFilters,
  type AppRow,
  type ResourceTypeValue,
} from "./data";
import { ResourceListPage } from "../../components/ResourceListPage";
import { EnvironmentPicker } from "../../components/EnvironmentPicker";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useConnectorCatalog } from "../../shared/connector-catalog";

const useStyles = makeStyles({
  search: {
    minWidth: "260px",
  },
  typeDropdown: {
    minWidth: "220px",
  },
});

function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

const TYPE_OPTIONS: { value: ResourceTypeValue; label: string }[] = [
  { value: ResourceType.CanvasApp, label: "Canvas" },
  { value: ResourceType.ModelDrivenApp, label: "Model-driven" },
  { value: ResourceType.CodeApp, label: "Code" },
  { value: ResourceType.AppBuilderApp, label: "App Builder" },
];

export function AppsList() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { classify } = useConnectorCatalog();
  const [types, setTypes] = useState<ResourceTypeValue[]>([]);
  const [envId, setEnvId] = useState<string | undefined>(undefined);
  const [queryInput, setQueryInput] = useState("");
  const debouncedQuery = useDebouncedValue(queryInput, 350);

  const filters: AppFilters = useMemo(
    () => ({
      types: types.length === 0 ? undefined : types,
      environmentId: envId,
      nameContains: debouncedQuery.trim() || undefined,
    }),
    [types, envId, debouncedQuery]
  );

  const filterKey = useMemo(
    () =>
      JSON.stringify([
        (filters.types ?? ALL_APP_TYPES).slice().sort(),
        filters.environmentId ?? "",
        filters.nameContains ?? "",
      ]),
    [filters]
  );

  const fetchPage = useCallback(
    (skipToken?: string, skip?: number) => listAppsPage(filters, skipToken, 500, skip ?? 0),
    [filters]
  );

  const columns: TableColumnDefinition<AppRow>[] = useMemo(
    () => [
      createTableColumn<AppRow>({
        columnId: "displayName",
        renderHeaderCell: () => "Name",
        renderCell: (row) => (
          <Link onClick={() => navigate(`/apps/${encodeURIComponent(row.id)}`)}>
            {row.displayName || row.id}
          </Link>
        ),
      }),
      createTableColumn<AppRow>({
        columnId: "type",
        renderHeaderCell: () => "Type",
        renderCell: (row) => (
          <Badge appearance="outline" color="informative">
            {shortResourceType(row.type)}
          </Badge>
        ),
      }),
      createTableColumn<AppRow>({
        columnId: "environment",
        renderHeaderCell: () => "Environment",
        renderCell: (row) =>
          row.environmentId ? (
            <Link
              onClick={() =>
                navigate(`/environments/${encodeURIComponent(row.environmentId)}`)
              }
            >
              {row.environmentName || row.environmentId}
            </Link>
          ) : (
            "—"
          ),
      }),
      createTableColumn<AppRow>({
        columnId: "owner",
        renderHeaderCell: () => "Owner",
        renderCell: (row) => row.ownerDisplayName || row.ownerId || "—",
      }),
      createTableColumn<AppRow>({
        columnId: "premium",
        renderHeaderCell: () => "Tier",
        renderCell: (row) => {
          // Roll the row's connectors up to a single tier. Any Premium
          // wins; otherwise any Unknown (i.e. a custom connector not in
          // the OOB catalog) wins; else Standard. The catalog hook
          // re-renders the whole grid when the snapshot loads, so the
          // badge flips from `—` to a real value with no extra wiring.
          if (row.connectors.length === 0) return "—";
          let sawPremium = false;
          let sawUnknown = false;
          for (const c of row.connectors) {
            const t = classify(c.connectorId).tier;
            if (t === "Premium") sawPremium = true;
            else if (t === "Unknown") sawUnknown = true;
          }
          if (sawPremium) {
            return (
              <Badge appearance="filled" color="warning">
                Premium
              </Badge>
            );
          }
          if (sawUnknown) {
            return (
              <Badge appearance="outline" color="warning" title="Uses a connector not in the OOB catalog — likely custom (treated as Premium for licensing).">
                Premium (custom)
              </Badge>
            );
          }
          return (
            <Badge appearance="outline" color="informative">
              Standard
            </Badge>
          );
        },
      }),
      createTableColumn<AppRow>({
        columnId: "lastModifiedAt",
        renderHeaderCell: () => "Modified",
        renderCell: (row) => formatDate(row.lastModifiedAt),
      }),
    ],
    [navigate, classify]
  );

  const onTypeSelect = (_e: unknown, data: { selectedOptions: string[] }) => {
    setTypes(data.selectedOptions as ResourceTypeValue[]);
  };

  const typeText =
    types.length === 0
      ? "All types"
      : types.map((t) => TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t).join(", ");

  return (
    <ResourceListPage<AppRow>
      title="Apps"
      subtitle="Canvas, model-driven, code, and app-builder apps across all environments."
      filterKey={filterKey}
      fetchPage={fetchPage}
      columns={columns}
      getRowId={(row) => row.id}
      emptyMessage={
        debouncedQuery || envId || types.length
          ? "No apps match the current filters."
          : "No apps found."
      }
      filterControls={
        <>
          <Dropdown
            className={styles.typeDropdown}
            multiselect
            placeholder="All types"
            value={typeText}
            selectedOptions={types}
            onOptionSelect={onTypeSelect}
          >
            {TYPE_OPTIONS.map((opt) => (
              <Option key={opt.value} value={opt.value} text={opt.label}>
                {opt.label}
              </Option>
            ))}
          </Dropdown>
          <EnvironmentPicker value={envId} onChange={setEnvId} />
          <Input
            className={styles.search}
            placeholder="Search by name"
            value={queryInput}
            onChange={(_e, data: InputOnChangeData) => setQueryInput(data.value)}
            contentBefore={<SearchIcon />}
          />
        </>
      }
    />
  );
}

function SearchIcon() {
  return (
    <span
      aria-hidden
      style={{ color: tokens.colorNeutralForeground3, display: "inline-flex" }}
    >
      🔍
    </span>
  );
}
