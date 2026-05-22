import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { StudioVersion, ResumeJSON } from "../types/studio.types";

export function useVersionHistory(resumeId: string | undefined) {
  const [versions, setVersions] = useState<StudioVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState<{ a: StudioVersion; b: StudioVersion } | null>(null);

  const loadVersions = useCallback(async () => {
    if (!resumeId) return;
    setLoading(true);
    try {
      const { data } = await supabase.functions.invoke("studio-list-versions", {
        body: { resumeId },
      });
      setVersions((data?.versions || []) as StudioVersion[]);
    } catch (err) {
      console.error("[useVersionHistory] Failed to load versions:", err);
    } finally {
      setLoading(false);
    }
  }, [resumeId]);

  const revertToVersion = useCallback(
    async (versionId: string): Promise<ResumeJSON | null> => {
      try {
        const { data, error } = await supabase.functions.invoke("studio-revert-version", {
          body: { versionId },
        });
        if (error) throw error;
        await loadVersions();
        return data?.current_json as ResumeJSON;
      } catch (err) {
        console.error("[useVersionHistory] Revert failed:", err);
        return null;
      }
    },
    [loadVersions]
  );

  const startCompare = useCallback((a: StudioVersion, b: StudioVersion) => {
    setComparing({ a, b });
  }, []);

  const stopCompare = useCallback(() => {
    setComparing(null);
  }, []);

  return {
    versions,
    loading,
    comparing,
    loadVersions,
    revertToVersion,
    startCompare,
    stopCompare,
  };
}
