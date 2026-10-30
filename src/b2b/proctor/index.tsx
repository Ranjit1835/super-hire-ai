// Proctoring V1: the interface other areas build against (props and exports fixed in docs/b2b/tracks/README.md).
// ProctoredSession: preflight → system check → itemised consent → entire-screen share + full screen → children,
// monitoring while mounted (browser / camera / speech signals, snapshots, Strict / Maximum reactions), and ends
// the session (server computes the integrity score) on unmount. AI proctoring: flags are evidence for human review.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { z } from "zod";
import { ShieldCheck, AlertTriangle, PauseCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { EventType, Severity } from "../../../supabase/functions/_shared/contracts/proctor";
import type { ProctoringPolicyV1 } from "../types";
import { ApiError, proctorApi } from "../lib/api";
import { useB2BTheme } from "../layout/V1Shell";
import { SystemCheckPanel, type CheckResult } from "./SystemCheckPanel";
import { ConsentStep, type AcceptedConsent } from "./ConsentStep";
import { ScreenShareStep, enterFullscreen, shareEntireScreen } from "./ScreenShareStep";
import { ProctorMonitor, PROBLEM_COPY, type Policy, type Problem } from "./monitor";
import { loadLandmarker } from "./detector";
import { requestCameraMic, stopStream } from "./systemCheck";
import type { SendResult } from "./queue";

export interface ProctorSignal {
  type: z.infer<typeof EventType>;
  severity: z.infer<typeof Severity>;
  meta?: Record<string, unknown>;
}

export interface ProctorApi {
  /** Report an event the host screen detected (e.g. a blocked paste in the code editor). */
  report: (s: ProctorSignal) => void;
  /** Proctoring session id once started (null while starting, or when the policy is "off"). */
  sessionId: string | null;
  /** True while a Maximum-policy pause is active: the host must block input and show nothing secret. */
  paused: boolean;
}

const noop: ProctorApi = { report: () => {}, sessionId: null, paused: false };
const Ctx = createContext<ProctorApi>(noop);

/** Inside a proctored screen: how the host reports signals and learns about pauses. */
/** R2.6: "Serious violation 1 of 3. At 3 the test is submitted automatically." */
export function strikeText(violations: number, max: number): string {
  return `Serious violation ${violations} of ${max}. At ${max} your test is submitted automatically.`;
}

export function useProctor(): ProctorApi {
  return useContext(Ctx);
}

export interface ProctoredSessionProps {
  /** Exactly one of attemptId / interviewId: what is being proctored. */
  attemptId?: string;
  interviewId?: string;
  policy: ProctoringPolicyV1;
  /** Coding tests listen for speech; interviews don't (the candidate is meant to talk). */
  kind: "assessment" | "interview";
  /** Called once system check, consent and screen share are done and monitoring has started. */
  onReady?: (sessionId: string | null) => void;
  /** Strict policy hit its violation limit: the host must submit now. */
  onAutoSubmit?: () => void;
  children: ReactNode;
}

type Stage = "preflight" | "check" | "consent" | "share" | "running" | "off" | "declined" | "error";

interface Preflight { policy: ProctoringPolicyV1; orgName: string; retentionDays: number; contactEmail: string | null; strictMaxViolations: number; snapshotIntervalS: number }

const STEPS: { key: Stage; label: string }[] = [
  { key: "check", label: "System check" }, { key: "consent", label: "Consent" }, { key: "share", label: "Screen share" },
];

const errorText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong. Please try again.");

/**
 * Wraps a proctored screen: shows system check → consent → screen share before children, monitors while they
 * render, and ends the session (computing the integrity score) on unmount.
 */
export function ProctoredSession({ attemptId, interviewId, kind, onReady, onAutoSubmit, children }: ProctoredSessionProps) {
  useB2BTheme();
  const [stage, setStage] = useState<Stage>("preflight");
  const [pre, setPre] = useState<Preflight | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  /** R2.6: the final warning before auto-submit; stays until the student acknowledges it. */
  const [finalWarning, setFinalWarning] = useState<{ violations: number; max: number } | null>(null);
  const check = useRef<CheckResult | null>(null);
  const consents = useRef<AcceptedConsent[]>([]);
  const monitor = useRef<ProctorMonitor | null>(null);
  const screen = useRef<MediaStream | null>(null);
  const live = useRef<{ sessionId: string } | null>(null);
  const cb = useRef({ onReady, onAutoSubmit });
  cb.current = { onReady, onAutoSubmit };
  const target = useMemo(() => (attemptId ? { attemptId } : { interviewId }), [attemptId, interviewId]);

  const runPreflight = useCallback(async () => {
    setStage("preflight");
    setError(null);
    try {
      // Cast: under the non-strict app tsconfig zod infers all-optional fields.
      const p = (await proctorApi("preflight", target)) as Preflight;
      setPre(p);
      if (p.policy === "off") { setStage("off"); cb.current.onReady?.(null); }
      else setStage("check");
    } catch (e) {
      setError(errorText(e));
      setStage("error");
    }
  }, [target]);

  useEffect(() => { void runPreflight(); }, [runPreflight]);

  // Unmount: stop monitoring, send what's queued, end the session (server computes the score), release devices.
  useEffect(() => () => {
    const m = monitor.current;
    const s = live.current;
    monitor.current = null;
    live.current = null;
    stopStream(screen.current);
    if (!s) { stopStream(check.current?.stream); return; }
    void (async () => {
      try { await m?.stop(); } finally {
        stopStream(check.current?.stream);
        try { await proctorApi("end", { sessionId: s.sessionId }); } catch { /* the review page shows a provisional score */ }
        if (document.fullscreenElement) await document.exitFullscreen?.().catch(() => undefined);
      }
    })();
  }, []);

  const start = async (screenStream: MediaStream, displays: number) => {
    const c = check.current;
    if (!c || !pre) return;
    setStarting(true);
    setStartError(null);
    screen.current = screenStream;
    try {
      const r = await proctorApi("start", {
        ...target, kind, consents: consents.current,
        systemCheck: {
          browser: c.browser.browser.slice(0, 40), version: c.browser.version, chromium: c.browser.chromium, mobile: c.browser.mobile,
          camera: c.camera, mic: c.mic, speakers: c.speakers, screen: "monitor", displays,
          bandwidth_kbps: c.bandwidthKbps, cores: c.cores, memory_gb: c.memoryGb, tier: c.tier,
        },
      });
      // Interviews: the interview flow owns the microphone; keep only the camera here.
      if (kind === "interview") c.stream?.getAudioTracks().forEach((t) => t.stop());
      const m = new ProctorMonitor({
        sessionId: r.sessionId, policy: r.policy as Policy, kind, tier: c.tier, snapshotIntervalS: r.snapshotIntervalS,
        camera: c.stream, mic: kind === "assessment" ? c.stream : null, screen: screenStream,
        sendEvents: async (events) => (await proctorApi("events", { sessionId: r.sessionId, events: events as never })) as SendResult,
        uploadUrl: async (snapKind, contentType) => {
          const u = await proctorApi("snapshotUploadUrl", { sessionId: r.sessionId, kind: snapKind, contentType });
          return { path: u.path, token: u.token };
        },
        upload: async (job) => {
          const { error: upErr } = await supabase.storage.from("b2b-evidence").uploadToSignedUrl(job.path, job.token, job.blob, { contentType: job.type });
          if (upErr) throw upErr;
        },
        loadDetector: () => loadLandmarker(c.tier === "full"),
        storage: typeof sessionStorage !== "undefined" ? sessionStorage : null,
        onWarning: (w) => setWarning(w.message),
        onStrike: (s) => {
          if (s.final) setFinalWarning({ violations: s.violations, max: s.max });
          else setWarning(strikeText(s.violations, s.max));
        },
        onPausedChange: setPaused,
        onProblemsChange: setProblems,
        onAutoSubmit: () => cb.current.onAutoSubmit?.(),
      });
      monitor.current = m;
      live.current = { sessionId: r.sessionId };
      m.start();
      if (r.resumed) m.report("page_reload", "low", { note: "Session restarted (reload or reconnect)" });
      setSessionId(r.sessionId);
      setStage("running");
      cb.current.onReady?.(r.sessionId);
    } catch (e) {
      stopStream(screenStream);
      screen.current = null;
      setStartError(errorText(e));
    } finally {
      setStarting(false);
    }
  };

  const fix = async (p: Problem) => {
    const m = monitor.current;
    if (!m) return;
    if (p === "fullscreen") { await enterFullscreen(); return; }
    if (p === "screen") {
      const r = await shareEntireScreen();
      if ("error" in r) { setWarning(r.error); return; }
      screen.current = r.stream;
      if (!m.replaceScreen(r.stream)) setWarning("Please share your Entire screen.");
      return;
    }
    if (p === "camera") {
      try {
        const s = await requestCameraMic(navigator.mediaDevices, false);
        m.replaceCamera(s);
      } catch { setWarning("We couldn't turn your camera on. Check the camera permission in the address bar."); }
    }
  };

  const api = useMemo<ProctorApi>(() => ({
    sessionId,
    paused,
    report: (s) => monitor.current?.report(s.type, s.severity, s.meta),
  }), [sessionId, paused]);

  useEffect(() => {
    if (!warning) return;
    const id = setTimeout(() => setWarning(null), 6000);
    return () => clearTimeout(id);
  }, [warning]);

  if (stage === "off") return <Ctx.Provider value={noop}>{children}</Ctx.Provider>;

  if (stage === "running") {
    return (
      <Ctx.Provider value={api}>
        {/* React 18 types lack `inert`; "" is how React 18 sets the boolean attribute. */}
        <div aria-hidden={paused || undefined} {...(paused ? ({ inert: "" } as Record<string, string>) : {})}>{children}</div>
        {/* In-test overlays: words, not colour, carry the message. Nothing beyond the 160ms fade already in .hr-rise. */}
        {warning && !paused && (
          <div role="status" className="hr-rise fixed top-3 left-1/2 -translate-x-1/2 z-50 max-w-md bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)] px-4 py-2.5 text-sm text-foreground">
            <AlertTriangle className="inline h-4 w-4 mr-2 -mt-0.5 text-[var(--hr-orange)]" aria-hidden />{warning}
          </div>
        )}
        {finalWarning && !paused && (
          <div role="alertdialog" aria-modal="true" aria-labelledby="final-warning-title" aria-describedby="final-warning-body"
               className="fixed inset-0 z-[55] bg-background/95 flex items-center justify-center p-6">
            <div className="hr-rise max-w-md w-full space-y-4 text-center">
              <AlertTriangle className="h-9 w-9 mx-auto text-[var(--hr-red)]" aria-hidden />
              <h2 id="final-warning-title" className="hr-display text-xl">Final warning</h2>
              <p id="final-warning-body" className="text-sm text-[var(--hr-muted)]">
                That was serious violation {finalWarning.violations} of {finalWarning.max}. One more and your test is submitted
                automatically with the answers saved so far. Stay in full screen, keep this tab open and keep your face in view.
              </p>
              <Button onClick={() => setFinalWarning(null)}>I understand</Button>
            </div>
          </div>
        )}
        {!paused && problems.length > 0 && (
          <div role="alert" className="hr-rise fixed bottom-3 left-1/2 -translate-x-1/2 z-50 max-w-lg bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-orange)] px-4 py-3 text-sm space-y-2">
            {problems.map((p) => (
              <div key={p} className="flex items-center gap-3">
                <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--hr-orange)]" aria-hidden />
                <span className="flex-1">{PROBLEM_COPY[p]}</span>
                {p !== "display" && <Button size="sm" variant="outline" onClick={() => void fix(p)}>Fix</Button>}
              </div>
            ))}
          </div>
        )}
        {paused && (
          <div role="dialog" aria-modal="true" aria-label="Test paused" className="fixed inset-0 z-[60] bg-background flex items-center justify-center p-6">
            <div className="hr-rise max-w-md w-full space-y-4 text-center">
              <PauseCircle className="h-9 w-9 mx-auto text-[var(--hr-orange)]" aria-hidden />
              <h2 className="hr-display text-xl">Test paused</h2>
              <p className="text-sm text-[var(--hr-muted)]">Fix the items below to continue. Each pause is recorded for the reviewer.</p>
              <ul className="space-y-2 text-left">
                {problems.map((p) => (
                  <li key={p} className="flex items-center gap-3 bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)] p-3 text-sm">
                    <span className="flex-1">{PROBLEM_COPY[p]}</span>
                    {p === "screen" && <Button size="sm" onClick={() => void fix(p)}>Share entire screen</Button>}
                    {p === "camera" && <Button size="sm" onClick={() => void fix(p)}>Turn camera on</Button>}
                    {p === "fullscreen" && <Button size="sm" onClick={() => void fix(p)}>Return to full screen</Button>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Ctx.Provider>
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.key === stage);
  return (
    <Ctx.Provider value={noop}>
      <div className="min-h-screen bg-background text-foreground flex items-start justify-center p-4 sm:p-8">
        <div className="hr-rise w-full max-w-2xl bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)] p-5 sm:p-6 space-y-5">
          <header className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-[var(--hr-orange)] shrink-0" aria-hidden />
            <div>
              <h1 className="hr-display text-lg">AI-proctored {kind === "interview" ? "interview" : "test"}</h1>
              {pre && <p className="text-xs text-[var(--hr-muted)] mt-0.5">{pre.orgName} · {policyLabel(pre.policy, pre.strictMaxViolations)}</p>}
            </div>
          </header>
          {stepIndex >= 0 && (
            <ol className="flex gap-2 text-xs" aria-label="Steps">
              {STEPS.map((s, i) => (
                <li key={s.key} aria-current={i === stepIndex ? "step" : undefined}
                    className={`hr-label !text-[10px] px-3 py-1.5 ${i === stepIndex ? "bg-[var(--hr-orange)] !text-[#07090F]" : i < stepIndex ? "bg-[var(--hr-surface-2)]" : "shadow-[inset_0_0_0_1px_var(--hr-rule)]"}`}>
                  {i + 1}. {s.label}
                </li>
              ))}
            </ol>
          )}
          {stage === "preflight" && <p className="text-sm text-[var(--hr-muted)]">Getting things ready…</p>}
          {stage === "error" && (
            <div role="alert" className="space-y-3">
              <p className="text-sm text-[var(--hr-red-ink)]">{error}</p>
              <Button variant="outline" onClick={() => void runPreflight()}>Try again</Button>
            </div>
          )}
          {stage === "check" && (
            <SystemCheckPanel kind={kind} onPassed={(r) => { check.current = r; setStage("consent"); }} />
          )}
          {stage === "consent" && pre && (
            <ConsentStep ctx={{ orgName: pre.orgName, retentionDays: pre.retentionDays, contactEmail: pre.contactEmail, kind, hasAttempt: !!attemptId }}
                         onAccept={(items) => { consents.current = items; setStage("share"); }}
                         onDecline={() => setStage("declined")} />
          )}
          {stage === "declined" && (
            <div className="space-y-3">
              <p className="text-sm">This {kind === "interview" ? "interview" : "test"} is proctored, so it can't start without your consent. If you have questions, contact {pre?.orgName ?? "the organiser"}{pre?.contactEmail ? ` at ${pre.contactEmail}` : ""}.</p>
              <Button variant="outline" onClick={() => setStage("consent")}>Review consent again</Button>
            </div>
          )}
          {stage === "share" && <ScreenShareStep onStart={(s, d) => void start(s, d)} starting={starting} error={startError} />}
        </div>
      </div>
    </Ctx.Provider>
  );
}

export function policyLabel(policy: ProctoringPolicyV1, strictMax: number): string {
  switch (policy) {
    case "standard": return "Standard proctoring: warnings only";
    case "strict": return `Strict proctoring: auto-submits after ${strictMax} serious violations`;
    case "maximum": return "Maximum proctoring: the test pauses until problems are fixed";
    default: return "Proctoring off";
  }
}
