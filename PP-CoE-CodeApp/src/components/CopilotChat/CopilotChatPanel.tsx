import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Spinner,
  Text,
  Textarea,
  Tooltip,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from "@fluentui/react-components";
import {
  DismissRegular,
  EraserRegular,
  SendRegular,
  BotSparkleRegular,
  SubtractRegular,
} from "@fluentui/react-icons";
import type { ChatMessage } from "../../hooks/useCopilotChat";

interface CopilotChatPanelProps {
  messages: ChatMessage[];
  sending: boolean;
  onSend: (text: string) => Promise<void> | void;
  onClear: () => void;
  // Hides the panel but preserves the conversation. The launcher's FAB
  // can bring it back with state intact.
  onMinimize: () => void;
  // Hides AND wipes the conversation — semantically "I'm done".
  onClose: () => void;
}

const useStyles = makeStyles({
  panel: {
    position: "fixed",
    bottom: tokens.spacingVerticalL,
    right: tokens.spacingHorizontalL,
    width: "380px",
    maxWidth: "calc(100vw - 32px)",
    height: "560px",
    maxHeight: "calc(100vh - 96px)",
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow28,
    borderRadius: tokens.borderRadiusXLarge,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    zIndex: 1000,
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  headerTitle: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForegroundOnBrand,
    fontWeight: tokens.fontWeightSemibold,
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
  headerButton: {
    color: tokens.colorNeutralForegroundOnBrand,
    "&:hover": {
      color: tokens.colorNeutralForegroundOnBrand,
      backgroundColor: tokens.colorBrandBackgroundHover,
    },
  },
  messages: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  bubble: {
    maxWidth: "85%",
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusLarge,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    borderBottomRightRadius: tokens.borderRadiusSmall,
  },
  agentBubble: {
    alignSelf: "flex-start",
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    borderBottomLeftRadius: tokens.borderRadiusSmall,
  },
  errorBubble: {
    alignSelf: "flex-start",
    backgroundColor: tokens.colorStatusDangerBackground1,
    color: tokens.colorStatusDangerForeground1,
    ...shorthands.border("1px", "solid", tokens.colorStatusDangerBorder1),
  },
  empty: {
    alignSelf: "center",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    textAlign: "center",
    paddingBlock: tokens.spacingVerticalXXL,
    paddingInline: tokens.spacingHorizontalL,
  },
  thinking: {
    alignSelf: "flex-start",
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  composer: {
    display: "flex",
    alignItems: "flex-end",
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalM,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  textarea: {
    flex: 1,
  },
});

export function CopilotChatPanel({
  messages,
  sending,
  onSend,
  onClear,
  onMinimize,
  onClose,
}: CopilotChatPanelProps) {
  const styles = useStyles();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Autoscroll to the latest message whenever the conversation grows or
  // the agent's reply lands.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    await onSend(text);
  }, [draft, sending, onSend]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends; Shift+Enter inserts a newline.
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div
      className={styles.panel}
      role="dialog"
      aria-label="Copilot Studio assistant"
    >
      <div className={styles.header}>
        <span className={styles.headerTitle}>
          <BotSparkleRegular fontSize={20} />
          <Text>CoE Assistant</Text>
        </span>
        <span className={styles.headerActions}>
          <Tooltip content="Clear conversation" relationship="label">
            <Button
              appearance="subtle"
              icon={<EraserRegular />}
              aria-label="Clear conversation"
              className={styles.headerButton}
              onClick={onClear}
              disabled={messages.length === 0 || sending}
            />
          </Tooltip>
          <Tooltip
            content="Minimize (keep conversation)"
            relationship="label"
          >
            <Button
              appearance="subtle"
              icon={<SubtractRegular />}
              aria-label="Minimize chat"
              className={styles.headerButton}
              onClick={onMinimize}
            />
          </Tooltip>
          <Tooltip content="Close and clear" relationship="label">
            <Button
              appearance="subtle"
              icon={<DismissRegular />}
              aria-label="Close chat"
              className={styles.headerButton}
              onClick={onClose}
            />
          </Tooltip>
        </span>
      </div>

      <div ref={scrollRef} className={styles.messages}>
        {messages.length === 0 && !sending && (
          <div className={styles.empty}>
            Ask the CoE assistant anything about your Power Platform tenant.
            Press Enter to send, Shift+Enter for a new line.
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={mergeClasses(
              styles.bubble,
              m.role === "user" && styles.userBubble,
              m.role === "agent" && styles.agentBubble,
              m.role === "error" && styles.errorBubble,
            )}
          >
            {m.text}
          </div>
        ))}
        {sending && (
          <div className={styles.thinking}>
            <Spinner size="tiny" />
            <Text>Thinking…</Text>
          </div>
        )}
      </div>

      <div className={styles.composer}>
        <Textarea
          className={styles.textarea}
          value={draft}
          onChange={(_, data) => setDraft(data.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the CoE assistant…"
          resize="vertical"
          rows={2}
          disabled={sending}
          aria-label="Message"
        />
        <Button
          appearance="primary"
          icon={<SendRegular />}
          aria-label="Send message"
          disabled={!draft.trim() || sending}
          onClick={() => void handleSend()}
        />
      </div>
    </div>
  );
}
