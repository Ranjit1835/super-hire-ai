import { useEffect, useState } from "react";

/** Faint, repeated subject id + time over the test, to deter photographing and leaking questions. */
export function Watermark({ text }: { text: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const h = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(h);
  }, []);
  const label = `${text} · ${now.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
  return (
    <div aria-hidden data-testid="watermark" className="pointer-events-none select-none fixed inset-0 z-30 overflow-hidden opacity-[0.05]">
      <div className="absolute -inset-1/2 rotate-[-24deg] flex flex-wrap content-start gap-x-24 gap-y-16 hr-data text-sm text-[var(--hr-floodlight)]">
        {Array.from({ length: 120 }, (_, i) => <span key={i} className="whitespace-nowrap">{label}</span>)}
      </div>
    </div>
  );
}
