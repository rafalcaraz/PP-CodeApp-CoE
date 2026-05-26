/**
 * Filter builder — ordered list of `DeepFilterClause` rows.
 *
 * Each row picks a property from the catalog (via a typeahead-enabled
 * Combobox so the user can either narrow by typing or paste a full
 * dotted path that isn't in the catalog), then renders the filter
 * controls appropriate to that property's `FilterSpec.kind`:
 *
 *  - `boolean` → tri-state dropdown (True / False / Either)
 *  - `enum`    → multi-select Combobox with typeahead (uses curated
 *                 `values` when present, observed enum values
 *                 otherwise; falls back to a free-text input when
 *                 neither is available)
 *  - `string`  → contains / equals / startsWith / endsWith inputs
 *  - `number`  → number input + numeric comparator dropdown
 *  - `date`    → ISO date input + comparator
 *  - `exists`  → present / missing dropdown
 *
 * Property picker is intentionally `freeform={true}` so an operator
 * can type *any* dotted path — useful for ad-hoc scans against fields
 * that haven't surfaced in the observed catalog yet (e.g. a freshly-
 * shipped admin field). Freeform paths default to `FilterSpec.kind =
 * 'string'`; the user picks the op as usual.
 */

import {
  Button,
  Combobox,
  Dropdown,
  Input,
  Option,
  OptionGroup,
  Switch,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { AddRegular, DeleteRegular } from "@fluentui/react-icons";
import { useMemo, useState } from "react";
import type {
  CatalogGroup,
  DeepFilterClause,
  FilterOp,
  PropertyCatalogEntry,
} from "../data";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "minmax(200px, 1.4fr) minmax(120px, 0.7fr) minmax(180px, 1.5fr) auto",
    gap: tokens.spacingHorizontalS,
    alignItems: "center",
    "@media (max-width: 720px)": {
      gridTemplateColumns: "1fr",
    },
  },
  addBtn: {
    alignSelf: "flex-start",
  },
  groupLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    paddingInlineStart: tokens.spacingHorizontalS,
    marginTop: tokens.spacingVerticalXS,
  },
  observedBadge: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
    marginInlineStart: tokens.spacingHorizontalXS,
  },
  empty: {
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
    fontSize: tokens.fontSizeBase200,
    paddingInlineStart: tokens.spacingHorizontalS,
  },
});

interface FilterBuilderProps {
  catalogGroups: CatalogGroup[];
  filters: DeepFilterClause[];
  onChange: (filters: DeepFilterClause[]) => void;
}

export function FilterBuilder({
  catalogGroups,
  filters,
  onChange,
}: FilterBuilderProps) {
  const styles = useStyles();

  const updateAt = (idx: number, next: DeepFilterClause): void => {
    const copy = filters.slice();
    copy[idx] = next;
    onChange(copy);
  };

  const removeAt = (idx: number): void => {
    onChange(filters.filter((_, i) => i !== idx));
  };

  const add = (): void => {
    // Default to the first curated property; user picks the real
    // path next.
    const firstEntry = catalogGroups[0]?.entries[0];
    if (!firstEntry) return;
    onChange([
      ...filters,
      defaultClauseFor(firstEntry),
    ]);
  };

  return (
    <div className={styles.root}>
      {filters.length === 0 && (
        <Text className={styles.empty}>
          No filters — the scan will return every record in scope. Add a
          filter to narrow it down.
        </Text>
      )}
      {filters.map((clause, idx) => (
        <FilterRow
          key={idx}
          clause={clause}
          catalogGroups={catalogGroups}
          onChange={(next) => updateAt(idx, next)}
          onRemove={() => removeAt(idx)}
        />
      ))}
      <Button
        className={styles.addBtn}
        icon={<AddRegular />}
        appearance="subtle"
        onClick={add}
      >
        Add filter
      </Button>
    </div>
  );
}

