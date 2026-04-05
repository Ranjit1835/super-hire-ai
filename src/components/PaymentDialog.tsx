import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Zap, Crown, Star, Package, CheckCircle2, Loader2, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";

declare global {
  interface Window { Razorpay: any; }
}

type PaymentType = "RESUME_FIX" | "UNLIMITED_PLAN" | "COMBO_PLAN";
type DialogStep = "select" | "confirm" | "receipt";

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resumeAnalysisId: string;
  userEmail?: string;
  onSuccess: () => void;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const PLAN_LABELS: Record<PaymentType, string> = {
  RESUME_FIX: "Unlock Resume Fix",
  COMBO_PLAN: "Combo Plan",
  UNLIMITED_PLAN: "Unlimited Plan",
};

export default function PaymentDialog({ open, onOpenChange, resumeAnalysisId, userEmail, onSuccess }: PaymentDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<DialogStep>("select");
  const [selectedPlan, setSelectedPlan] = useState<PaymentType | null>(null);
  const [loading, setLoading] = useState(false);
  const [receipt, setReceipt] = useState<{ orderId: string; paymentId: string; plan: string } | null>(null);
  const [discountInfo, setDiscountInfo] = useState<{ isStudent: boolean; firstFix: boolean; firstEarlyBird: boolean } | null>(null);

  useEffect(() => {
    if (!open) { setStep("select"); setSelectedPlan(null); setReceipt(null); }
  }, [open]);

  useEffect(() => {
    if (!open || !resumeAnalysisId) return;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const [resumeRes, profileRes] = await Promise.all([
          supabase.from("resume_analyses").select("resume_type").eq("id", resumeAnalysisId).single(),
          supabase.from("profiles").select("first_time_fix_used, first_time_early_bird_used").eq("user_id", user.id).single(),
        ]);
        setDiscountInfo({
          isStudent: resumeRes.data?.resume_type === "STUDENT",
          firstFix: !profileRes.data?.first_time_fix_used,
          firstEarlyBird: !profileRes.data?.first_time_early_bird_used,
        });
      } catch { setDiscountInfo(null); }
    })();
  }, [open, resumeAnalysisId]);

  const getFixPrice = () => {
    if (discountInfo?.isStudent && discountInfo?.firstFix) return { price: "₹149", original: "₹299", discount: true };
    return { price: "₹299", original: null, discount: false };
  };

  const getPlanPrice = (type: PaymentType) => {
    if (type === "RESUME_FIX") return getFixPrice();
    if (type === "COMBO_PLAN") return { price: "₹899", original: null, discount: false };
    if (type === "UNLIMITED_PLAN") return { price: "₹1,999", original: null, discount: false };
    return { price: "₹299", original: null, discount: false };
  };

  const handleSelectPlan = (plan: PaymentType) => {
    setSelectedPlan(plan);
    setStep("confirm");
  };

  const handlePayment = async () => {
    if (!selectedPlan) return;
    setLoading(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.access_token) throw new Error("Please sign in to continue");

      const createRes = await fetch(`${SUPABASE_URL}/functions/v1/create-payment-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY },
        body: JSON.stringify({
          paymentType: selectedPlan,
          resumeAnalysisId: selectedPlan === "RESUME_FIX" ? resumeAnalysisId : undefined,
        }),
      });
      const data = await createRes.json();
      if (!createRes.ok) throw new Error(data?.error || "Failed to create payment order");

      if (data.alreadyUnlocked) {
        toast({ title: "Already unlocked!" });
        onSuccess();
        return;
      }

      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://checkout.razorpay.com/v1/checkout.js";
          s.onload = () => resolve();
          s.onerror = () => reject(new Error("Failed to load payment gateway."));
          document.head.appendChild(s);
        });
      }

      const options = {
        key: data.keyId,
        amount: data.amount,
        currency: data.currency,
        name: "HireResume",
        description: PLAN_LABELS[selectedPlan],
        order_id: data.orderId,
        prefill: { email: userEmail || "" },
        handler: async (response: any) => {
          try {
            const verifyRes = await fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });
            const verifyData = await verifyRes.json();
            if (!verifyRes.ok) throw new Error(verifyData?.error || "Payment verification failed");

            setReceipt({
              orderId: response.razorpay_order_id,
              paymentId: response.razorpay_payment_id,
              plan: `${PLAN_LABELS[selectedPlan!]} (₹${data.amount / 100})`,
            });
            setStep("receipt");
            toast({ title: "Payment successful!" });
          } catch (err: any) {
            toast({ title: "Verification failed", description: err.message, variant: "destructive" });
          }
          setLoading(false);
        },
        modal: { ondismiss: () => setLoading(false) },
        theme: { color: "#6366f1" },
      };

      const rzp = new window.Razorpay(options);
      rzp.on("payment.failed", (resp: any) => {
        toast({ title: "Payment failed", description: resp.error?.description || "Please try again", variant: "destructive" });
        setLoading(false);
      });
      rzp.open();
    } catch (err: any) {
      toast({ title: "Payment error", description: err.message, variant: "destructive" });
      setLoading(false);
    }
  };

  const fixPrice = getFixPrice();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">

        {/* STEP: RECEIPT */}
        {step === "receipt" && receipt && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300 }}>
                  <CheckCircle2 className="h-5 w-5 text-success" />
                </motion.div>
                Payment Successful
              </DialogTitle>
              <DialogDescription>Your payment has been verified.</DialogDescription>
            </DialogHeader>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Order ID</span><span className="font-mono text-xs">{receipt.orderId}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Payment ID</span><span className="font-mono text-xs">{receipt.paymentId}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Plan</span><span className="font-medium">{receipt.plan}</span></div>
            </motion.div>
            <Button className="w-full mt-4" onClick={() => { setStep("select"); onSuccess(); }}>
              Continue
            </Button>
          </>
        )}

        {/* STEP: CONFIRM */}
        {step === "confirm" && selectedPlan && (
          <>
            <DialogHeader>
              <DialogTitle>Confirm Payment</DialogTitle>
              <DialogDescription>Review your order before proceeding.</DialogDescription>
            </DialogHeader>
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 mt-2">
              <Card className="border-2 border-primary/30 bg-primary/5">
                <CardContent className="py-4 flex justify-between items-center">
                  <div>
                    <p className="font-semibold">{PLAN_LABELS[selectedPlan]}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {selectedPlan === "RESUME_FIX" && "One-time unlock for this resume"}
                      {selectedPlan === "COMBO_PLAN" && "Resume Fix + AI Interview session"}
                      {selectedPlan === "UNLIMITED_PLAN" && "3 builds + 2 interviews/month for 1 year"}
                    </p>
                  </div>
                  <span className="text-xl font-bold">{getPlanPrice(selectedPlan).price}</span>
                </CardContent>
              </Card>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setStep("select")} disabled={loading}>
                  <ArrowLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                <Button className="flex-1" onClick={handlePayment} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                  {loading ? "Processing..." : `Confirm & Pay ${getPlanPrice(selectedPlan).price}`}
                </Button>
              </div>
            </motion.div>
          </>
        )}

        {/* STEP: SELECT PLAN */}
        {step === "select" && (
          <>
            <DialogHeader>
              <DialogTitle>Unlock Resume Fix</DialogTitle>
              <DialogDescription>Choose a plan to fix your resume with AI</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 mt-2">
              {/* Resume Fix */}
              <Card className="border-2 hover:border-primary/50 transition-all duration-200 cursor-pointer hover:shadow-md hover:-translate-y-0.5" onClick={() => handleSelectPlan("RESUME_FIX")}>
                <CardContent className="flex items-start gap-4 py-4">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Zap className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">Resume Fix Only</p>
                      <div className="text-right">
                        {fixPrice.discount && fixPrice.original && <span className="text-sm text-muted-foreground line-through mr-2">{fixPrice.original}</span>}
                        <span className="text-lg font-bold">{fixPrice.price}</span>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">One-time payment for this resume only.</p>
                    {fixPrice.discount && <Badge className="mt-1.5 bg-success/20 text-success border-success/30 text-xs">🎓 Student Discount Applied</Badge>}
                  </div>
                </CardContent>
              </Card>

              {/* Combo Plan */}
              <Card className="border-2 hover:border-primary/50 transition-all duration-200 cursor-pointer hover:shadow-md hover:-translate-y-0.5" onClick={() => handleSelectPlan("COMBO_PLAN")}>
                <CardContent className="flex items-start gap-4 py-4">
                  <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                    <Package className="h-5 w-5 text-blue-500" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">Combo Plan</p>
                      <span className="text-lg font-bold">₹899</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">Resume Fix + AI Interview session.</p>
                  </div>
                </CardContent>
              </Card>

              {/* Unlimited Plan */}
              <Card className="border-2 border-primary/30 bg-primary/5 hover:border-primary/60 transition-all duration-200 cursor-pointer relative hover:shadow-md hover:-translate-y-0.5" onClick={() => handleSelectPlan("UNLIMITED_PLAN")}>
                <Badge className="absolute -top-2.5 right-4 bg-primary text-primary-foreground text-xs">BEST VALUE</Badge>
                <CardContent className="flex items-start gap-4 py-4">
                  <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                    <Crown className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">Unlimited Plan</p>
                      <span className="text-lg font-bold">₹1,999<span className="text-xs font-normal text-muted-foreground">/year</span></span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">3 resume builds + 2 interviews/month for 365 days.</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Separator className="my-1" />
            <p className="text-xs text-center text-muted-foreground">Secured by Razorpay · All prices inclusive of taxes</p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
