import { Button, Combobox, Dropdown, Field, Input, Option, makeStyles, tokens } from "@fluentui/react-components";
import { DeleteRegular } from "@fluentui/react-icons";
import { CONNECTOR_FIELD, KNOWN_CONNECTORS, OPERATION_FIELD, friendlyConnectorName, friendlyFilterField, type QueryFilter, type QueryFilterOp, type ResourceTypeValue } from "../../data/inventory";
import { getFieldSuggestions, type InventoryField } from "../../data/inventory.fields";
import { EnvironmentPicker } from "../../components/EnvironmentPicker";
import { useUserLookup } from "../../hooks/useUserLookup";
import { operatorsFor } from "./filterModel";

const useStyles = makeStyles({
  row: { display: "grid", gridTemplateColumns: "minmax(180px, 2fr) minmax(140px, 1fr) minmax(180px, 2fr) auto", gap: tokens.spacingHorizontalS, alignItems: "start",
    "& > *": { minWidth: 0 },
    "@media (max-width: 800px)": { gridTemplateColumns: "minmax(0, 1fr)" } },
  control: { minWidth: 0, maxWidth: "100%", width: "100%" },
  values: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS, minWidth: 0 },
  hint: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 },
});
export function QueryFilterRow({ filter: f, index, fields, resourceTypes, onChange, onRemove }: {
  filter: QueryFilter; index: number; fields: InventoryField[]; resourceTypes: ResourceTypeValue[];
  onChange: (patch: Partial<QueryFilter>) => void; onRemove: () => void;
}) {
  const styles = useStyles();
  const openLookup = useUserLookup();
  const meta = fields.find((m) => m.path === f.field);
  const operators = operatorsFor(meta);
  const options = operators.some((o) => o.value === f.op) ? operators : [...operators, { value: f.op, label: `${f.op} (existing)` }];
  const noValue = ["isempty", "!isempty", "today", "yesterday"].includes(f.op);
  const dateInput = f.op === "onDate" || f.op === "dateRange";
  const applicable = resourceTypes.filter((t) => getFieldSuggestions([t], "filter").some((m) => m.path === f.field));
  const fieldLabel = `Filter ${index + 1}`;
  return <div className={styles.row}>
    <Field label={`${fieldLabel} field`}>
      <Combobox className={styles.control} freeform value={friendlyFilterField(f.field)} placeholder="Choose or type a field path"
        onChange={(e) => onChange({ field: e.target.value })}
        onOptionSelect={(_e, d) => {
          const field = fields.find((m) => m.path === d.optionValue);
          const available = operatorsFor(field);
          onChange({ field: d.optionValue ?? "", op: available.some((o) => o.value === f.op) ? f.op : available[0].value, value: "" });
        }}>
        {fields.map((m) => <Option key={m.path} value={m.path} text={m.path}>{m.label} ({m.kind}) - {m.path}</Option>)}
      </Combobox>
      {meta?.help && <span className={styles.hint}>{meta.help}</span>}
      {resourceTypes.length > 1 && applicable.length < resourceTypes.length && <span className={styles.hint}>Not reported on all selected resource types. Missing values are unavailable, not false.</span>}
    </Field>
    <Field label={`${fieldLabel} operator`}>
      <Dropdown className={styles.control} selectedOptions={[f.op]} value={options.find((o) => o.value === f.op)?.label}
        onOptionSelect={(_e, d) => onChange({ op: d.optionValue as QueryFilterOp })}>
        {options.map((o) => <Option key={o.value} value={o.value}>{o.label}</Option>)}
      </Dropdown>
    </Field>
    <div className={styles.values}>
      {!noValue && <Field label={`${fieldLabel} value`}>
        {f.field === CONNECTOR_FIELD ? <Combobox className={styles.control} freeform value={f.value} placeholder="Connector ID"
          onChange={(e) => onChange({ value: e.target.value })} onOptionSelect={(_e, d) => onChange({ value: d.optionValue ?? "" })}>
          {Object.keys(KNOWN_CONNECTORS).map((id) => <Option key={id} value={id} text={id}>{friendlyConnectorName(id)} - {id}</Option>)}
        </Combobox> : meta?.kind === "boolean" ? <Dropdown className={styles.control} value={f.value || "Choose true or false"} selectedOptions={[f.value]}
          onOptionSelect={(_e, d) => onChange({ value: d.optionValue ?? "" })}>
          <Option value="true">true</Option><Option value="false">false</Option>
        </Dropdown> : dateInput ? <div className={styles.values}>
          <Input aria-label={`${fieldLabel} start date (UTC)`} type="date" value={f.value.split(",")[0] ?? ""}
            onChange={(_e, d) => onChange({ value: f.op === "dateRange" ? `${d.value},${f.value.split(",")[1] ?? ""}` : d.value })} />
          {f.op === "dateRange" && <Input aria-label={`${fieldLabel} end date (UTC, inclusive)`} type="date" value={f.value.split(",")[1] ?? ""}
            onChange={(_e, d) => onChange({ value: `${f.value.split(",")[0] ?? ""},${d.value}` })} />}
        </div> : <Input value={f.value} type={(meta?.kind === "number" && f.op !== "in~") || f.op === "lastNdays" ? "number" : "text"}
          placeholder={meta?.kind === "date" ? "2026-01-01T00:00:00Z" : f.field === OPERATION_FIELD ? "Operation ID (reported evidence)" : "Value"}
          onChange={(_e, d) => onChange({ value: d.value })} />}
      </Field>}
      {f.field === "properties.environmentId" && f.op === "==" && <EnvironmentPicker value={f.value || undefined}
        placeholder="Choose an environment, or type its ID above" onChange={(value) => onChange({ value: value ?? "" })} />}
      {["properties.ownerId", "properties.createdBy", "properties.lastModifiedBy"].includes(f.field) &&
        <Button size="small" appearance="subtle" onClick={() => openLookup(f.value || undefined)}>Look up an identity; paste its GUID above</Button>}
      {f.field === OPERATION_FIELD && <>
        <Field label="Within connector (optional)">
          <Input value={f.connectorId ?? ""} placeholder="e.g. shared_sharepointonline" onChange={(_e, d) => onChange({ connectorId: d.value || undefined })} />
        </Field>
        <span className={styles.hint}>{f.connectorId ? "Paired evidence from this connector only." : "Independent match across all connectors; another connector may report this operation."} Reported actions/triggers are not runtime execution.</span>
      </>}
      {["today", "yesterday", "onDate", "dateRange"].includes(f.op) && <span className={styles.hint}>UTC calendar days: midnight inclusive to next midnight exclusive. Range end date is included.</span>}
      {f.op === "lastNdays" && <span className={styles.hint}>After X x 24 hours ago, evaluated again on every run. Lower bound only; future timestamps also match.</span>}
    </div>
    <Button icon={<DeleteRegular />} appearance="subtle" aria-label={`Remove filter ${index + 1}`} onClick={onRemove} />
  </div>;
}
