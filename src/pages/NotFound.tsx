import { Link, useLocation } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { PublicNavbar } from "@/components/PublicNavbar";
import { PublicFooter } from "@/components/PublicFooter";
import { FEATURES } from "@/components/layout/site-nav";

// The distinct destinations people most likely wanted (the resume-fix card also goes to the checker).
const SUGGESTIONS = FEATURES.filter((f, i, all) => all.findIndex((g) => g.href === f.href) === i).slice(0, 6);

const NotFound = () => {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEOHead
        title="Page Not Found - HiResume"
        description="The page you're looking for doesn't exist. Head back to HiResume to check your ATS resume score for free."
        path={location.pathname}
        noindex={true}
      />
      <PublicNavbar />
      <main className="flex-1 container max-w-3xl px-4 pt-28 pb-16">
        <p className="text-sm font-semibold text-violet-400 mb-2">404</p>
        <h1 className="text-3xl sm:text-4xl font-bold mb-3">We couldn't find that page</h1>
        <p className="text-muted-foreground mb-8">
          The link may be old or mistyped. <code className="text-xs bg-white/5 px-1.5 py-0.5 rounded break-all">{location.pathname}</code> doesn't exist on HiResume.
        </p>
        <div className="flex flex-wrap gap-3 mb-12">
          <Link to="/" className="inline-flex items-center gap-1 px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white">
            Go to the home page <ArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/blog" className="px-5 py-2.5 rounded-lg text-sm font-medium border border-border hover:bg-white/5">
            Read the blog
          </Link>
        </div>
        <h2 className="text-sm font-semibold mb-3">Or go straight to</h2>
        <ul className="grid sm:grid-cols-2 gap-3">
          {SUGGESTIONS.map((f) => (
            <li key={f.href}>
              <Link to={f.href} className="flex items-start gap-3 rounded-xl border border-border/60 p-4 hover:border-violet-500/40 hover:bg-white/[0.03] transition-colors">
                <f.icon className="h-5 w-5 text-violet-400 shrink-0 mt-0.5" aria-hidden />
                <span>
                  <span className="block text-sm font-medium">{f.title}</span>
                  <span className="block text-xs text-muted-foreground line-clamp-2">{f.desc}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <PublicFooter />
    </div>
  );
};

export default NotFound;
