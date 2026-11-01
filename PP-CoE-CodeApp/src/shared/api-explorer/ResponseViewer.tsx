import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Button, Checkbox, Input, Tab, TabList, Text, makeStyles, mergeClasses, tokens,
} from "@fluentui/react-components";
import { ChevronDownRegular, ChevronUpRegular, DismissRegular, SearchRegular } from "@fluentui/react-icons";
import { findResponseMatches } from "./responseSearch";

const useStyles = makeStyles({
  root: { minWidth: 0, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  toolbar: {
    display: "flex", alignItems: "center", flexWrap: "wrap", gap: tokens.spacingHorizontalXS,
  },
  search: { flex: "1 1 180px", minWidth: 0 },
  count: { color: tokens.colorNeutralForeground2, minWidth: "70px", textAlign: "center" },
  options: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: tokens.spacingHorizontalS },
  code: {
    position: "relative", fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase300, whiteSpace: "pre", margin: 0,
    padding: tokens.spacingHorizontalM, backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground1, border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium, maxHeight: "min(55vh, 600px)", minHeight: "160px",
    overflow: "auto", tabSize: 2,
    ":focus-visible": { outline: `2px solid ${tokens.colorStrokeFocus2}`, outlineOffset: "2px" },
  },
  wrap: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  match: {
    backgroundColor: tokens.colorStatusWarningBackground2, color: tokens.colorStatusWarningForeground2,
    borderRadius: tokens.borderRadiusSmall,
  },
  active: {
    backgroundColor: tokens.colorBrandBackground, color: tokens.colorNeutralForegroundOnBrand,
    outline: `1px solid ${tokens.colorBrandStroke1}`,
  },
});

export interface ResponseSource {
  label: string;
  ariaLabel: string;
  text: string;
}

export function ResponseViewer({ sources }: { sources: ResponseSource[] }) {
  const styles = useStyles();
  const [sourceIndex, setSourceIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [wrap, setWrap] = useState(true);
  const source = sources[sourceIndex] ?? sources[0];
  const text = source?.text ?? "";
  const matches = useMemo(() => findResponseMatches(text, query), [text, query]);
  const current = matches.length ? active % matches.length : 0;
  const code = useRef<HTMLPreElement>(null);
  const activeMatch = useRef<HTMLElement>(null);

  useEffect(() => {
    const container = code.current;
    const mark = activeMatch.current;
    if (!container || !mark) return;
    const offset = mark.getBoundingClientRect().top - container.getBoundingClientRect().top;
    if (offset < 0 || offset > container.clientHeight - mark.offsetHeight) {
      container.scrollTop += offset - container.clientHeight / 2;
    }
    const horizontal = mark.getBoundingClientRect().left - container.getBoundingClientRect().left;
    if (horizontal < 0 || horizontal > container.clientWidth - mark.offsetWidth) {
      container.scrollLeft += horizontal - container.clientWidth / 2;
    }
  }, [current, matches, wrap]);

  function move(direction: number) {
    if (matches.length) setActive((current + direction + matches.length) % matches.length);
  }

  return (
    <div className={styles.root}>
      {sources.length > 1 && <TabList selectedValue={sourceIndex} size="small"
        aria-label="Response format" onTabSelect={(_, data) => { setSourceIndex(Number(data.value)); setActive(0); }}>
        {sources.map((entry, index) => <Tab key={entry.label} value={index}>{entry.label}</Tab>)}
      </TabList>}
      <div className={styles.toolbar}>
        <Input className={styles.search} aria-label="Search response" placeholder="Find text in this response"
          contentBefore={<SearchRegular />} value={query}
          onChange={(_, data) => { setQuery(data.value); setActive(0); }}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
            if (event.key === "Escape") { setQuery(""); setActive(0); }
          }}
          contentAfter={query ? <Button appearance="transparent" size="small" icon={<DismissRegular />}
            aria-label="Clear response search" onClick={() => { setQuery(""); setActive(0); }} /> : undefined} />
        <Text size={200} className={styles.count} role="status">
          {query ? matches.length ? `${current + 1} of ${matches.length}` : "No matches" : "Find text"}
        </Text>
        <Button size="small" appearance="subtle" icon={<ChevronUpRegular />} aria-label="Previous match"
          title="Previous match (Shift+Enter)" disabled={!matches.length} onClick={() => move(-1)} />
        <Button size="small" appearance="subtle" icon={<ChevronDownRegular />} aria-label="Next match"
          title="Next match (Enter)" disabled={!matches.length} onClick={() => move(1)} />
      </div>
      <div className={styles.options}>
        <Text size={200}>{query ? "Case-insensitive, literal text search" : "Search keys, values, or error messages"}</Text>
        <Checkbox label="Wrap lines" size="medium" checked={wrap} onChange={(_, data) => setWrap(data.checked === true)} />
      </div>
      <pre ref={code} className={mergeClasses(styles.code, wrap && styles.wrap)}
        tabIndex={0} aria-label={source?.ariaLabel ?? "Response"}>
        {matches.length ? matches.map((match, index) => (
          <Fragment key={match.start}>
            {text.slice(index ? matches[index - 1].end : 0, match.start)}
            <mark ref={index === current ? activeMatch : undefined}
              className={mergeClasses(styles.match, index === current && styles.active)}
              aria-current={index === current ? "true" : undefined}>{text.slice(match.start, match.end)}</mark>
            {index === matches.length - 1 ? text.slice(match.end) : ""}
          </Fragment>
        )) : text}
      </pre>
    </div>
  );
}
