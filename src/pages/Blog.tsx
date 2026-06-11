import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Zap, ArrowLeft, ArrowRight, Clock, BookOpen } from "lucide-react";
import { motion } from "framer-motion";
import { AnimatedGradientMesh } from "@/components/premium";
import { SEOHead } from "@/components/SEOHead";

const ARTICLES = [
  {
    slug: "what-is-ats-resume",
    category: "ATS Basics",
    title: "What Is an ATS Resume? Everything You Need to Know in 2026",
    excerpt: "Applicant Tracking Systems reject 75% of resumes before a human sees them. Learn exactly what ATS software looks for, how it parses your resume, and what you can do to pass the filter.",
    readTime: "8 min read",
    date: "Coming Soon",
  },
  {
    slug: "ats-friendly-resume-format",
    category: "Resume Tips",
    title: "The Perfect ATS-Friendly Resume Format (With Examples)",
    excerpt: "Tables, columns, and graphics kill your ATS score. Here's the exact resume format that passes every major ATS system — Workday, Greenhouse, Lever, and more.",
    readTime: "6 min read",
    date: "Coming Soon",
  },
  {
    slug: "resume-keywords-optimization",
    category: "Keywords",
    title: "How to Optimize Resume Keywords for Any Job Description",
    excerpt: "A step-by-step guide to identifying the right keywords from a job posting and naturally weaving them into your resume — without keyword stuffing.",
    readTime: "7 min read",
    date: "Coming Soon",
  },
  {
    slug: "ai-mock-interview-guide",
    category: "Interviews",
    title: "How to Use AI Mock Interviews to Prepare for Your Next Job",
    excerpt: "AI interview tools can simulate real job interviews with role-specific questions. Here's how to get the most out of mock interview practice.",
    readTime: "5 min read",
    date: "Coming Soon",
  },
  {
    slug: "resume-mistakes-getting-rejected",
    category: "Common Mistakes",
    title: "10 Resume Mistakes That Get You Rejected by ATS (and How to Fix Them)",
    excerpt: "From missing keywords to bad formatting — these are the most common reasons resumes get auto-rejected, and exactly how to fix each one.",
    readTime: "9 min read",
    date: "Coming Soon",
  },
  {
    slug: "fresher-resume-guide",
    category: "For Students",
    title: "Resume Writing Guide for Freshers: How to Stand Out With No Experience",
    excerpt: "No work experience? No problem. Learn how to write a compelling resume using academic projects, internships, skills, and certifications.",
    readTime: "7 min read",
    date: "Coming Soon",
  },
  {
    slug: "resume-action-verbs",
    category: "Resume Tips",
    title: "150+ Strong Resume Action Verbs That Impress Recruiters",
    excerpt: "Replace weak phrases like 'responsible for' with powerful action verbs that demonstrate impact. Categorized by industry and function.",
    readTime: "5 min read",
    date: "Coming Soon",
  },
  {
    slug: "quantify-resume-achievements",
    category: "Resume Tips",
    title: "How to Quantify Achievements on Your Resume (With 50+ Examples)",
    excerpt: "Numbers make recruiters stop and read. Learn the formula for turning vague bullet points into quantified impact statements that get callbacks.",
    readTime: "8 min read",
    date: "Coming Soon",
  },
];

const CATEGORIES = ["All", "ATS Basics", "Resume Tips", "Keywords", "Interviews", "Common Mistakes", "For Students"];

export default function Blog() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background relative">
      <SEOHead
        title="Blog - Resume Tips, ATS Guides & Interview Advice | HireResume"
        description="Expert resume writing tips, ATS optimization guides, keyword strategies, and interview preparation advice. Learn how to beat ATS filters and land more interviews."
        path="/blog"
        keywords="resume tips, ATS resume guide, resume writing tips, interview preparation, resume keywords, ATS optimization, job search advice, career tips"
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }]}
      />
      <AnimatedGradientMesh />

      {/* Header */}
      <nav className="fixed top-0 w-full z-50 glass-strong border-b border-border/30">
        <div className="container flex items-center justify-between h-16 px-4">
          <a href="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-lg text-foreground tracking-tight">HireResume</span>
          </a>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <ArrowLeft className="h-3 w-3 mr-1" /> Home
            </Button>
            <Button size="sm" onClick={() => navigate("/auth")}>Sign In</Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-28 sm:pt-36 pb-10 px-4 text-center relative z-10">
        <div className="container max-w-3xl">
          <Badge className="mb-4 bg-primary/10 text-primary border-primary/20">Blog</Badge>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight mb-4">
            Resume Tips & <span className="gradient-text-new">Career Guides</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Expert advice on ATS optimization, resume writing, keyword strategies, and interview preparation to help you land your next role.
          </p>
        </div>
      </section>

      {/* Category Tags */}
      <section className="pb-8 px-4">
        <div className="container max-w-4xl">
          <div className="flex flex-wrap justify-center gap-2">
            {CATEGORIES.map((cat) => (
              <Badge
                key={cat}
                variant={cat === "All" ? "default" : "outline"}
                className="cursor-pointer hover:bg-primary/10 transition-colors text-xs px-3 py-1"
              >
                {cat}
              </Badge>
            ))}
          </div>
        </div>
      </section>

      {/* Article Grid */}
      <section className="pb-16 px-4">
        <div className="container max-w-5xl">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {ARTICLES.map((article, i) => (
              <motion.div
                key={article.slug}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className="h-full flex flex-col border-border hover:border-primary/30 hover:-translate-y-0.5 transition-all cursor-pointer group">
                  <CardContent className="pt-5 flex flex-col flex-1">
                    <div className="flex items-center gap-2 mb-3">
                      <Badge variant="outline" className="text-[10px] px-2 py-0">{article.category}</Badge>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" /> {article.readTime}
                      </span>
                    </div>
                    <h2 className="font-bold text-sm mb-2 group-hover:text-primary transition-colors leading-snug">
                      {article.title}
                    </h2>
                    <p className="text-xs text-muted-foreground leading-relaxed flex-1 mb-3">
                      {article.excerpt}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground/60">{article.date}</span>
                      <span className="text-xs text-primary font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                        Read <ArrowRight className="h-3 w-3" />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Newsletter CTA */}
      <section className="py-16 px-4 bg-primary/5 border-t border-border">
        <div className="container max-w-2xl text-center">
          <BookOpen className="h-8 w-8 text-primary mx-auto mb-4" />
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">More Articles Coming Soon</h2>
          <p className="text-muted-foreground mb-6">
            We're writing in-depth guides on ATS optimization, resume writing, and interview prep. In the meantime, check your resume score for free.
          </p>
          <Button size="lg" onClick={() => navigate("/")} className="gap-2">
            Check My ATS Score <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-border text-center">
        <div className="container max-w-4xl flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
          <a href="/" className="hover:text-foreground transition-colors">Home</a>
          <a href="/ats-checker" className="hover:text-foreground transition-colors">ATS Checker</a>
          <a href="/pricing" className="hover:text-foreground transition-colors">Pricing</a>
          <a href="/blog" className="hover:text-foreground transition-colors">Blog</a>
          <a href="/about" className="hover:text-foreground transition-colors">About</a>
          <a href="/college-placement" className="hover:text-foreground transition-colors">College Placement</a>
        </div>
        <p className="text-xs text-muted-foreground/60 mt-4">&copy; {new Date().getFullYear()} HireResume. All rights reserved.</p>
      </footer>
    </div>
  );
}
