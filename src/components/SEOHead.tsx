import { Helmet } from "react-helmet-async";

const BASE_URL = "https://hiresume.in";
const DEFAULT_OG_IMAGE = `${BASE_URL}/og-image.png`;

interface BreadcrumbItem {
  name: string;
  path: string;
}

interface SEOHeadProps {
  title: string;
  description: string;
  path: string;
  ogImage?: string;
  ogType?: string;
  noindex?: boolean;
  keywords?: string;
  breadcrumbs?: BreadcrumbItem[];
  /** Page-specific schema.org objects (FAQPage, Article, SoftwareApplication…). Must describe content visible on the page. */
  jsonLd?: object | object[];
}

export function SEOHead({
  title,
  description,
  path,
  ogImage = DEFAULT_OG_IMAGE,
  ogType = "website",
  noindex = false,
  keywords,
  breadcrumbs,
  jsonLd,
}: SEOHeadProps) {
  const canonicalUrl = `${BASE_URL}${path === "/" ? "" : path}`;
  const fullUrl = `${canonicalUrl}${path === "/" ? "/" : ""}`;

  // Build BreadcrumbList JSON-LD
  const breadcrumbList = breadcrumbs
    ? {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: breadcrumbs.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: item.name,
          item: `${BASE_URL}${item.path === "/" ? "" : item.path}`,
        })),
      }
    : null;

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      {keywords && <meta name="keywords" content={keywords} />}
      <link rel="canonical" href={fullUrl} />
      <link rel="alternate" hrefLang="x-default" href={fullUrl} />
      <link rel="alternate" hrefLang="en-IN" href={fullUrl} />
      {noindex && <meta name="robots" content="noindex, nofollow" />}

      {/* Open Graph */}
      <meta property="og:type" content={ogType} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={fullUrl} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />

      {/* BreadcrumbList structured data */}
      {(Array.isArray(jsonLd) ? jsonLd : jsonLd ? [jsonLd] : []).map((d, i) => (
        <script key={i} type="application/ld+json">{JSON.stringify(d)}</script>
      ))}
      {breadcrumbList && (
        <script type="application/ld+json">
          {JSON.stringify(breadcrumbList)}
        </script>
      )}
    </Helmet>
  );
}