interface FilterRowProps {
  clause: DeepFilterClause;
  catalogGroups: CatalogGroup[];
  onChange: (clause: DeepFilterClause) => void;
  onRemove: () => void;
}

function FilterRow({ clause, catalogGroups, onChange, onRemove }: FilterRowProps) {
  const styles = useStyles();
  const entry = findEntry(catalogGroups, clause.path);

  return (
    <div className={styles.row}>
      <PropertyCombobox
        catalogGroups={catalogGroups}
        clause={clause}
        entry={entry}
        onChange={onChange}
      />

      <OpDropdown entry={entry} clause={clause} onChange={onChange} />

      <ValueControl entry={entry} clause={clause} onChange={onChange} />

      <Button
        appearance="subtle"
        icon={<DeleteRegular />}
        aria-label="Remove filter"
        onClick={onRemove}
      />
    </div>
  );
}

// ─── property picker (Combobox with typeahead + freeform) ───────────

interface PropertyComboboxProps {
  catalogGroups: CatalogGroup[];
  clause: DeepFilterClause;
  entry: PropertyCatalogEntry | undefined;
  onChange: (next: DeepFilterClause) => void;
}

function PropertyCombobox({
  catalogGroups,
  clause,
  entry,
  onChange,
}: PropertyComboboxProps) {
  const styles = useStyles();
  // The Combobox needs both a controlled text value (what the user
  // typed) and a selectedOptions array (which entry is highlighted).
  // We track the typed text locally so the user can backspace +
  // retype without losing focus.
  const initialText = entry ? labelFor(entry) : clause.path;
  const [text, setText] = useState(initialText);

  // Reset the displayed text whenever the underlying clause path
  // changes from outside (e.g. user clicked an option).
  const expectedText = entry ? labelFor(entry) : clause.path;
  if (text !== expectedText && text === initialText) {
    setText(expectedText);
  }

  const filtered = useMemo(
    () => filterCatalogGroups(catalogGroups, text),
    [catalogGroups, text]
  );
  const hasMatches = filtered.some((g) => g.entries.length > 0);

  return (
    <Combobox
      freeform
      placeholder="Pick or type a property path…"
      value={text}
      selectedOptions={[clause.path]}
      onChange={(e) => setText((e.target as HTMLInputElement).value)}
      onOptionSelect={(_e, data) => {
        const path = data.optionValue;
        if (!path || path.endsWith("-label") || path.endsWith("-empty")) return;
        const next = findEntry(catalogGroups, path);
        if (next) {
          setText(labelFor(next));
          onChange(defaultClauseFor(next));
        } else {
          // Freeform path the user typed and selected — keep the
          // existing op + value, just swap the path. New paths
          // default to a `string` filter kind (string contains).
          setText(path);
          onChange({ ...clause, path });
        }
      }}
      onBlur={() => {
        // If the user typed a freeform path and didn't pick an
        // option, commit the typed text as the new path so the row
        // reflects what they see.
        const trimmed = text.trim();
        if (!trimmed) return;
        if (trimmed === clause.path) return;
        const matched = findEntry(catalogGroups, trimmed);
        if (matched) {
          onChange(defaultClauseFor(matched));
        } else {
          onChange({ ...clause, path: trimmed });
        }
      }}
    >
      {!hasMatches && (
        <Option key="__no_match__" value="__no_match__" text="No match" disabled>
          <span className={styles.empty}>
            No matching property — press Enter to use "{text}" as a freeform path.
          </span>
        </Option>
      )}
      {filtered.map((group) => (
        <PropertyOptionGroup key={group.label} group={group} />
      ))}
    </Combobox>
  );
}

