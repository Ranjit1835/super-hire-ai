import { supabase } from "@/integrations/supabase/client";
import type { ChatStreamChunk } from "../types/studio.types";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export async function* streamChat(
  sessionId: string,
  userMessage: string,
  persona?: string
): AsyncGenerator<ChatStreamChunk> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");

  const response = await fetch(`${SUPABASE_URL}/functions/v1/studio-chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ sessionId, userMessage, persona }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Request failed" }));
    if (err.code === "LIMIT_REACHED") {
      yield { type: "error", error: "FREE_LIMIT_REACHED" };
      return;
    }
    throw new Error(err.error || "Chat request failed");
  }

  const contentType = response.headers.get("content-type") || "";

  // SSE streaming response (Claude paid tier)
  if (contentType.includes("text/event-stream")) {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const chunk: ChatStreamChunk = JSON.parse(line.slice(6));
            yield chunk;
          } catch {
            // skip malformed
          }
        }
      }
    }
  } else {
    // JSON response (Groq free tier)
    const data = await response.json();
    if (data.error) {
      yield { type: "error", error: data.error };
      return;
    }

    // Simulate streaming for free tier by yielding text in chunks
    const content = data.content || "";
    const words = content.split(" ");
    const chunkSize = 3;
    for (let i = 0; i < words.length; i += chunkSize) {
      const chunk = words.slice(i, i + chunkSize).join(" ");
      yield { type: "text", content: (i > 0 ? " " : "") + chunk };
      // Small delay to simulate streaming feel
      await new Promise((r) => setTimeout(r, 20));
    }

    if (data.changes && data.changes.length > 0) {
      yield { type: "changes", changes: data.changes, version_id: data.version_id };
    }

    yield {
      type: "done",
      message_id: data.message_id,
    };
  }
}
