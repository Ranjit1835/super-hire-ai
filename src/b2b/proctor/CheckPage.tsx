// /proctor/check — stand-alone system check students and candidates can run any time before a proctored test.
// Nothing is recorded here; the camera and screen are released as soon as the check is done.
// The 3D stage appears only on the intro, before the camera check starts; the moment the student steps in, it's gone.
import { useState, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoMark } from "../ui/broadcast";
import { Stage } from "../three/Stage";
import { useB2BTheme } from "../layout/V1Shell";
import { Row, SystemCheckPanel, type CheckResult } from "./SystemCheckPanel";
import { shareEntireScreen } from "./ScreenShareStep";
import { stopStream } from "./systemCheck";

/** Exported for the gallery: the same page chrome, without a live camera/mic request. */
export function Frame({ children }: { children: ReactNode }) {
  useB2BTheme();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="hr-rule-b">
        <div className="mx-auto max-w-[760px] flex items-center gap-2 h-14 px-4 sm:px-0">
          <LogoMark title="HiResume" /><span className="hr-display text-[15px]">HiResume</span>
        </div>
      </header>
      <main className="mx-auto max-w-[760px] px-4 sm:px-0 py-6 sm:py-10">{children}</main>
    </div>
  );
}

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-6 hr-rise">
      <Stage className="h-56 md:h-72 order-last md:order-first" steps={[{ label: "Browser", state: "current" }, { label: "Camera & mic", state: "todo" }, { label: "Screen", state: "todo" }, { label: "Test", state: "todo" }]} />
      <div>
        <h1 className="hr-display text-[28px] sm:text-[32px] leading-[1.05]">System check</h1>
        <p className="text-sm text-[var(--hr-muted)] mt-2 max-w-sm">
          Two quick checks before a proctored test: your browser, camera and microphone, then entire-screen sharing.
          Nothing is recorded on this page, and your camera and screen are released as soon as you're done.
        </p>
        <Button type="button" className="mt-5" onClick={onStart}>Start check</Button>
      </div>
    </div>
  );
}

/**
 * A fixed-state preview of a finished check with one row needing attention, for the gallery and design review.
 * No live camera/mic/display calls — the real page drives SystemCheckPanel live; this is its "done" shape.
 */
export function CheckResultsPreview() {
  return (
    <Frame>
      <div className="space-y-6 hr-rise">
        <div>
          <h1 className="hr-display text-2xl">System check</h1>
          <p className="text-sm text-[var(--hr-muted)] mt-1">Check your computer before a proctored test. Nothing is recorded on this page.</p>
        </div>
        <section className="bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)] p-4 sm:p-5 space-y-3">
          <h2 className="hr-label !text-[11px]">1. Browser, camera, microphone and connection</h2>
          <ul className="bg-[var(--hr-surface)]" aria-label="Checks">
            <Row label="Browser" status="ok" detail="Chrome 130" />
            <Row label="Camera" status="ok" />
            <Row label="Microphone" status="ok" />
            <Row label="Speakers" status="warn" detail="Play the test sound and confirm you heard it" />
            <Row label="Connection" status="ok" detail="About 10.0 Mbps" />
            <Row label="Device" status="ok" detail="8 cores, 8 GB memory → full checks" />
            <Row label="Displays" status="ok" detail="Single display" />
          </ul>
        </section>
        <section className="bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)] p-4 sm:p-5 space-y-2">
          <h2 className="hr-label !text-[11px]">2. Entire-screen sharing</h2>
          <p className="text-sm text-[var(--hr-muted)]">
            Proctored tests need you to share your <strong className="text-foreground">entire screen</strong>, not a single window or browser
            tab. A window or tab share lets the rest of the screen stay hidden, which a proctored test can't allow.
          </p>
          <Button type="button" variant="outline" disabled>Test screen sharing</Button>
        </section>
      </div>
    </Frame>
  );
}

export default function CheckPage() {
  const [started, setStarted] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [screen, setScreen] = useState<"idle" | "ok" | string>("idle");

  const testScreen = async () => {
    const r = await shareEntireScreen();
    if ("error" in r) { setScreen(r.error); return; }
    stopStream(r.stream);
    setScreen("ok");
  };

  if (!started) return <Frame><Intro onStart={() => setStarted(true)} /></Frame>;

  return (
    <Frame>
      <div className="space-y-6 hr-rise">
        <div>
          <h1 className="hr-display text-2xl">System check</h1>
          <p className="text-sm text-[var(--hr-muted)] mt-1">Check your computer before a proctored test. Nothing is recorded on this page.</p>
        </div>

        <section className="bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)] p-4 sm:p-5 space-y-3">
          <h2 className="hr-label !text-[11px]">1. Browser, camera, microphone and connection</h2>
          {!result ? <SystemCheckPanel kind="assessment" keepStream={false} onPassed={setResult} /> : (
            <p className="flex items-center gap-2 text-sm text-[var(--hr-gold)]"><CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
              Passed: {result.browser.browser} {result.browser.version}, camera and microphone working, {result.tier === "full" ? "full" : result.tier === "lite" ? "light" : "basic"} checks on this device.
            </p>
          )}
        </section>

        <section className="bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)] p-4 sm:p-5 space-y-2">
          <h2 className="hr-label !text-[11px]">2. Entire-screen sharing</h2>
          <p className="text-sm text-[var(--hr-muted)]">
            Proctored tests need you to share your <strong className="text-foreground">entire screen</strong>, not a single window or browser
            tab. A window or tab share lets the rest of the screen stay hidden, which a proctored test can't allow.
          </p>
          <Button type="button" variant="outline" onClick={() => void testScreen()}>Test screen sharing</Button>
          {screen === "ok" && <p className="text-sm text-[var(--hr-gold)]" data-testid="screen-ok">Entire screen sharing works.</p>}
          {screen !== "ok" && screen !== "idle" && <p role="alert" className="text-sm text-[var(--hr-red-ink)]">{screen}</p>}
        </section>

        {result && screen === "ok" && (
          <p className="bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-blue)] text-foreground p-3 text-sm" data-testid="all-set">
            You're all set. Use this computer and browser for the test.
          </p>
        )}
      </div>
    </Frame>
  );
}
