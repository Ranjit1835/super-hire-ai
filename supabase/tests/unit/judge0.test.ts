// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  b64decode, b64encode, buildSubmission, codingScore, createJudge0, judge0FromEnv, judgeLimits, judgeTests, mapStatus,
  normalizeOutput, outputsMatch, summarize, toOutcome, type RunOutcome, type TestCase,
} from "../../functions/_shared/judge0";

const ok = (stdout: string, extra: Partial<RunOutcome> = {}): RunOutcome =>
  ({ status: "ran", stdout, stderr: "", compileOutput: "", timeMs: 12, memoryKb: 3000, judgeStatusId: 3, ...extra });
const test = (id: string, input: string, expected: string, sample = false, weight = 1): TestCase =>
  ({ id, input, expected_output: expected, is_sample: sample, weight });

describe("Judge0 core", () => {
  it("round-trips UTF-8 base64", () => {
    const s = "print('नमस्ते ✓')\n";
    expect(b64decode(b64encode(s))).toBe(s);
    expect(b64decode(null)).toBe("");
  });

  it("compares outputs ignoring trailing whitespace per line and trailing blank lines", () => {
    expect(normalizeOutput("1 2  \r\n3\t\n\n")).toBe("1 2\n3");
    expect(outputsMatch("3\n", "3")).toBe(true);
    expect(outputsMatch("1 2 \n3", "1 2\n3\n\n")).toBe(true);
    expect(outputsMatch(" 3", "3")).toBe(false);          // leading whitespace matters
    expect(outputsMatch("1\n\n2", "1\n2")).toBe(false);   // inner blank lines matter
  });

  it("builds requests with language ids and clamped limits", () => {
    const s = buildSubmission({ language: "cpp", code: "int main(){}", stdin: "5" }, { timeLimitMs: 1500, memoryLimitKb: 128000 });
    expect(s).toMatchObject({ language_id: 54, cpu_time_limit: 1.5, memory_limit: 128000, wall_time_limit: 5.5 });
    expect(b64decode(s.source_code)).toBe("int main(){}");
    expect(b64decode(s.stdin)).toBe("5");
    expect(buildSubmission({ language: "python", code: "", stdin: "" }, {}).language_id).toBe(71);
    expect(judgeLimits({ timeLimitMs: 60_000, memoryLimitKb: 4_000_000 })).toEqual({ cpu_time_limit: 15, wall_time_limit: 20, memory_limit: 512000 });
    expect(judgeLimits({})).toMatchObject({ cpu_time_limit: 2, memory_limit: 256000 });
  });

  it("maps Judge0 statuses", () => {
    expect(mapStatus(1)).toBeNull();
    expect(mapStatus(2)).toBeNull();
    expect(mapStatus(3)).toBe("ran");
    expect(mapStatus(5)).toBe("time_limit");
    expect(mapStatus(6)).toBe("compile_error");
    expect(mapStatus(11)).toBe("runtime_error");
    expect(mapStatus(13)).toBe("internal_error");
    expect(toOutcome({ status: { id: 3 }, stdout: b64encode("3\n"), time: "0.021", memory: 900 }))
      .toMatchObject({ status: "ran", stdout: "3\n", timeMs: 21, memoryKb: 900 });
    expect(toOutcome({ status: { id: 2 } })).toBeNull();
  });

  it("grades weighted tests; stdout/expected only for samples", () => {
    const tests = [test("s", "1 2", "3", true, 1), test("h1", "5 5", "10", false, 3), test("h2", "0 0", "0", false, 1)];
    const sum = summarize(tests, [ok("3\n"), ok("11"), ok("", { status: "time_limit" })]);
    expect(sum.passed).toBe(1);
    expect(sum.total).toBe(3);
    expect(sum.fraction).toBeCloseTo(1 / 5);
    expect(codingScore(10, sum)).toBe(2);
    expect(sum.tests[0]).toMatchObject({ sample: true, passed: true, stdout: "3\n", expected: "3" });
    expect(sum.tests[1]).toEqual({ test_id: "h1", sample: false, passed: false, status: "wrong_answer", time_ms: 12, memory_kb: 3000 });
    expect(sum.tests[2].status).toBe("time_limit");
    const compileFail = summarize([tests[0]], [ok("", { status: "compile_error", compileOutput: "error: x" })]);
    expect(compileFail.compile_output).toBe("error: x");
    expect(codingScore(10, { fraction: 1 })).toBe(10);
  });
});

