import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Zap, ShieldCheck, Lock, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 30;
const OTP_EXPIRY = 5 * 60; // 5 minutes in seconds

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

  useEffect(() => {
    if (!email || !password) {
      navigate("/auth", { replace: true });
    }
  }, [email, password, navigate]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // OTP expiry countdown
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
      const { data, error } = await supabase.functions.invoke("verify-otp", {
        body: { email, password, otp: otpString },
      });

      if (error) throw error;
      if (data?.locked) {
        setLocked(true);
        toast({ title: "Account locked", description: data.error, variant: "destructive" });
        return;
      }
      if (data?.error) {
        toast({ title: "Verification failed", description: data.error, variant: "destructive" });
        setOtp(Array(OTP_LENGTH).fill(""));
        inputRefs.current[0]?.focus();
        return;
      }

      if (data?.session) {
        // Set the session in the client
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        toast({ title: "Welcome back!", description: "Successfully authenticated." });
        navigate("/dashboard", { replace: true });
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
      const { data, error } = await supabase.functions.invoke("send-otp", {
        body: { email, password },
      });
      if (error) throw error;
      if (data?.error) {
        toast({ title: "Resend failed", description: data.error, variant: "destructive" });
        return;
      }
      toast({ title: "OTP sent", description: "A new code has been sent to your email." });
      
      // In dev mode, show the OTP
      if (data?.otpCode) {
        toast({ title: "Dev Mode OTP", description: `Your code: ${data.otpCode}`, duration: 15000 });
      }
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
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <Card className="w-full max-w-md glass shadow-xl">
          <CardHeader className="text-center pb-4">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, delay: 0.1 }}
              className="mx-auto mb-3 h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center"
            >
              <ShieldCheck className="h-6 w-6 text-primary" />
            </motion.div>
            <CardTitle className="text-2xl">Verify Your Identity</CardTitle>
            <CardDescription>
              Enter the 6-digit code sent to <span className="font-medium text-foreground">{maskedEmail || email}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
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
                  className="w-12 h-14 text-center text-xl font-semibold rounded-lg border-2 border-input bg-background focus:border-primary focus:ring-2 focus:ring-ring/30 outline-none transition-all disabled:opacity-50"
                />
              ))}
            </div>

            {/* Countdown & Status */}
            <div className="text-center space-y-1">
              {expiryCountdown > 0 ? (
                <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
                  <Lock className="h-3 w-3" />
                  Code expires in <span className="font-mono font-medium text-foreground">{formatTime(expiryCountdown)}</span>
                </p>
              ) : (
                <p className="text-sm text-destructive font-medium">Code expired. Please resend.</p>
              )}
              {locked && (
                <p className="text-sm text-destructive font-medium flex items-center justify-center gap-1">
                  <Lock className="h-3 w-3" /> Account temporarily locked
                </p>
              )}
            </div>

            {/* Verify Button */}
            <Button
              className="w-full h-11"
              onClick={handleVerify}
              disabled={loading || locked || otp.join("").length !== OTP_LENGTH || expiryCountdown <= 0}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Verifying...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" /> Verify & Sign In
                </span>
              )}
            </Button>

            {/* Resend */}
            <div className="text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResend}
                disabled={resendCooldown > 0 || loading}
                className="text-sm"
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${resendCooldown > 0 ? "" : "animate-none"}`} />
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend Code"}
              </Button>
            </div>

            {/* Back to login */}
            <div className="text-center">
              <Button variant="link" size="sm" onClick={() => navigate("/auth")} className="text-muted-foreground">
                ← Back to Sign In
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
