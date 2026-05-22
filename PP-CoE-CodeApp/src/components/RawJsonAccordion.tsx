import {
  makeStyles,
  tokens,
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Text,
} from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  json: {
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground2,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusMedium,
    overflow: "auto",
    maxHeight: "480px",
    whiteSpace: "pre",
    margin: tokens.spacingHorizontalM,
  },
});

interface RawJsonAccordionProps {
  data: unknown;
  /** Title shown next to the disclosure chevron. */
  title?: string;
  /** Render the accordion item open on first render. Useful for
   *  supplemental enrichment cards where the user just clicked "Load"
   *  expecting to see the payload immediately. */
  defaultOpen?: boolean;
}

/** Collapsed-by-default raw JSON viewer for the full inventory payload.
 *  Kept around because the inventory schema returns dynamic shapes that
 *  are sometimes the only place certain fields live. */
export function RawJsonAccordion({
  data,
  title = "Raw inventory payload",
  defaultOpen = false,
}: RawJsonAccordionProps) {
  const styles = useStyles();
  return (
    <div className={styles.root}>
      <Accordion collapsible defaultOpenItems={defaultOpen ? ["raw"] : undefined}>
        <AccordionItem value="raw">
          <AccordionHeader>
            <Text weight="semibold">{title}</Text>
          </AccordionHeader>
          <AccordionPanel>
            <pre className={styles.json}>{JSON.stringify(data, null, 2)}</pre>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
