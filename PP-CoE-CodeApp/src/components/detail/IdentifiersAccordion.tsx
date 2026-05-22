/**
 * `IdentifiersAccordion` — the collapsed bottom block of every detail page
 * listing all the GUIDs / schema names / tenant IDs in a monospaced grid.
 *
 * Pass `items` as a list of `{ label, value }` pairs; the component handles
 * the accordion shell, mono styling, and grid layout. Falsy / empty `value`
 * fields are still rendered with a "—" placeholder so the row count is
 * predictable.
 */
import { type ReactNode } from "react";
import {
  makeStyles,
  tokens,
  Text,
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
} from "@fluentui/react-components";
import { Meta } from "./Meta";
import { useDetailStyles } from "./useDetailStyles";

const useStyles = makeStyles({
  wrapper: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalM,
  },
});

export interface IdentifierItem {
  label: string;
  value: ReactNode;
}

export function IdentifiersAccordion({
  items,
  title = "Identifiers",
  className,
}: {
  items: IdentifierItem[];
  title?: string;
  /** Optional extra className (typically `colFull` from `useDetailStyles`). */
  className?: string;
}) {
  const styles = useStyles();
  const detail = useDetailStyles();
  const visible = items.filter((it) => it.value !== undefined && it.value !== null);
  if (visible.length === 0) return null;
  const rootClassName = className ? `${styles.wrapper} ${className}` : styles.wrapper;
  return (
    <div className={rootClassName}>
      <Accordion collapsible>
        <AccordionItem value="ids">
          <AccordionHeader>
            <Text weight="semibold">{title}</Text>
          </AccordionHeader>
          <AccordionPanel>
            <div className={styles.grid}>
              {visible.map((it) => (
                <Meta key={it.label} label={it.label}>
                  <span className={detail.mono}>
                    {it.value === "" || it.value == null ? "—" : it.value}
                  </span>
                </Meta>
              ))}
            </div>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
