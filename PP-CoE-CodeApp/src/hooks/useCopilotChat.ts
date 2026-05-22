import { useCallback, useRef, useState } from "react";
import { sendMessage } from "../services/copilotStudio";

export type ChatRole = "user" | "agent" | "error";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
}

export interface UseCopilotChatResult {
  messages: ChatMessage[];
  sending: boolean;
  send: (text: string) => Promise<void>;
  clear: () => void;
}

function buildId(): string {
  // No need for cryptographic randomness; only used as a React key.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Owns the chat transcript and the per-conversation continuation id.
 *
 * Lifted out of CopilotChatPanel so the state can survive the panel
 * unmounting — that's what makes the difference between Minimize
 * (state preserved, just hide) and Close (state cleared, dismiss).
 */
export function useCopilotChat(): UseCopilotChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  // Preserved across turns so the agent treats follow-ups as part of the
  // same dialog. Reset on `clear()`.
  const conversationIdRef = useRef<string | undefined>(undefined);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMsg: ChatMessage = { id: buildId(), role: "user", text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    try {
      const reply = await sendMessage(trimmed, {
        conversationId: conversationIdRef.current,
      });
      if (reply.conversationId) {
        conversationIdRef.current = reply.conversationId;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: buildId(),
          role: "agent",
          text: reply.text || "(empty response)",
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: buildId(),
          role: "error",
          text: err instanceof Error ? err.message : String(err),
        },
      ]);
    } finally {
      setSending(false);
    }
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    conversationIdRef.current = undefined;
  }, []);

  return { messages, sending, send, clear };
}
