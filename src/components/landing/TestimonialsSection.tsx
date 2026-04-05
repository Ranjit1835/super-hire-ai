import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Star, TrendingUp } from "lucide-react";

const testimonials = [
  {
    name: "Priya Sharma",
    role: "Software Engineer",
    company: "Freshly placed at a product startup",
    avatar: "PS",
    color: "bg-purple-500",
    before: 38,
    after: 81,
    text: "My resume had a 38 ATS score and I kept getting ghosted. After HireResume fixed it, my score jumped to 81. Got 3 interview calls in the same week I started applying.",
    tag: "Software Engineering",
  },
  {
    name: "Rahul Mehta",
    role: "MBA Graduate",
    company: "Now at a top consulting firm",
    avatar: "RM",
    color: "bg-blue-500",
    before: 52,
    after: 89,
    text: "I had no idea my resume was failing ATS scans. The keyword analysis was an eye-opener. The AI rewrite was genuinely better than what I had — more specific and impactful.",
    tag: "MBA / Consulting",
  },
  {
    name: "Ananya Reddy",
    role: "Data Analyst",
    company: "Fresher, placed within 45 days",
    avatar: "AR",
    color: "bg-teal-500",
    before: 29,
    after: 74,
    text: "As a fresher I had no idea what ATS even was. HireResume told me exactly what was wrong and fixed it for ₹149 (student price). Got my first job within 6 weeks. Totally worth it.",
    tag: "Fresher / Data",
  },
  {
    name: "Karthik Nair",
    role: "DevOps Engineer",
    company: "Transitioned from IT support",
    avatar: "KN",
    color: "bg-green-500",
    before: 45,
    after: 83,
    text: "Was switching careers and my resume wasn't reflecting my new skills properly. The AI interview practice helped me figure out how to talk about my experience better. Both products are gold.",
    tag: "Career Switch",
  },
  {
    name: "Deepika Agarwal",
    role: "Product Manager",
    company: "IIM graduate, placed at a unicorn",
    avatar: "DA",
    color: "bg-rose-500",
    before: 61,
    after: 92,
    text: "Even with a good resume I was at 61. Didn't know keywords mattered this much. After HireResume, I hit 92 and got shortlisted at 4 companies I had been applying to for months.",
    tag: "Product Management",
  },
  {
    name: "Vikram Singh",
    role: "Frontend Developer",
    company: "2 YOE, placed at a funded startup",
    avatar: "VS",
    color: "bg-amber-500",
    before: 43,
    after: 78,
    text: "The recruiter scan simulation was the most useful thing — it showed exactly what a recruiter sees in 6 seconds. Completely changed how I structured my resume.",
    tag: "Frontend / React",
  },
];

function Stars() {
  return (
    <div className="flex gap-0.5">
      {[...Array(5)].map((_, i) => (
        <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
      ))}
    </div>
  );
}

export function TestimonialsSection() {
  return (
    <section className="py-16 sm:py-20 px-4 border-y border-border bg-secondary/10" id="testimonials">
      <div className="container max-w-6xl">
        <div className="text-center mb-12">
          <Badge className="mb-3 bg-primary/10 text-primary border-primary/20 text-xs">Real Users, Real Results</Badge>
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">Job Seekers Who Got More Callbacks</h2>
          <p className="text-muted-foreground text-sm max-w-xl mx-auto">
            Over 1,200 resumes analyzed. Here's what real users say after using HireResume.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {testimonials.map((t, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
            >
              <Card className="glass h-full flex flex-col hover:border-primary/30 transition-colors duration-200">
                <CardContent className="pt-5 pb-5 flex flex-col flex-1">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`h-10 w-10 rounded-full ${t.color} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                        {t.avatar}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{t.name}</p>
                        <p className="text-xs text-muted-foreground">{t.role}</p>
                      </div>
                    </div>
                    <Stars />
                  </div>

                  {/* Score change */}
                  <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-success/5 border border-success/20">
                    <div className="text-center">
                      <p className="text-xl font-black text-destructive">{t.before}</p>
                      <p className="text-[10px] text-muted-foreground">Before</p>
                    </div>
                    <TrendingUp className="h-4 w-4 text-success flex-1 mx-1" />
                    <div className="text-center">
                      <p className="text-xl font-black text-success">{t.after}</p>
                      <p className="text-[10px] text-muted-foreground">After</p>
                    </div>
                    <div className="ml-2 text-center">
                      <p className="text-sm font-bold text-success">+{t.after - t.before}</p>
                      <p className="text-[10px] text-muted-foreground">points</p>
                    </div>
                  </div>

                  {/* Quote */}
                  <p className="text-sm text-muted-foreground leading-relaxed flex-1">"{t.text}"</p>

                  {/* Footer */}
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/40">
                    <p className="text-xs text-muted-foreground">{t.company}</p>
                    <Badge variant="outline" className="text-[10px] px-1.5">{t.tag}</Badge>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <div className="text-center mt-10">
          <p className="text-sm text-muted-foreground">
            ⭐ Average rating <span className="font-bold text-foreground">4.8/5</span> from 312 users &nbsp;·&nbsp;
            <span className="font-bold text-success">+44 points</span> average ATS score improvement
          </p>
        </div>
      </div>
    </section>
  );
}
