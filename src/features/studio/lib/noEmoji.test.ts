import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripEmoji } from "./noEmoji";

const e = (...cps: number[]) => String.fromCodePoint(...cps);
const WAVE = e(0x1f44b), ROCKET = e(0x1f680), FIRE = e(0x1f525), CHECK = e(0x2705);
const KEYCAP_1 = "1" + e(0xfe0f, 0x20e3), DEV = e(0x1f468, 0x200d, 0x1f4bb), FLAG_IN = e(0x1f1ee, 0x1f1f3), THUMB_TONE = e(0x1f44d, 0x1f3fd);

describe("stripEmoji", () => {
  it("removes emojis, sequences, flags and skin tones but keeps text and symbols", () => {
    expect(stripEmoji(`Hi Ravi! ${WAVE} Let's fix this ${ROCKET}${FIRE}`)).toBe("Hi Ravi! Let's fix this");
    expect(stripEmoji(`Step ${KEYCAP_1} done ${CHECK}`)).toBe("Step 1 done");
    expect(stripEmoji(`${DEV} Engineer`).trim()).toBe("Engineer");
    expect(stripEmoji(`Made in ${FLAG_IN} India ${THUMB_TONE}`)).toBe("Made in India");
    const keep = "Microsoft" + e(0xae) + " Azure" + e(0x2122) + " " + e(0xa9) + " 2026 " + e(0x2192) + " next";
    expect(stripEmoji(keep)).toBe(keep);
  });
});

const EMOJI = /(?![©®™])\p{Extended_Pictographic}|️/u;
function files(p: string): string[] {
  if (statSync(p).isFile()) return [p];
  return readdirSync(p).flatMap((n) => files(join(p, n)));
}

describe("Resume Studio has no emojis", () => {
  it("in UI code and server functions", () => {
    const roots = [
      "src/features/studio",
      "src/components/StudioNavBar.tsx", "src/components/StudioFAB.tsx", "src/components/StudioOnboardingTooltip.tsx", "src/components/PostAnalysisStudioToast.tsx",
      "supabase/functions/studio-chat", "supabase/functions/studio-parse-resume", "supabase/functions/studio-create-session",
      "supabase/functions/_shared/no-emoji.ts",
    ];
    const hits = roots.flatMap(files).filter((f) => /\.(tsx?|ts)$/.test(f) && !/\.test\./.test(f))
      .flatMap((f) => readFileSync(f, "utf8").split("\n").map((line, i) => [f, i + 1, line] as const))
      .filter(([, , line]) => EMOJI.test(line))
      .map(([f, n]) => `${f}:${n}`);
    expect(hits).toEqual([]);
  });

  it("tells the model not to use emojis and strips them from its replies", () => {
    const chat = readFileSync("supabase/functions/studio-chat/index.ts", "utf8");
    expect(chat).toContain("${NO_EMOJI_RULE}");
    expect(chat).toContain("const content = stripEmoji(rawContent);");
    expect(chat).toMatch(/const delta = rawDelta \? stripEmoji\(rawDelta\)/);
  });
});
