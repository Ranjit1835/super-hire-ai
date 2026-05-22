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

    const { suggestionId } = await req.json();
    if (!suggestionId) throw new Error("suggestionId is required");

    // Get suggestion
    const { data: suggestion } = await admin
      .from("studio_suggestions")
      .select("*")
      .eq("id", suggestionId)
      .single();
    if (!suggestion) throw new Error("Suggestion not found");
    if (suggestion.applied) {
      return new Response(JSON.stringify({ alreadyApplied: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify ownership
    const { data: resume } = await admin
      .from("studio_resumes")
      .select("id")
      .eq("id", suggestion.resume_id)
      .eq("user_id", user.id)
      .single();
    if (!resume) throw new Error("Resume not found");

    // Mark suggestion as applied — the actual fix is triggered
    // by calling studio-chat from the client with the suggestion text
    await admin
      .from("studio_suggestions")
      .update({ applied: true })
      .eq("id", suggestionId);

    return new Response(
      JSON.stringify({
        success: true,
        chatPrompt: `Fix this issue: ${suggestion.suggestion} (Target: ${suggestion.target_path || "general"})`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
