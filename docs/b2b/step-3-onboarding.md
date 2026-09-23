# Step 3 — Bulk onboarding

## What changed
- `supabase/migrations/20260923000003_b2b_invites.sql`
  - `org_invites` (org, batch, name, email, roll_no, **SHA-256 of the token**, status, 30-day expiry, email
    delivery status). One live invite per email and per roll number per org; withdrawn invites don't block
    re-inviting.
  - `org_consents` (user, org, version, **exact text shown**, invite) — audit trail for DPDP-style consent.
  - Service-role-only functions that each re-check authorization (`actor_is_org_admin`):
    `b2b_import_invites` (dedupe within file / against members / against live invites, find-or-create batch,
    capacity check counting pending invites), `b2b_accept_invite` (row-locked, idempotent, consent required,
    refuses expired/revoked/used links and staff accounts, respects the plan cap), `b2b_rotate_invite`
    (new link, old one dies), `b2b_revoke_invite`, `b2b_invite_preview`, `b2b_email_has_account`,
    `b2b_mark_invite_email`.
  - Staff can read invites; nobody can write them except through those functions.
- Shared, pure-TS modules used by both the edge function and the browser:
  `supabase/functions/_shared/invite-csv.ts` (CSV parser + validator: quotes, BOM, `;`/tab files, common Indian
  college headers such as "Hall Ticket No", "Student Name", "Branch", "Section") and `_shared/b2b-consent.ts`.
- Edge function `b2b-invites` (actions `import`, `resend`, `revoke`, `preview`, `register`, `accept`), with real
  HTTP status codes. `_shared/b2b-http.ts` (auth, errors, tokens), `_shared/invite-email.ts` (Resend batch API).
  Type-checked with Deno 2.9 (`npx deno check`).
- UI
  - `/org/:orgId` now has tabs: **Overview**, **Invites** (status chips, search, batch filter, copy new link,
    resend email, withdraw), **Add students** (org admin only: template download, drag-and-drop CSV,
    per-row error preview, results with "Download invite links (CSV)" for WhatsApp / LMS sharing).
  - `/invite/:token` (public): shows institution, name, roll no; consent checkbox; new students set a password
    and are signed in; existing accounts sign in (password or Google) and come back; expired / withdrawn /
    used links explain what to do.
  - `AuthCallback` returns a student to their pending invite after Google sign-in or email confirmation.
  - B2C `/dashboard` shows a one-line banner linking to `/org` or `/learn` **only** for users in an institution.
- Exports go through `toCsv`, which neutralises formula cells (`= + - @`) — CSV injection safe.

## Decisions taken
- Invite link = the credential. A student may join with a different (e.g. personal Gmail) account; the
  institution still sees the roll number and name from its own roster.
- "Create account" from an invite is only for the **invited** email (created pre-confirmed); a different email
  goes through normal sign-up/Google and then accepts.
- Links are shown once (only a hash is stored). Losing them is fixed by "Copy new link".

## Before the pilot — required
1. **Verify `hiresume.in` in Resend** and set secrets:
   `supabase secrets set B2B_EMAIL_FROM="HiResume <invites@hiresume.in>" APP_BASE_URL=https://hiresume.in`.
   The current sender `onboarding@resend.dev` only delivers to the Resend account owner. Until then, use the
   downloaded invite-links CSV.
2. Deploy: `supabase db push` then `supabase functions deploy b2b-invites`.

## Verify
1. `npm test` → all pass (DB suites: tenancy 15, plans 13, invites 12; CSV/email unit 11; UI 18).
2. As org admin → Add students → upload the template → 2 invited → Download invite links.
   Upload the same file again → both "Already invited".
3. Open a link in a private window → tick consent → set password → lands on `/learn` showing 6 of 6.
4. Open the same link again → "already been used". Invites tab shows "Joined".
5. Invites → Copy new link on a pending invite → the old link now says "isn't valid".
6. B2C account with no institution: `/dashboard` unchanged (no banner).
