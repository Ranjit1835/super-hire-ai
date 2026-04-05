import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trophy, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

interface LeaderboardOptInProps {
  analysisId: string;
  score: number;
}

export function LeaderboardOptIn({ analysisId, score }: LeaderboardOptInProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [college, setCollege] = useState("");
  const [roleTarget, setRoleTarget] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!user || !displayName.trim()) return;
    setSubmitting(true);
    await supabase.from("leaderboard_entries").upsert({
      user_id: user.id,
      analysis_id: analysisId,
      display_name: displayName.trim(),
      college: college.trim() || null,
      role_target: roleTarget.trim() || null,
      ats_score: score,
      is_public: true,
    }, { onConflict: "analysis_id" });
    setSubmitting(false);
    setDone(true);
    setTimeout(() => setOpen(false), 1200);
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2 border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10">
        <Trophy className="h-4 w-4" /> Add to Leaderboard
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="glass-neon max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-yellow-400" /> Join the Leaderboard
            </DialogTitle>
          </DialogHeader>
          {done ? (
            <div className="text-center py-6">
              <Check className="h-12 w-12 text-green-400 mx-auto mb-2" />
              <p className="font-medium">Added! Your score is live.</p>
              <Button className="mt-3" variant="outline" size="sm" onClick={() => navigate("/leaderboard")}>
                View Leaderboard
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Share your score anonymously — your real name is never shown unless you choose to.</p>
              <div>
                <label className="text-xs font-medium mb-1 block">Display Name * <span className="text-muted-foreground">(can be a nickname)</span></label>
                <Input placeholder="e.g. CSE_Fresher_2025" value={displayName} onChange={e => setDisplayName(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">College <span className="text-muted-foreground">(optional)</span></label>
                <Input placeholder="e.g. IIT Delhi" value={college} onChange={e => setCollege(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Target Role <span className="text-muted-foreground">(optional)</span></label>
                <Input placeholder="e.g. SDE-1 at FAANG" value={roleTarget} onChange={e => setRoleTarget(e.target.value)} />
              </div>
              <div className="bg-muted/30 rounded p-3 text-center">
                <span className="text-3xl font-bold">{score}</span>
                <span className="text-muted-foreground text-sm">/100 ATS Score</span>
              </div>
              <Button className="w-full" onClick={submit} disabled={submitting || !displayName.trim()}>
                {submitting ? "Submitting..." : "Post to Leaderboard"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
