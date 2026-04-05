import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, Gift, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface ReferralInfo {
  referral_code: string;
  referral_credits: number;
  referral_count: number;
  successful_count: number;
}

export function ReferralWidget() {
  const { user } = useAuth();
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.functions.invoke("referral", {
      body: { action: "get_referral_info", user_id: user.id }
    }).then(({ data, error }) => {
      if (error) console.error("Referral widget error:", error);
      if (data) setInfo(data);
    });
  }, [user]);

  const referralUrl = info
    ? `https://hiresume.in/?ref=${info.referral_code}&utm_source=referral&utm_medium=personal`
    : "";

  const copyLink = () => {
    navigator.clipboard.writeText(referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareWhatsApp = () => {
    const msg = `Hey! I've been using HireResume to improve my ATS score — it's amazing for the Indian job market! Sign up with my link and check your resume free 🚀\n${referralUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  if (!info) return null;

  return (
    <Card className="border border-purple-500/20 bg-card/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Gift className="h-4 w-4 text-purple-400" />
          Refer &amp; Earn Free Resume Fix
        </CardTitle>
        <p className="text-xs text-muted-foreground">Share your link. When a friend runs their first analysis, you both win — you get a free resume fix credit.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Stats row */}
        <div className="flex gap-4">
          <div className="text-center">
            <div className="text-xl font-bold text-purple-400">{info.referral_count}</div>
            <div className="text-xs text-muted-foreground">Referred</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-green-400">{info.successful_count}</div>
            <div className="text-xs text-muted-foreground">Activated</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-yellow-400">{info.referral_credits}</div>
            <div className="text-xs text-muted-foreground">Credits</div>
          </div>
        </div>

        {info.referral_credits > 0 && (
          <Badge variant="secondary" className="bg-green-500/10 text-green-400 border-green-500/30">
            🎉 You have {info.referral_credits} free fix credit{info.referral_credits > 1 ? "s" : ""}!
          </Badge>
        )}

        {/* Referral link */}
        <div className="flex gap-2">
          <div className="flex-1 text-xs bg-muted/50 border border-border rounded px-2 py-1.5 font-mono truncate text-muted-foreground">
            {referralUrl}
          </div>
          <Button variant="outline" size="sm" onClick={copyLink} className="shrink-0 gap-1">
            {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>

        <Button variant="outline" size="sm" onClick={shareWhatsApp} className="w-full gap-2 border-green-500/30 text-green-400 hover:bg-green-500/10">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          Share on WhatsApp
        </Button>
      </CardContent>
    </Card>
  );
}
