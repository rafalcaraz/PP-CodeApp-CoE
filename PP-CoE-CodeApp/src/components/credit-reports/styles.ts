import { makeStyles, tokens } from "@fluentui/react-components";

export const useCreditStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM, minWidth: 0 },
  list: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, minWidth: 0 },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: tokens.spacingHorizontalM },
  muted: { color: tokens.colorNeutralForeground2 },
  coverage: { color: tokens.colorNeutralForeground2, maxWidth: "85ch" },
  chart: { width: "100%", height: "280px", minWidth: 0 },
  chartHost: { width: "100%", minWidth: 0 },
  rankingChart: { width: "100%", height: "360px", minWidth: 0 },
  tableWrap: { overflowX: "auto", maxWidth: "100%" },
  table: {
    width: "100%", borderCollapse: "collapse",
    "& th, & td": { padding: tokens.spacingHorizontalS, textAlign: "left", verticalAlign: "top", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
    "& th": { fontWeight: tokens.fontWeightSemibold, whiteSpace: "nowrap" },
    "& td": { overflowWrap: "anywhere" },
    "& caption": { textAlign: "left", paddingBlock: tokens.spacingVerticalS, fontWeight: tokens.fontWeightSemibold },
  },
  fields: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: tokens.spacingHorizontalM },
  button: { alignSelf: "flex-start", whiteSpace: "normal", textAlign: "left", justifyContent: "flex-start", overflowWrap: "anywhere" },
});
