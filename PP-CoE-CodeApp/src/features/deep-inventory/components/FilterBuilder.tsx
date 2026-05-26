/**
 * Filter builder — ordered list of `DeepFilterClause` rows.
 *
 * Each row picks a property from the catalog, then renders the filter
 * controls appropriate to that property's `FilterSpec.kind`:
 *
 *  - `boolean` → tri-state dropdown (True / False / Either)
 *  - `enum`    → multi-select (uses curated `values` when present,
 *                 observed enum values otherwise; falls back to a
 *                 free-text input when neither is available)
 *  - `string`  → contains / equals / startsWith / endsWith inputs
 *  - `number`  → number input + numeric comparator dropdown
 *  - `date`    → ISO date input + comparator
 *  - `exists`  → present / missing dropdown
 *
 * Keeps the row count UI tight so admins can stack 3–4 clauses
 * without the layout sprawling. Add / remove buttons live inline.
 */

import {
  Button,
  Dropdown,
  Input,
  Option,
  Switch,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { AddRegular, DeleteRegular } from "@fluentui/react-icons";
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
      <Dropdown
        placeholder="Pick a property…"
        value={entry ? labelFor(entry) : clause.path}
        selectedOptions={[clause.path]}
        onOptionSelect={(_e, data) => {
          const path = data.optionValue;
          if (!path) return;
          const next = findEntry(catalogGroups, path);
          if (!next) return;
          onChange(defaultClauseFor(next));
        }}
      >
        {catalogGroups.map((group) => (
          <PropertyOptionGroup key={group.label} group={group} />
        ))}
      </Dropdown>

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

function PropertyOptionGroup({ group }: { group: CatalogGroup }) {
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
        <Option key={entry.path} value={entry.path} text={labelFor(entry)}>
          {labelFor(entry)}
          {entry.origin === "observed" && (
            <span className={styles.observedBadge}>discovered</span>
          )}
        </Option>
      ))}
    </>
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
    const options = enumValuesFor(entry);
    if (options.length === 0) {
      // No known values yet — render free-form input so the user
      // can still type one.
      return <PlainInput clause={clause} onChange={onChange} />;
    }
    const selected = normalizeMulti(clause.value);
    return (
      <Dropdown
        multiselect={clause.op === "in" || clause.op === "notIn"}
        value={selected.join(", ") || "Pick value…"}
        selectedOptions={selected}
        onOptionSelect={(_e, data) => {
          const next = data.selectedOptions;
          onChange({
            ...clause,
            value:
              clause.op === "in" || clause.op === "notIn"
                ? next
                : (next[0] ?? ""),
          });
        }}
      >
        {options.map((v) => (
          <Option key={v} value={v} text={v}>
            {v}
          </Option>
        ))}
      </Dropdown>
    );
  }

  return <PlainInput clause={clause} onChange={onChange} />;
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
