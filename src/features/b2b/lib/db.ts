import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// B2B tables aren't in the generated types.ts yet (regenerate after deploying the
// b2b migrations). Until then, use an untyped view of the same client — same
// session, same RLS — and type rows via ../types.
export const b2bDb = supabase as unknown as SupabaseClient;
