// Header and footer for the signed-in tools (and the guest result page). Marketing pages and the
// 404 page render the same SiteHeader/SiteFooter themselves; full-screen screens (auth, the
// Studio editor, institution/B2B areas) have their own layout and are left alone.
import { useLocation } from "react-router-dom";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

const APP_PAGES = [/^\/dashboard\/?$/, /^\/analysis\//, /^\/fix\//, /^\/build-resume\/?$/, /^\/voice-interview\/?$/, /^\/studio\/?$/];

export const hasAppChrome = (pathname: string) => APP_PAGES.some((re) => re.test(pathname));

export function AppHeader() {
  const { pathname } = useLocation();
  return hasAppChrome(pathname) ? <SiteHeader spacer /> : null;
}

export function AppFooter() {
  const { pathname } = useLocation();
  return hasAppChrome(pathname) ? <SiteFooter /> : null;
}
