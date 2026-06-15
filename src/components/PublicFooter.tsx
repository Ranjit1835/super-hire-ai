
const FOOTER_LINKS = [
  { href: "/", label: "Home" },
  { href: "/ats-checker", label: "ATS Checker" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/blog", label: "Blog" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/college-placement", label: "College Placement" },
];

export function PublicFooter() {
  return (
    <footer className="py-10 px-4 border-t border-border/30 bg-background/50 backdrop-blur-sm">
      <div className="container max-w-5xl">
        <div className="flex flex-col sm:flex-row items-center sm:items-start justify-between gap-6">
          {/* Brand */}
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="HireSume" className="h-7 w-7 rounded-lg" />
            <span className="font-bold text-foreground tracking-tight">HireSume</span>
          </div>

          {/* Links */}
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-2">
            {FOOTER_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-border/20 text-center">
          <p className="text-xs text-muted-foreground/60">
            &copy; {new Date().getFullYear()} HireSume. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
