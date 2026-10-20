// /proctor/check — stand-alone system check students and candidates can run any time before a proctored test.
// Nothing is recorded here; the camera and screen are released as soon as the check is done.
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { V1Shell } from "../layout/V1Shell";
import { SystemCheckPanel, type CheckResult } from "./SystemCheckPanel";
import { shareEntireScreen } from "./ScreenShareStep";
import { stopStream } from "./systemCheck";

export default function CheckPage() {
  const [result, setResult] = useState<CheckResult | null>(null);
  const [screen, setScreen] = useState<"idle" | "ok" | string>("idle");

  const testScreen = async () => {
    const r = await shareEntireScreen();
    if ("error" in r) { setScreen(r.error); return; }
    stopStream(r.stream);
    setScreen("ok");
  };

  return (
    <V1Shell title="System check" subtitle="Check your computer before a proctored test. Nothing is recorded on this page.">
      <div className="max-w-2xl space-y-6">
        <section className="rounded-lg border border-border p-4">
          <h2 className="font-semibold mb-2">1. Browser, camera, microphone and connection</h2>
          {!result ? <SystemCheckPanel kind="assessment" keepStream={false} onPassed={setResult} /> : (
            <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden />
              Passed: {result.browser.browser} {result.browser.version}, camera and microphone working, {result.tier === "full" ? "full" : result.tier === "lite" ? "light" : "basic"} checks on this device.
            </p>
          )}
        </section>
        <section className="rounded-lg border border-border p-4 space-y-2">
          <h2 className="font-semibold">2. Entire-screen sharing</h2>
          <p className="text-sm text-muted-foreground">Proctored tests need you to share your <strong>Entire screen</strong> (not a window or tab).</p>
          <Button type="button" variant="outline" onClick={() => void testScreen()}>Test screen sharing</Button>
          {screen === "ok" && <p className="text-sm text-emerald-700" data-testid="screen-ok">Entire screen sharing works.</p>}
          {screen !== "ok" && screen !== "idle" && <p role="alert" className="text-sm text-destructive">{screen}</p>}
        </section>
        {result && screen === "ok" && (
          <p className="rounded-md bg-emerald-50 text-emerald-900 p-3 text-sm" data-testid="all-set">You're all set. Use this computer and browser for the test.</p>
        )}
      </div>
    </V1Shell>
  );
}
