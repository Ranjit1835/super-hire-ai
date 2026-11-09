-- Real model rates for the B2B cost log (replaces the placeholder seed from 20260923000010).
--
-- The old default row ('%', ₹25.2 / ₹210 per 1M tokens) was Gemini 2.5 Flash's price at ₹84/USD.
-- The app runs gemini-3.6-flash, whose paid Standard-tier price on Google's pricing page
-- (https://ai.google.dev/gemini-api/docs/pricing, checked 2026-10-20) is:
--   $0.75 input / $3.75 output per 1M tokens through 31 Dec 2026,
--   $1.50 input / $7.50 output per 1M tokens from 1 Jan 2027.
-- Exchange rate: ₹95 per USD (USD/INR traded at 94.7–96.8 in October 2026). Edit in /admin/costs
-- when the rate moves; super_recompute_costs re-prices logged usage.
--
-- New rows only: the old row stays for history. b2b_price_for picks, for the same key, the row with
-- the latest effective_from that is already in effect, so the 2027 row takes over by itself.
-- Context-cache discounts are not modelled yet (the usage log has no cached-token column); the AI
-- gateway in Phase 1 adds that, so cached calls are logged at the full input price until then.

INSERT INTO public.b2b_pricing (provider_key, input_inr_per_million, output_inr_per_million, effective_from, notes) VALUES
  ('%', 71.25, 356.25, now(),
   'gemini-3.6-flash Standard: $0.75 in / $3.75 out per 1M at ₹95/USD (Google pricing page, 2026-10-20).'),
  ('%', 142.5, 712.5, '2027-01-01 00:00:00+00',
   'gemini-3.6-flash Standard from 1 Jan 2027: $1.50 in / $7.50 out per 1M at ₹95/USD.');
