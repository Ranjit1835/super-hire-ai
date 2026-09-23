import { Clock, MessageSquare, Target } from "lucide-react";
import type { InterviewModule } from "../types";

export function ModuleMeta({ m }: { m: Pick<InterviewModule, "spec"> }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" />{m.spec.max_turns} questions</span>
      <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{m.spec.max_minutes} min</span>
      <span className="inline-flex items-center gap-1"><Target className="h-3 w-3" />Pass {m.spec.pass_threshold}/10</span>
    </div>
  );
}
