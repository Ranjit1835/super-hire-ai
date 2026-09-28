import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { FEATURES } from "@/components/layout/site-nav";

/** One card per product feature, so each is reachable from the home page. */
export function FeaturesSection() {
  return (
    <section id="features" className="py-12 sm:py-20 px-4" aria-labelledby="features-title">
      <div className="container max-w-6xl">
        <div className="text-center mb-8 sm:mb-12">
          <h2 id="features-title" className="text-2xl sm:text-3xl font-bold mb-3">Everything in HiResume</h2>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto">
            From your first resume to the final interview round. The score check is free without an account; the other tools need a free sign-in.
          </p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <Link
                to={f.href}
                className="group h-full flex flex-col rounded-2xl border border-border/60 bg-card/40 p-5 hover:border-violet-500/40 hover:bg-white/[0.03] transition-colors"
              >
                <span className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <f.icon className="h-5 w-5 text-primary" aria-hidden />
                </span>
                <h3 className="font-semibold mb-1.5">{f.title}</h3>
                <p className="text-sm text-muted-foreground flex-1">{f.desc}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-violet-400 group-hover:text-violet-300">
                  {f.cta} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
