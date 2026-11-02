import { makeStyles, tokens } from "@fluentui/react-components";

export const useCostStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL, minWidth: 0 },
  header: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, paddingBottom: tokens.spacingVerticalM, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  row: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: tokens.spacingHorizontalM },
  spread: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: tokens.spacingHorizontalM },
  muted: { color: tokens.colorNeutralForeground2 },
  panel: {
    display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL, border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge, backgroundColor: tokens.colorNeutralBackground1, minWidth: 0,
    "& h2, & h3": { marginBlock: 0 },
    "@media (max-width: 600px)": { padding: tokens.spacingHorizontalM },
  },
  warning: { padding: tokens.spacingHorizontalM, backgroundColor: tokens.colorStatusWarningBackground1, color: tokens.colorStatusWarningForeground1, borderRadius: tokens.borderRadiusMedium },
  success: { padding: tokens.spacingHorizontalM, backgroundColor: tokens.colorStatusSuccessBackground1, color: tokens.colorStatusSuccessForeground1, borderRadius: tokens.borderRadiusMedium },
  tableWrap: { overflowX: "auto", maxWidth: "100%" },
  table: {
    width: "100%", borderCollapse: "collapse",
    "& th, & td": { textAlign: "left", verticalAlign: "top", padding: tokens.spacingHorizontalM, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
    "& th": { fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground2, whiteSpace: "nowrap" },
    "& td": { overflowWrap: "anywhere" },
    "& caption": { textAlign: "left", paddingBottom: tokens.spacingVerticalM, fontWeight: tokens.fontWeightSemibold },
  },
  chart: { width: "100%", height: "280px", minWidth: 0 },
  fields: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
    gap: tokens.spacingHorizontalL, alignItems: "start",
  },
  management: {
    display: "grid", gridTemplateColumns: "minmax(230px, 1fr) minmax(0, 3fr)", gap: tokens.spacingHorizontalL,
    "@media (max-width: 1050px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  list: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, minWidth: 0 },
  policyButton: { width: "100%", justifyContent: "start", textAlign: "left", whiteSpace: "normal", overflowWrap: "anywhere", minHeight: "44px" },
  form: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  actions: { paddingTop: tokens.spacingVerticalM, borderTop: `1px solid ${tokens.colorNeutralStroke2}` },
  code: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, maxHeight: "360px", overflow: "auto" },
});
