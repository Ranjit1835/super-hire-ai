import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { StudioSession, StudioResume, StudioMessage, StudioSuggestion, PassType } from "../types/studio.types";

export function useStudioSession(resumeId: string | undefined) {
  const { user } = useAuth();
  const [resume, setResume] = useState<StudioResume | null>(null);
  const [session, setSession] = useState<StudioSession | null>(null);
  const [messages, setMessages] = useState<StudioMessage[]>([]);
  const [suggestions, setSuggestions] = useState<StudioSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load resume + session
  useEffect(() => {
    if (!resumeId || !user) return;
    loadStudioData();
  }, [resumeId, user]);

  const loadStudioData = async () => {
    if (!resumeId || !user) return;
    setLoading(true);
    setError(null);

    try {
      // Fetch resume
      const { data: resumeData, error: rErr } = await supabase
        .from("studio_resumes")
        .select("*")
        .eq("id", resumeId)
        .eq("user_id", user.id)
        .single();

      if (rErr || !resumeData) throw new Error("Resume not found");
      setResume(resumeData as unknown as StudioResume);

      // Check for active session
      const sessionRes = await supabase.functions.invoke("studio-create-session", {
        body: { action: "check", resumeId },
      });

      let activeSession = sessionRes.data?.session;

      // If no session, create a free one
      if (!activeSession) {
        const createRes = await supabase.functions.invoke("studio-create-session", {
          body: { action: "create-free", resumeId },
        });
        if (createRes.error) {
          let errMsg = "Failed to create session";
          try {
            if (createRes.error.context && typeof createRes.error.context.json === "function") {
              const body = await createRes.error.context.json();
              errMsg = body?.error || errMsg;
            }
          } catch { /* ignore */ }
          throw new Error(errMsg);
        }
        activeSession = createRes.data?.session;
      }

      if (activeSession) {
        setSession(activeSession as StudioSession);

        // Load messages for this session
        const { data: msgs } = await supabase
          .from("studio_messages")
          .select("*")
          .eq("session_id", activeSession.id)
          .order("created_at", { ascending: true });

        setMessages((msgs || []) as unknown as StudioMessage[]);
      }

      // Load suggestions
      const { data: suggs } = await supabase
        .from("studio_suggestions")
        .select("*")
        .eq("resume_id", resumeId)
        .eq("applied", false)
        .order("created_at", { ascending: true });

      setSuggestions((suggs || []) as unknown as StudioSuggestion[]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const addMessage = useCallback((msg: StudioMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const updateResume = useCallback((updatedJson: any) => {
    setResume((prev) => prev ? { ...prev, current_json: updatedJson, updated_at: new Date().toISOString() } : prev);
  }, []);

  const updateSession = useCallback((updates: Partial<StudioSession>) => {
    setSession((prev) => prev ? { ...prev, ...updates } : prev);
  }, []);

  const updateTemplate = useCallback(async (templateId: string) => {
    if (!resume) return;
    await supabase
      .from("studio_resumes")
      .update({ template_id: templateId, updated_at: new Date().toISOString() })
      .eq("id", resume.id);
    setResume((prev) => prev ? { ...prev, template_id: templateId as any } : prev);
  }, [resume]);

  const updatePersona = useCallback(async (persona: string) => {
    if (!resume) return;
    await supabase
      .from("studio_resumes")
      .update({ persona, updated_at: new Date().toISOString() })
      .eq("id", resume.id);
    setResume((prev) => prev ? { ...prev, persona: persona as any } : prev);
  }, [resume]);

  const markSuggestionApplied = useCallback((suggestionId: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
  }, []);

  const isPaidSession = session?.pass_type !== "free";
  const isExpired = session ? new Date(session.expires_at) < new Date() : false;
  const messagesRemaining = session?.pass_type === "free" ? Math.max(0, 3 - (session.messages_used || 0)) : Infinity;

  return {
    resume,
    session,
    messages,
    suggestions,
    loading,
    error,
    isPaidSession,
    isExpired,
    messagesRemaining,
    addMessage,
    updateResume,
    updateSession,
    updateTemplate,
    updatePersona,
    markSuggestionApplied,
    reload: loadStudioData,
  };
}
