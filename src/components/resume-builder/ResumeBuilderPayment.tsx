import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Lock, Download, CheckCircle2, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useCurrency } from "@/hooks/useCurrency";

declare global {
  interface Window {
    Razorpay: any;
  }
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface Props {
  resumeBuilderId: string;
  isPaid: boolean;
  onPaymentSuccess: () => void;
  onDownload: () => void;
  userEmail?: string;
}

export function ResumeBuilderPayment({ resumeBuilderId, isPaid, onPaymentSuccess, onDownload, userEmail }: Props) {
  const { toast } = useToast();
  const { currency, pricing } = useCurrency();
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
        body: JSON.stringify({
          paymentType: "RESUME_BUILD",
          resumeBuilderId,
          currency,
        }),
      });
      const data = await createRes.json();
      if (!createRes.ok) throw new Error(data?.error || "Failed to create payment order");

      if (data.alreadyUnlocked) {
        toast({ title: "Already unlocked!" });
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
        description: "Resume Builder – Download Unlock",
        order_id: data.orderId,
        prefill: { email: userEmail || "" },
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
            const verifyData = await verifyRes.json();
            if (!verifyRes.ok) throw new Error(verifyData?.error || "Payment verification failed");

            toast({ title: "Payment successful! You can now download your resume." });
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
        toast({ title: "Payment failed", description: resp.error?.description || "Please try again", variant: "destructive" });
        setLoading(false);
      });
      rzp.open();
    } catch (err: any) {
      toast({ title: "Payment error", description: err.message, variant: "destructive" });
      setLoading(false);
    }
  };

  if (isPaid) {
    return (
      <Card className="border-2 border-primary/30 bg-primary/5">
        <CardContent className="py-6 text-center">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring" }}>
            <CheckCircle2 className="h-10 w-10 text-primary mx-auto mb-3" />
          </motion.div>
          <h3 className="font-bold text-lg mb-1">Resume Unlocked!</h3>
          <p className="text-sm text-muted-foreground mb-4">Download your ATS-optimized resume</p>
          <Button onClick={onDownload} className="w-full max-w-xs">
            <Download className="h-4 w-4 mr-2" /> Download Resume (PDF)
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-border">
      <CardContent className="py-6 text-center">
        <Lock className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <h3 className="font-bold text-lg mb-1">Unlock Resume Download</h3>
        <p className="text-sm text-muted-foreground mb-2">Preview is available. Pay to download the full PDF.</p>
        <div className="mb-4">
          <span className="text-2xl font-bold">{pricing.RESUME_BUILD.display}</span>
          <Badge variant="secondary" className="ml-2 text-xs">One-time</Badge>
        </div>
        <Button onClick={handlePayment} disabled={loading} className="w-full max-w-xs">
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Lock className="h-4 w-4 mr-1" />}
          {loading ? "Processing..." : `Unlock Resume Download – ${pricing.RESUME_BUILD.display}`}
        </Button>
      </CardContent>
    </Card>
  );
}
