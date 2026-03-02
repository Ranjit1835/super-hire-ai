import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Zap, LogIn, UserPlus, Mail, Lock, User, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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

export default function Auth() {
  const { signUp, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirm, setSignupConfirm] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  const returnTo = searchParams.get("returnTo");
  const guestToken = searchParams.get("guestToken");

  if (user) {
    if (returnTo === "guest" && guestToken) {
      navigate(`/analysis/guest/${guestToken}`, { replace: true });
    } else if (returnTo === "analyze" && sessionStorage.getItem("pendingResume")) {
      navigate("/dashboard?autoAnalyze=true", { replace: true });
    } else {
      navigate("/dashboard", { replace: true });
    }
    return null;
  }

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setSignInError(null);
    const form = new FormData(e.currentTarget);
    const email = form.get("email") as string;
    const password = form.get("password") as string;

    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-otp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ email, password }),
        }
      );
      const data = await res.json();

      if (!res.ok || data?.error) {
        setSignInError(data?.error || "Something went wrong");
        setLoading(false);
        return;
      }

      toast({ title: "OTP Sent", description: "A verification code has been sent to your email." });

      navigate("/verify-otp", {
        state: {
          email,
          password,
          maskedEmail: data?.email,
          expiresAt: data?.expiresAt,
          returnTo,
          guestToken,
        },
      });
    } catch (err: any) {
      setSignInError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = form.get("password") as string;
    const confirmPw = form.get("confirmPassword") as string;

    const errors = validatePassword(password);
    if (errors.length > 0) {
      toast({ title: "Password requirements not met", description: errors.join(", "), variant: "destructive" });
      return;
    }
    if (password !== confirmPw) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }

    setLoading(true);
    const { error } = await signUp(
      form.get("email") as string,
      password,
      form.get("name") as string
    );
    setLoading(false);
    if (error) {
      toast({ title: "Sign up failed", description: error, variant: "destructive" });
    } else {
      toast({ title: "Check your email", description: "We sent you a confirmation link." });
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) return;
    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast({ title: "Reset link sent", description: "Check your email for a password reset link." });
      setShowForgotPassword(false);
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setForgotLoading(false);
    }
  };

  const signupErrors = validatePassword(signupPassword);
  const signupMatch = signupPassword === signupConfirm;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <Card className="glass shadow-xl">
          <CardHeader className="text-center pb-4">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, delay: 0.1 }}
              className="mx-auto mb-3 h-12 w-12 rounded-xl bg-primary flex items-center justify-center"
            >
              <Zap className="h-6 w-6 text-primary-foreground" />
            </motion.div>
            <CardTitle className="text-2xl">HireResume</CardTitle>
            <CardDescription>
              {returnTo === "guest" ? "Sign in to unlock your full analysis" : returnTo === "analyze" ? "Sign in to see your analysis results" : "Resume Intelligence Platform"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {showForgotPassword ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div className="text-center mb-4">
                    <KeyRound className="h-8 w-8 text-primary mx-auto mb-2" />
                    <h3 className="font-semibold">Forgot Password?</h3>
                    <p className="text-sm text-muted-foreground">Enter your email to receive a reset link</p>
                  </div>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="email"
                      placeholder="Email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      required
                      className="pl-10"
                    />
                  </div>
                  <Button type="submit" className="w-full h-11" disabled={forgotLoading}>
                    {forgotLoading ? (
                      <span className="flex items-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                        Sending...
                      </span>
                    ) : (
                      "Send Reset Link"
                    )}
                  </Button>
                  <Button type="button" variant="link" className="w-full" onClick={() => setShowForgotPassword(false)}>
                    ← Back to Sign In
                  </Button>
                </form>
              </motion.div>
            ) : (
              <Tabs defaultValue="signin">
                <TabsList className="grid w-full grid-cols-2 mb-4">
                  <TabsTrigger value="signin" className="gap-1.5">
                    <LogIn className="h-3.5 w-3.5" /> Sign In
                  </TabsTrigger>
                  <TabsTrigger value="signup" className="gap-1.5">
                    <UserPlus className="h-3.5 w-3.5" /> Sign Up
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="signin">
                  <form onSubmit={handleSignIn} className="space-y-4">
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input name="email" type="email" placeholder="Email" required className="pl-10" />
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input name="password" type="password" placeholder="Password" required className="pl-10" />
                    </div>
                    {signInError && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-lg bg-destructive/10 border border-destructive/30 p-3"
                      >
                        <p className="text-sm text-destructive font-medium">{signInError}</p>
                        <button
                          type="button"
                          className="text-xs text-primary hover:underline mt-1"
                          onClick={() => { setShowForgotPassword(true); setSignInError(null); }}
                        >
                          Forgot your password?
                        </button>
                      </motion.div>
                    )}
                    <Button type="submit" className="w-full h-11" disabled={loading}>
                      {loading ? (
                        <span className="flex items-center gap-2">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                          Authenticating...
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <LogIn className="h-4 w-4" /> Sign In
                        </span>
                      )}
                    </Button>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">A verification code will be sent to your email</p>
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline"
                        onClick={() => setShowForgotPassword(true)}
                      >
                        Forgot password?
                      </button>
                    </div>
                  </form>
                </TabsContent>
                <TabsContent value="signup">
                  <form onSubmit={handleSignUp} className="space-y-4">
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input name="name" placeholder="Full Name" required className="pl-10" />
                    </div>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input name="email" type="email" placeholder="Email" required className="pl-10" />
                    </div>
                    <div>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          name="password"
                          type="password"
                          placeholder="Password"
                          required
                          value={signupPassword}
                          onChange={(e) => setSignupPassword(e.target.value)}
                          className="pl-10"
                        />
                      </div>
                      {signupPassword && signupErrors.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5">
                          {signupErrors.map((err, i) => (
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
                          name="confirmPassword"
                          type="password"
                          placeholder="Confirm Password"
                          required
                          value={signupConfirm}
                          onChange={(e) => setSignupConfirm(e.target.value)}
                          className="pl-10"
                        />
                      </div>
                      {signupConfirm && !signupMatch && (
                        <p className="text-xs text-destructive mt-1">Passwords do not match</p>
                      )}
                    </div>
                    <Button
                      type="submit"
                      className="w-full h-11"
                      disabled={loading || signupErrors.length > 0 || !signupMatch || !signupPassword}
                    >
                      {loading ? (
                        <span className="flex items-center gap-2">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                          Creating account...
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <UserPlus className="h-4 w-4" /> Create Account
                        </span>
                      )}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
