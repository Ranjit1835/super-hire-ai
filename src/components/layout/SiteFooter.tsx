import { Link } from "react-router-dom";
import { FOOTER_COLUMNS } from "./site-nav";

export function SiteFooter() {
  return (
    <footer className="py-10 px-4 border-t border-border/30 bg-background/50 backdrop-blur-sm">
      <div className="container max-w-5xl">
        <div className="grid gap-8 sm:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <Link to="/" className="inline-flex items-center gap-2">
              <img src="/logo.svg" alt="" className="h-7 w-7 rounded-lg" />
              <span className="font-bold text-foreground tracking-tight">HiResume</span>
            </Link>
            <p className="mt-3 text-xs text-muted-foreground max-w-xs">
              Check your resume against ATS, fix it with AI and practise the interview.
            </p>
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h2 className="text-xs font-semibold text-foreground mb-3">{col.title}</h2>
              <ul className="space-y-2">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link to={l.href} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-8 pt-4 border-t border-border/20 text-center">
          <p className="text-xs text-muted-foreground/60">&copy; {new Date().getFullYear()} HiResume. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
