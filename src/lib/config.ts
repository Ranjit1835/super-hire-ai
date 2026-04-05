// In development, use the current origin so OAuth redirects come back to localhost.
// In production builds, use the live domain.
export const APP_BASE_URL = import.meta.env.DEV
  ? window.location.origin
  : "https://hiresume.in";

export const APPLE_OAUTH_ENABLED = false;
