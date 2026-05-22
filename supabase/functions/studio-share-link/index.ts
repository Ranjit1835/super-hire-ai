import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, resumeId, shareToken } = await req.json();

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Action: create — generate a share link (requires auth)
    if (action === "create") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) throw new Error("Missing authorization");

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) throw new Error("Unauthorized");

      if (!resumeId) throw new Error("resumeId is required");

      const { data: resume } = await admin
        .from("studio_resumes")
        .select("id, current_json, template_id, title")
        .eq("id", resumeId)
        .eq("user_id", user.id)
        .single();
      if (!resume) throw new Error("Resume not found");

      // Generate a share token (use UUID for simplicity)
      const token = crypto.randomUUID();

      // Store share data as a version snapshot with a special summary
      await admin.from("studio_versions").insert({
        resume_id: resumeId,
        snapshot_json: resume.current_json,
        change_summary: `SHARE:${token}`,
      });

      const shareUrl = `https://hiresume.in/studio/shared/${token}`;

      return new Response(JSON.stringify({ shareUrl, token }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action: view — get shared resume (no auth required)
    if (action === "view") {
      if (!shareToken) throw new Error("shareToken is required");

      const { data: version } = await admin
        .from("studio_versions")
        .select("snapshot_json, resume_id")
        .like("change_summary", `SHARE:${shareToken}`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!version) throw new Error("Shared resume not found or link expired");

      const { data: resume } = await admin
        .from("studio_resumes")
        .select("template_id, title")
        .eq("id", version.resume_id)
        .single();

      return new Response(
        JSON.stringify({
          resume_json: version.snapshot_json,
          template_id: resume?.template_id || "classic-ats",
          title: resume?.title || "Shared Resume",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error("Invalid action. Use: create, view");
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