function PropertyOptionGroup({ group }: { group: CatalogGroup }) {
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

// ─── op dropdown ────────────────────────────────────────────────────

const OPS_BY_KIND: Record<string, FilterOp[]> = {
  boolean: ["eq", "exists", "notExists"],
  enum: ["eq", "ne", "in", "notIn", "exists", "notExists"],
  string: ["eq", "ne", "contains", "startsWith", "endsWith", "exists", "notExists"],
  number: ["eq", "ne", "gt", "gte", "lt", "lte", "exists", "notExists"],
  date: ["eq", "ne", "gt", "gte", "lt", "lte", "exists", "notExists"],
  exists: ["exists", "notExists"],
};

const OP_LABELS: Record<FilterOp, string> = {
  eq: "equals",
  ne: "not equals",
  in: "is one of",
  notIn: "is not one of",
  contains: "contains",
  startsWith: "starts with",
  endsWith: "ends with",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  exists: "exists",
  notExists: "does not exist",
};

function OpDropdown({
  entry,
  clause,
  onChange,
}: {
  entry: PropertyCatalogEntry | undefined;
  clause: DeepFilterClause;
  onChange: (next: DeepFilterClause) => void;
}) {
  const kind = filterKindFor(entry);
  const ops = OPS_BY_KIND[kind] ?? ["eq", "ne", "exists", "notExists"];
  return (
    <Dropdown
      value={OP_LABELS[clause.op] ?? clause.op}
      selectedOptions={[clause.op]}
      onOptionSelect={(_e, data) => {
        const op = data.optionValue as FilterOp;
        if (op) onChange({ ...clause, op });
      }}
    >
      {ops.map((op) => (
        <Option key={op} value={op} text={OP_LABELS[op]}>
          {OP_LABELS[op]}
        </Option>
      ))}
    </Dropdown>
  );
}

// ─── value control ──────────────────────────────────────────────────

function ValueControl({
  entry,
  clause,
  onChange,
}: {
  entry: PropertyCatalogEntry | undefined;
  clause: DeepFilterClause;
  onChange: (next: DeepFilterClause) => void;
}) {
  if (clause.op === "exists" || clause.op === "notExists") {
    return <span aria-hidden />;
  }
  const kind = filterKindFor(entry);

  if (kind === "boolean") {
    return (
      <Switch
        checked={!!clause.value}
        onChange={(_e, data) => onChange({ ...clause, value: data.checked })}
        label={clause.value ? "True" : "False"}
      />
    );
  }

  if (kind === "enum") {
    return <EnumValueCombobox entry={entry} clause={clause} onChange={onChange} />;
  }

  return <PlainInput clause={clause} onChange={onChange} />;
}

interface EnumValueComboboxProps {
  entry: PropertyCatalogEntry | undefined;
  clause: DeepFilterClause;
  onChange: (next: DeepFilterClause) => void;
}

function EnumValueCombobox({ entry, clause, onChange }: EnumValueComboboxProps) {
  const options = enumValuesFor(entry);
  const isMulti = clause.op === "in" || clause.op === "notIn";
  const selected = normalizeMulti(clause.value);
  const [text, setText] = useState(isMulti ? selected.join(", ") : (selected[0] ?? ""));

  // Keep the visible text in sync with the underlying value when it
  // changes from outside (clause swap).
  const expected = isMulti ? selected.join(", ") : (selected[0] ?? "");
  if (text !== expected && (text === "" || expected === "")) {
    setText(expected);
  }

  // Allow free typing when there are no known values (observed
  // string-kind property with no cap; or curated enum with no
  // values).
  if (options.length === 0) {
    return <PlainInput clause={clause} onChange={onChange} />;
  }

  const filtered = options.filter((v) => v.toLowerCase().includes(text.toLowerCase()));

  return (
    <Combobox
      freeform
      multiselect={isMulti}
      placeholder="Pick value…"
      value={text}
      selectedOptions={selected}
      onChange={(e) => setText((e.target as HTMLInputElement).value)}
      onOptionSelect={(_e, data) => {
        const next = data.selectedOptions;
        onChange({
          ...clause,
          value: isMulti ? next : (next[0] ?? ""),
        });
        // For single-select, commit the picked label so the input
        // shows the canonical value. For multi-select, the chip
        // rendering inside the combobox handles display.
        if (!isMulti) setText(next[0] ?? "");
      }}
      onBlur={() => {
        // Freeform commit for single-select only (multi-select is
        // chip-based, freeform commits aren't meaningful).
        if (isMulti) return;
        const trimmed = text.trim();
        if (!trimmed) return;
        if (trimmed === selected[0]) return;
        onChange({ ...clause, value: trimmed });
      }}
    >
      {filtered.map((v) => (
        <Option key={v} value={v} text={v}>
          {v}
        </Option>
      ))}
    </Combobox>
  );
}

function PlainInput({
  clause,
  onChange,
}: {
  clause: DeepFilterClause;
  onChange: (next: DeepFilterClause) => void;
}) {
  return (
    <Input
      value={clause.value == null ? "" : String(clause.value)}
      onChange={(_e, data) => onChange({ ...clause, value: data.value })}
      placeholder="Value"
    />
  );
}

function normalizeMulti(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value == null || value === "") return [];
  return [String(value)];
}

