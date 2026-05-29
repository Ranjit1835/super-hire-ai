import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Lock, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { AnimatedGradientMesh, SparkleParticles } from "@/components/premium";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 30;
const OTP_EXPIRY = 5 * 60;

export default function OtpVerification() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN);
  const [expiryCountdown, setExpiryCountdown] = useState(OTP_EXPIRY);
  const [locked, setLocked] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const email = location.state?.email;
  const password = location.state?.password;
  const maskedEmail = location.state?.maskedEmail;
  const returnTo = location.state?.returnTo;
  const guestToken = location.state?.guestToken;
  const isSignupVerification = location.state?.isSignupVerification === true;

  useEffect(() => {
    if (!email || !password || !isSignupVerification) {
      navigate("/auth", { replace: true });
    }
  }, [email, password, isSignupVerification, navigate]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  useEffect(() => {
    if (expiryCountdown <= 0) return;
    const t = setInterval(() => setExpiryCountdown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [expiryCountdown]);

  const handleChange = useCallback((index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const digit = value.slice(-1);
    setOtp((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (digit && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }, []);

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }, [otp]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (pasted.length > 0) {
      setOtp(pasted.split("").concat(Array(OTP_LENGTH - pasted.length).fill("")));
      inputRefs.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus();
    }
  }, []);

  const handleVerify = async () => {
    const otpString = otp.join("");
    if (otpString.length !== OTP_LENGTH) {
      toast({ title: "Enter all 6 digits", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-otp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ email, password, otp: otpString }),
        }
      );
      const data = await res.json();

      if (data?.locked) {
        setLocked(true);
        toast({ title: "Account locked", description: data.error, variant: "destructive" });
        return;
      }
      if (!res.ok || data?.error) {
        toast({ title: "Verification failed", description: data?.error || "Verification failed", variant: "destructive" });
        setOtp(Array(OTP_LENGTH).fill(""));
        inputRefs.current[0]?.focus();
        return;
      }

      if (data?.session) {
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });

        let confirmed = false;
        for (let i = 0; i < 15; i++) {
          const { data: { user: confirmedUser } } = await supabase.auth.getUser();
          if (confirmedUser) { confirmed = true; break; }
          await new Promise(r => setTimeout(r, 200));
        }

        toast({ title: "Welcome back!", description: "Successfully authenticated." });

        if (returnTo === "guest" && guestToken) {
          navigate(`/analysis/guest/${guestToken}`, { replace: true });
        } else if (returnTo === "analyze" && sessionStorage.getItem("pendingResume")) {
          navigate("/dashboard?autoAnalyze=true", { replace: true });
        } else {
          navigate("/dashboard", { replace: true });
        }
      }
    } catch (err: any) {
      const msg = err?.message || "Verification failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setResendCooldown(RESEND_COOLDOWN);
    setExpiryCountdown(OTP_EXPIRY);
    setOtp(Array(OTP_LENGTH).fill(""));
    setLocked(false);

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
        toast({ title: "Resend failed", description: data?.error || "Failed to resend", variant: "destructive" });
        return;
      }
      toast({ title: "OTP sent", description: "A new code has been sent to your email." });
    } catch {
      toast({ title: "Failed to resend", variant: "destructive" });
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (!email) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden px-4">
      <AnimatedGradientMesh />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="glass rounded-2xl shadow-2xl shadow-violet-500/10 border border-violet-500/15 overflow-hidden">
          <div className="text-center px-6 pt-8 pb-4 relative">
            <SparkleParticles count={5} colors={["#8B5CF6", "#06B6D4"]} />
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200, delay: 0.1 }}
              className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center shadow-lg shadow-violet-500/30"
            >
              <ShieldCheck className="h-7 w-7 text-white" />
            </motion.div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Verify Your Identity</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Enter the 6-digit code sent to <span className="font-medium text-violet-400">{maskedEmail || email}</span>
            </p>
          </div>

          <div className="px-6 pb-6 space-y-6">
            {/* OTP Input Boxes */}
            <div className="flex justify-center gap-2" onPaste={handlePaste}>
              {otp.map((digit, i) => (
                <motion.input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  disabled={locked || loading}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="w-12 h-14 text-center text-xl font-semibold rounded-xl border-2 border-violet-500/20 bg-white/5 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 outline-none transition-all disabled:opacity-50 text-foreground"
                />
              ))}
            </div>

            {/* Countdown */}
            <div className="text-center space-y-1">
              {expiryCountdown > 0 ? (
                <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
                  <Lock className="h-3 w-3" />
                  Code expires in <span className="font-mono font-medium text-violet-400">{formatTime(expiryCountdown)}</span>
                </p>
              ) : (
                <p className="text-sm text-red-400 font-medium">Code expired. Please resend.</p>
              )}
              {locked && (
                <p className="text-sm text-red-400 font-medium flex items-center justify-center gap-1">
                  <Lock className="h-3 w-3" /> Account temporarily locked
                </p>
              )}
            </div>

            {/* Verify Button */}
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={handleVerify}
              disabled={loading || locked || otp.join("").length !== OTP_LENGTH || expiryCountdown <= 0}
              className="w-full h-11 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Verifying...
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" /> Verify & Sign In
                </>
              )}
            </motion.button>

            {/* Resend */}
            <div className="text-center">
              <button
                onClick={handleResend}
                disabled={resendCooldown > 0 || loading}
                className="text-sm text-muted-foreground hover:text-violet-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-1 mx-auto"
              >
                <RefreshCw className={`h-3 w-3 ${resendCooldown > 0 ? "" : "animate-none"}`} />
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend Code"}
              </button>
            </div>

            <div className="text-center">
              <button
                onClick={() => navigate("/auth")}
                className="text-xs text-muted-foreground/60 hover:text-violet-400 transition-colors"
              >
                &larr; Back to Sign In
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
