import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { takePendingInvite } from "@/features/b2b/lib/api";
import { takeRememberedRedirect } from "@/lib/safe-redirect";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A student who started from an institution invite link goes back to it; anyone else to the
    // page they were on when they chose to sign in, else the dashboard.
    let done = false;
    const goHome = () => {
      if (done) return;
      done = true;
      const invite = takePendingInvite();
      const back = takeRememberedRedirect();
      navigate(invite ? `/invite/${invite}` : back ?? "/dashboard", { replace: true });
    };

    // Supabase automatically detects and processes the OAuth code/token in the URL.
    // We just listen for the resulting auth state change.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        navigate("/reset-password", { replace: true });
      } else if (event === "SIGNED_IN" && session) {
        goHome();
      }
    });

    // Also check if a session already exists (e.g. Supabase processed it before our listener fired)
    supabase.auth.getSession().then(({ data: { session }, error: err }) => {
      if (err) {
        setError(err.message);
        return;
      }
      if (session) {
        goHome();
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
        <img src="/logo.svg" alt="HiResume" className="h-12 w-12 rounded-xl opacity-50" />
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
      <img src="/logo.svg" alt="HiResume" className="h-12 w-12 rounded-xl animate-pulse" />
      <p className="text-sm text-muted-foreground">Completing sign-in…</p>
    </div>
  );
}
