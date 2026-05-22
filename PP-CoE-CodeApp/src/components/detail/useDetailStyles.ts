/**
 * Shared styles for every resource detail page (Agent, App, Flow,
 * Environment, Environment group).
 *
 * Centralizing these here means a tweak (e.g. grid column count, mono font,
 * relative-time color) lands on every detail page at once. Page-specific
 * styles (e.g. AgentDetail's `chips`, `sharingBlock`, `stat`) stay in the
 * page file.
 */
import { makeStyles, tokens } from "@fluentui/react-components";

export const useDetailStyles = makeStyles({
  /** 2-column responsive grid root. Collapses to 1 column under 900px. */
  root: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalL,
    "@media (max-width: 900px)": {
      gridTemplateColumns: "1fr",
    },
  },
  colFull: {
    gridColumn: "1 / -1",
  },
  colHalf: {
    gridColumn: "span 1",
    minWidth: 0,
    height: "100%",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  badgeRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
  },
  cardBody: {
    padding: tokens.spacingHorizontalL,
  },
  /** Auto-flowing meta grid used for the larger Trigger / Configuration cards. */
  metaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalM,
  },
  /** Tight 2-column meta grid used inside half-width cards. */
  metaGridTwo: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalM,
    "@media (max-width: 500px)": {
      gridTemplateColumns: "1fr",
    },
  },
  summaryLine: {
    color: tokens.colorNeutralForeground2,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    rowGap: tokens.spacingVerticalXXS,
  },
  summaryDot: {
    color: tokens.colorNeutralForeground4,
  },
  metaItem: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  metaLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  /** Small muted label shown next to absolute dates ("(3 days ago)"). */
  relative: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    marginLeft: tokens.spacingHorizontalXS,
  },
  /** Monospaced identifier display (IDs, GUIDs, schema names). */
  mono: {
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: tokens.fontSizeBase200,
    wordBreak: "break-all",
  },
  /** Inline italic "no data" / "empty state" copy inside cards. */
  empty: {
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
    fontSize: tokens.fontSizeBase200,
  },
});
