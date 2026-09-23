/** Institution (B2B) screens have their own chrome; B2C nav, FAB and upsells stay off them. */
export function isB2BPath(pathname: string): boolean {
  return /^\/(org|admin|learn|invite|test|dev\/b2b-demo)(\/|$)/.test(pathname);
}
