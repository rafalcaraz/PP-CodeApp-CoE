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
  ALL_FLOW_TYPES,
  ResourceType,
  listFlowsPage,
  shortResourceType,
  type FlowFilters,
  type FlowRow,
  type ResourceTypeValue,
} from "../data/inventory";
import { ResourceListPage } from "../components/ResourceListPage";
import { EnvironmentPicker } from "../components/EnvironmentPicker";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

const useStyles = makeStyles({
  search: {
    minWidth: "260px",
  },
  typeDropdown: {
    minWidth: "220px",
  },
  stateDropdown: {
    minWidth: "180px",
  },
});

function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

const TYPE_OPTIONS: { value: ResourceTypeValue; label: string }[] = [
  { value: ResourceType.CloudFlow, label: "Cloud flow" },
  { value: ResourceType.AgentFlow, label: "Agent flow" },
  { value: ResourceType.WorkflowAgentFlow, label: "Workflow agent flow" },
];

const STATUS_OPTIONS = [
  { value: "", label: "Any status" },
  { value: "Activated", label: "Activated" },
  { value: "Suspended", label: "Suspended" },
  { value: "Stopped", label: "Stopped" },
  { value: "Started", label: "Started" },
  { value: "NotStarted", label: "Not started" },
];

const TRIGGER_TYPE_OPTIONS = [
  { value: "", label: "Any trigger" },
  { value: "Instant", label: "Instant" },
  { value: "Automated", label: "Automated" },
  { value: "Recurrence", label: "Recurrence" },
  { value: "Manual", label: "Manual" },
];

function statusBadgeColor(
  status: string
): "success" | "danger" | "warning" | "subtle" | "informative" {
  const s = status.toLowerCase();
  if (s === "activated" || s === "started") return "success";
  if (s === "stopped") return "danger";
  if (s === "suspended") return "warning";
  if (s === "notstarted") return "informative";
  return "subtle";
}

export function FlowsList() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [types, setTypes] = useState<ResourceTypeValue[]>([]);
  const [envId, setEnvId] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [triggerFilter, setTriggerFilter] = useState<string>("");
  const [queryInput, setQueryInput] = useState("");
  const debouncedQuery = useDebouncedValue(queryInput, 350);

  const filters: FlowFilters = useMemo(
    () => ({
      types: types.length === 0 ? undefined : types,
      environmentId: envId,
      status: statusFilter || undefined,
      flowTriggerType: triggerFilter || undefined,
      nameContains: debouncedQuery.trim() || undefined,
    }),
    [types, envId, statusFilter, triggerFilter, debouncedQuery]
  );

  const filterKey = useMemo(
    () =>
      JSON.stringify([
        (filters.types ?? ALL_FLOW_TYPES).slice().sort(),
        filters.environmentId ?? "",
        filters.status ?? "",
        filters.flowTriggerType ?? "",
        filters.nameContains ?? "",
      ]),
    [filters]
  );

  const fetchPage = useCallback(
    (skipToken?: string) => listFlowsPage(filters, skipToken),
    [filters]
  );

  const columns: TableColumnDefinition<FlowRow>[] = useMemo(
    () => [
      createTableColumn<FlowRow>({
        columnId: "displayName",
        renderHeaderCell: () => "Name",
        renderCell: (row) => (
          <Link onClick={() => navigate(`/flows/${encodeURIComponent(row.id)}`)}>
            {row.displayName || row.id}
          </Link>
        ),
      }),
      createTableColumn<FlowRow>({
        columnId: "type",
        renderHeaderCell: () => "Type",
        renderCell: (row) => (
          <Badge appearance="outline" color="informative">
            {shortResourceType(row.type)}
          </Badge>
        ),
      }),
      createTableColumn<FlowRow>({
        columnId: "status",
        renderHeaderCell: () => "Status",
        renderCell: (row) =>
          row.status ? (
            <Badge appearance="filled" color={statusBadgeColor(row.status)}>
              {row.status}
            </Badge>
          ) : (
            "—"
          ),
      }),
      createTableColumn<FlowRow>({
        columnId: "trigger",
        renderHeaderCell: () => "Trigger",
        renderCell: (row) => {
          const t = row.trigger;
          const label = t?.operationDisplayName || t?.operationId || "—";
          const sub = row.flowTriggerType;
          return (
            <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.2 }}>
              <span>{label}</span>
              {sub && (
                <span style={{ color: "var(--colorNeutralForeground3)", fontSize: 11 }}>
                  {sub}
                </span>
              )}
            </span>
          );
        },
      }),
      createTableColumn<FlowRow>({
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
      createTableColumn<FlowRow>({
        columnId: "owner",
        renderHeaderCell: () => "Owner",
        renderCell: (row) => row.ownerDisplayName || row.ownerId || "—",
      }),
      createTableColumn<FlowRow>({
        columnId: "lastModifiedAt",
        renderHeaderCell: () => "Modified",
        renderCell: (row) => formatDate(row.lastModifiedAt),
      }),
    ],
    [navigate]
  );

  const onTypeSelect = (_e: unknown, data: { selectedOptions: string[] }) => {
    setTypes(data.selectedOptions as ResourceTypeValue[]);
  };

  const typeText =
    types.length === 0
      ? "All types"
      : types.map((t) => TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t).join(", ");

  return (
    <ResourceListPage<FlowRow>
      title="Flows"
      subtitle="Cloud flows, agent flows, and workflow agent flows across all environments."
      filterKey={filterKey}
      fetchPage={fetchPage}
      columns={columns}
      getRowId={(row) => row.id}
      emptyMessage={
        debouncedQuery || envId || types.length || statusFilter || triggerFilter
          ? "No flows match the current filters."
          : "No flows found."
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
          <Dropdown
            className={styles.stateDropdown}
            placeholder="Any status"
            value={STATUS_OPTIONS.find((s) => s.value === statusFilter)?.label ?? "Any status"}
            selectedOptions={[statusFilter]}
            onOptionSelect={(_e, data) => setStatusFilter((data.optionValue as string) ?? "")}
          >
            {STATUS_OPTIONS.map((opt) => (
              <Option key={opt.value || "any"} value={opt.value} text={opt.label}>
                {opt.label}
              </Option>
            ))}
          </Dropdown>
          <Dropdown
            className={styles.stateDropdown}
            placeholder="Any trigger"
            value={
              TRIGGER_TYPE_OPTIONS.find((s) => s.value === triggerFilter)?.label ?? "Any trigger"
            }
            selectedOptions={[triggerFilter]}
            onOptionSelect={(_e, data) => setTriggerFilter((data.optionValue as string) ?? "")}
          >
            {TRIGGER_TYPE_OPTIONS.map((opt) => (
              <Option key={opt.value || "anytrig"} value={opt.value} text={opt.label}>
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
            contentBefore={
              <span aria-hidden style={{ color: tokens.colorNeutralForeground3 }}>
                🔍
              </span>
            }
          />
        </>
      }
    />
  );
}