// ─── helpers ────────────────────────────────────────────────────────

function findEntry(
  groups: CatalogGroup[],
  path: string
): PropertyCatalogEntry | undefined {
  for (const g of groups) {
    for (const e of g.entries) {
      if (e.path === path) return e;
    }
  }
  return undefined;
}

function labelFor(entry: PropertyCatalogEntry): string {
  if (entry.origin === "curated") return entry.label;
  return entry.path;
}

function filterKindFor(entry: PropertyCatalogEntry | undefined): string {
  if (!entry) return "string";
  if (entry.origin === "curated") return entry.filter.kind;
  // Observed → infer a filter kind from the inferred type.
  switch (entry.inferredType) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string":
      // Treat as enum when we have observed values; otherwise string.
      if (
        !entry.tooManyValues &&
        entry.observedValues &&
        entry.observedValues.length > 0 &&
        entry.observedValues.length <= 20
      ) {
        return "enum";
      }
      return "string";
    default:
      return "string";
  }
}

function enumValuesFor(entry: PropertyCatalogEntry | undefined): string[] {
  if (!entry) return [];
  if (entry.origin === "curated" && entry.filter.kind === "enum") {
    const curated = (entry.filter.values ?? []).map((v) =>
      v === null ? "(null)" : String(v)
    );
    return curated;
  }
  if (entry.origin === "observed") {
    return entry.observedValues ?? [];
  }
  return [];
}

function defaultClauseFor(entry: PropertyCatalogEntry): DeepFilterClause {
  const kind = filterKindFor(entry);
  switch (kind) {
    case "boolean":
      return { path: entry.path, op: "eq", value: true };
    case "enum":
      return { path: entry.path, op: "eq", value: enumValuesFor(entry)[0] ?? "" };
    case "number":
      return { path: entry.path, op: "eq", value: 0 };
    case "date":
      return { path: entry.path, op: "gte", value: new Date().toISOString().slice(0, 10) };
    case "exists":
      return { path: entry.path, op: "exists" };
    default:
      return { path: entry.path, op: "contains", value: "" };
  }
}

/** Filter the catalog groups by a typed query. Substring-match,
 *  case-insensitive, against both label and raw path. Returns the
 *  same group shape but with entries pruned. Empty query returns
 *  the input unchanged. */
function filterCatalogGroups(
  groups: CatalogGroup[],
  query: string
): CatalogGroup[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return groups;
  return groups
    .map((group) => ({
      label: group.label,
      entries: group.entries.filter((entry) => {
        const label = labelFor(entry).toLowerCase();
        const path = entry.path.toLowerCase();
        return label.includes(trimmed) || path.includes(trimmed);
      }),
    }))
    .filter((g) => g.entries.length > 0 || g.label === "Discovered fields");
}
