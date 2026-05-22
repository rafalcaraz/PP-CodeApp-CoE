import { lazy, Suspense, useCallback, useState } from "react";
import { Button, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { BotSparkleFilled, DismissRegular } from "@fluentui/react-icons";
import { useCopilotChat } from "../../hooks/useCopilotChat";

// Lazy-load the heavier chat panel so it stays out of the initial bundle.
// The launcher itself is tiny (a single Fluent FAB) and is mounted on every
// route; the panel only matters once the user actually opens it.
const CopilotChatPanel = lazy(() =>
  import("./CopilotChatPanel").then((m) => ({ default: m.CopilotChatPanel })),
);

const useStyles = makeStyles({
  fab: {
    position: "fixed",
    bottom: tokens.spacingVerticalL,
    right: tokens.spacingHorizontalL,
    width: "56px",
    height: "56px",
    minWidth: "56px",
    borderRadius: tokens.borderRadiusCircular,
    boxShadow: tokens.shadow16,
    zIndex: 999,
  },
});

export function CopilotChatLauncher() {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  // Chat state lives here, not in the panel, so it survives minimize/restore
  // cycles. Only `clear()` (or `Close`) wipes the conversation.
  const { messages, sending, send, clear } = useCopilotChat();

  const handleToggle = useCallback(() => setOpen((prev) => !prev), []);
  // Minimize: hide the panel but keep the transcript + conversationId.
  const handleMinimize = useCallback(() => setOpen(false), []);
  // Close (X): hide AND clear. Semantically "I'm done with this dialog".
  const handleClose = useCallback(() => {
    setOpen(false);
    clear();
  }, [clear]);

  return (
    <>
      <Tooltip
        content={
          open
            ? "Minimize CoE assistant"
            : messages.length > 0
              ? "Resume CoE assistant"
              : "Open CoE assistant"
        }
        relationship="label"
      >
        <Button
          appearance="primary"
          shape="circular"
          size="large"
          className={styles.fab}
          icon={open ? <DismissRegular /> : <BotSparkleFilled />}
          aria-label={
            open
              ? "Minimize CoE assistant"
              : messages.length > 0
                ? "Resume CoE assistant"
                : "Open CoE assistant"
          }
          aria-expanded={open}
          onClick={handleToggle}
        />
      </Tooltip>
      {open && (
        <Suspense fallback={null}>
          <CopilotChatPanel
            messages={messages}
            sending={sending}
            onSend={send}
            onClear={clear}
            onMinimize={handleMinimize}
            onClose={handleClose}
          />
        </Suspense>
      )}
    </>
  );
}