describe("Judge0 client", () => {
  function fakeJudge(behaviour: (stdin: string) => { id: number; stdout?: string }, opts: { pendingPolls?: number } = {}) {
    const store = new Map<string, { stdin: string; polls: number }>();
    let n = 0;
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (init.method === "POST") {
        const body = JSON.parse(String(init.body)) as { submissions: { stdin: string }[] };
        return new Response(JSON.stringify(body.submissions.map((s) => {
          const token = `t${n++}`;
          store.set(token, { stdin: b64decode(s.stdin), polls: 0 });
          return { token };
        })));
      }
      const tokens = new URL(url).searchParams.get("tokens")!.split(",");
      return new Response(JSON.stringify({ submissions: tokens.map((token) => {
        const s = store.get(token)!;
        s.polls++;
        if (s.polls <= (opts.pendingPolls ?? 0)) return { token, status: { id: 2 } };
        const b = behaviour(s.stdin);
        return { token, status: { id: b.id }, stdout: b.stdout ? b64encode(b.stdout) : null, time: "0.01", memory: 1000 };
      }) }));
    });
    return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
  }

  it("submits a batch, polls until done, and sends the auth header", async () => {
    const { fetchImpl, calls } = fakeJudge((stdin) => ({ id: 3, stdout: String(stdin.split(" ").map(Number).reduce((a, b) => a + b, 0)) }), { pendingPolls: 1 });
    const client = createJudge0({ url: "http://judge:2358/", authToken: "secret", fetch: fetchImpl, sleep: async () => {} });
    const tests = [test("s", "1 2", "3", true), test("h", "5 5", "10", false, 2)];
    const sum = await judgeTests(client, "python", "print(sum(map(int,input().split())))", tests, { timeLimitMs: 1000 });
    expect(sum.passed).toBe(2);
    expect(sum.fraction).toBe(1);
    expect(calls[0].url).toBe("http://judge:2358/submissions/batch?base64_encoded=true&wait=false");
    expect((calls[0].init.headers as Record<string, string>)["X-Auth-Token"]).toBe("secret");
    expect(calls.filter((c) => c.init.method === "GET").length).toBe(2);
  });

  it("chunks batches of more than 20", async () => {
    const { fetchImpl, calls } = fakeJudge(() => ({ id: 3, stdout: "x" }));
    const client = createJudge0({ url: "http://j", fetch: fetchImpl, sleep: async () => {} });
    const out = await client.run(Array.from({ length: 45 }, () => ({ language: "c" as const, code: "", stdin: "" })), {});
    expect(out).toHaveLength(45);
    expect(calls.filter((c) => c.init.method === "POST").length).toBe(3);
  });

  it("gives up at the hard timeout and marks unfinished runs as timeout", async () => {
    const { fetchImpl } = fakeJudge(() => ({ id: 3 }), { pendingPolls: 1000 });
    let t = 0;
    const client = createJudge0({ url: "http://j", fetch: fetchImpl, sleep: async (ms) => { t += ms; }, now: () => t, timeoutMs: 5_000 });
    const out = await client.run([{ language: "java", code: "", stdin: "" }], {});
    expect(out[0].status).toBe("timeout");
  });

  it("reports an unreachable server as JUDGE0_UNAVAILABLE", async () => {
    const client = createJudge0({ url: "http://j", fetch: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch });
    await expect(client.run([{ language: "python", code: "", stdin: "" }], {})).rejects.toMatchObject({ code: "JUDGE0_UNAVAILABLE" });
    const bad = createJudge0({ url: "http://j", fetch: (async () => new Response("nope", { status: 502 })) as unknown as typeof fetch });
    await expect(bad.run([{ language: "python", code: "", stdin: "" }], {})).rejects.toMatchObject({ code: "JUDGE0_UNAVAILABLE" });
  });

  it("is not configured without JUDGE0_URL", () => {
    expect(judge0FromEnv(() => undefined, fetch)).toBeNull();
    expect(judge0FromEnv((k) => (k === "JUDGE0_URL" ? "http://j" : undefined), fetch)).not.toBeNull();
  });
});
