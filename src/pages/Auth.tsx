import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { APP_BASE_URL, APPLE_OAUTH_ENABLED } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Zap, LogIn, UserPlus, Mail, Lock, User, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { AnimatedGradientMesh, SparkleParticles } from "@/components/premium";
import { SEOHead } from "@/components/SEOHead";

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

// Google SVG icon
const GoogleIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

// Apple SVG icon
const AppleIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
  </svg>
);

export default function Auth() {
  const { signUp, signIn, signInWithGoogle, signInWithApple, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | "apple" | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [cooldownEnd, setCooldownEnd] = useState<number | null>(null);
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirm, setSignupConfirm] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  const returnTo = searchParams.get("returnTo");
  const guestToken = searchParams.get("guestToken");
  const redirect = searchParams.get("redirect");

  if (user) {
    if (redirect) {
      navigate(redirect, { replace: true });
    } else if (returnTo === "guest" && guestToken) {
      navigate(`/analysis/guest/${guestToken}`, { replace: true });
    } else if (returnTo === "analyze" && sessionStorage.getItem("pendingResume")) {
      navigate("/dashboard?autoAnalyze=true", { replace: true });
    } else {
      navigate("/dashboard", { replace: true });
    }
    return null;
  }

  const isCoolingDown = cooldownEnd !== null && Date.now() < cooldownEnd;

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isCoolingDown) return;

    setLoading(true);
    setSignInError(null);
    const form = new FormData(e.currentTarget);
    const email = form.get("email") as string;
    const password = form.get("password") as string;

    const { error, code } = await signIn(email, password);
    setLoading(false);

    if (error) {
      const newAttempts = loginAttempts + 1;
      setLoginAttempts(newAttempts);
      setSignInError(error);

      if (newAttempts >= 5 && code !== "rate_limited") {
        setCooldownEnd(Date.now() + 30_000);
        setTimeout(() => setCooldownEnd(null), 30_000);
      }
      return;
    }

    setLoginAttempts(0);
    if (redirect) {
      navigate(redirect, { replace: true });
    } else if (returnTo === "guest" && guestToken) {
      navigate(`/analysis/guest/${guestToken}`, { replace: true });
    } else if (returnTo === "analyze" && sessionStorage.getItem("pendingResume")) {
      navigate("/dashboard?autoAnalyze=true", { replace: true });
    } else {
      navigate("/dashboard", { replace: true });
    }
  };

  const handleGoogleSignIn = async () => {
    setOauthLoading("google");
    await signInWithGoogle();
    setOauthLoading(null);
  };

  const handleAppleSignIn = async () => {
    if (!APPLE_OAUTH_ENABLED) return;
    setOauthLoading("apple");
    await signInWithApple();
    setOauthLoading(null);
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
      toast({ title: "Check your email", description: "We sent you a confirmation link to verify your account." });
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) return;
    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: `${APP_BASE_URL}/reset-password`,
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

  const cooldownRemaining = cooldownEnd ? Math.ceil((cooldownEnd - Date.now()) / 1000) : 0;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden px-4">
      <SEOHead
        title="Sign In to HireResume - ATS Resume Checker & AI Interview Platform"
        description="Sign in or create your free HireResume account. Access AI resume analysis, resume builder, and mock interview tools."
        path="/auth"
        noindex={true}
      />
      <AnimatedGradientMesh />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="glass rounded-2xl shadow-2xl shadow-violet-500/10 border border-violet-500/15 overflow-hidden">
          {/* Header */}
          <div className="text-center px-6 pt-8 pb-4 relative">
            <SparkleParticles count={6} colors={["#8B5CF6", "#06B6D4"]} />
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200, delay: 0.1 }}
              className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center shadow-lg shadow-violet-500/30"
            >
              <Zap className="h-7 w-7 text-white" />
            </motion.div>
            <h1 className="text-2xl font-bold tracking-tight gradient-text-new">HireResume</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {returnTo === "guest" ? "Sign in to unlock your full analysis" : returnTo === "analyze" ? "Sign in to see your analysis results" : "Resume Intelligence Platform"}
            </p>
          </div>

          <div className="px-6 pb-6">
            {showForgotPassword ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div className="text-center mb-4">
                    <div className="h-10 w-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto mb-3">
                      <KeyRound className="h-5 w-5 text-violet-400" />
                    </div>
                    <h3 className="font-semibold text-foreground">Forgot Password?</h3>
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
                      className="pl-10 bg-white/5 border-violet-500/15 focus:border-violet-500/40"
                    />
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    type="submit"
                    disabled={forgotLoading}
                    className="w-full h-11 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all disabled:opacity-50"
                  >
                    {forgotLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Sending...
                      </span>
                    ) : "Send Reset Link"}
                  </motion.button>
                  <button
                    type="button"
                    className="w-full text-xs text-violet-400 hover:text-violet-300 py-2 transition-colors"
                    onClick={() => setShowForgotPassword(false)}
                  >
                    &larr; Back to Sign In
                  </button>
                </form>
              </motion.div>
            ) : (
              <Tabs defaultValue="signin">
                <TabsList className="grid w-full grid-cols-2 mb-4 bg-white/5 border border-violet-500/10">
                  <TabsTrigger value="signin" className="gap-1.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-600/80 data-[state=active]:to-cyan-600/80 data-[state=active]:text-white">
                    <LogIn className="h-3.5 w-3.5" /> Sign In
                  </TabsTrigger>
                  <TabsTrigger value="signup" className="gap-1.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-600/80 data-[state=active]:to-cyan-600/80 data-[state=active]:text-white">
                    <UserPlus className="h-3.5 w-3.5" /> Sign Up
                  </TabsTrigger>
                </TabsList>

                {/* SIGN IN TAB */}
                <TabsContent value="signin">
                  <div className="space-y-2 mb-4">
                    <motion.button
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      type="button"
                      className="w-full h-10 rounded-lg border border-violet-500/15 bg-white/5 hover:bg-white/10 text-sm font-medium text-foreground flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                      onClick={handleGoogleSignIn}
                      disabled={oauthLoading !== null}
                    >
                      {oauthLoading === "google" ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                      ) : <GoogleIcon />}
                      Continue with Google
                    </motion.button>
                    {APPLE_OAUTH_ENABLED && (
                      <motion.button
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        type="button"
                        className="w-full h-10 rounded-lg border border-violet-500/15 bg-white/5 hover:bg-white/10 text-sm font-medium text-foreground flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                        onClick={handleAppleSignIn}
                        disabled={oauthLoading !== null}
                      >
                        {oauthLoading === "apple" ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                        ) : <AppleIcon />}
                        Continue with Apple
                      </motion.button>
                    )}
                  </div>

                  <div className="relative mb-4">
                    <div className="h-px bg-gradient-to-r from-transparent via-violet-500/20 to-transparent" />
                    <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[rgba(20,20,35,0.8)] px-3 text-xs text-muted-foreground">
                      or sign in with email
                    </span>
                  </div>

                  <form onSubmit={handleSignIn} className="space-y-4">
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input name="email" type="email" placeholder="Email" required className="pl-10 bg-white/5 border-violet-500/15 focus:border-violet-500/40" />
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input name="password" type="password" placeholder="Password" required className="pl-10 bg-white/5 border-violet-500/15 focus:border-violet-500/40" />
                    </div>
                    {signInError && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-lg bg-red-500/10 border border-red-500/20 p-3"
                      >
                        <p className="text-sm text-red-400 font-medium">{signInError}</p>
                        <button
                          type="button"
                          className="text-xs text-violet-400 hover:text-violet-300 mt-1 transition-colors"
                          onClick={() => { setShowForgotPassword(true); setSignInError(null); }}
                        >
                          Forgot your password?
                        </button>
                      </motion.div>
                    )}
                    {isCoolingDown && (
                      <p className="text-xs text-muted-foreground text-center">
                        Too many attempts. Wait {cooldownRemaining}s before trying again.
                      </p>
                    )}
                    <motion.button
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      type="submit"
                      disabled={loading || isCoolingDown}
                      className="w-full h-11 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {loading ? (
                        <>
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          Signing in...
                        </>
                      ) : (
                        <>
                          <LogIn className="h-4 w-4" /> Sign In
                        </>
                      )}
                    </motion.button>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                        onClick={() => setShowForgotPassword(true)}
                      >
                        Forgot password?
                      </button>
                    </div>
                  </form>
                </TabsContent>

                {/* SIGN UP TAB */}
                <TabsContent value="signup">
                  <div className="space-y-2 mb-4">
                    <motion.button
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      type="button"
                      className="w-full h-10 rounded-lg border border-violet-500/15 bg-white/5 hover:bg-white/10 text-sm font-medium text-foreground flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                      onClick={handleGoogleSignIn}
                      disabled={oauthLoading !== null}
                    >
                      {oauthLoading === "google" ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                      ) : <GoogleIcon />}
                      Sign up with Google
                    </motion.button>
                  </div>

                  <div className="relative mb-4">
                    <div className="h-px bg-gradient-to-r from-transparent via-violet-500/20 to-transparent" />
                    <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[rgba(20,20,35,0.8)] px-3 text-xs text-muted-foreground">
                      or create account with email
                    </span>
                  </div>

                  <form onSubmit={handleSignUp} className="space-y-4">
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input name="name" placeholder="Full Name" required className="pl-10 bg-white/5 border-violet-500/15 focus:border-violet-500/40" />
                    </div>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input name="email" type="email" placeholder="Email" required className="pl-10 bg-white/5 border-violet-500/15 focus:border-violet-500/40" />
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
                          className="pl-10 bg-white/5 border-violet-500/15 focus:border-violet-500/40"
                        />
                      </div>
                      {signupPassword && signupErrors.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5">
                          {signupErrors.map((err, i) => (
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
                          name="confirmPassword"
                          type="password"
                          placeholder="Confirm Password"
                          required
                          value={signupConfirm}
                          onChange={(e) => setSignupConfirm(e.target.value)}
                          className="pl-10 bg-white/5 border-violet-500/15 focus:border-violet-500/40"
                        />
                      </div>
                      {signupConfirm && !signupMatch && (
                        <p className="text-xs text-red-400 mt-1">Passwords do not match</p>
                      )}
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      type="submit"
                      disabled={loading || signupErrors.length > 0 || !signupMatch || !signupPassword}
                      className="w-full h-11 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {loading ? (
                        <>
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          Creating account...
                        </>
                      ) : (
                        <>
                          <UserPlus className="h-4 w-4" /> Create Account
                        </>
                      )}
                    </motion.button>
                    <p className="text-xs text-muted-foreground/60 text-center">
                      A verification link will be sent to your email
                    </p>
                  </form>
                </TabsContent>
              </Tabs>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
