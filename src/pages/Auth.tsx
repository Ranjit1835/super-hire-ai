import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { APP_BASE_URL, APPLE_OAUTH_ENABLED } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
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

      // Client-side cooldown after 5 failed attempts
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
    <div className="min-h-screen flex items-center justify-center gradient-bg px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <Card className="glass-neon shadow-xl">
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
                    ) : "Send Reset Link"}
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

                {/* SIGN IN TAB */}
                <TabsContent value="signin">
                  {/* OAuth Buttons */}
                  <div className="space-y-2 mb-4">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-10 gap-2"
                      onClick={handleGoogleSignIn}
                      disabled={oauthLoading !== null}
                    >
                      {oauthLoading === "google" ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                      ) : <GoogleIcon />}
                      Continue with Google
                    </Button>
                    {APPLE_OAUTH_ENABLED && (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full h-10 gap-2"
                        onClick={handleAppleSignIn}
                        disabled={oauthLoading !== null}
                      >
                        {oauthLoading === "apple" ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                        ) : <AppleIcon />}
                        Continue with Apple
                      </Button>
                    )}
                  </div>

                  <div className="relative mb-4">
                    <Separator />
                    <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                      or sign in with email
                    </span>
                  </div>

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
                    {isCoolingDown && (
                      <p className="text-xs text-muted-foreground text-center">
                        Too many attempts. Wait {cooldownRemaining}s before trying again.
                      </p>
                    )}
                    <Button type="submit" className="w-full h-11" disabled={loading || isCoolingDown}>
                      {loading ? (
                        <span className="flex items-center gap-2">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                          Signing in...
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <LogIn className="h-4 w-4" /> Sign In
                        </span>
                      )}
                    </Button>
                    <div className="flex justify-end">
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

                {/* SIGN UP TAB */}
                <TabsContent value="signup">
                  {/* OAuth for signup */}
                  <div className="space-y-2 mb-4">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-10 gap-2"
                      onClick={handleGoogleSignIn}
                      disabled={oauthLoading !== null}
                    >
                      {oauthLoading === "google" ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                      ) : <GoogleIcon />}
                      Sign up with Google
                    </Button>
                  </div>

                  <div className="relative mb-4">
                    <Separator />
                    <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                      or create account with email
                    </span>
                  </div>

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
                    <p className="text-xs text-muted-foreground text-center">
                      A verification link will be sent to your email
                    </p>
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
