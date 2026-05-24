/**
 * "Demo the future" dialog — fires when the user drags a Managed env
 * onto a different MS env group lane in the Tier 2 Kanban. The point
 * is to *teach* what the eventual mutation feature would do, without
 * actually performing the write yet.
 *
 * Two visual modes via `source.kind`:
 *  - `ms-group` — env moved from one MS group to another. Message
 *    emphasizes rule inheritance ("would inherit X's rules").
 *  - `loose-managed` — env was Loose Managed and got dragged into an
 *    MS group. Message emphasizes promotion ("would join X and start
 *    inheriting governance").
 *
 * Action: a primary "Open target group in PPAC" deep link so the user
 * can do the move manually right now. Plus a "Got it" dismiss.
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
import { OpenRegular } from "@fluentui/react-icons";
import type { EnvironmentRow } from "../../../data/inventory";
import type { EnvDragSource } from "./EnvRow";

const PPAC_ENV_GROUP_BASE =
  "https://admin.powerplatform.microsoft.com/manage/environment-groups";

export interface EnvMoveDemoTarget {
  groupId: string;
  groupDisplayName: string;
}

interface Props {
  open: boolean;
  env: EnvironmentRow | null;
  source: EnvDragSource | null;
  target: EnvMoveDemoTarget | null;
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
  inheritList: {
    margin: 0,
    paddingLeft: tokens.spacingHorizontalL,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  highlight: {
    fontWeight: tokens.fontWeightSemibold,
  },
});

export function EnvMoveDemoDialog({
  open,
  env,
  source,
  target,
  onDismiss,
}: Props) {
  const styles = useStyles();
  const ready = env !== null && source !== null && target !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open) onDismiss();
      }}
    >
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>Just this easy — coming soon</DialogTitle>
          <DialogContent>
            {ready ? (
              <div className={styles.body}>
                <MessageBar intent="info">
                  <MessageBarBody>
                    <MessageBarTitle>Preview, not a real move</MessageBarTitle>
                    Nothing changed in Power Platform. This dialog shows
                    what the eventual drag-to-move feature would do.
                  </MessageBarBody>
                </MessageBar>

                {source.kind === "ms-group" ? (
                  <Text>
                    Moving <span className={styles.highlight}>{env.displayName}</span>{" "}
                    from <span className={styles.highlight}>{source.groupDisplayName}</span>{" "}
                    into <span className={styles.highlight}>{target.groupDisplayName}</span>{" "}
                    would be a single drag-and-drop. The environment would
                    automatically inherit the target group's rules:
                  </Text>
                ) : (
                  <Text>
                    <span className={styles.highlight}>{env.displayName}</span>{" "}
                    is a Loose Managed environment — paying for Managed
                    governance with no group-level rules applied. Dropping
                    it into <span className={styles.highlight}>{target.groupDisplayName}</span>{" "}
                    would promote it into the group and start applying
                    that group's rules immediately:
                  </Text>
                )}

                <ul className={styles.inheritList}>
                  <li>
                    <strong>Advanced Connector Policy (ACP)</strong> — this
                    group's connector restrictions (when ACP is configured,
                    it supersedes tenant DLP for envs in this group)
                  </li>
                  <li>Sharing limits + maker welcome content</li>
                  <li>Solution checker enforcement level</li>
                  <li>IP firewall / Lockbox if the group requires them</li>
                  <li>Backup retention + AI feature gating</li>
                </ul>

                <Caption1>
                  Tenant DLP policies still apply unless this group has ACP
                  configured. Microsoft env groups don't bind DLP natively —
                  that's a known gap (the app exists partly to surface it).
                </Caption1>

                <Caption1>
                  For now, you can do this manually in the Power Platform
                  Admin Center. The link below opens the target group's
                  page where you can add or move the environment.
                </Caption1>
              </div>
            ) : null}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onDismiss}>
              Got it
            </Button>
            {target && (
              <Button
                appearance="primary"
                icon={<OpenRegular />}
                as="a"
                href={`${PPAC_ENV_GROUP_BASE}/${target.groupId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onDismiss}
              >
                Open {target.groupDisplayName} in PPAC
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
