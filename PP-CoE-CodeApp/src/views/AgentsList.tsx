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
  Button,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Field,
  Tooltip,
  Dropdown,
  Option,
  type DropdownProps,
} from "@fluentui/react-components";
import {
  FilterRegular,
  FilterFilled,
  DismissRegular,
} from "@fluentui/react-icons";
import { useNavigate } from "react-router-dom";
import {
  listAgentsPage,
  shortResourceType,
  type AgentFilterMode,
  type AgentFilters,
  type AgentRow,
  type AgentValueFilter,
} from "../data/inventory";
import { ResourceListPage } from "../components/ResourceListPage";
import { EnvironmentPicker } from "../components/EnvironmentPicker";
import { UserChip } from "../components/UserChip";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

const useStyles = makeStyles({
  search: {
    minWidth: "260px",
  },
  popoverSurface: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    minWidth: "380px",
    padding: tokens.spacingHorizontalL,
  },
  filterRow: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
    alignItems: "stretch",
  },
  modeDropdown: {
    minWidth: "118px",
    flexShrink: 0,
  },
  filterValueInput: {
    flex: 1,
    minWidth: 0,
  },
  popoverFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
  },
  popoverFooterRight: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
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

  // Per-value filter state. Each filter has:
  //   - `*Draft`     — what the user is currently typing in the popover
  //   - `*Applied`   — the value that actually drives the query
  //   - `*Mode`      — "exclude" (default) or "include" (applied immediately
  //                    on change since toggling without typing changes
  //                    intent atomically)
  // Drafts commit to applied on blur, Enter, or the popover's Apply
  // button — never on every keystroke. Avoids the mid-typing lag we
  // used to get from debounced 500-row fetches over 16k agents.
  const [schemaPrefixDraft, setSchemaPrefixDraft] = useState("");
  const [schemaPrefixApplied, setSchemaPrefixApplied] = useState("");
  const [schemaMode, setSchemaMode] = useState<AgentFilterMode>("exclude");
  const [ownerDraft, setOwnerDraft] = useState("");
  const [ownerApplied, setOwnerApplied] = useState("");
  const [ownerMode, setOwnerMode] = useState<AgentFilterMode>("exclude");

  const applyDrafts = useCallback(() => {
    setSchemaPrefixApplied(schemaPrefixDraft);
    setOwnerApplied(ownerDraft);
  }, [schemaPrefixDraft, ownerDraft]);

  const activeFilterCount =
    (schemaPrefixApplied.trim() ? 1 : 0) + (ownerApplied.trim() ? 1 : 0);

  const filters: AgentFilters = useMemo(() => {
    // Inventory stores ownerId GUIDs lowercase and the server-side `==`
    // / `!=` clauses are case-sensitive — normalize so a copy-pasted
    // GUID from the Azure portal (often mixed case) still matches.
    const schemaTrimmed = schemaPrefixApplied.trim();
    const ownerTrimmed = ownerApplied.trim().toLowerCase();
    const schemaPrefix: AgentValueFilter | undefined = schemaTrimmed
      ? { mode: schemaMode, value: schemaTrimmed }
      : undefined;
    const owner: AgentValueFilter | undefined = ownerTrimmed
      ? { mode: ownerMode, value: ownerTrimmed }
      : undefined;
    return {
      environmentId: envId,
      // Search box matches against both displayName AND schemaName
      // (combined contains in the data layer).
      nameContains: debouncedQuery.trim() || undefined,
      schemaPrefix,
      owner,
    };
  }, [envId, debouncedQuery, schemaPrefixApplied, schemaMode, ownerApplied, ownerMode]);

  const filterKey = useMemo(
    () =>
      JSON.stringify([
        filters.environmentId ?? "",
        filters.nameContains ?? "",
        filters.schemaPrefix?.mode ?? "",
        filters.schemaPrefix?.value ?? "",
        filters.owner?.mode ?? "",
        filters.owner?.value ?? "",
      ]),
    [filters]
  );

  const fetchPage = useCallback(
    (skipToken?: string, skip?: number) => listAgentsPage(filters, skipToken, 500, skip ?? 0),
    [filters]
  );

  const clearFilters = useCallback(() => {
    setSchemaPrefixDraft("");
    setSchemaPrefixApplied("");
    setSchemaMode("exclude");
    setOwnerDraft("");
    setOwnerApplied("");
    setOwnerMode("exclude");
  }, []);

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
        renderCell: (row) => {
          // Inventory sometimes returns a friendly display name; use it
          // verbatim when present. Otherwise resolve the raw GUID via
          // the shared chip — all chips on the page batch into one call.
          if (row.ownerDisplayName && row.ownerDisplayName !== row.ownerId) {
            return row.ownerDisplayName;
          }
          if (row.ownerId) {
            return <UserChip id={row.ownerId} avatarSize={20} />;
          }
          return "—";
        },
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
            placeholder="Search name or schema"
            value={queryInput}
            onChange={(_e, data: InputOnChangeData) => setQueryInput(data.value)}
            contentBefore={
              <span aria-hidden style={{ color: tokens.colorNeutralForeground3 }}>
                🔍
              </span>
            }
          />
          <Popover withArrow positioning="below-start" trapFocus>
            <PopoverTrigger disableButtonEnhancement>
              <Tooltip content="Filter by schema or owner" relationship="label">
                <Button
                  appearance={activeFilterCount > 0 ? "primary" : "subtle"}
                  icon={
                    activeFilterCount > 0 ? (
                      <FilterFilled />
                    ) : (
                      <FilterRegular />
                    )
                  }
                  aria-label={
                    activeFilterCount > 0
                      ? `${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} active`
                      : "Filters"
                  }
                >
                  {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : "Filters"}
                </Button>
              </Tooltip>
            </PopoverTrigger>
            <PopoverSurface className={styles.popoverSurface}>
              <Field
                label="Schema name prefix"
                hint="Filter by schema name prefix (case-insensitive). Publisher prefixes: msdyn_ (first-party Dynamics), new_ (default publisher), or your customer prefix. Press Enter to apply."
              >
                <div className={styles.filterRow}>
                  <FilterModeDropdown
                    className={styles.modeDropdown}
                    value={schemaMode}
                    onChange={setSchemaMode}
                  />
                  <Input
                    className={styles.filterValueInput}
                    placeholder="e.g. msdyn_"
                    value={schemaPrefixDraft}
                    onChange={(_e, data: InputOnChangeData) =>
                      setSchemaPrefixDraft(data.value)
                    }
                    onBlur={() => setSchemaPrefixApplied(schemaPrefixDraft)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        setSchemaPrefixApplied(schemaPrefixDraft);
                      }
                    }}
                  />
                </div>
              </Field>
              <Field
                label="Owner ID"
                hint="Filter by Entra owner object ID. Excluding hides Pipelines / SPN deployments; including shows only that owner's agents. Tip: Ctrl+K to look up a GUID first."
              >
                <div className={styles.filterRow}>
                  <FilterModeDropdown
                    className={styles.modeDropdown}
                    value={ownerMode}
                    onChange={setOwnerMode}
                  />
                  <Input
                    className={styles.filterValueInput}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    value={ownerDraft}
                    onChange={(_e, data: InputOnChangeData) =>
                      setOwnerDraft(data.value)
                    }
                    onBlur={() => setOwnerApplied(ownerDraft)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        setOwnerApplied(ownerDraft);
                      }
                    }}
                    spellCheck={false}
                  />
                </div>
              </Field>
              <div className={styles.popoverFooter}>
                <Button
                  appearance="subtle"
                  icon={<DismissRegular />}
                  onClick={clearFilters}
                  disabled={
                    activeFilterCount === 0 &&
                    !schemaPrefixDraft &&
                    !ownerDraft
                  }
                >
                  Clear
                </Button>
                <div className={styles.popoverFooterRight}>
                  <Button
                    appearance="primary"
                    onClick={applyDrafts}
                    disabled={
                      schemaPrefixDraft === schemaPrefixApplied &&
                      ownerDraft === ownerApplied
                    }
                  >
                    Apply
                  </Button>
                </div>
              </div>
            </PopoverSurface>
          </Popover>
        </>
      }
    />
  );
}

/** Compact two-option dropdown for the per-value filter mode. Kept as
 *  a small typed wrapper so the AgentsList JSX stays readable and the
 *  display label always matches the underlying mode value. */
function FilterModeDropdown({
  value,
  onChange,
  className,
}: {
  value: AgentFilterMode;
  onChange: (mode: AgentFilterMode) => void;
  className?: DropdownProps["className"];
}) {
  const label = value === "include" ? "Include only" : "Exclude";
  return (
    <Dropdown
      className={className}
      value={label}
      selectedOptions={[value]}
      onOptionSelect={(_e, data) => {
        const next = data.optionValue;
        if (next === "include" || next === "exclude") onChange(next);
      }}
    >
      <Option value="exclude">Exclude</Option>
      <Option value="include">Include only</Option>
    </Dropdown>
  );
}
