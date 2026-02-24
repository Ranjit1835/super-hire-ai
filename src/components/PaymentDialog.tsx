import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Zap, Crown, CheckCircle2, Loader2 } from "lucide-react";

declare global {
  interface Window {
    Razorpay: any;
  }
}

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resumeAnalysisId: string;
  userEmail?: string;
  onSuccess: () => void;
}

export default function PaymentDialog({ open, onOpenChange, resumeAnalysisId, userEmail, onSuccess }: PaymentDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ orderId: string; paymentId: string; plan: string } | null>(null);

  const handlePayment = async (paymentType: "ONE_TIME_FIX" | "EARLY_BIRD_ACCESS") => {
    setLoading(paymentType);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment-order", {
        body: { paymentType, resumeAnalysisId: paymentType === "ONE_TIME_FIX" ? resumeAnalysisId : undefined },
      });
      if (error) throw error;
      if (data.alreadyUnlocked) {
        toast({ title: "Already unlocked!" });
        onSuccess();
        return;
      }

      // Load Razorpay script if not loaded
      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://checkout.razorpay.com/v1/checkout.js";
          s.onload = () => resolve();
          s.onerror = () => reject(new Error("Failed to load Razorpay"));
          document.head.appendChild(s);
        });
      }

      const options = {
        key: data.keyId,
        amount: data.amount,
        currency: data.currency,
        name: "HireResume",
        description: paymentType === "ONE_TIME_FIX" ? "Unlock Resume Fix" : "Early Bird Access (1 Year)",
        order_id: data.orderId,
        prefill: { email: userEmail || "" },
        handler: async (response: any) => {
          try {
            const { data: verifyData, error: verifyErr } = await supabase.functions.invoke("verify-payment", {
              body: {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              },
            });
            if (verifyErr) throw verifyErr;
            setReceipt({
              orderId: response.razorpay_order_id,
              paymentId: response.razorpay_payment_id,
              plan: paymentType === "ONE_TIME_FIX" ? "Resume Fix (₹299)" : "Early Bird Access (₹1,499)",
            });
            toast({ title: "Payment successful!" });
          } catch (err: any) {
            toast({ title: "Verification failed", description: err.message, variant: "destructive" });
          }
          setLoading(null);
        },
        modal: {
          ondismiss: () => setLoading(null),
        },
        theme: { color: "#6366f1" },
      };

      const rzp = new window.Razorpay(options);
      rzp.on("payment.failed", (resp: any) => {
        toast({ title: "Payment failed", description: resp.error?.description || "Please try again", variant: "destructive" });
        setLoading(null);
      });
      rzp.open();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setLoading(null);
    }
  };

  if (receipt) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" /> Payment Successful
            </DialogTitle>
            <DialogDescription>Your payment has been verified.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Order ID</span><span className="font-mono text-xs">{receipt.orderId}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Payment ID</span><span className="font-mono text-xs">{receipt.paymentId}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Plan</span><span className="font-medium">{receipt.plan}</span></div>
          </div>
          <Button className="w-full mt-4" onClick={() => { setReceipt(null); onSuccess(); }}>
            Continue to Fix Resume
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Unlock Resume Fix</DialogTitle>
          <DialogDescription>Choose a plan to fix your resume with AI</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 mt-2">
          <Card className="border-2 hover:border-primary/50 transition-colors cursor-pointer" onClick={() => !loading && handlePayment("ONE_TIME_FIX")}>
            <CardContent className="flex items-start gap-4 py-5">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Zap className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">Unlock This Resume Fix</p>
                  <span className="text-lg font-bold">₹299</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">One-time payment for this resume only. No expiry.</p>
              </div>
              {loading === "ONE_TIME_FIX" && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
            </CardContent>
          </Card>
          <Card className="border-2 border-primary/30 bg-primary/5 hover:border-primary/60 transition-colors cursor-pointer relative" onClick={() => !loading && handlePayment("EARLY_BIRD_ACCESS")}>
            <Badge className="absolute -top-2.5 right-4 bg-primary text-primary-foreground text-xs">BEST VALUE</Badge>
            <CardContent className="flex items-start gap-4 py-5">
              <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                <Crown className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">Early Bird Access</p>
                  <span className="text-lg font-bold">₹1,499<span className="text-xs font-normal text-muted-foreground">/year</span></span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">Unlimited resume fixes + premium features for 365 days.</p>
              </div>
              {loading === "EARLY_BIRD_ACCESS" && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
