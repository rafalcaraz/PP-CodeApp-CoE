import { useId, type ReactNode } from "react";
import { Button, Dropdown, Field, Option, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { AddRegular, DeleteRegular } from "@fluentui/react-icons";
import {
  formatQueryConditionSummary, queryConditionRoot, resourceTypeShort,
  type QueryCondition, type QueryConditionGroup, type QuerySpec,
} from "../../data/inventory";
import type { InventoryField } from "../../data/inventory.fields";
import { QueryFilterRow } from "./QueryFilters";

const useStyles = makeStyles({
  group: {
    margin: 0, minWidth: 0, padding: tokens.spacingHorizontalM,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke1),
    borderRadius: tokens.borderRadiusMedium,
    display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM,
    "@media (forced-colors: active)": { ...shorthands.borderColor("CanvasText"), color: "CanvasText" },
  },
  rootGroup: {
    backgroundColor: tokens.colorNeutralBackground2,
    "@media (forced-colors: active)": { backgroundColor: "Canvas" },
  },
  subgroup: {
    backgroundColor: `color-mix(in srgb, ${tokens.colorPalettePurpleBackground2} 45%, ${tokens.colorNeutralBackground1})`,
    ...shorthands.borderColor(tokens.colorPalettePurpleBorderActive),
    "@media (forced-colors: active)": { backgroundColor: "Canvas", ...shorthands.borderColor("CanvasText") },
  },
  legend: { fontWeight: tokens.fontWeightSemibold, paddingInline: tokens.spacingHorizontalS },
  subgroupLegend: {
    color: tokens.colorPalettePurpleForeground2,
    "@media (forced-colors: active)": { color: "CanvasText" },
  },
  toolbar: { display: "flex", alignItems: "end", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
  control: { minWidth: 0, maxWidth: "100%" },
  children: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  summary: {
    display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS,
    backgroundColor: tokens.colorNeutralBackground2, padding: tokens.spacingHorizontalM,
    overflowWrap: "anywhere", borderRadius: tokens.borderRadiusMedium,
  },
  hint: { color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase200 },
  join: {
    display: "block", marginBlock: tokens.spacingVerticalS,
    fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground2,
  },
});

export function ConditionBuilder({ spec, fields, onChange }: {
  spec: QuerySpec; fields: InventoryField[];
  onChange: (group: QueryConditionGroup) => void;
}) {
  const styles = useStyles();
  const root = queryConditionRoot(spec);
  const containerId = useId();
  const summary = formatQueryConditionSummary(spec, (path) => fields.find((f) => f.path === path)?.label ?? path);
  const scope = spec.resourceTypes.length ? spec.resourceTypes.map(resourceTypeShort).join(", ") : "All reportable resources";

  const focusNew = (path: number[]) => {
    requestAnimationFrame(() => {
      const target = document.getElementById(containerId)?.querySelector(`[data-condition-path="${path.join("-")}"]`);
      target?.querySelector<HTMLElement>('[role="combobox"], input, button')?.focus();
    });
  };
  const focusGroup = (index?: number) => {
    requestAnimationFrame(() => {
      document.getElementById(containerId)?.querySelector<HTMLElement>(index === undefined ?
        '[data-root-toolbar] button' : `[data-subgroup-index="${index}"] button`)?.focus();
    });
  };
  const replaceChild = (index: number, child: QueryCondition) => {
    onChange({ ...root, children: root.children.map((old, i) => i === index ? child : old) });
  };
  const addCondition = (group: QueryConditionGroup, index?: number) => {
    const updated: QueryConditionGroup = { ...group, children: [...group.children, { kind: "condition", filter: { field: "", op: "==", value: "" } }] };
    if (index === undefined) onChange(updated);
    else replaceChild(index, updated);
    focusNew(index === undefined ? [group.children.length] : [index, group.children.length]);
  };
  const toolbar = (group: QueryConditionGroup, label: string, index?: number) => <div className={styles.toolbar}
    {...(index === undefined ? { "data-root-toolbar": true } : {})}>
    <Field label={`${label} match`}>
      <Dropdown className={styles.control} selectedOptions={[group.operator]} value={group.operator === "all" ? "Match all (AND)" : "Match any (OR)"}
        onOptionSelect={(_e, data) => {
          const next = { ...group, operator: data.optionValue as "all" | "any" };
          if (index === undefined) onChange(next);
          else replaceChild(index, next);
        }}>
        <Option value="all">Match all (AND)</Option><Option value="any">Match any (OR)</Option>
      </Dropdown>
    </Field>
    <Button size="small" icon={<AddRegular />} aria-label={`Add condition to ${label.toLowerCase()}`}
      onClick={() => addCondition(group, index)}>Add condition</Button>
    {index === undefined ? <Button size="small" icon={<AddRegular />} onClick={() => {
      const groupIndex = root.children.length;
      onChange({ ...root, children: [...root.children, {
        kind: "group", operator: root.operator === "all" ? "any" : "all",
        children: [{ kind: "condition", filter: { field: "", op: "==", value: "" } }],
      }] });
      focusNew([groupIndex, 0]);
    }}>Add group</Button> : <Button size="small" appearance="subtle" icon={<DeleteRegular />} aria-label={`Remove ${label.toLowerCase()}`}
      onClick={() => { onChange({ ...root, children: root.children.filter((_child, i) => i !== index) }); focusGroup(); }}>Remove group</Button>}
  </div>;
  let conditionNumber = 0;
  const renderCondition = (node: QueryCondition, path: number[], update: (next: QueryCondition) => void, remove: () => void): ReactNode => {
    if (node.kind !== "condition") return null;
    const index = conditionNumber++;
    return <div key={path.join("-")} data-condition-path={path.join("-")}>
      <QueryFilterRow filter={node.filter} index={index} conditionLabel={`Condition ${index + 1}`} fields={fields} resourceTypes={spec.resourceTypes}
        onChange={(patch) => update({ ...node, filter: { ...node.filter, ...patch } })} onRemove={remove} />
    </div>;
  };
  let subgroupNumber = 0;
  return <div id={containerId}>
    <fieldset className={mergeClasses(styles.group, styles.rootGroup)}>
      <legend className={styles.legend}>Root group</legend>
      {toolbar(root, "Root group")}
      <Text className={styles.hint}>Resource types always apply to the whole query. Within each group, all means AND; any means OR. One level of subgroups is supported.</Text>
      {!root.children.length && <Text className={styles.hint}>{root.operator === "all" ?
        "No conditions. All resources in the selected scope can match." : "An empty Match any group is invalid. Add a condition or switch to Match all."}</Text>}
      <div className={styles.children}>
        {root.children.map((node, index) => {
          const before = index > 0 && <Text className={styles.join}>{root.operator === "all" ? "AND" : "OR"}</Text>;
          if (node.kind === "condition") return <div key={index}>{before}{renderCondition(node, [index],
            (next) => replaceChild(index, next), () => {
              onChange({ ...root, children: root.children.filter((_old, i) => i !== index) }); focusGroup();
            })}</div>;
          const label = `Group ${++subgroupNumber}`;
          return <div key={index}>{before}<fieldset className={mergeClasses(styles.group, styles.subgroup)} data-subgroup-index={index}>
            <legend className={mergeClasses(styles.legend, styles.subgroupLegend)}>{label}</legend>
            {toolbar(node, label, index)}
            {!node.children.length && <Text className={styles.hint}>This group is empty. Add a condition or remove the group before running.</Text>}
            <div className={styles.children}>
              {node.children.map((child, childIndex) => <div key={childIndex}>
                {childIndex > 0 && <Text className={styles.join}>{node.operator === "all" ? "AND" : "OR"}</Text>}
                {renderCondition(child, [index, childIndex],
                  (next) => replaceChild(index, { ...node, children: node.children.map((old, i) => i === childIndex ? next : old) }),
                  () => { replaceChild(index, { ...node, children: node.children.filter((_old, i) => i !== childIndex) }); focusGroup(index); })}
              </div>)}
            </div>
          </fieldset></div>;
        })}
      </div>
    </fieldset>
    <div className={styles.summary} role="note" aria-label="Condition summary">
      <Text weight="semibold">Condition summary</Text>
      <Text>{scope} AND {summary}</Text>
      <Text className={styles.hint}>Only explicit false matches a boolean equals false condition; a missing or null value is not false.</Text>
    </div>
  </div>;
}
