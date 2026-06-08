import { useState } from "react";
import { type Currency, detectCurrency, getPricing, type PricingTable } from "@/config/pricing";

const STORAGE_KEY = "hiresume_currency";

function getInitialCurrency(): Currency {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "INR" || stored === "USD") return stored;
  } catch {}
  return detectCurrency();
}

export function useCurrency() {
  const [currency, setCurrencyState] = useState<Currency>(getInitialCurrency);

  const setCurrency = (c: Currency) => {
    setCurrencyState(c);
    try { localStorage.setItem(STORAGE_KEY, c); } catch {}
  };

  const pricing: PricingTable = getPricing(currency);

  return { currency, setCurrency, pricing };
}
