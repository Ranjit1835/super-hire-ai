// schema.org builders shared by public pages. Only describe what the page visibly shows —
// no ratings or reviews unless they are real and displayed.
import { PRICING } from "@/config/pricing";

export const SITE_URL = "https://hiresume.in";

const inr = (key: keyof typeof PRICING.INR) => {
  const e = PRICING.INR[key] as { amount: number };
  return (e.amount / 100).toFixed(0);
};

/** The product with its INR price list (matches /pricing). */
export function softwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "HiResume",
    operatingSystem: "Web",
    applicationCategory: "BusinessApplication",
    url: `${SITE_URL}/`,
    description:
      "AI resume checker, resume builder and mock interview platform. Get a free ATS score with keyword and formatting feedback, then fix your resume and practise interviews by voice.",
    featureList: [
      "Free ATS resume score",
      "Keyword gap analysis against a job description",
      "AI resume rewrite",
      "ATS-friendly resume builder",
      "AI voice mock interviews",
    ],
    offers: [
      { "@type": "Offer", name: "ATS resume check", price: "0", priceCurrency: "INR" },
      { "@type": "Offer", name: "Resume Fix", price: inr("RESUME_FIX"), priceCurrency: "INR" },
      { "@type": "Offer", name: "Resume Build", price: inr("RESUME_BUILD"), priceCurrency: "INR" },
      { "@type": "Offer", name: "AI Interview", price: inr("AI_INTERVIEW"), priceCurrency: "INR" },
      { "@type": "Offer", name: "Combo Plan", price: inr("COMBO_PLAN"), priceCurrency: "INR" },
      { "@type": "Offer", name: "Unlimited Plan", price: inr("UNLIMITED_PLAN"), priceCurrency: "INR" },
    ],
  };
}

export interface ArticleMeta {
  slug: string;
  title: string;
  description: string;
  published: string; // YYYY-MM-DD
  updated: string;
}

export function articleJsonLd(a: ArticleMeta) {
  const url = `${SITE_URL}/blog/${a.slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.title,
    description: a.description,
    datePublished: a.published,
    dateModified: a.updated,
    mainEntityOfPage: url,
    url,
    image: `${SITE_URL}/og-image.png`,
    inLanguage: "en-IN",
    author: { "@type": "Organization", name: "HiResume Editorial Team", url: `${SITE_URL}/about` },
    publisher: { "@type": "Organization", name: "HiResume", logo: { "@type": "ImageObject", url: `${SITE_URL}/logo.svg` } },
  };
}
