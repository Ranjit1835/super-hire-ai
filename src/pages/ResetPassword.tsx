import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Lock, CheckCircle2, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { AnimatedGradientMesh, SparkleParticles } from "@/components/premium";

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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
      }
    });

    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setIsRecovery(true);
    }

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
      <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden px-4">
        <AnimatedGradientMesh />
        <div className="glass rounded-2xl shadow-2xl shadow-violet-500/10 border border-violet-500/15 w-full max-w-md relative z-10">
          <div className="py-12 text-center px-6">
            <p className="text-muted-foreground mb-4">Invalid or expired reset link.</p>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate("/auth")}
              className="px-6 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all"
            >
              Back to Sign In
            </motion.button>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden px-4">
        <AnimatedGradientMesh />
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative z-10">
          <div className="glass rounded-2xl shadow-2xl shadow-violet-500/10 border border-violet-500/15 w-full max-w-md">
            <div className="py-12 text-center px-6">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 300 }}
                className="mx-auto mb-4 h-16 w-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center"
              >
                <CheckCircle2 className="h-8 w-8 text-emerald-400" />
              </motion.div>
              <h2 className="text-xl font-bold mb-2 text-foreground">Password Reset Successful</h2>
              <p className="text-muted-foreground">Redirecting to sign in...</p>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden px-4">
      <AnimatedGradientMesh />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="glass rounded-2xl shadow-2xl shadow-violet-500/10 border border-violet-500/15 overflow-hidden">
          <div className="text-center px-6 pt-8 pb-4 relative">
            <SparkleParticles count={5} colors={["#8B5CF6", "#06B6D4"]} />
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200 }}
              className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center shadow-lg shadow-violet-500/30"
            >
              <Zap className="h-7 w-7 text-white" />
            </motion.div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Reset Password</h1>
            <p className="text-sm text-muted-foreground mt-1">Enter your new password below</p>
          </div>

          <div className="px-6 pb-6">
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
                    className="pl-10 bg-white/5 border-violet-500/15 focus:border-violet-500/40"
                  />
                </div>
                {password && passwordErrors.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {passwordErrors.map((err, i) => (
                      <li key={i} className="text-xs text-red-400 flex items-center gap-1">
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
                    className="pl-10 bg-white/5 border-violet-500/15 focus:border-violet-500/40"
                  />
                </div>
                {confirmPassword && !passwordsMatch && (
                  <p className="text-xs text-red-400 mt-1">Passwords do not match</p>
                )}
              </div>
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                type="submit"
                disabled={loading || passwordErrors.length > 0 || !passwordsMatch || !password}
                className="w-full h-11 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all disabled:opacity-50"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Updating...
                  </span>
                ) : (
                  "Reset Password"
                )}
              </motion.button>
            </form>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
