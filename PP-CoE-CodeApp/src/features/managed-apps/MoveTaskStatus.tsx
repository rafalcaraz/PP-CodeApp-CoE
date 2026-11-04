import { useEffect, useSyncExternalStore } from "react";
import {
  Button, Caption1, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
  Link, MessageBar, MessageBarBody, Text, makeStyles, tokens,
} from "@fluentui/react-components";
import { createMoveTaskRunner, moveTaskPhaseLabel } from "./moveTask";
import { moveOutcomeLabel } from "./pdeMoves";

const useStyles = makeStyles({
  strip: { marginInline: tokens.spacingHorizontalL, marginBlock: tokens.spacingVerticalS, flexShrink: 0, minWidth: 0, overflowWrap: "anywhere" },
  content: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  entries: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, paddingInlineStart: tokens.spacingHorizontalL },
});

export function MoveTaskStatus({ runner, hideResult = false }: { runner: ReturnType<typeof createMoveTaskRunner>; hideResult?: boolean }) {
  const styles = useStyles();
  const task = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  useEffect(() => {
    if (!task?.running) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [task?.running]);
  if (!task || (hideResult && !task.running && !task.detailOpen)) return null;
  const attention = !!task.error || task.environments.some((entry) => entry.phase === "needs-attention" || entry.phase === "stopped");
  const done = task.environments.filter((entry) => entry.phase === "moved" || entry.phase === "already-member").length;
  const title = task.running ? `Moving ${task.environments.length} PDE${task.environments.length === 1 ? "" : "s"} · ${done} complete`
    : attention ? "Move needs attention" : "Move complete";
  const names = task.environments.map((entry) => entry.name).join(", ");
  return <>
    {(!hideResult || task.running) && <MessageBar className={styles.strip} intent={task.running ? "info" : attention ? "warning" : "success"}>
      <MessageBarBody><Text role="status">{title} · {task.running ? "" : `${done} of ${task.environments.length} complete · `}{task.destinationName}</Text>
        {!task.running && <Text> · {names}</Text>}
        <Button size="small" appearance="transparent" onClick={runner.showDetails}>View progress</Button>
        {!task.running && <Button size="small" appearance="transparent" onClick={runner.dismiss}>Dismiss move result</Button>}
      </MessageBarBody>
    </MessageBar>}
    {task.detailOpen && <Dialog open onOpenChange={(_, data) => { if (!data.open) runner.hideDetails(); }}>
      <DialogSurface><DialogBody>
        <DialogTitle>{task.running ? "Move progress" : title}</DialogTitle>
        <DialogContent className={styles.content}>
          <Text>Destination: {task.destinationName}</Text>
          <ul className={styles.entries}>{task.environments.map((entry) => {
            const result = task.outcome?.record.pdes.find((pde) => pde.environmentId.toLowerCase() === entry.environmentId.toLowerCase());
            return <li key={entry.environmentId}>{entry.name}: {result && task.outcome ? moveOutcomeLabel(task.outcome, result) : moveTaskPhaseLabel(entry.phase)}</li>;
          })}</ul>
          {task.running && <Caption1>You can use other pages in this app. Keep this browser tab open; reloading stops this in-app runner.</Caption1>}
          {!task.running && attention && <Link href="#/managed-apps" onClick={runner.hideDetails}>Review pending move</Link>}
          {(task.error || (attention && !!task.outcome?.messages.length)) && <details><summary>Move error details</summary>
            {task.error && <Text>{task.error}</Text>}
            {task.outcome?.messages.map((message, index) => <p key={index}>{message}</p>)}
          </details>}
        </DialogContent>
        <DialogActions><Button appearance="primary" onClick={runner.hideDetails}>{task.running ? "Continue in background" : "Close"}</Button></DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>}
  </>;
}
