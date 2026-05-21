import { useCallback, useMemo, useState } from "react";
import {
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
  listAgentsPage,
  shortResourceType,
  type AgentFilters,
  type AgentRow,
} from "../data/inventory";
import { ResourceListPage } from "../components/ResourceListPage";
import { EnvironmentPicker } from "../components/EnvironmentPicker";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

const useStyles = makeStyles({
  search: {
    minWidth: "260px",
  },
});

function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

export function AgentsList() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [envId, setEnvId] = useState<string | undefined>(undefined);
  const [queryInput, setQueryInput] = useState("");
  const debouncedQuery = useDebouncedValue(queryInput, 350);

  const filters: AgentFilters = useMemo(
    () => ({
      environmentId: envId,
      nameContains: debouncedQuery.trim() || undefined,
    }),
    [envId, debouncedQuery]
  );

  const filterKey = useMemo(
    () => JSON.stringify([filters.environmentId ?? "", filters.nameContains ?? ""]),
    [filters]
  );

  const fetchPage = useCallback(
    (skipToken?: string) => listAgentsPage(filters, skipToken),
    [filters]
  );

  const columns: TableColumnDefinition<AgentRow>[] = useMemo(
    () => [
      createTableColumn<AgentRow>({
        columnId: "displayName",
        renderHeaderCell: () => "Name",
        renderCell: (row) => (
          <Link onClick={() => navigate(`/agents/${encodeURIComponent(row.id)}`)}>
            {row.displayName || row.id}
          </Link>
        ),
      }),
      createTableColumn<AgentRow>({
        columnId: "type",
        renderHeaderCell: () => "Type",
        renderCell: (row) => (
          <Badge appearance="outline" color="informative">
            {shortResourceType(row.type)}
          </Badge>
        ),
      }),
      createTableColumn<AgentRow>({
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
      createTableColumn<AgentRow>({
        columnId: "owner",
        renderHeaderCell: () => "Owner",
        renderCell: (row) => row.ownerDisplayName || row.ownerId || "—",
      }),
      createTableColumn<AgentRow>({
        columnId: "lastPublishedAt",
        renderHeaderCell: () => "Last published",
        renderCell: (row) => formatDate(row.lastPublishedAt),
      }),
    ],
    [navigate]
  );

  return (
    <ResourceListPage<AgentRow>
      title="Agents"
      subtitle="Copilot Studio agents across all environments."
      filterKey={filterKey}
      fetchPage={fetchPage}
      columns={columns}
      getRowId={(row) => row.id}
      emptyMessage={
        debouncedQuery || envId
          ? "No agents match the current filters."
          : "No agents found."
      }
      filterControls={
        <>
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
