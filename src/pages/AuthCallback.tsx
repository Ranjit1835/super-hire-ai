import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Zap } from "lucide-react";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Supabase automatically detects and processes the OAuth code/token in the URL.
    // We just listen for the resulting auth state change.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        navigate("/reset-password", { replace: true });
      } else if (event === "SIGNED_IN" && session) {
        navigate("/dashboard", { replace: true });
      }
    });

    // Also check if a session already exists (e.g. Supabase processed it before our listener fired)
    supabase.auth.getSession().then(({ data: { session }, error: err }) => {
      if (err) {
        setError(err.message);
        return;
      }
      if (session) {
        navigate("/dashboard", { replace: true });
      }
    });

    // Timeout fallback — if nothing happens after 8s, show an error
    const timeout = setTimeout(() => {
      setError("Sign-in timed out. Please try again.");
    }, 8000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <div className="h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center">
          <Zap className="h-6 w-6 text-destructive" />
        </div>
        <h2 className="text-lg font-semibold">Sign-in Failed</h2>
        <p className="text-sm text-muted-foreground text-center max-w-xs">{error}</p>
        <button
          className="text-sm text-primary hover:underline"
          onClick={() => navigate("/auth", { replace: true })}
        >
          Back to Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center animate-pulse">
        <Zap className="h-6 w-6 text-primary-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">Completing sign-in…</p>
    </div>
  );
}
