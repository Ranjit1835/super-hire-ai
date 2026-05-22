import { useState, useCallback, useRef } from "react";
import { streamChat } from "../lib/claudeStream";
import { applyChanges } from "../lib/jsonPatch";
import type { ResumeJSON, ResumeChange, StudioMessage, ChatStreamChunk } from "../types/studio.types";

interface UseChatStreamOptions {
  sessionId: string | undefined;
  persona: string;
  currentJson: ResumeJSON | undefined;
  onResumeUpdate: (json: ResumeJSON) => void;
  onMessageAdd: (msg: StudioMessage) => void;
  onSessionUpdate: (updates: any) => void;
  onFreeLimitReached: () => void;
}

export function useChatStream({
  sessionId,
  persona,
  currentJson,
  onResumeUpdate,
  onMessageAdd,
  onSessionUpdate,
  onFreeLimitReached,
}: UseChatStreamOptions) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [pendingChanges, setPendingChanges] = useState<ResumeChange[]>([]);
  const abortRef = useRef(false);

  const sendMessage = useCallback(
    async (userMessage: string) => {
      if (!sessionId || !currentJson || isStreaming) return;

      abortRef.current = false;
      setIsStreaming(true);
      setStreamingContent("");
      setPendingChanges([]);

      // Add user message immediately (optimistic)
      const userMsg: StudioMessage = {
        id: crypto.randomUUID(),
        session_id: sessionId,
        role: "user",
        content: userMessage,
        changes_applied: null,
        model_used: null,
        tokens_used: 0,
        created_at: new Date().toISOString(),
      };
      onMessageAdd(userMsg);

      let fullContent = "";
      let allChanges: ResumeChange[] = [];

      try {
        for await (const chunk of streamChat(sessionId, userMessage, persona)) {
          if (abortRef.current) break;

          switch (chunk.type) {
            case "text":
              fullContent += chunk.content || "";
              setStreamingContent(fullContent);
              break;

            case "changes":
              allChanges = chunk.changes || [];
              setPendingChanges(allChanges);
              // Apply changes to resume immediately
              if (allChanges.length > 0) {
                const updated = applyChanges(currentJson, allChanges);
                onResumeUpdate(updated);
              }
              break;

            case "done":
              // Add the assistant message
              const assistantMsg: StudioMessage = {
                id: chunk.message_id || crypto.randomUUID(),
                session_id: sessionId,
                role: "assistant",
                content: fullContent,
                changes_applied: allChanges.length > 0 ? allChanges : null,
                model_used: null,
                tokens_used: 0,
                created_at: new Date().toISOString(),
              };
              onMessageAdd(assistantMsg);
              onSessionUpdate({ messages_used: (chunk as any).messages_used });
              break;

            case "error":
              if (chunk.error === "FREE_LIMIT_REACHED") {
                onFreeLimitReached();
              } else {
                const errMsg: StudioMessage = {
                  id: crypto.randomUUID(),
                  session_id: sessionId,
                  role: "system",
                  content: `Error: ${chunk.error}`,
                  changes_applied: null,
                  model_used: null,
                  tokens_used: 0,
                  created_at: new Date().toISOString(),
                };
                onMessageAdd(errMsg);
              }
              break;
          }
        }
      } catch (err: any) {
        console.error("[useChatStream] Error:", err);
        const errMsg: StudioMessage = {
          id: crypto.randomUUID(),
          session_id: sessionId,
          role: "system",
          content: `Something went wrong. Please try again.`,
          changes_applied: null,
          model_used: null,
          tokens_used: 0,
          created_at: new Date().toISOString(),
        };
        onMessageAdd(errMsg);
      } finally {
        setIsStreaming(false);
        setStreamingContent("");
        setPendingChanges([]);
      }
    },
    [sessionId, persona, currentJson, isStreaming, onResumeUpdate, onMessageAdd, onSessionUpdate, onFreeLimitReached]
  );

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  return {
    sendMessage,
    abort,
    isStreaming,
    streamingContent,
    pendingChanges,
  };
}
