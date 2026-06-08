// =============================================
// Centralized Pricing Configuration
// =============================================
// All prices in smallest currency unit (paise for INR, cents for USD)
// Display prices are formatted strings shown to users

export type Currency = "INR" | "USD";

export interface PriceEntry {
  amount: number;       // smallest unit (paise / cents)
  display: string;      // e.g. "₹99" or "$4"
}

export interface PricingTable {
  currency: Currency;
  symbol: string;
  RESUME_FIX: PriceEntry;
  RESUME_BUILD: PriceEntry;
  AI_INTERVIEW: PriceEntry;
  COMBO_PLAN: PriceEntry;
  UNLIMITED_PLAN: PriceEntry;
  UNLIMITED_STUDENT: PriceEntry;
  // Legacy aliases
  ONE_TIME_FIX: PriceEntry;
  RESUME_BUILDER: PriceEntry;
  MOCK_INTERVIEW: PriceEntry;
  EARLY_BIRD_ACCESS: PriceEntry;
  // Studio plans
  STUDIO_SINGLE: PriceEntry;
  STUDIO_WEEKLY: PriceEntry;
  STUDIO_YEARLY: PriceEntry;
}

const INR_PRICING: PricingTable = {
  currency: "INR",
  symbol: "₹",
  RESUME_FIX:        { amount: 9900,   display: "₹99" },
  RESUME_BUILD:      { amount: 29900,  display: "₹299" },
  AI_INTERVIEW:      { amount: 59900,  display: "₹599" },
  COMBO_PLAN:        { amount: 59900,  display: "₹599" },
  UNLIMITED_PLAN:    { amount: 199900, display: "₹1,999" },
  UNLIMITED_STUDENT: { amount: 149900, display: "₹1,499" },
  // Legacy aliases (same as above)
  ONE_TIME_FIX:      { amount: 9900,   display: "₹99" },
  RESUME_BUILDER:    { amount: 29900,  display: "₹299" },
  MOCK_INTERVIEW:    { amount: 59900,  display: "₹599" },
  EARLY_BIRD_ACCESS: { amount: 149900, display: "₹1,499" },
  // Studio
  STUDIO_SINGLE:     { amount: 14900,  display: "₹149" },
  STUDIO_WEEKLY:     { amount: 59900,  display: "₹599" },
  STUDIO_YEARLY:     { amount: 249900, display: "₹2,499" },
};

const USD_PRICING: PricingTable = {
  currency: "USD",
  symbol: "$",
  RESUME_FIX:        { amount: 400,   display: "$4" },
  RESUME_BUILD:      { amount: 900,   display: "$9" },
  AI_INTERVIEW:      { amount: 1900,  display: "$19" },
  COMBO_PLAN:        { amount: 1900,  display: "$19" },
  UNLIMITED_PLAN:    { amount: 3900,  display: "$39" },
  UNLIMITED_STUDENT: { amount: 2900,  display: "$29" },
  // Legacy aliases
  ONE_TIME_FIX:      { amount: 400,   display: "$4" },
  RESUME_BUILDER:    { amount: 900,   display: "$9" },
  MOCK_INTERVIEW:    { amount: 1900,  display: "$19" },
  EARLY_BIRD_ACCESS: { amount: 2900,  display: "$29" },
  // Studio
  STUDIO_SINGLE:     { amount: 500,   display: "$5" },
  STUDIO_WEEKLY:     { amount: 1900,  display: "$19" },
  STUDIO_YEARLY:     { amount: 7900,  display: "$79" },
};

export const PRICING: Record<Currency, PricingTable> = {
  INR: INR_PRICING,
  USD: USD_PRICING,
};

/** Detect currency based on user's timezone/locale. India → INR, everyone else → USD. */
export function detectCurrency(): Currency {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (tz.startsWith("Asia/Kolkata") || tz.startsWith("Asia/Calcutta")) return "INR";
    const locale = navigator.language || "";
    if (locale.startsWith("hi") || locale === "en-IN") return "INR";
  } catch {
    // fallback
  }
  return "USD";
}

/** Get the pricing table for a currency */
export function getPricing(currency?: Currency): PricingTable {
  return PRICING[currency || detectCurrency()];
}

/** Format amount from smallest unit to display string */
export function formatPrice(amount: number, currency: Currency): string {
  const divisor = currency === "INR" ? 100 : 100;
  const symbol = currency === "INR" ? "₹" : "$";
  const value = amount / divisor;
  if (currency === "INR" && value >= 1000) {
    return `${symbol}${value.toLocaleString("en-IN")}`;
  }
  return `${symbol}${value}`;
}
