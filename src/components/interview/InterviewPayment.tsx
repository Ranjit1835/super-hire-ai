import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Lock, Loader2, Mic } from "lucide-react";
import { motion } from "framer-motion";

declare global {
  interface Window {
    Razorpay: any;
  }
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface Props {
  accessInfo: any;
  userEmail: string;
  onPaymentSuccess: () => void;
}

export function InterviewPayment({ accessInfo, userEmail, onPaymentSuccess }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handlePayment = async () => {
    setLoading(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.access_token) throw new Error("Please sign in to continue");

      const createRes = await fetch(`${SUPABASE_URL}/functions/v1/create-payment-order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({ paymentType: "AI_INTERVIEW" }),
      });
      const data = await createRes.json();
      if (!createRes.ok) throw new Error(data?.error || "Failed to create order");

      if (data.alreadyUnlocked) {
        onPaymentSuccess();
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
        description: "AI Mock Interview Session",
        order_id: data.orderId,
        prefill: { email: userEmail },
        handler: async (response: any) => {
          try {
            const verifyRes = await fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.access_token}`,
                apikey: SUPABASE_KEY,
              },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });
            if (!verifyRes.ok) throw new Error("Verification failed");
            toast({ title: "Payment successful!" });
            onPaymentSuccess();
          } catch (err: any) {
            toast({ title: "Verification failed", description: err.message, variant: "destructive" });
          }
          setLoading(false);
        },
        modal: { ondismiss: () => setLoading(false) },
        theme: { color: "#ea580c" },
      };

      const rzp = new window.Razorpay(options);
      rzp.on("payment.failed", (resp: any) => {
        toast({ title: "Payment failed", description: resp.error?.description, variant: "destructive" });
        setLoading(false);
      });
      rzp.open();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-md mx-auto">
      <div className="text-center mb-8">
        <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <Mic className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">AI Mock Interview</h1>
        <p className="text-muted-foreground text-sm">
          {accessInfo?.reason === "LIMIT_REACHED"
            ? "You've used your free interviews this month."
            : "Practice with AI-powered interview simulation."}
        </p>
      </div>

      <Card className="border-2 border-border">
        <CardContent className="py-6 text-center">
          <Lock className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-bold text-lg mb-1">Unlock Interview Session</h3>
          <p className="text-sm text-muted-foreground mb-2">
            {accessInfo?.reason === "LIMIT_REACHED"
              ? "Purchase additional sessions or wait for monthly reset."
              : "Get unlimited practice with AI-powered interviews."}
          </p>
          <div className="mb-4">
            <span className="text-2xl font-bold">₹599</span>
            <Badge variant="secondary" className="ml-2 text-xs">Per Session</Badge>
          </div>
          <Button onClick={handlePayment} disabled={loading} className="w-full max-w-xs">
            {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Lock className="h-4 w-4 mr-1" />}
            {loading ? "Processing..." : "Pay ₹599 – Start Interview"}
          </Button>
          <p className="text-xs text-muted-foreground mt-3">Unlimited Plan members get 2 free sessions/month</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
