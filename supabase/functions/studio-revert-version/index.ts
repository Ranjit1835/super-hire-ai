import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) throw new Error("Unauthorized");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { versionId } = await req.json();
    if (!versionId) throw new Error("versionId is required");

    // Get version
    const { data: version } = await admin
      .from("studio_versions")
      .select("id, resume_id, snapshot_json")
      .eq("id", versionId)
      .single();
    if (!version) throw new Error("Version not found");

    // Verify ownership
    const { data: resume } = await admin
      .from("studio_resumes")
      .select("id, current_json")
      .eq("id", version.resume_id)
      .eq("user_id", user.id)
      .single();
    if (!resume) throw new Error("Resume not found");

    // Save current state as a new version before reverting
    await admin.from("studio_versions").insert({
      resume_id: resume.id,
      snapshot_json: resume.current_json,
      change_summary: "Auto-saved before revert",
    });

    // Apply revert
    await admin
      .from("studio_resumes")
      .update({ current_json: version.snapshot_json, updated_at: new Date().toISOString() })
      .eq("id", resume.id);

    return new Response(JSON.stringify({ success: true, current_json: version.snapshot_json }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
