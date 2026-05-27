/**
 * Column picker — drives which paths appear in the result table.
 *
 * Renders the currently-selected columns as removable chips, plus a
 * "+ Add column" Combobox sourced from the same `CatalogGroup` list
 * the filter builder uses. The combobox is typeahead-enabled and
 * `freeform`, so users can either narrow by typing or paste a full
 * dotted path that isn't in the catalog (useful for projecting
 * fields that haven't surfaced in the observed catalog yet).
 *
 * Defaults: when `columns` is empty, the picker shows a "Default
 * columns" placeholder and the result table falls back to the
 * source's `defaultColumns`. Clicking any column adds it explicitly,
 * which switches the picker into custom-columns mode.
 */

import {
  Combobox,
  Option,
  OptionGroup,
  Button,
  Tag,
  TagGroup,
  type TagGroupProps,
  makeStyles,
  tokens,
  Text,
} from "@fluentui/react-components";
import { useMemo, useState } from "react";
import type { CatalogGroup, PropertyCatalogEntry } from "../data";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  picker: {
    minWidth: "260px",
  },
  empty: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontStyle: "italic",
  },
  observedBadge: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
    marginInlineStart: tokens.spacingHorizontalXS,
  },
});

interface ColumnPickerProps {
  catalogGroups: CatalogGroup[];
  columns: string[];
  onChange: (columns: string[]) => void;
  /** Default column paths for the active source. Shown as muted chips
   *  when `columns` is empty so the user knows what the table will
   *  display by default. */
  defaultColumns?: string[];
}

export function ColumnPicker({
  catalogGroups,
  columns,
  onChange,
  defaultColumns = [],
}: ColumnPickerProps) {
  const styles = useStyles();
  const [text, setText] = useState("");

  const handleDismiss: TagGroupProps["onDismiss"] = (_e, data) => {
    onChange(columns.filter((c) => c !== String(data.value)));
  };

  const addColumn = (path: string): void => {
    if (!path) return;
    if (columns.includes(path)) return;
    onChange([...columns, path]);
    setText(""); // reset the input so the user can add another
  };

  const reset = (): void => {
    onChange([]);
    setText("");
  };

  const showingDefaults = columns.length === 0;
  const chipsToShow = showingDefaults ? defaultColumns : columns;

  const filtered = useMemo(
    () => filterCatalogGroups(catalogGroups, text, columns),
    [catalogGroups, text, columns]
  );
  const hasMatches = filtered.some((g) => g.entries.length > 0);

  return (
    <div className={styles.root}>
      {chipsToShow.length === 0 && (
        <Text className={styles.empty}>No columns configured.</Text>
      )}
      {chipsToShow.length > 0 && (
        <TagGroup
          aria-label="Selected columns"
          onDismiss={showingDefaults ? undefined : handleDismiss}
        >
          {chipsToShow.map((path) => (
            <Tag
              key={path}
              value={path}
              dismissible={!showingDefaults}
              shape="rounded"
              appearance={showingDefaults ? "outline" : "filled"}
            >
              {labelForPath(catalogGroups, path)}
            </Tag>
          ))}
        </TagGroup>
      )}
      <Combobox
        freeform
        className={styles.picker}
        placeholder="+ Add column (type a label or path)"
        value={text}
        selectedOptions={[]}
        onChange={(e) => setText((e.target as HTMLInputElement).value)}
        onOptionSelect={(_e, data) => {
          const path = data.optionValue;
          if (!path || path.endsWith("-empty") || path === "__no_match__") return;
          addColumn(path);
        }}
        onBlur={() => {
          // Freeform commit on blur — if the user typed a path that
          // isn't in the catalog, add it as a raw path column.
          const trimmed = text.trim();
          if (!trimmed) return;
          // Don't accept a label like "Embedded app type" as a path;
          // only commit when it looks like a dotted path. Heuristic:
          // contains a dot AND doesn't contain spaces.
          if (!/^[A-Za-z0-9_]+(\.[A-Za-z0-9_*]+)+$/.test(trimmed)) {
            setText("");
            return;
          }
          addColumn(trimmed);
        }}
      >
        {!hasMatches && (
          <Option key="__no_match__" value="__no_match__" text="No match" disabled>
            <span className={styles.empty}>
              No matching property — type a full dotted path to add it as a raw column.
            </span>
          </Option>
        )}
        {filtered.map((group) => (
          <ColumnOptionGroup key={group.label} group={group} />
        ))}
      </Combobox>
      {!showingDefaults && (
        <Button appearance="subtle" onClick={reset}>
          Reset to defaults
        </Button>
      )}
    </div>
  );
}

function ColumnOptionGroup({ group }: { group: CatalogGroup }) {
  const styles = useStyles();
  const isObserved = group.label === "Discovered fields";
  if (group.entries.length === 0 && !isObserved) return null;
  return (
    <OptionGroup label={group.label}>
      {isObserved && group.entries.length === 0 && (
        <Option
          key={`${group.label}-empty`}
          value={`${group.label}-empty`}
          text="Run a scan to populate"
          disabled
        >
          <span className={styles.empty}>
            Run a scan — discovered fields will appear here.
          </span>
        </Option>
      )}
      {group.entries.map((entry) => (
        <Option key={entry.path} value={entry.path} text={labelFor(entry)}>
          {labelFor(entry)}
          {entry.origin === "observed" && (
            <span className={styles.observedBadge}>discovered</span>
          )}
        </Option>
      ))}
    </OptionGroup>
  );
}

function labelFor(entry: PropertyCatalogEntry): string {
  if (entry.origin === "curated") return entry.label;
  return entry.path;
}

function labelForPath(groups: CatalogGroup[], path: string): string {
  for (const g of groups) {
    for (const e of g.entries) {
      if (e.path === path) return labelFor(e);
    }
  }
  // Default columns sometimes reference paths that aren't in the
  // catalog yet (first scan, before introspection has run). Fall
  // back to the raw path.
  return path;
}

/** Filter catalog groups by typed query (case-insensitive substring
 *  against label and path) AND remove already-picked columns so the
 *  user can't add the same column twice. Empty query returns the
 *  full group list (minus picked columns). The "Discovered fields"
 *  group is always retained even when empty so its empty-state hint
 *  stays visible. */
function filterCatalogGroups(
  groups: CatalogGroup[],
  query: string,
  alreadyPicked: string[]
): CatalogGroup[] {
  const trimmed = query.trim().toLowerCase();
  const picked = new Set(alreadyPicked);
  return groups
    .map((group) => ({
      label: group.label,
      entries: group.entries.filter((entry) => {
        if (picked.has(entry.path)) return false;
        if (!trimmed) return true;
        return (
          labelFor(entry).toLowerCase().includes(trimmed) ||
          entry.path.toLowerCase().includes(trimmed)
        );
      }),
    }))
    .filter((g) => g.entries.length > 0 || g.label === "Discovered fields");
}
