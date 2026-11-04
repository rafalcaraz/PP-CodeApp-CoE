import { useState } from "react";
import { Button, Combobox, Option, makeStyles, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
  root: { display: "flex", gap: tokens.spacingHorizontalXS, minWidth: 0 },
  input: { minWidth: 0, width: "100%" },
});

export interface PickerOption { id: string; name: string }

export function SearchPicker({ label, options, value, onChange, placeholder = "Search name or ID", disabled = false, showIds = false }: {
  label: string; options: PickerOption[]; value: string; onChange: (id: string) => void;
  placeholder?: string; disabled?: boolean; showIds?: boolean;
}) {
  const styles = useStyles();
  const [query, setQuery] = useState<string | null>(null);
  const selected = options.find((option) => option.id === value);
  const text = (option: PickerOption) => showIds && option.id ? `${option.name} (${option.id})` : option.name;
  const matching = options.filter((option) => `${option.name} ${option.id}`.toLowerCase().includes((query ?? "").trim().toLowerCase()));
  return <div className={styles.root}>
    <Combobox aria-label={label} className={styles.input} disabled={disabled} placeholder={placeholder}
      value={query ?? (selected ? text(selected) : "")} selectedOptions={selected ? [value] : []}
      onChange={(event) => { setQuery(event.target.value); if (value) onChange(""); }}
      onOptionSelect={(_, data) => { onChange(data.optionValue ?? ""); setQuery(null); }}
      onBlur={() => setQuery(null)}>
      {matching.map((option) => <Option key={option.id} value={option.id} text={text(option)}>{text(option)}</Option>)}
      {!matching.length && <Option disabled text="No matches">No matches</Option>}
    </Combobox>
    <Button disabled={disabled || (!value && !query)} appearance="subtle" aria-label={`Clear ${label}`}
      onClick={() => { onChange(""); setQuery(null); }}>Clear</Button>
  </div>;
}
