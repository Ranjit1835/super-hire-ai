// @vitest-environment node
// Direct-API isolation check against a real (non-production) Supabase project.
// Runs only when STAGING_SUPABASE_URL / STAGING_SUPABASE_ANON_KEY /
// STAGING_SUPABASE_SERVICE_ROLE_KEY are set and B2B migrations are applied there.
// Uses the public REST API with each user's own JWT — the same access a student
// with devtools open has.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL = process.env.STAGING_SUPABASE_URL;
const ANON = process.env.STAGING_SUPABASE_ANON_KEY;
const SERVICE = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
const PRODUCTION_REF = "zhfahrrxuguagwbujkiz";
const enabled = !!(URL && ANON && SERVICE);

if (enabled && URL!.includes(PRODUCTION_REF)) {
  throw new Error("Refusing to run isolation tests against the production project");
}

describe.skipIf(!enabled)("tenancy via REST API (staging)", () => {
  let admin: SupabaseClient;
  const run = randomUUID().slice(0, 8);
  const created: { users: string[]; orgs: string[] } = { users: [], orgs: [] };
  let orgA: string, orgB: string;
  let studentA: SupabaseClient, adminA: SupabaseClient;

  async function userClient(email: string): Promise<{ id: string; client: SupabaseClient }> {
    const password = `T3st-${randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    created.users.push(data.user.id);
    const client = createClient(URL!, ANON!, { auth: { persistSession: false } });
    const { error: e2 } = await client.auth.signInWithPassword({ email, password });
    if (e2) throw e2;
    return { id: data.user.id, client };
  }

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
    const mkOrg = async (slug: string) => {
      const { data, error } = await admin.from("organizations")
        .insert({ name: slug, slug, type: "college" }).select("id").single();
      if (error) throw error;
      created.orgs.push(data.id);
      return data.id as string;
    };
    orgA = await mkOrg(`rls-a-${run}`);
    orgB = await mkOrg(`rls-b-${run}`);
    const sA = await userClient(`rls-student-a-${run}@example.com`);
    const aA = await userClient(`rls-admin-a-${run}@example.com`);
    const sB = await userClient(`rls-student-b-${run}@example.com`);
    await admin.from("org_memberships").insert([
      { org_id: orgA, user_id: sA.id, role: "student" },
      { org_id: orgA, user_id: aA.id, role: "org_admin" },
      { org_id: orgB, user_id: sB.id, role: "student" },
    ]).throwOnError();
    studentA = sA.client;
    adminA = aA.client;
  }, 60000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("organizations").delete().in("id", created.orgs);
    for (const id of created.users) await admin.auth.admin.deleteUser(id);
  });

  it("student A cannot read org B or its roster", async () => {
    const { data: orgs } = await studentA.from("organizations").select("id");
    expect(orgs!.map((o) => o.id)).toEqual([orgA]);
    const { data: roster } = await studentA.from("org_memberships").select("*").eq("org_id", orgB);
    expect(roster).toEqual([]);
  });

  it("admin A cannot write org B", async () => {
    const { error } = await adminA.from("batches").insert({ org_id: orgB, name: "injected" });
    expect(error).not.toBeNull();
    const { data } = await adminA.from("organizations").update({ name: "pwned" }).eq("id", orgB).select();
    expect(data).toEqual([]);
    const { data: memberships } = await adminA.from("org_memberships").delete().eq("org_id", orgB).select();
    expect(memberships).toEqual([]);
  });

  it("admin A cannot attach users to their org directly", async () => {
    const outsider = await userClient(`rls-outsider-${run}@example.com`);
    const { error } = await adminA.from("org_memberships").insert({ org_id: orgA, user_id: outsider.id, role: "student" });
    expect(error).not.toBeNull();
  });
});
