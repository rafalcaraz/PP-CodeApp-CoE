import { makeStyles, tokens } from "@fluentui/react-components";

export const usePlaygroundStyles = makeStyles({
  header: {
    paddingBottom: tokens.spacingVerticalM, borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  filters: {
    backgroundColor: tokens.colorBrandBackground2, padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadiusLarge, border: `1px solid ${tokens.colorBrandStroke2}`,
  },
  panel: {
    padding: tokens.spacingHorizontalL, border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge, backgroundColor: tokens.colorNeutralBackground1,
    alignSelf: "start", overflowWrap: "anywhere",
    "& h3": { marginBlock: 0 },
    "@media (max-width: 600px)": { padding: tokens.spacingHorizontalM },
  },
  response: {
    alignSelf: "start",
    "@media (min-width: 1001px)": { position: "sticky", top: tokens.spacingVerticalL },
  },
  panelHeading: {
    color: tokens.colorBrandForeground1, display: "flex", alignItems: "center",
    gap: tokens.spacingHorizontalS, paddingBottom: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    "& h2": { marginBlock: 0 },
  },
  endpoint: {
    display: "flex", alignItems: "start", gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalM, backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium, minWidth: 0,
    "& code": { flex: 1, minWidth: 0, fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, overflowWrap: "anywhere" },
    "& .fui-Badge": { flexShrink: 0 },
  },
  fields: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
    alignItems: "start", gap: tokens.spacingHorizontalL,
  },
  body: { gridColumn: "1 / -1" },
  actions: {
    paddingTop: tokens.spacingVerticalM, borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  empty: {
    display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
    gap: tokens.spacingVerticalM, padding: `${tokens.spacingVerticalXXXL} ${tokens.spacingHorizontalL}`,
    backgroundColor: tokens.colorNeutralBackground2, borderRadius: tokens.borderRadiusMedium,
    "& svg": { width: "32px", height: "32px", color: tokens.colorBrandForeground1 },
  },
  details: {
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`, paddingTop: tokens.spacingVerticalS,
    "& summary": {
      cursor: "pointer", color: tokens.colorBrandForeground1, paddingBlock: tokens.spacingVerticalXS,
      fontWeight: tokens.fontWeightSemibold,
    },
    "& summary:focus-visible": { outline: `2px solid ${tokens.colorStrokeFocus2}`, outlineOffset: "2px" },
  },
});
