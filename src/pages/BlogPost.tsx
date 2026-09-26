import { Fragment, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Clock, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SEOHead } from "@/components/SEOHead";
import { PublicNavbar } from "@/components/PublicNavbar";
import { PublicFooter } from "@/components/PublicFooter";
import { ARTICLES, articleBySlug, type Article, type Block } from "@/content/blog";
import { articleJsonLd } from "@/seo/schema";
import NotFound from "./NotFound";

const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;

/** **bold** and [text](/path) — internal links become router links, so they are crawlable <a href>. */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={m.index} className="text-foreground font-semibold">{m[1]}</strong>);
    else if (m[3].startsWith("/")) out.push(<Link key={m.index} to={m[3]} className="text-primary underline underline-offset-2 hover:no-underline">{m[2]}</Link>);
    else out.push(<a key={m.index} href={m[3]} rel="noopener noreferrer" target="_blank" className="text-primary underline underline-offset-2">{m[2]}</a>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const CTAS = {
  ats: { title: "Check your resume’s ATS score — free", body: "Upload your resume and see what an ATS reads, which keywords are missing and what to fix. No signup, about 15 seconds.", to: "/ats-checker", label: "Check my resume" },
  interview: { title: "Practise with an AI voice interviewer", body: "Answer out loud, get follow-up questions based on your answers, and a report on what to improve.", to: "/mock-interview", label: "Start a mock interview" },
  builder: { title: "Build an ATS-friendly resume", body: "Fill in your details and get a clean, one-column resume in the format recruiters and ATS expect.", to: "/build-resume", label: "Open the resume builder" },
} as const;

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "p": return <p>{renderInline(block.text)}</p>;
    case "h2": return <h2 className="text-2xl font-bold text-foreground mt-10 mb-3 scroll-mt-24">{block.text}</h2>;
    case "h3": return <h3 className="text-lg font-semibold text-foreground mt-6 mb-2">{block.text}</h3>;
    case "ul": return <ul className="list-disc pl-6 space-y-1.5">{block.items.map((t, i) => <li key={i}>{renderInline(t)}</li>)}</ul>;
    case "ol": return <ol className="list-decimal pl-6 space-y-1.5">{block.items.map((t, i) => <li key={i}>{renderInline(t)}</li>)}</ol>;
    case "tip":
      return (
        <aside className="rounded-xl border border-primary/25 bg-primary/5 p-4 flex gap-3">
          <Lightbulb className="h-5 w-5 text-primary shrink-0 mt-0.5" aria-hidden />
          <div><p className="font-semibold text-foreground mb-1">{block.title}</p><p>{renderInline(block.text)}</p></div>
        </aside>
      );
    case "example":
      return (
        <div className="rounded-xl border border-border overflow-hidden text-sm">
          <div className="p-4 bg-red-500/5 border-b border-border"><p className="text-xs font-semibold uppercase tracking-wide text-red-400 mb-1">Weak</p><p>{renderInline(block.bad)}</p></div>
          <div className="p-4 bg-emerald-500/5"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-400 mb-1">Strong</p><p>{renderInline(block.good)}</p></div>
          {block.note && <p className="px-4 py-2 text-xs text-muted-foreground border-t border-border">{block.note}</p>}
        </div>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40"><tr>{block.head.map((h) => <th key={h} scope="col" className="text-left font-semibold text-foreground p-3">{h}</th>)}</tr></thead>
            <tbody>{block.rows.map((r, i) => <tr key={i} className="border-t border-border align-top">{r.map((c, j) => <td key={j} className="p-3">{renderInline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    case "cta": {
      const c = CTAS[block.kind];
      return (
        <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-6 not-prose">
          <p className="text-lg font-bold text-foreground mb-1">{c.title}</p>
          <p className="text-sm text-muted-foreground mb-4">{c.body}</p>
          <Button asChild><Link to={c.to}>{c.label} <ArrowRight className="h-4 w-4 ml-1" /></Link></Button>
        </div>
      );
    }
  }
}

const formatDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function ArticleView({ a }: { a: Article }) {
  const related = ARTICLES.filter((x) => x.slug !== a.slug && x.category === a.category)
    .concat(ARTICLES.filter((x) => x.slug !== a.slug && x.category !== a.category))
    .slice(0, 3);
  const faqLd = a.faq?.length ? {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: a.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  } : null;

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={`${a.seoTitle ?? a.title} | HiResume`}
        description={a.description}
        path={`/blog/${a.slug}`}
        ogType="article"
        keywords={a.keywords.join(", ")}
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }, { name: a.title, path: `/blog/${a.slug}` }]}
        jsonLd={faqLd ? [articleJsonLd(a), faqLd] : articleJsonLd(a)}
      />
      <PublicNavbar />

      <main className="pt-28 sm:pt-32 pb-16 px-4">
        <article className="container max-w-3xl">
          <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground mb-6">
            <Link to="/blog" className="inline-flex items-center gap-1 hover:text-primary"><ArrowLeft className="h-4 w-4" /> All articles</Link>
          </nav>
          <header className="mb-8">
            <Badge variant="outline" className="mb-3">{a.category}</Badge>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight mb-4">{a.title}</h1>
            <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>By the HiResume Editorial Team</span>
              <span aria-hidden>·</span>
              <time dateTime={a.updated}>Updated {formatDate(a.updated)}</time>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {a.readMinutes} min read</span>
            </p>
          </header>

          <div className="space-y-4 text-[15px] sm:text-base leading-relaxed text-muted-foreground">
            {a.body.map((b, i) => <Fragment key={i}><BlockView block={b} /></Fragment>)}
          </div>

          {a.faq?.length ? (
            <section className="mt-12" aria-labelledby="faq-heading">
              <h2 id="faq-heading" className="text-2xl font-bold mb-4">Frequently asked questions</h2>
              <div className="space-y-4">
                {a.faq.map((f) => (
                  <div key={f.q} className="rounded-xl border border-border p-4">
                    <h3 className="font-semibold text-foreground mb-1">{f.q}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{f.a}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="mt-12" aria-labelledby="related-heading">
            <h2 id="related-heading" className="text-xl font-bold mb-4">Keep reading</h2>
            <ul className="grid sm:grid-cols-3 gap-3">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link to={`/blog/${r.slug}`} className="block h-full rounded-xl border border-border p-4 hover:border-primary/40 transition-colors">
                    <span className="text-[11px] text-muted-foreground">{r.category}</span>
                    <span className="block text-sm font-semibold mt-1 leading-snug">{r.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </article>
      </main>

      <PublicFooter />
    </div>
  );
}

export default function BlogPost() {
  const { slug = "" } = useParams();
  const a = articleBySlug(slug);
  return a ? <ArticleView a={a} /> : <NotFound />;
}
