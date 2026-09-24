import { useEffect, useState } from "react";
import { type Currency, detectCurrency, getPricing, type PricingTable } from "@/config/pricing";

const STORAGE_KEY = "hiresume_currency";

function getInitialCurrency(): Currency {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "INR" || stored === "USD") return stored;
  } catch {}
  return detectCurrency();
}

/** Public pages are pre-rendered in INR (our main market). The first client render must match that
 * HTML, so the visitor's own currency (stored choice or locale) is applied right after mount. */
const PRERENDER_CURRENCY: Currency = "INR";

export function useCurrency() {
  const [currency, setCurrencyState] = useState<Currency>(PRERENDER_CURRENCY);

  useEffect(() => {
    const c = getInitialCurrency();
    if (c !== PRERENDER_CURRENCY) setCurrencyState(c);
  }, []);

  const setCurrency = (c: Currency) => {
    setCurrencyState(c);
    try { localStorage.setItem(STORAGE_KEY, c); } catch {}
  };

  const pricing: PricingTable = getPricing(currency);

  return { currency, setCurrency, pricing };
}
