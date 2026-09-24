import { CheckCircle2, Mic, Volume2, WifiOff } from "lucide-react";

export function PreflightTips() {
  return (
    <ul className="text-sm space-y-1.5 rounded-lg border border-border/60 p-4">
      <li className="flex gap-2"><Mic className="h-4 w-4 mt-0.5 text-violet-300 shrink-0" /> Use a headset if you can, in a quiet spot. Allow the microphone when asked.</li>
      <li className="flex gap-2"><Volume2 className="h-4 w-4 mt-0.5 text-violet-300 shrink-0" /> The interviewer speaks each question. Take a moment to think, then answer out loud.</li>
      <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 mt-0.5 text-violet-300 shrink-0" /> Tap <strong>Done answering</strong> when you finish, or just pause for a few seconds.</li>
      <li className="flex gap-2"><WifiOff className="h-4 w-4 mt-0.5 text-violet-300 shrink-0" /> If your connection drops, reopen this page — you'll continue where you left off.</li>
    </ul>
  );
}
