/**
 * Column picker — drives which paths appear in the result table.
 *
 * Renders the currently-selected columns as removable chips, plus a
 * "+ Add column" dropdown sourced from the same `CatalogGroup` list
 * the filter builder uses.
 *
 * Defaults: when `columns` is empty, the picker shows a "Default
 * columns" placeholder and the result table falls back to the
 * source's `defaultColumns`. Clicking any column adds it explicitly,
 * which switches the picker into custom-columns mode.
 */

import {
  Dropdown,
  Option,
  Button,
  Tag,
  TagGroup,
  type TagGroupProps,
  makeStyles,
  tokens,
  Text,
} from "@fluentui/react-components";
import { useState } from "react";
import type { CatalogGroup, PropertyCatalogEntry } from "../data";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  picker: {
    minWidth: "240px",
  },
  empty: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontStyle: "italic",
  },
  groupLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    paddingInlineStart: tokens.spacingHorizontalS,
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
  const [pickerKey, setPickerKey] = useState(0);

  const handleDismiss: TagGroupProps["onDismiss"] = (_e, data) => {
    onChange(columns.filter((c) => c !== String(data.value)));
  };

  const addColumn = (path: string): void => {
    if (columns.includes(path)) return;
    onChange([...columns, path]);
    setPickerKey((k) => k + 1); // reset dropdown selection
  };

  const reset = (): void => {
    onChange([]);
    setPickerKey((k) => k + 1);
  };

  const showingDefaults = columns.length === 0;
  const chipsToShow = showingDefaults ? defaultColumns : columns;

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
      <Dropdown
        key={pickerKey}
        className={styles.picker}
        placeholder="+ Add column"
        onOptionSelect={(_e, data) => {
          if (data.optionValue) addColumn(data.optionValue);
        }}
      >
        {catalogGroups.map((group) => (
          <ColumnOptionGroup
            key={group.label}
            group={group}
            disabled={(path) => columns.includes(path)}
          />
        ))}
      </Dropdown>
      {!showingDefaults && (
        <Button appearance="subtle" onClick={reset}>
          Reset to defaults
        </Button>
      )}
    </div>
  );
}

function ColumnOptionGroup({
  group,
  disabled,
}: {
  group: CatalogGroup;
  disabled: (path: string) => boolean;
}) {
  const styles = useStyles();
  const isObserved = group.label === "Discovered fields";
  return (
    <>
      <Option
        key={`${group.label}-label`}
        value={`${group.label}-label`}
        text={group.label}
        disabled
      >
        <span className={styles.groupLabel}>{group.label}</span>
      </Option>
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
        <Option
          key={entry.path}
          value={entry.path}
          text={labelFor(entry)}
          disabled={disabled(entry.path)}
        >
          {labelFor(entry)}
          {entry.origin === "observed" && (
            <span className={styles.observedBadge}>discovered</span>
          )}
        </Option>
      ))}
    </>
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
