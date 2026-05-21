/**
 * Portal actions bar — the reusable command-bar strip for detail pages.
 *
 * Visually modeled after the model-driven / Dynamics 365 command bar: a thin
 * full-width strip of flat, icon-led buttons with a subtle bottom rule. Sits
 * just under the breadcrumb and above the entity title.
 *
 * Renders nothing if no portal actions apply for the given context, so the
 * bar is safe to mount unconditionally on every detail page.
 */
import { useMemo } from "react";
import {
  makeStyles,
  mergeClasses,
  tokens,
  Toolbar,
  ToolbarButton,
  Tooltip,
} from "@fluentui/react-components";
import { getPortalActions } from "./registry";
import type { PortalContext } from "./types";

const useStyles = makeStyles({
  bar: {
    // Flat command-bar strip: edge-to-edge inside the detail content, light
    // background, subtle hairline below to separate from the page title.
    // Negative inline margin breaks out of the parent page padding (the
    // AppShell content area uses `spacingHorizontalXXL` padding) so the
    // strip spans the full width like a real D365 command bar.
    boxSizing: "border-box",
    marginInline: `calc(-1 * ${tokens.spacingHorizontalXXL})`,
    paddingInline: tokens.spacingHorizontalXXL,
    paddingBlock: tokens.spacingVerticalXS,
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    columnGap: tokens.spacingHorizontalXXS,
    rowGap: tokens.spacingVerticalXXS,
    flexWrap: "wrap",
    alignItems: "center",
  },
  button: {
    // Tight padding so icon + label sit close together like the D365 bar.
    paddingInline: tokens.spacingHorizontalSNudge,
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground1,
  },
});

export interface PortalActionsBarProps {
  context: PortalContext;
  /** Optional className for per-page margin / placement tweaks. */
  className?: string;
}

export function PortalActionsBar({ context, className }: PortalActionsBarProps) {
  const styles = useStyles();
  const actions = useMemo(() => getPortalActions(context), [context]);

  if (actions.length === 0) return null;

  return (
    <Toolbar
      aria-label="External portal links"
      size="small"
      className={mergeClasses(styles.bar, className)}
    >
      {actions.map((action) => (
        <Tooltip
          key={action.kind}
          content={`${action.description} Opens ${action.url} in a new tab.`}
          relationship="description"
          withArrow
        >
          <ToolbarButton
            as="a"
            href={action.url}
            target="_blank"
            rel="noopener noreferrer"
            icon={action.icon}
            appearance="subtle"
            className={styles.button}
          >
            {action.label}
          </ToolbarButton>
        </Tooltip>
      ))}
    </Toolbar>
  );
}
