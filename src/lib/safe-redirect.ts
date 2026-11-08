// Where to send someone after sign-in. Only paths on this site are allowed, so a crafted link
// like /auth?redirect=https://evil.example can't bounce a freshly signed-in user elsewhere.

const KEY = "hiresume:post-auth-redirect";

/** The path if it is a same-site path ("/x", not "//x" or "/\x"), else null. */
export function safeRedirect(path: string | null | undefined): string | null {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return null;
  if (/^\/auth(\/|\?|$)/.test(path)) return null; // never loop back to sign-in
  return path;
}

/** "/auth?redirect=<current page>" for a sign-in link that brings the user back. */
export function authUrlFor(path: string): string {
  const back = safeRedirect(path);
  return back && back !== "/" ? `/auth?redirect=${encodeURIComponent(back)}` : "/auth";
}

/**
 * Google/Apple sign-in leaves the site, and an email confirmation link opens a new tab. Remember
 * where to go when either returns to /auth/callback. localStorage, because sessionStorage doesn't
 * reach that new tab.
 */
export function rememberRedirect(path: string | null | undefined) {
  const p = safeRedirect(path);
  try {
    if (p) localStorage.setItem(KEY, p);
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked: fall back to the dashboard */ }
}

export function takeRememberedRedirect(): string | null {
  try {
    const p = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    return safeRedirect(p);
  } catch {
    return null;
  }
}
