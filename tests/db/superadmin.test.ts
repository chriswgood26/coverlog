import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { getPlatformContext } from "@/lib/auth/platform";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const EMAIL_A = "superadmin-a@example.com";
const EMAIL_B = "superadmin-b@example.com";
const ORIG_ALLOW = process.env.SUPERADMIN_EMAILS;

let userA: string; let userB: string;
let clientA: ReturnType<typeof createClient>;

beforeAll(async () => {
  const a = await admin.auth.admin.createUser({ email: EMAIL_A, password: "Test-Passw0rd!", email_confirm: true });
  userA = a.data!.user!.id;
  const b = await admin.auth.admin.createUser({ email: EMAIL_B, password: "Test-Passw0rd!", email_confirm: true });
  userB = b.data!.user!.id;
  clientA = createClient(URL, ANON, { auth: { persistSession: false } });
  await clientA.auth.signInWithPassword({ email: EMAIL_A, password: "Test-Passw0rd!" });
});

afterAll(async () => {
  if (ORIG_ALLOW === undefined) delete process.env.SUPERADMIN_EMAILS;
  else process.env.SUPERADMIN_EMAILS = ORIG_ALLOW;
  if (userA) await admin.auth.admin.deleteUser(userA);
  if (userB) await admin.auth.admin.deleteUser(userB);
  await asAdmin((q) => q(`truncate table public.superadmins restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("getPlatformContext", () => {
  it("recognizes a superadmin via the SUPERADMIN_EMAILS allowlist (bootstrap)", async () => {
    process.env.SUPERADMIN_EMAILS = `other@x.com, ${EMAIL_A}`;
    const ctx = await getPlatformContext(clientA);
    expect(ctx).not.toBeNull();
    expect(ctx!.userId).toBe(userA);
    expect(ctx!.email).toBe(EMAIL_A);
  });

  it("recognizes a superadmin via a superadmins row (self-read RLS)", async () => {
    process.env.SUPERADMIN_EMAILS = "";
    await asAdmin((q) => q(`insert into public.superadmins (user_id, email) values ($1,$2)`, [userA, EMAIL_A]));
    const ctx = await getPlatformContext(clientA);
    expect(ctx).not.toBeNull();
    expect(ctx!.userId).toBe(userA);
  });

  it("returns null for a signed-in non-superadmin", async () => {
    process.env.SUPERADMIN_EMAILS = "";
    await asAdmin((q) => q(`delete from public.superadmins where user_id = $1`, [userA]));
    const ctx = await getPlatformContext(clientA);
    expect(ctx).toBeNull();
  });

  it("returns null for an anonymous (signed-out) client", async () => {
    process.env.SUPERADMIN_EMAILS = "";
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const ctx = await getPlatformContext(anon);
    expect(ctx).toBeNull();
  });

  it("does not let one user read another user's superadmin row (self-read RLS isolation)", async () => {
    await asAdmin((q) => q(`insert into public.superadmins (user_id, email) values ($1,$2)`, [userB, EMAIL_B]));
    const { data } = await clientA.from("superadmins").select("user_id").eq("user_id", userB);
    expect(data ?? []).toHaveLength(0);
  });
});
