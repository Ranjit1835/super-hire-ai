import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useLocation } from "react-router-dom";
import { authUrlFor } from "@/lib/safe-redirect";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Sign in, then come straight back here (e.g. a "Resume builder" link from the home page).
  if (!user) return <Navigate to={authUrlFor(location.pathname + location.search)} replace />;
  return <>{children}</>;
}
