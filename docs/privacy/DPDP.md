# DPDP Act 2023 / Rules 2025: where HiResume stands

Source checklist: kalqore.com "DPDP Act for app builders". All duties apply from **May 2027**; consent managers from
November 2026. Owner decisions (2026-11-09): B2C is 18+ only, English notice now (translations later), grievance
contact `privacy@hiresume.in`.

## Checklist

| Item | Status | Where |
|---|---|---|
| Sign-up links to the privacy notice before submitting | Done | `src/pages/Auth.tsx` (required tick for email and Google sign-up) |
| Notice lists each kind of data and its purpose | Done | `src/pages/Privacy.tsx` (`/privacy`) |
| Notice explains withdrawal, rights, Board complaint | Done | `/privacy` |
| Consent recorded with version, text and time | Done | `user_consents`, `src/components/ConsentGate.tsx` (also asks existing users once) |
| Marketing emails opt-in, unticked | Not needed | No marketing email is sent. Add a separate unticked box before sending any. |
| Named privacy contact and email published | **Partly** | `src/lib/privacy.ts`: name still "Grievance Officer, HiResume"; **hiresume.in has no MX records, so mail to privacy@ bounces** (see below) |
| User B can't read user A's data | Done | RLS on every table; `supabase/tests/rls/*` (tenant isolation tests) |
| Every API checks ownership, not just login | Done | edge functions re-check in SQL (`actor_*` functions) |
| Access logs kept at least 1 year | **Open** | `audit_logs` keeps staff changes; sign-in logs depend on the Supabase plan's log retention, and `login_attempts` is cleared hourly. Needs a 1-year sign-in log. |
| Backups tested with a restore | **Open** | Manual dumps exist (`Documents\hiresume-backups\prod-20261109-1057`); restore into a scratch project once and note the date here. |
| Delete account from settings | Done | `/account` → `account-delete` function → `privacy_delete_account()` |
| Deletion reaches all tables, files, outside services | Done for B2C | tables + resume files + auth user. Razorpay keeps its own payment records (legal). No analytics or mailing-list tools hold user data. |
| Law-required records kept apart with delete-after dates | Done | `retained_payment_records`, `b2b_deleted_orgs` (8 years, purged daily) |
| Complaints answered well within 90 days | Process | Target 30 days (`PRIVACY_RESPONSE_DAYS`). Needs a working inbox. |
| Breach notice template ready | Done | below |
| Can email every user with the app down | Done | below |
| Named person owns breach decisions and the 72-hour report | **Owner** | fill in below |
| Under-18s blocked or parental consent | Done | B2C: 18+ confirmation; B2B: `held_minor` students are never activated |
| Every provider has security and deletion terms | **Owner** | accept/download DPAs: Supabase, Vercel, Google Cloud (Gemini), Razorpay, Resend, Groq, Sarvam |
| Notice in the 22 scheduled languages | Later | English only for now (owner decision); `/privacy` is plain text so it can be translated |

## Make privacy@hiresume.in receive mail

1. Pick a mailbox: Zoho Mail (free plan, 5 users) or Google Workspace, or ImprovMX for plain forwarding to an inbox you already read.
2. In the hiresume.in DNS (where the domain is managed), add the MX records the provider gives you, plus its SPF TXT record.
3. Create `privacy@` (and `support@`, which the site also shows) and send a test mail from another account.
4. While there: verify hiresume.in in Resend (its DKIM records), then set the `B2B_EMAIL_FROM` secret so invites are emailed.

## Breach response

**Owner of breach decisions:** _name, phone_ (must decide within hours whether something is a breach).

A breach is any unauthorised access, accidental disclosure, sharing, change or loss of personal data: an exposed admin
page, a public bucket, a mail sent to the wrong people, a leaked key.

1. **Contain** (first hour): revoke the leaked key or session, close the bucket, turn the feature off (`B2B_ENABLED`,
   `VITE_B2B_ENABLED`), note the time you found out.
2. **Decide** (within hours): what data, whose, since when. Keep notes; `audit_logs` and Supabase logs show who did what.
3. **Tell affected users without delay**, by email (template below).
4. **Tell the Data Protection Board without delay**, then a **full report within 72 hours** of finding out: what happened,
   when and where, likely impact, cause, who was responsible if known, what was fixed, and the notices sent.

**Email everyone with the app down:** export addresses with the Supabase SQL editor
(`select email from auth.users where email is not null`, plus `students.email` for a college's students), and send from
Resend's dashboard or API using the verified hiresume.in domain. This does not need the website running.

### User notice template

> Subject: Important: a security incident affecting your HiResume account
>
> On {date} we found that {what happened, in plain words}. It affected {which data} for {who}. We have {what we did}.
> What this means for you: {impact}. What you can do: {steps, e.g. change your password, watch for phishing}.
> Questions: privacy@hiresume.in. We are sorry this happened.
