// Embedded Postgres (PGlite) harness for RLS tests.
// Recreates the slice of Supabase that RLS depends on — anon/authenticated roles,
// auth.users, auth.uid() from JWT claims, user_roles/has_role — then applies the
// real B2B migration files from supabase/migrations. Queries run through asUser()
// execute exactly as PostgREST would for a request carrying that user's JWT.
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

const SUPABASE_STUB = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;

  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT);
  CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

  -- Supabase grants table privileges broadly and relies on RLS; mirror that so
  -- the tests prove RLS (not missing grants) is what blocks access.
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

  -- From 20260215160118 (the pieces B2B depends on)
  CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
  CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role public.app_role NOT NULL,
    UNIQUE (user_id, role)
  );
  ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
  CREATE OR REPLACE FUNCTION public.update_updated_at_column()
  RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
  LANGUAGE plpgsql SET search_path = public;
`;

export function b2bMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => /_b2b_.*\.sql$/.test(f)).sort();
}

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of b2bMigrationFiles()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (e) {
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
    }
  }
  return db;
}

export async function createUser(db: PGlite, opts: { superAdmin?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, `${id}@test.local`]);
  if (opts.superAdmin) await db.query("INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')", [id]);
  return id;
}

async function runAs<T>(
  db: PGlite, role: "anon" | "authenticated" | "service_role", userId: string | null,
  fn: (tx: Transaction) => Promise<T>, commit: boolean,
): Promise<T> {
  let result: T;
  await db.transaction(async (tx) => {
    await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    await tx.exec(`SET LOCAL ROLE ${role}`);
    result = await fn(tx);
    if (!commit) await tx.rollback();
  });
  return result!;
}

/** Run fn as a PostgREST request from `userId` (null = anon). Always rolled back. */
export function asUser<T>(db: PGlite, userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return runAs(db, userId ? "authenticated" : "anon", userId, fn, false);
}

/** Run fn as an edge function holding the service-role key. Committed. */
export function asService<T>(db: PGlite, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return runAs(db, "service_role", null, fn, true);
}

/**
 * Run a statement that must be refused (RLS WITH CHECK, trigger, FK, or missing
 * privilege). Uses a savepoint so the surrounding test transaction stays usable.
 */
export async function expectRejected(tx: Transaction, sql: string, params: unknown[] = []): Promise<string> {
  await tx.exec("SAVEPOINT expect_rejected");
  try {
    await tx.query(sql, params);
  } catch (e) {
    await tx.exec("ROLLBACK TO SAVEPOINT expect_rejected");
    return (e as Error).message;
  }
  throw new Error(`Expected statement to be rejected, but it succeeded: ${sql}`);
}

/** Row count affected by an UPDATE/DELETE (RLS hides rows rather than erroring). */
export async function affected(tx: Transaction, sql: string, params: unknown[] = []): Promise<number> {
  const r = await tx.query(sql, params);
  return r.affectedRows ?? 0;
}
