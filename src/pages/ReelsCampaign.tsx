import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { Play, Upload } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { PublicNavbar } from "@/components/PublicNavbar";
import { PublicFooter } from "@/components/PublicFooter";

const STEPS = [
  { n: "01", title: "Upload your resume on hiresume.in", desc: "Takes 30 seconds. Paste the link or upload PDF." },
  { n: "02", title: "Screenshot your ATS score", desc: "The big number — your honest recruiter score." },
  { n: "03", title: "Record a 30-second Reel", desc: "\"I scored X/100 — here's what the AI told me to fix.\"" },
  { n: "04", title: "Tag #HiResume + @hiresume.in", desc: "We feature the best ones on our socials. Top 3 win a free fix." },
];


export default function ReelsCampaign() {
  const navigate = useNavigate();

  const fadeUp = (delay = 0) => ({
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { delay },
  });

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="HiResume Reels Campaign - Share Your ATS Score & Win"
        description="Record a 30-second Reel with your ATS resume score, tag #HiResume, and win a free resume fix. Join the challenge!"
        path="/reels-campaign"
        noindex={true}
      />
      <PublicNavbar />

      <main>
        {/* Hero */}
        <section className="gradient-bg pt-24 sm:pt-28 pb-20 px-4 text-center">
          <motion.div {...fadeUp(0)} className="max-w-2xl mx-auto">
            <Badge className="mb-4 bg-pink-500/20 text-pink-400 border-pink-500/30 text-sm">
              🎬 Trending on Instagram &amp; TikTok
            </Badge>
            <h1 className="text-4xl sm:text-5xl font-bold mb-6 leading-tight">
              Rate Your Resume<br />
              <span className="gradient-text-new">Go Viral. Get Hired.</span>
            </h1>
            <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
              Thousands of Indian job seekers are sharing their ATS scores on Reels. Are you next? Check your score, record a Reel, and win a free AI fix.
            </p>
            <div className="flex flex-wrap gap-4 justify-center">
              <Button size="lg" onClick={() => navigate("/dashboard")} className="gap-2">
                <Upload className="h-5 w-5" /> Check My Score Free
              </Button>
              <Button size="lg" variant="outline" onClick={() => window.open("https://www.instagram.com/explore/tags/hiresume", "_blank")} className="gap-2">
                <Play className="h-5 w-5" /> Watch #HiResume Reels
              </Button>
            </div>
            <div className="flex flex-wrap gap-8 justify-center mt-12 text-sm text-muted-foreground">
              <div><span className="text-2xl font-bold text-foreground">2.4M+</span><br />Reel views</div>
              <div><span className="text-2xl font-bold text-foreground">18K+</span><br />Participants</div>
              <div><span className="text-2xl font-bold text-foreground">₹299</span><br />Prize per week</div>
            </div>
          </motion.div>
        </section>

        {/* How to Participate */}
        <section className="py-16 px-4">
          <div className="container max-w-3xl">
            <motion.div {...fadeUp(0.1)} className="text-center mb-10">
              <h2 className="text-3xl font-bold mb-3">How to Join the Challenge</h2>
              <p className="text-muted-foreground">4 steps. 30 seconds. Potentially viral.</p>
            </motion.div>
            <div className="space-y-4">
              {STEPS.map((step, i) => (
                <motion.div key={step.n} {...fadeUp(0.05 * i)}>
                  <Card className="glass-neon">
                    <CardContent className="flex items-center gap-4 py-4">
                      <div className="text-4xl font-black text-primary/30 shrink-0 w-12 text-center">{step.n}</div>
                      <div>
                        <p className="font-semibold">{step.title}</p>
                        <p className="text-sm text-muted-foreground">{step.desc}</p>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Prize */}
        <section className="py-16 px-4">
          <div className="container max-w-xl text-center">
            <motion.div {...fadeUp(0.1)}>
              <div className="text-4xl mb-4">🏆</div>
              <h2 className="text-2xl font-bold mb-3">Weekly Prize: Free AI Resume Fix</h2>
              <p className="text-muted-foreground mb-6">Every Friday, we pick the top 3 most creative/inspiring Reels using <strong>#HiResume</strong>. Winners get a free AI resume fix (worth ₹299).</p>
              <div className="flex flex-wrap justify-center gap-3 mb-8">
                {["Most Inspiring Score Improvement", "Most Creative Format", "Most Relatable Story"].map(c => (
                  <Badge key={c} variant="secondary" className="border-primary/30">{c}</Badge>
                ))}
              </div>
              <Button size="lg" onClick={() => navigate("/dashboard")} className="gap-2">
                <Upload className="h-5 w-5" /> Get My Score &amp; Join
              </Button>
            </motion.div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
