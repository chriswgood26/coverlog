import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { asAdmin, resetDb, pool } from "./helpers";
import { hasValidConsent } from "@/lib/phi/consent";

// Real-DB integration coverage for the hasValidConsent disclosure gate.
// Unit tests use a fake client that rubber-stamps any PostgREST filter string,
// so they cannot catch a malformed `.or("expires_at.is.null,expires_at.gt.<iso>")`.
// This test signs in as a real RLS-bound user and exercises the actual PostgREST
// `.or()` + `.is()` + `.not()` filters against the hosted Postgres for every case.

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const ORG = "22222222-2222-2222-2222-222222222222";
const EMAIL = "consent-it@example.com";
const PASSWORD = "Test-Passw0rd!";

// One patient per case so RLS + the real .or() filter decide each independently.
const P_NULL_EXPIRY = "33333333-3333-3333-3333-333333333301";
const P_FUTURE_EXPIRY = "33333333-3333-3333-3333-333333333302";
const P_PAST_EXPIRY = "33333333-3333-3333-3333-333333333303";
const P_REVOKED = "33333333-3333-3333-3333-333333333304";
const P_NO_CONSENT = "33333333-3333-3333-3333-333333333305";

let userId: string;
let userClient: ReturnType<typeof createClient>;

beforeAll(async () => {
  // Clean any leftover user from a prior aborted run.
  const existing = await admin.auth.admin.listUsers();
  for (const u of existing.data.users) {
    if (u.email === EMAIL) await admin.auth.admin.deleteUser(u.id);
  }

  const created = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(`createUser failed: ${created.error?.message ?? "no user returned"}`);
  }
  userId = created.data.user.id;

  // Seed org, staff (linked to the auth user), patients, and one consent per case.
  await asAdmin(async (q) => {
    await q(`truncate table public.patient_consents, public.patients, public.staff,
             public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'Consent IT Org')`, [ORG]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Carol','carol@it.com','admin')`, [ORG, userId]);

    const patients: [string, string][] = [
      [P_NULL_EXPIRY, "Pat NullExpiry"],
      [P_FUTURE_EXPIRY, "Pat FutureExpiry"],
      [P_PAST_EXPIRY, "Pat PastExpiry"],
      [P_REVOKED, "Pat Revoked"],
      [P_NO_CONSENT, "Pat NoConsent"],
    ];
    for (const [id, name] of patients) {
      await q(`insert into public.patients (id, org_id, name) values ($1,$2,$3)`, [id, ORG, name]);
    }

    // granted, not revoked, no expiry -> valid
    await q(`insert into public.patient_consents
             (org_id, patient_id, consent_type, granted_at, expires_at, revoked_at)
             values ($1,$2,'part2_disclosure', now(), null, null)`, [ORG, P_NULL_EXPIRY]);
    // granted, not revoked, expiry in the FUTURE -> valid
    await q(`insert into public.patient_consents
             (org_id, patient_id, consent_type, granted_at, expires_at, revoked_at)
             values ($1,$2,'part2_disclosure', now(), now() + interval '30 days', null)`, [ORG, P_FUTURE_EXPIRY]);
    // granted, not revoked, expiry in the PAST -> invalid
    await q(`insert into public.patient_consents
             (org_id, patient_id, consent_type, granted_at, expires_at, revoked_at)
             values ($1,$2,'part2_disclosure', now() - interval '60 days', now() - interval '1 day', null)`, [ORG, P_PAST_EXPIRY]);
    // granted but REVOKED -> invalid
    await q(`insert into public.patient_consents
             (org_id, patient_id, consent_type, granted_at, expires_at, revoked_at)
             values ($1,$2,'part2_disclosure', now() - interval '10 days', null, now() - interval '1 day')`, [ORG, P_REVOKED]);
    // P_NO_CONSENT: intentionally no consent row.
  });

  // Sign in via the anon client to get an RLS-bound session.
  userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  const signin = await userClient.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (signin.error || !signin.data.session) {
    throw new Error(`signInWithPassword failed: ${signin.error?.message ?? "no session"}`);
  }
});

afterAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.patient_consents, public.patients restart identity cascade`);
  });
  if (userId) await admin.auth.admin.deleteUser(userId);
  await resetDb();
  await pool.end();
});

describe("hasValidConsent (real PostgREST .or() filter under RLS)", () => {
  it("TRUE when granted, not revoked, no expiry", async () => {
    expect(await hasValidConsent(userClient, P_NULL_EXPIRY)).toBe(true);
  });
  it("TRUE when granted, not revoked, expiry in the future", async () => {
    expect(await hasValidConsent(userClient, P_FUTURE_EXPIRY)).toBe(true);
  });
  it("FALSE when expiry is in the past", async () => {
    expect(await hasValidConsent(userClient, P_PAST_EXPIRY)).toBe(false);
  });
  it("FALSE when the consent has been revoked", async () => {
    expect(await hasValidConsent(userClient, P_REVOKED)).toBe(false);
  });
  it("FALSE when there is no consent row at all", async () => {
    expect(await hasValidConsent(userClient, P_NO_CONSENT)).toBe(false);
  });
});
