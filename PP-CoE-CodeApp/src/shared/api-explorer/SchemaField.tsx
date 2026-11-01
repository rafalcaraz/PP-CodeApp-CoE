import { Button, Field, Input, Select, Text, Textarea, makeStyles, tokens } from "@fluentui/react-components";
import { createSchemaTools, type JsonSchema } from "./schema";

const useStyles = makeStyles({
  root: { minWidth: 0 },
  control: { width: "100%", minWidth: 0 },
  code: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    padding: tokens.spacingHorizontalM,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
    maxHeight: "400px",
    overflow: "auto",
  },
  editor: { width: "100%", minWidth: 0, "& textarea": { fontFamily: tokens.fontFamilyMonospace, minHeight: "160px" } },
  schema: { marginTop: tokens.spacingVerticalS, "& summary": { cursor: "pointer" } },
});

export function SchemaField({ label, hint, required, schema, tools, value, disabled, json = false, includeOptional = false, onChange }: {
  label: string;
  hint?: string;
  required?: boolean;
  schema: JsonSchema;
  tools: ReturnType<typeof createSchemaTools>;
  value: string;
  disabled: boolean;
  json?: boolean;
  includeOptional?: boolean;
  onChange: (value: string) => void;
}) {
  const styles = useStyles();
  const resolved = tools.resolveSchema(schema);
  const isJson = json || resolved.type === "object" || resolved.type === "array" || !resolved.type;
  const options = resolved.enum ?? (resolved.type === "boolean" ? [true, false] : undefined);
  return (
    <div className={styles.root}>
      <Field label={label} required={required} hint={hint}>
        {isJson ? (
          <Textarea className={styles.editor} value={value} disabled={disabled}
            resize="vertical" spellCheck={false} onChange={(_, data) => onChange(data.value)} />
        ) : options ? (
          <Select className={styles.control} value={value} disabled={disabled} onChange={(_, data) => onChange(data.value)}>
            <option value="">Select a value</option>
            {options.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
          </Select>
        ) : (
          <Input className={styles.control} value={value} disabled={disabled} onChange={(_, data) => onChange(data.value)} />
        )}
      </Field>
      {isJson && (
        <div>
          <Button size="small" appearance="subtle" disabled={disabled}
            onClick={() => onChange(JSON.stringify(tools.schemaTemplate(schema, includeOptional), null, 2))}>
            Insert JSON template
          </Button>
          <details className={styles.schema}>
            <summary>Request schema for {label}</summary>
            <pre className={styles.code}>{JSON.stringify(tools.schemaDocument(schema), null, 2)}</pre>
            <Text size={200}>
              {includeOptional ? "Templates include writable properties." : "Templates include required properties only."} Replace placeholders before running.
            </Text>
          </details>
        </div>
      )}
    </div>
  );
}
