# Deploying Coverlog (Vercel + Supabase)

A walkthrough to get Coverlog running on Vercel for a demo. **Use synthetic data only** — this is behavioral-health software (42 CFR Part 2); real PHI requires signed BAAs with Supabase, Vercel, and AWS first.

## What you're deploying

- **Next.js 16** app (App Router; middleware is `proxy.ts`).
- **Supabase** — Postgres + Auth. 13 migrations under `supabase/migrations/` build the schema.
- **Vercel** — imports the repo, builds (`next build`), hosts.
- **AWS SES** — optional; the weekly email digest no-ops without credentials.

## Required environment variables

| Variable | Required for demo? | Source / value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase → Settings → API → Project URL (`https://<ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase → Settings → API → `anon` public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase → Settings → API → `service_role` key (secret) |
| `SUPABASE_DB_URL` | ✅ | Supabase → Settings → Database → Connection string → **Session pooler** (URI, includes password) |
| `NEXT_PUBLIC_APP_URL` | recommended | Your Vercel URL, e.g. `https://coverlog.vercel.app` (used in digest links) |
| `CRON_SECRET` | only if enabling crons | A long random string |
| `SES_FROM_ADDRESS`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | only for real emails | AWS SES credentials |

> **`SUPABASE_DB_URL` is required at runtime, not just locally.** The onboarding action (`src/app/onboarding/actions.ts`) opens a direct `pg` connection to create the org + first admin. Use the **pooler** connection string (serverless-friendly) — without it, account onboarding fails.

## Step 1 — Supabase project

You have two options:

- **Reuse your existing project** (the one in `.env.local` that the tests run against): the schema is already applied, so you can **skip Step 2**. Caveat: that project is your **test database** — `npm test` and `npm run db:reset` wipe data (`db:reset` drops the `public` schema; tests truncate `organizations`/`staff` cascade), so any demo data is erased the next time you run tests. Fine for a one-shot demo; not for persistent/repeat demos.
- **Create a fresh project** (recommended if you want demo data to persist): supabase.com → New project, pick a region, set a strong DB password, then collect the four values in the table above.

## Step 2 — Apply migrations (skip if reusing the existing project)

The migrations are **not** run by the Vercel build — apply them once against the project from your machine:

1. Set `SUPABASE_DB_URL` in your local `.env.local` to the project's **session-pooler** connection string.
2. Run `npm run db:reset` — drops/recreates `public` and applies all 13 migrations (`0001`…`0013`) in order.
   - If it errors on `0005` (`create extension if not exists pgaudit`), enable **pgaudit** under Supabase → Database → Extensions, then re-run.

> `db:reset` is destructive — it drops the entire `public` schema before rebuilding. Never point it at a database whose data you want to keep.

## Step 3 — Auth setting for a smooth demo

Supabase → Authentication → Providers → Email: turn **"Confirm email" OFF** for the demo. With confirmation off, sign-up logs the user straight in. With it on, new users are routed to a "check your email" message first.

## Step 4 — Deploy on Vercel

1. vercel.com → Add New → Project → Import `chriswgood26/coverlog`.
2. Framework auto-detects **Next.js**; keep the default build command (`next build`).
3. Add the environment variables from the table above (Production + Preview).
4. **Deploy.**

## Step 5 — First run (demo path)

1. Open the deployed URL — `/` redirects into the app (→ `/dashboard` → `/sign-in` when signed out).
2. **Sign up** (email + password).
3. **Onboarding** — enter a clinic name + your name → creates your org and makes you admin.
4. You're in at `/dashboard`. Nav: Dashboard · Patients · Payers · Providers · Admin (admin-only) · Sign out.
5. Create synthetic demo data: add a patient, log an eligibility check, add a provider + license, link a payer, grant a consent. The dashboard stat cards and `/admin` consents overview update accordingly.

## Step 6 — Cron jobs (optional for a demo)

`vercel.json` defines two crons:

- `/api/cron/weekly-digest` — Mondays 13:00 UTC (per-org email digest)
- `/api/cron/ensure-partitions` — 1st of month 04:00 UTC (rolls the `access_log` partition runway forward)

**Vercel Cron requires a Pro plan** for these schedules. They are **not needed for a demo** — the app works fully without them, and email no-ops without SES. If you enable them, set `CRON_SECRET` (Vercel sends it automatically as the `Authorization: Bearer` token; the routes reject anything else with 401).

> Production note: `ensure-partitions` is the release gate for the partitioned `access_log`. The static runway is provisioned through 2028-12; the monthly cron extends it. Before then (and for real PHI), keep this cron healthy — alert on non-200 responses.

## Local development

```bash
cp .env.local.example .env.local   # fill in real values
npm install
npm run db:reset                   # apply migrations to the configured DB
npm run dev                        # http://localhost:3000
npm test                           # full suite (hosted Supabase; serial)
```
