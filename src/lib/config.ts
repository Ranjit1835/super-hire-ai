// In development, use the current origin so OAuth redirects come back to localhost.
// In production builds, use the live domain.
export const APP_BASE_URL = import.meta.env.DEV && typeof window !== "undefined"
  ? window.location.origin
  : "https://hiresume.in";

export const APPLE_OAUTH_ENABLED = false;

/**
 * B2B portals (institutions, students, public test). Off unless the build sets VITE_B2B_ENABLED=true,
 * so production stays B2C-only until it is switched on. The edge functions have their own server-side
 * switch (B2B_ENABLED secret); this flag only decides whether the pages exist.
 */
export const B2B_ENABLED = import.meta.env.VITE_B2B_ENABLED === "true";
