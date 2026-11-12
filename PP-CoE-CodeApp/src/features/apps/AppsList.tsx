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
  MANAGED_APP_SUBTYPE,
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
import { fromFluentColumns, type ViewColumn } from "../../shared/resource-table";

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
  { value: ResourceType.CodeApp, label: "Code / Vibe" },
  { value: ResourceType.AppBuilderApp, label: "Managed / App Builder" },
];

const SUBTYPE_OPTIONS = [
  { value: "byocApp", label: "Code app", type: ResourceType.CodeApp },
  { value: "vibeApp", label: "Vibe app", type: ResourceType.CodeApp },
  { value: MANAGED_APP_SUBTYPE, label: "Managed app", type: ResourceType.AppBuilderApp },
  { value: "appBuilderApp", label: "App Builder app", type: ResourceType.AppBuilderApp },
];

export function AppsList() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { classify, catalog } = useConnectorCatalog();
  const [types, setTypes] = useState<ResourceTypeValue[]>([]);
  const [subType, setSubType] = useState("");
  const [envId, setEnvId] = useState<string | undefined>(undefined);
  const [queryInput, setQueryInput] = useState("");
  const debouncedQuery = useDebouncedValue(queryInput, 350);

  const filters: AppFilters = useMemo(
    () => ({
      types: types.length === 0 ? undefined : types,
      subType: subType || undefined,
      environmentId: envId,
      nameContains: debouncedQuery.trim() || undefined,
    }),
    [types, subType, envId, debouncedQuery]
  );

  const filterKey = useMemo(
    () =>
      JSON.stringify([
        (filters.types ?? ALL_APP_TYPES).slice().sort(),
        filters.subType ?? "",
        filters.environmentId ?? "",
        filters.nameContains ?? "",
      ]),
    [filters]
  );

  const fetchPage = useCallback(
    (skipToken?: string, skip?: number) => listAppsPage(filters, skipToken, 500, skip ?? 0),
    [filters]
  );

  const tier = useCallback((row: AppRow) => {
    if (!catalog || !row.connectors.length) return "";
    const classifications = row.connectors.map((c) => classify(c.connectorId));
    if (classifications.some((c) => c.tier === "Premium")) return "Premium";
    if (classifications.some((c) => c.reason === "not-found")) return "Premium (custom)";
    if (classifications.some((c) => c.tier === "Unknown")) return "";
    return "Standard";
  }, [classify, catalog]);

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
            {shortResourceType(row.type, row.subType)}
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
          const label = tier(row);
          if (label === "Premium") {
            return (
              <Badge appearance="filled" color="warning">
                Premium
              </Badge>
            );
          }
          if (label === "Premium (custom)") {
            return (
              <Badge appearance="outline" color="warning" title="Uses a connector absent from the complete catalog - likely custom (treated as Premium for licensing).">
                Premium (custom)
              </Badge>
            );
          }
          if (!label) return "—";
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
    [navigate, tier]
  );

  const viewColumns = useMemo<ViewColumn<AppRow>[]>(() => [
    ...fromFluentColumns(columns, {
      displayName: { value: (row) => row.displayName || row.id },
      type: { kind: "category", value: (row) => shortResourceType(row.type, row.subType), exportValue: (row) => row.type },
      environment: { value: (row) => row.environmentName || row.environmentId, exportValue: (row) => row.environmentId },
      owner: { value: (row) => row.ownerDisplayName || row.ownerId, exportValue: (row) => row.ownerId },
      premium: { kind: "category", value: tier },
      lastModifiedAt: { kind: "date" },
    }),
    { id: "id", label: "App ID", value: (row) => row.id, defaultVisible: false },
    { id: "logicalName", label: "Logical name", value: (row) => row.logicalName, defaultVisible: false },
    { id: "appModuleId", label: "App module ID", value: (row) => row.appModuleId, defaultVisible: false },
    { id: "ownerId", label: "Owner ID", value: (row) => row.ownerId, defaultVisible: false },
    { id: "createdBy", label: "Creator ID", value: (row) => row.createdBy, defaultVisible: false },
    { id: "lastModifiedBy", label: "Modifier ID", value: (row) => row.lastModifiedBy, defaultVisible: false },
    { id: "createdAt", label: "Created on", kind: "date", value: (row) => row.createdAt, render: (row) => formatDate(row.createdAt), defaultVisible: false },
    { id: "lastLaunchedAt", label: "Last launched", kind: "date", value: (row) => row.lastLaunchedAt, render: (row) => formatDate(row.lastLaunchedAt), defaultVisible: false },
    { id: "region", label: "Region", kind: "category", value: (row) => row.region, defaultVisible: false },
    { id: "subType", label: "Sub-type", kind: "category", value: (row) => row.subType, defaultVisible: false },
    { id: "isQuarantined", label: "Quarantined", kind: "boolean", value: (row) => row.isQuarantined, defaultVisible: false },
    { id: "isFeatured", label: "Featured", kind: "boolean", value: (row) => row.isFeatured, defaultVisible: false },
    { id: "bypassConsent", label: "Bypass consent", kind: "boolean", value: (row) => row.bypassConsent, defaultVisible: false },
    { id: "sharedUsersCount", label: "Shared users", kind: "number", value: (row) => row.sharedUsersCount, defaultVisible: false },
    { id: "sharedGroupsCount", label: "Shared groups", kind: "number", value: (row) => row.sharedGroupsCount, defaultVisible: false },
    { id: "connectorCount", label: "Connectors", kind: "number", value: (row) => row.connectors.length, defaultVisible: false },
  ], [columns, tier]);

  const onTypeSelect = (_e: unknown, data: { selectedOptions: string[] }) => {
    setTypes(data.selectedOptions as ResourceTypeValue[]);
    setSubType("");
  };

  const subTypeOptions = SUBTYPE_OPTIONS.filter(
    (option) => types.length === 0 || types.includes(option.type),
  );
  const typeText =
    types.length === 0
      ? "All types"
      : types.map((t) => TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t).join(", ");

  return (
    <ResourceListPage<AppRow>
      title="Apps"
      subtitle="Canvas, model-driven, code, vibe, managed, and App Builder apps across all environments."
      filterKey={filterKey}
      fetchPage={fetchPage}
      columns={columns}
      viewColumns={viewColumns}
      getRowId={(row) => row.id}
      emptyMessage={
        debouncedQuery || envId || types.length || subType
          ? "No apps match the current filters."
          : "No apps found."
      }
      filterControls={
        <>
          <Dropdown
            className={styles.typeDropdown}
            multiselect
            placeholder="All types"
            aria-label="App resource types"
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
          <Dropdown
            className={styles.typeDropdown}
            aria-label="App sub-type"
            value={SUBTYPE_OPTIONS.find((option) => option.value === subType)?.label ?? "All sub-types"}
            selectedOptions={[subType]}
            disabled={subTypeOptions.length === 0}
            onOptionSelect={(_event, data) => setSubType(data.optionValue ?? "")}
          >
            <Option value="">All sub-types</Option>
            {subTypeOptions.map((option) => (
              <Option key={option.value} value={option.value}>
                {option.label}
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
