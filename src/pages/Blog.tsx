import { useState } from "react";
import { Link } from "react-router-dom";
import { ARTICLES } from "@/content/blog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Clock, BookOpen } from "lucide-react";
import { motion } from "framer-motion";
import { AnimatedGradientMesh } from "@/components/premium";
import { SEOHead } from "@/components/SEOHead";
import { PublicNavbar } from "@/components/PublicNavbar";
import { PublicFooter } from "@/components/PublicFooter";

const CATEGORIES = ["All", ...Array.from(new Set(ARTICLES.map((a) => a.category)))];

export default function Blog() {
  const [category, setCategory] = useState("All");
  const shown = category === "All" ? ARTICLES : ARTICLES.filter((a) => a.category === category);

  return (
    <div className="min-h-screen bg-background relative">
      <SEOHead
        title="Resume Tips, ATS Guides & Interview Advice | HiResume Blog"
        description="Practical guides on ATS resumes, resume formats for freshers, resume keywords, action verbs and AI mock interview practice for placements and jobs in India."
        path="/blog"
        keywords="resume tips, ATS resume guide, resume writing tips, interview preparation, resume keywords, ATS optimization, job search advice, career tips"
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }]}
      />
      <AnimatedGradientMesh />

      <PublicNavbar />

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
              <button key={cat} type="button" onClick={() => setCategory(cat)} aria-pressed={category === cat}>
                <Badge
                  variant={cat === category ? "default" : "outline"}
                  className="cursor-pointer hover:bg-primary/10 transition-colors text-xs px-3 py-1"
                >
                  {cat}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Article Grid */}
      <section className="pb-16 px-4">
        <div className="container max-w-5xl">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {shown.map((article, i) => (
              <motion.div
                key={article.slug}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
              >
                <Link to={`/blog/${article.slug}`} className="block h-full">
                <Card className="h-full flex flex-col border-border hover:border-primary/30 hover:-translate-y-0.5 transition-all cursor-pointer group">
                  <CardContent className="pt-5 flex flex-col flex-1">
                    <div className="flex items-center gap-2 mb-3">
                      <Badge variant="outline" className="text-[10px] px-2 py-0">{article.category}</Badge>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" /> {article.readMinutes} min read
                      </span>
                    </div>
                    <h2 className="font-bold text-sm mb-2 group-hover:text-primary transition-colors leading-snug">
                      {article.title}
                    </h2>
                    <p className="text-xs text-muted-foreground leading-relaxed flex-1 mb-3">
                      {article.description}
                    </p>
                    <div className="flex items-center justify-between">
                      <time dateTime={article.updated} className="text-[10px] text-muted-foreground/60">{new Date(`${article.updated}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</time>
                      <span className="text-xs text-primary font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                        Read <ArrowRight className="h-3 w-3" />
                      </span>
                    </div>
                  </CardContent>
                </Card>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Newsletter CTA */}
      <section className="py-16 px-4 bg-primary/5 border-t border-border">
        <div className="container max-w-2xl text-center">
          <BookOpen className="h-8 w-8 text-primary mx-auto mb-4" />
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">Put it into practice</h2>
          <p className="text-muted-foreground mb-6">
            See how an ATS reads your resume and exactly what to fix — free, in about 15 seconds.
          </p>
          <Button size="lg" asChild className="gap-2">
            <Link to="/ats-checker">Check My ATS Score <ArrowRight className="h-4 w-4" /></Link>
          </Button>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
