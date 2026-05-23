/**
 * Post-add educational popup for the Standard custom group drop flow.
 *
 * Fires AFTER a Standard env is dragged into a Standard custom group
 * lane (the add already happened — this isn't a preview). The point
 * is to point at the *next* feature on this concept's roadmap: linking
 * a DLP policy directly to a Standard custom group, since Microsoft
 * refuses to bind DLP to env groups natively (see roadmap receipt #2).
 *
 * When we ship the DLP-to-custom-group linkage, envs added here will
 * automatically declare that DLP as their governance home — and the
 * link will be a visible relationship in this app, surfacing the gap
 * Microsoft refuses to fill.
 *
 * Distinct from `EnvMoveDemoDialog`:
 *  - That one fires for MS-group drops (preview-only; mutation deferred)
 *  - This one fires for custom-group drops (action already happened;
 *    popup is forward-looking)
 */

import {
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  makeStyles,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Text,
  tokens,
} from "@fluentui/react-components";
import type { EnvironmentRow } from "../../data/inventory";

interface Props {
  open: boolean;
  env: EnvironmentRow | null;
  /** The Standard custom group the env was just added to. */
  targetGroupName: string | null;
  /**
   * When the env was previously in a different custom group (cross-
   * group drag), include the prior group's name so the message can
   * say "moved from X to Y" instead of just "added to Y."
   */
  fromGroupName?: string | null;
  onDismiss: () => void;
}

const useStyles = makeStyles({
  surface: {
    maxWidth: "560px",
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  highlight: {
    fontWeight: tokens.fontWeightSemibold,
  },
  benefitList: {
    margin: 0,
    paddingLeft: tokens.spacingHorizontalL,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
});

export function StandardGroupAddDialog({
  open,
  env,
  targetGroupName,
  fromGroupName,
  onDismiss,
}: Props) {
  const styles = useStyles();
  const ready = env !== null && targetGroupName !== null;
  const wasMove = ready && fromGroupName !== null && fromGroupName !== undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open) onDismiss();
      }}
    >
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>Added — and here's what's coming</DialogTitle>
          <DialogContent>
            {ready ? (
              <div className={styles.body}>
                <MessageBar intent="success">
                  <MessageBarBody>
                    <MessageBarTitle>Done</MessageBarTitle>
                    {wasMove ? (
                      <>
                        <span className={styles.highlight}>{env.displayName}</span>{" "}
                        moved from{" "}
                        <span className={styles.highlight}>{fromGroupName}</span>{" "}
                        into{" "}
                        <span className={styles.highlight}>{targetGroupName}</span>
                        .
                      </>
                    ) : (
                      <>
                        <span className={styles.highlight}>{env.displayName}</span>{" "}
                        added to{" "}
                        <span className={styles.highlight}>{targetGroupName}</span>
                        .
                      </>
                    )}
                  </MessageBarBody>
                </MessageBar>

                <Text>
                  In the future, you'll be able to link a{" "}
                  <span className={styles.highlight}>DLP policy</span> directly
                  to <span className={styles.highlight}>{targetGroupName}</span>.
                  When that lands, every env you add here will automatically
                  declare that DLP as its governance home.
                </Text>

                <ul className={styles.benefitList}>
                  <li>
                    One source of truth for "what DLP governs the envs in
                    this group"
                  </li>
                  <li>
                    Visible drift detection when an env is missing from the
                    DLP's environment list (or the DLP is missing from the
                    group's link)
                  </li>
                  <li>
                    A way to author "tag-based" DLP coverage that Microsoft
                    refuses to ship natively for env groups
                  </li>
                </ul>

                <Caption1>
                  Why this matters: Microsoft env groups don't bind DLP
                  policies natively — their official guidance is to "create
                  a data policy with the same or similar name as an
                  environment group" and align by convention. Standard
                  custom groups in this app exist outside Microsoft's model
                  entirely, so we can make the linkage explicit instead of
                  conventional.
                </Caption1>
              </div>
            ) : null}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={onDismiss}>
              Got it
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
