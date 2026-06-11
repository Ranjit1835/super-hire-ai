import { Helmet } from "react-helmet-async";

const BASE_URL = "https://hiresume.in";
const DEFAULT_OG_IMAGE = `${BASE_URL}/og-image.png`;
const SITE_NAME = "HireResume";

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
      <link rel="alternate" hrefLang="en" href={fullUrl} />
      {noindex && <meta name="robots" content="noindex, nofollow" />}

      {/* Open Graph */}
      <meta property="og:type" content={ogType} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={fullUrl} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:locale" content="en_US" />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />

      {/* BreadcrumbList structured data */}
      {breadcrumbList && (
        <script type="application/ld+json">
          {JSON.stringify(breadcrumbList)}
        </script>
      )}
    </Helmet>
  );
}
