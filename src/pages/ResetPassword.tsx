import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Lock, CheckCircle2, Zap } from "lucide-react";
import { motion } from "framer-motion";

const PASSWORD_RULES = {
  minLength: 8,
  uppercase: /[A-Z]/,
  number: /[0-9]/,
};

function validatePassword(password: string) {
  const errors: string[] = [];
  if (password.length < PASSWORD_RULES.minLength) errors.push("At least 8 characters");
  if (!PASSWORD_RULES.uppercase.test(password)) errors.push("At least 1 uppercase letter");
  if (!PASSWORD_RULES.number.test(password)) errors.push("At least 1 number");
  return errors;
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);

  useEffect(() => {
    document.title = "Reset Password – HireResume";

    // Listen for PASSWORD_RECOVERY event (fired after PKCE code exchange in AuthCallback)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
      }
    });

    // Check hash-based recovery (legacy flow)
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setIsRecovery(true);
    }

    // If we arrived here directly after AuthCallback exchanged the code,
    // session already exists — treat as recovery
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setIsRecovery(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  const passwordErrors = validatePassword(password);
  const passwordsMatch = password === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordErrors.length > 0 || !passwordsMatch) return;

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
      toast({ title: "Password updated", description: "You can now sign in with your new password." });
      setTimeout(() => navigate("/auth", { replace: true }), 2000);
    } catch (err: any) {
      toast({ title: "Failed to reset password", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (!isRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md glass shadow-xl">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">Invalid or expired reset link.</p>
            <Button onClick={() => navigate("/auth")}>Back to Sign In</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          <Card className="w-full max-w-md glass shadow-xl">
            <CardContent className="py-12 text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 300 }}
                className="mx-auto mb-4 h-16 w-16 rounded-full bg-success/20 flex items-center justify-center"
              >
                <CheckCircle2 className="h-8 w-8 text-success" />
              </motion.div>
              <h2 className="text-xl font-bold mb-2">Password Reset Successful</h2>
              <p className="text-muted-foreground">Redirecting to sign in...</p>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <Card className="glass shadow-xl">
          <CardHeader className="text-center pb-4">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200 }}
              className="mx-auto mb-3 h-12 w-12 rounded-xl bg-primary flex items-center justify-center"
            >
              <Zap className="h-6 w-6 text-primary-foreground" />
            </motion.div>
            <CardTitle className="text-2xl">Reset Password</CardTitle>
            <CardDescription>Enter your new password below</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="password"
                    placeholder="New Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="pl-10"
                  />
                </div>
                {password && passwordErrors.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {passwordErrors.map((err, i) => (
                      <li key={i} className="text-xs text-destructive flex items-center gap-1">
                        <span>•</span> {err}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="password"
                    placeholder="Confirm Password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="pl-10"
                  />
                </div>
                {confirmPassword && !passwordsMatch && (
                  <p className="text-xs text-destructive mt-1">Passwords do not match</p>
                )}
              </div>
              <Button
                type="submit"
                className="w-full h-11"
                disabled={loading || passwordErrors.length > 0 || !passwordsMatch || !password}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                    Updating...
                  </span>
                ) : (
                  "Reset Password"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
