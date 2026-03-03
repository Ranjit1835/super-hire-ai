

# Stabilization Plan: Email Redirect URLs + OTP Cleanup

## Root Cause

Two locations use `window.location.origin` for email redirect URLs:
1. **AuthContext.tsx line 43** — signup `emailRedirectTo: window.location.origin`
2. **Auth.tsx line 137** — password reset `redirectTo: window.location.origin + '/reset-password'`

In preview, `window.location.origin` resolves to the Lovable preview domain, so all email links point there instead of production.

## Fix 1: Centralize base URL in a config file

Create `src/lib/config.ts` with:
```ts
export const APP_BASE_URL = "https://super-hire-ai.lovable.app";
```

This single source of truth replaces all `window.location.origin` usage in email link generation. When a custom domain (e.g. hiresume.in) is configured later, only this one file changes.

## Fix 2: Update signup redirect (AuthContext.tsx)

Replace `emailRedirectTo: window.location.origin` with `emailRedirectTo: APP_BASE_URL` on line 43.

## Fix 3: Update password reset redirect (Auth.tsx)

Replace `redirectTo: \`${window.location.origin}/reset-password\`` with `redirectTo: \`${APP_BASE_URL}/reset-password\`` on line 137.

## Fix 4: Update ResetPassword.tsx recovery detection

The reset password page checks `window.location.hash` for `type=recovery`. This already works correctly regardless of domain since it reads the current page's hash. No change needed.

## No other changes

- Edge functions, OTP flow, session propagation, payment logic — all untouched
- The OTP flow was already stabilized in previous iterations (direct fetch, 200ms retry, 3s fallback)
- No database changes needed

