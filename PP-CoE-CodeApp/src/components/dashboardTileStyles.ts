import { makeStyles, tokens } from "@fluentui/react-components";

export const useDashboardTileStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", height: "100%", minHeight: "240px", minWidth: 0 },
  body: {
    flex: 1, padding: tokens.spacingHorizontalM, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  kpi: {
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center",
    flex: 1, gap: tokens.spacingVerticalXS,
  },
  kpiValue: { fontSize: "56px", fontWeight: tokens.fontWeightSemibold, lineHeight: 1, textAlign: "center" },
  kpiLabel: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase300, textAlign: "center" },
  disclosure: {
    fontSize: tokens.fontSizeBase200, marginTop: tokens.spacingVerticalM, color: tokens.colorNeutralForeground2,
    "& summary": { cursor: "pointer", paddingBlock: tokens.spacingVerticalXS },
  },
  tableWrap: { flex: 1, overflow: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: tokens.fontSizeBase200 },
  th: {
    textAlign: "left", fontWeight: tokens.fontWeightSemibold, padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    backgroundColor: tokens.colorNeutralBackground2, borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, position: "sticky", top: 0,
  },
  td: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`, borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "260px",
  },
  empty: { color: tokens.colorNeutralForeground3, fontStyle: "italic", fontSize: tokens.fontSizeBase200, padding: tokens.spacingHorizontalM },
  err: { color: tokens.colorPaletteRedForeground1, fontSize: tokens.fontSizeBase200, padding: tokens.spacingHorizontalM },
  centerSpinner: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center" },
});
