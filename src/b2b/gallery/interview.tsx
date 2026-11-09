// Gallery scenes for the interview area (owner: the interview clone). Fixture data only; see ./kit.tsx and ./college.tsx.
// None of these pages read react-query: the loop talks to b2b-interview directly, so (matching the proctor area's
// CheckResultsPreview pattern) each scene renders the pure, props-driven view with fixture state instead of the
// network-calling route component.
import type { ComponentType } from "react";
import { StartPreview } from "../interview/StartPage";
import { RoomView } from "../interview/RoomPage";
import { AudioCheck } from "../interview/AudioCheck";
import { useB2BTheme } from "../layout/V1Shell";

const IV = "11111111-1111-4111-8111-111111111111";
const DRIVE = "22222222-2222-4222-8222-222222222222";

const sections = [
  { key: "intro" as const, label: "Introduction", minutes: 2 },
  { key: "technical" as const, label: "Technical", minutes: 8 },
  { key: "code_walkthrough" as const, label: "Code walkthrough", minutes: 5 },
];

const transcript = [
  { turn: 1, role: "interviewer" as const, text: "Let's start with your submission. Walk me through how your duplicate-check function works.", offsetS: 0, at: "00:00" },
  { turn: 1, role: "candidate" as const, text: "Sure. I loop through the roll numbers once, keep a set of the ones I've already seen, and flag anything that's already in the set.", offsetS: 14, at: "00:14" },
  { turn: 2, role: "interviewer" as const, text: "What's the time complexity of that, and why did you pick a set over sorting first?", offsetS: 20, at: "00:20" },
];

const roomFixture = {
  interviewId: IV, context: "drive" as const, contextId: DRIVE, title: "CSE 2027 placement drive", status: "in_progress" as const,
  endReason: null, policy: "strict" as const,
  startedAt: new Date(Date.now() - 320_000).toISOString(), deadlineAt: new Date(Date.now() + 582_000).toISOString(),
  serverNow: new Date().toISOString(), durationMin: 15, sections, section: "technical" as const, turnCount: 2,
  question: "What's the time complexity of that, and why did you pick a set over sorting first?",
  closing: null, transcript, codeWalkthrough: true, resultsVisible: false, result: null,
};

const latency = { count: 2, p50: 1180, p95: 1180, max: 1180, overTarget: 0 };

const noop = () => {};

/** Scene 1: the pre-interview moment, the one place this area allows a 3D stage. */
function Start() {
  return <StartPreview />;
}

/** Scene 2: mid-interview, interviewer listening to the candidate's answer. Calm, no 3D, no decoration. */
function Room() {
  useB2BTheme();
  return (
    <RoomView room={roomFixture} phase="listening" error={null} issue={null}
      voiceTranscript="...because a set gives constant-time lookups, so the whole pass stays linear." level={0.62}
      remainingMs={582_000} latency={latency}
      begin={noop} resume={noop} end={noop} answerAgain={noop} retry={noop} recheckPassed={noop} finishAnswer={noop} />
  );
}

/** Scene 3: the room with the audio re-check open right after the first question, early in the interview. No
 * transcript yet, so the Transcript list's own auto-scroll-to-latest never fires and the re-check stays on screen
 * at 1366x577 alongside the header and question above it. */
function RoomRecheck() {
  useB2BTheme();
  return (
    <RoomView room={{ ...roomFixture, section: "intro", turnCount: 0, question: transcript[0].text, transcript: [] }}
      phase="audio_check" error={null} issue="mic_denied" voiceTranscript="" level={0} remainingMs={582_000} latency={latency}
      begin={noop} resume={noop} end={noop} answerAgain={noop} retry={noop} recheckPassed={noop} finishAnswer={noop} />
  );
}

/** Scene 4: the audio check on its own, mid-way through (sound confirmed, mic not tested yet). */
function AudioCheckScene() {
  useB2BTheme();
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <AudioCheck issue="mic_denied" onResume={noop} onPassed={noop} />
    </div>
  );
}

export const scenes: Record<string, ComponentType> = {
  start: Start,
  room: Room,
  "room-recheck": RoomRecheck,
  "audio-check": AudioCheckScene,
};
