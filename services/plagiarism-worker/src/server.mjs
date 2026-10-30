// HTTP entry point for Cloud Run. POST /run (Authorization: Bearer WORKER_TOKEN) drains the queue and answers when
// done, so Cloud Run keeps CPU allocated for the whole run. GET /healthz for probes.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_TOKEN, PORT (Cloud Run sets it).
import { createServer } from "node:http";
import { analyze } from "./analyze.mjs";
import { authorized, drain, supabaseRpc } from "./worker.mjs";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_TOKEN } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !WORKER_TOKEN) {
  console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and WORKER_TOKEN are required");
  process.exit(1);
}

const rpc = supabaseRpc({ url: SUPABASE_URL, serviceKey: SUPABASE_SERVICE_ROLE_KEY });
let running = null;   // one drain at a time per instance; concurrent pings share it

createServer(async (req, res) => {
  const send = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method === "GET" && req.url === "/healthz") return send(200, { ok: true });
  if (req.method !== "POST" || req.url !== "/run") return send(404, { error: "not found" });
  if (!authorized(req.headers.authorization, WORKER_TOKEN)) return send(401, { error: "unauthorized" });
  req.resume();
  try {
    running ??= drain({ rpc, analyze }).finally(() => { running = null; });
    send(200, await running);
  } catch (e) {
    console.error(JSON.stringify({ msg: "drain failed", error: e instanceof Error ? e.message : String(e) }));
    send(500, { error: "drain failed" });
  }
}).listen(Number(process.env.PORT ?? 8080), () => console.log(JSON.stringify({ msg: "plagiarism worker listening" })));
