// /interview/v1/live-spike — DEV ONLY. Time-boxed Gemini Live experiment (docs/b2b/gemini-live-spike.md):
// the browser gets a short-lived token from b2b-interview (liveToken), connects straight to Gemini Live over a
// WebSocket, runs a short scripted interview and records per-turn latency (speech end → first reply audio) and the
// session length. Nothing here is used by the real interview room.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { V1Shell } from "../layout/V1Shell";
import { latencyStats } from "../../../supabase/functions/_shared/interview-v1/stats";
import { interviewV1Api } from "./api";
import { LIVE_WS_URL, createLiveMeter, createVad, floatToPcm16Base64, pcm16Base64ToFloat, rms, setupMessage, type LiveTurn } from "./live";

interface LogLine { at: string; who: "you" | "model" | "system"; text: string }

export default function LiveSpikePage() {
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "closed" | "error">("idle");
  const [log, setLog] = useState<LogLine[]>([]);
  const [turns, setTurns] = useState<LiveTurn[]>([]);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const cleanup = useRef<() => void>(() => {});
  const meter = useRef(createLiveMeter());

  const add = (who: LogLine["who"], text: string) =>
    setLog((l) => [...l.slice(-200), { at: new Date().toLocaleTimeString(), who, text }]);

  useEffect(() => () => cleanup.current(), []);
  useEffect(() => {
    if (status !== "live") return;
    const t = setInterval(() => setSeconds(meter.current.sessionSeconds(performance.now())), 1000);
    return () => clearInterval(t);
  }, [status]);

  async function connect() {
    setStatus("connecting");
    setNote(null);
    meter.current = createLiveMeter();
    setTurns([]);
    try {
      const { token, model } = await interviewV1Api("liveToken", {});
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ctx = new AudioContext();
      const out = new AudioContext({ sampleRate: 24000 });
      let playAt = 0;
      const ws = new WebSocket(`${LIVE_WS_URL}?access_token=${encodeURIComponent(token)}`);
      const src = ctx.createMediaStreamSource(mic);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const vad = createVad({ onEnd: (at) => meter.current.speechEnded(at) });

      proc.onaudioprocess = (e) => {
        const frame = e.inputBuffer.getChannelData(0);
        vad.push(rms(frame), performance.now());
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ realtimeInput: { audio: { data: floatToPcm16Base64(frame, ctx.sampleRate), mimeType: "audio/pcm;rate=16000" } } }));
        }
      };
      ws.onopen = () => {
        ws.send(JSON.stringify(setupMessage(model)));
        src.connect(proc);
        proc.connect(ctx.destination);
        meter.current.sessionStarted(performance.now());
        setStatus("live");
        add("system", `Connected (${model}). Speak when the interviewer asks.`);
      };
      ws.onmessage = async (ev) => {
        const raw = typeof ev.data === "string" ? ev.data : await (ev.data as Blob).text();
        const msg = JSON.parse(raw) as {
          serverContent?: { modelTurn?: { parts?: { inlineData?: { data: string } }[] }; inputTranscription?: { text?: string }; outputTranscription?: { text?: string }; interrupted?: boolean };
          goAway?: { timeLeft?: string };
        };
        const sc = msg.serverContent;
        for (const p of sc?.modelTurn?.parts ?? []) {
          if (!p.inlineData?.data) continue;
          const ms = meter.current.audioChunk(performance.now());
          if (ms !== null) setTurns(meter.current.turns);
          const samples = pcm16Base64ToFloat(p.inlineData.data);
          const buf = out.createBuffer(1, samples.length, 24000);
          buf.copyToChannel(samples, 0);
          const node = out.createBufferSource();
          node.buffer = buf;
          node.connect(out.destination);
          playAt = Math.max(playAt, out.currentTime);
          node.start(playAt);
          playAt += buf.duration;
        }
        if (sc?.inputTranscription?.text) add("you", sc.inputTranscription.text);
        if (sc?.outputTranscription?.text) add("model", sc.outputTranscription.text);
        if (sc?.interrupted) add("system", "Interrupted (barge-in)");
        if (msg.goAway) add("system", `Server will close the session soon (time left ${msg.goAway.timeLeft ?? "?"})`);
      };
      ws.onclose = (ev) => {
        meter.current.sessionEnded(performance.now());
        setSeconds(meter.current.sessionSeconds(performance.now()));
        add("system", `Closed: code ${ev.code}${ev.reason ? `, ${ev.reason}` : ""}`);
        setStatus("closed");
        cleanup.current();
      };
      ws.onerror = () => setNote("WebSocket error (see the console).");
      cleanup.current = () => {
        proc.disconnect(); src.disconnect();
        mic.getTracks().forEach((t) => t.stop());
        void ctx.close().catch(() => undefined); void out.close().catch(() => undefined);
        if (ws.readyState === WebSocket.OPEN) ws.close();
      };
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  const stats = latencyStats(turns.map((t) => t.latencyMs));
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ turns, stats, sessionSeconds: seconds, log }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gemini-live-spike-${Date.now()}.json`;
    a.click();
  };

  return (
    <V1Shell title="Gemini Live spike" subtitle="Developer experiment, not part of the product">
      <div className="space-y-4 max-w-3xl">
        <p className="text-sm text-muted-foreground">Runs a 5-question scripted interview directly against Gemini Live with an ephemeral token. Use headphones. See docs/b2b/gemini-live-spike.md for what to record.</p>
        <div className="flex gap-2">
          <Button onClick={() => void connect()} disabled={status === "connecting" || status === "live"}>Get token and connect</Button>
          <Button variant="outline" onClick={() => cleanup.current()} disabled={status !== "live"}>Stop</Button>
          <Button variant="outline" onClick={exportJson} disabled={!turns.length && !log.length}>Download results (JSON)</Button>
        </div>
        <p className="text-sm" role="status">Status: {status}{note ? ` · ${note}` : ""}</p>
        <div className="rounded-md border border-border p-3 text-sm" data-testid="live-stats">
          Turns {stats.count} · p50 {stats.p50 ?? "–"} ms · p95 {stats.p95 ?? "–"} ms · session {seconds ?? "–"} s
        </div>
        <ol className="text-sm space-y-1 max-h-80 overflow-y-auto">
          {log.map((l, i) => <li key={i}><span className="text-muted-foreground tabular-nums">{l.at}</span> <strong>{l.who}</strong>: {l.text}</li>)}
        </ol>
      </div>
    </V1Shell>
  );
}
