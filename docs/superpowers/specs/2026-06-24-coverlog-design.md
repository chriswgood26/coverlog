# Coverlog — Design Specification

**Date:** 2026-06-24
**Status:** Approved design, pre-implementation
**Customer:** Sam W.
**Codename:** Coverlog (not the final product name)

---

## 1. Overview

Coverlog is a **manual-entry insurance eligibility tracking tool** for eligibility
specialists and small behavioral health clinics. Specialists check coverage on payer
portals themselves; Coverlog gives them one place to log results, track who is due for
re-verification, keep a per-patient history, and reference payer-specific billing
intelligence (credentialing status, code coverage, and claim rules).

This spec adapts the customer-supplied technical spec (which targeted Retool + direct
Postgres) to our customary stack and to two requirements the original spec under-scoped:
**true multi-tenant SaaS at launch** and **42 CFR Part 2 (SUD record) compliance**.

### What it deliberately does NOT do (v1)

- No automated eligibility pulls from payers (no clearinghouse API, no portal scraping).
  Checking stays manual; Coverlog makes logging and tracking fast.
- No Office Ally / EDI automation (deferred; see §11).
- No claim scrubbing or 837P submission — the claim-rules module is a **lookup/checklist**, not a claims engine.
- No SMS.
- **No user-composed / freeform email of any kind** (see §8).

---

## 2. Goals & Success Criteria

- A specialist can log an eligibility check in seconds and see who is due this week.
- Multiple clinics run simultaneously with **hard tenant isolation** enforced at the database level.
- The product is structurally ready for **42 CFR Part 2** data: consent is captured before disclosure, and disclosures/exports are logged.
- Module 8 (credentialing + payer billing intelligence) ships in the **first paid release** (full scope), using a **hybrid** shared/per-org data model.

---

## 3. Scope (first paid release)

Everything below ships in release 1 (decision: single full-scope release):

- **Core eligibility tracking** — patients, eligibility checks, dashboard, CSV import/export.
- **Payer directory** + tabbed **Payer Profile**.
- **Module 8** — provider credentialing tracker, payer code coverage, CMS-1500 claim rules.
- **42 CFR Part 2 foundation** — consent capture, disclosure logging, RLS isolation.
- **Email alert digests** — system-generated, templated, PHI-minimized.

---

## 4. Tech Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| App | **Next.js 16 (App Router)**, TypeScript strict, Tailwind 4 | `@/*` → `./src/*`; middleware is `proxy.ts` |
| Hosting | **Vercel** | HIPAA BAA via Pro add-on (see §10) |
| Database | **Supabase (Postgres)** | Separate project; RLS enabled on all tables |
| Auth | **Supabase Auth** | Replaces the spec's email-only "login" *and* replaces Clerk for this project |
| Email | **AWS SES** | Under AWS BAA; templated alert digests only |
| Cron | **Vercel cron** | Daily alert digest job |

### Stack decisions and why they differ from our other projects

- **Supabase Auth, not Clerk.** Clerk gates HIPAA BAAs behind custom-priced Enterprise
  (~$2,000+/mo). Supabase Auth is covered under the Supabase HIPAA add-on we already pay
  for, eliminating a second enterprise BAA and consolidating identity + RLS into one
  system. This is a deliberate departure from the shared-stack "Clerk everywhere"
  convention, made for cost and for a simpler Part 2 isolation story.
- **AWS SES, not Resend.** Resend does not offer a HIPAA BAA (they pursued SOC 2, not
  HIPAA). AWS signs a BAA covering SES, at negligible cost for this volume.

---

## 5. Architecture

- **Server components by default**; `"use client"` only when needed.
- **Mutations** run through server actions / route handlers that validate the Supabase
  session first, then act.
- **Tenant data access** uses a request-scoped Supabase client carrying the user's JWT, so
  **RLS enforces isolation in the database** (Approach 2 — see §6). Service-role access is
  confined to the internal baseline-curation surface (§7.4) and never touches the tenant
  request path.
- **Email** is sent only by the Vercel cron job via AWS SES, from templates we control.

---

## 6. Tenancy & RLS Model (Approach 2)

Every tenant table carries `org_id`. **RLS is enabled on all tables.** Isolation is
enforced by the database, not by application discipline.

### Identity → org resolution

A `staff` row links a Supabase `auth.users` id to exactly one `org_id`. A stable helper
function resolves the current user's org for use in policies:

```sql
create or replace function auth.user_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.staff where user_id = auth.uid() and deleted_at is null
$$;
```

### Policy patterns

**Tenant tables** (staff, patients, eligibility_checks, payer_directory, providers,
payer_enrollments, patient_consents, disclosure_log, access_log):

```sql
-- read/write only your own org's rows
using      ( org_id = auth.user_org_id() )
with check ( org_id = auth.user_org_id() )
```

**`organizations`** has no `org_id` column (its `id` *is* the org), so it uses:
`using ( id = auth.user_org_id() )`. **`disclosure_log`** and **`access_log`** are
append-only — grant `insert`/`select` under the org policy but no `update`/`delete`.

**Shared-baseline tables** (`payer_code_coverage`, `payer_claim_rules`) — hybrid model:

```sql
-- SELECT: see the Coverlog baseline (org_id IS NULL) plus your own overrides
using ( org_id is null or org_id = auth.user_org_id() )

-- INSERT/UPDATE/DELETE: tenants may only write their own rows, never the baseline
with check ( org_id = auth.user_org_id() )
```

Baseline rows (`org_id IS NULL`) are written **only** by the internal curation surface
using the service role (§7.4).

### Hybrid precedence

When both a baseline row and an org row exist for the same key
(`payer_id` + `cpt_code` for coverage; `payer_id` + `rule_category` + `field_reference`
for claim rules), the **org row wins**. Resolution happens in a query/view layer; the UI
shows a **provenance badge**: *Coverlog baseline* vs. *Your clinic's override*.

---

## 7. Data Model

Changes from the customer spec are called out. All PHI-bearing tables use **soft delete**
(`deleted_at`) for audit integrity.

### 7.1 Core tables

```sql
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- CHANGED: user_id links Supabase Auth identity; soft delete
create table staff (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) not null,
  user_id uuid references auth.users(id) unique,   -- Supabase Auth link
  name text not null,
  email text not null,
  role text default 'specialist',                  -- 'admin' | 'specialist'
  created_at timestamptz default now(),
  deleted_at timestamptz
);

-- CHANGED: part2_protected flag; soft delete
create table patients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) not null,
  name text not null,
  dob date,
  member_id text,
  primary_payer text,
  status text default 'pending',                   -- verified | pending | inactive
  last_checked date,
  next_due date,
  part2_protected boolean default true,            -- treat as 42 CFR Part 2 record
  created_at timestamptz default now(),
  deleted_at timestamptz
);

-- CHANGED: source + raw_271 reserved for future automation; soft delete
create table eligibility_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) not null,
  patient_id uuid references patients(id) not null,
  checked_by uuid references staff(id),
  payer text,
  status text,                                     -- verified | pending | inactive
  copay numeric,
  deductible_remaining numeric,
  notes text,
  check_date date default current_date,
  next_due date,
  source text default 'manual',                    -- 'manual' (future: 'office_ally_auto')
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create table payer_directory (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) not null,
  payer_name text not null,
  portal_url text,
  login_notes text,                                -- NEVER store passwords here (see §10)
  username_hint text,
  last_checked_here date
);
```

**Status values:** `verified` | `pending` | `inactive`, used identically on
`patients.status` and `eligibility_checks.status`.

**Business rules:**
- *Due this week* = `next_due` between today and today + 7 days.
- *Needs attention* = `status` is `pending` or `inactive`.
- Logging a check updates the parent `patients` row (`status`, `last_checked`,
  `next_due`, `primary_payer`) **and** inserts an `eligibility_checks` row — **atomically**
  (see §7.5).

### 7.2 Module 8 — credentialing & payer intelligence

```sql
create table providers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) not null,
  name text not null,
  npi text,
  license_type text,                               -- LCSW, LMHC, LMFT, MD, PMHNP, etc.
  license_number text,
  license_state text,
  license_expiration date,
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create table payer_enrollments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) not null,
  provider_id uuid references providers(id) not null,
  payer_id uuid references payer_directory(id) not null,
  status text default 'pending',                   -- enrolled | pending | terminated | not_enrolled
  par_status text,                                 -- in_network | out_of_network
  effective_date date,
  termination_date date,
  revalidation_due date,
  caqh_id text,
  notes text,
  created_at timestamptz default now()
);

-- CHANGED: org_id nullable (NULL = Coverlog baseline); provenance fields
create table payer_code_coverage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id),        -- NULL = shared baseline
  payer_id uuid references payer_directory(id) not null,
  cpt_code text not null,                          -- e.g. 90837, H0015, T1040
  code_description text,
  covered boolean default true,
  requires_prior_auth boolean default false,
  unit_limit text,
  modifier_required text,                          -- e.g. 'HE', 'GT', '95'
  telehealth_allowed boolean,
  notes text,
  effective_date date,
  source text default 'org',                       -- 'coverlog_baseline' | 'org'
  verified_at timestamptz,
  verified_by text,
  promoted_from_org uuid,                           -- reserved for future crowd-sourcing
  created_at timestamptz default now()
);

-- CHANGED: org_id nullable; provenance fields
create table payer_claim_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id),        -- NULL = shared baseline
  payer_id uuid references payer_directory(id) not null,
  rule_category text,                              -- modifier | diagnosis_pointer | timely_filing | npi_placement
  field_reference text,                            -- e.g. 'Box 24J', 'Box 33a', 'Box 19'
  rule_description text,
  required_value text,
  notes text,
  source text default 'org',                       -- 'coverlog_baseline' | 'org'
  verified_at timestamptz,
  verified_by text,
  promoted_from_org uuid,                           -- reserved for future crowd-sourcing
  created_at timestamptz default now()
);
```

> **Note on the baseline FK.** `payer_directory` is org-scoped, but baseline coverage/rule
> rows are global. Resolution joins baseline rows to a payer by **payer name/identifier**,
> not by a tenant's `payer_directory.id`. Implementation detail to settle in the plan: a
> canonical payer reference (e.g. a `payer_master` lookup keyed by name) so baseline rows
> point at a stable payer, and each org's `payer_directory` maps to it.

### 7.3 42 CFR Part 2 — consent & disclosure

```sql
create table patient_consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) not null,
  patient_id uuid references patients(id) not null,
  consent_type text not null,                      -- e.g. 'disclosure_to_payer', 'general'
  scope text,                                      -- what disclosures this consent permits
  granted_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  document_ref text,                               -- pointer to signed consent artifact
  created_by uuid references staff(id),
  created_at timestamptz default now()
);

-- Append-only accounting of OUTWARD disclosures/exports (Part 2 disclosure accounting)
create table disclosure_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) not null,
  patient_id uuid references patients(id),
  actor_staff_id uuid references staff(id),
  action text not null,                            -- 'csv_export' | 'disclosure_to_payer' | ...
  purpose text,
  disclosed_to text,
  occurred_at timestamptz default now(),
  detail jsonb
);

-- Append-only log of INTERNAL access (every read of patient PHI) — full read-logging
create table access_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) not null,
  actor_staff_id uuid references staff(id),
  action text not null,                            -- 'view_chart' | 'view_check_history' | 'patient_search' | 'list_view'
  patient_id uuid references patients(id),         -- null for multi-record reads (list/search)
  patient_ids uuid[],                              -- populated for list/search results
  query_context text,                              -- e.g. the filter/search terms used
  occurred_at timestamptz default now(),
  detail jsonb
);
```

**Full read-logging — what counts and how it's enforced:**

- **Granularity:** every read that returns identifiable PHI is logged. Record-level views
  (opening a chart, viewing check history) write one row with `patient_id`. Multi-record
  reads (patient list, search) write one row with the returned `patient_ids[]` and the
  `query_context`, rather than one row per patient, to keep volume sane while still
  recording exactly which records were exposed.
- **Enforcement is centralized:** all patient-PHI reads go through a single data-access
  layer that writes the `access_log` row; no route may read PHI by bypassing it. This is a
  hard architectural rule, since a missed call = a gap in the audit trail.
- **Database-level backstop:** enable **`pgaudit`** (supported on Supabase) to log
  read access at the Postgres layer as defense-in-depth — guaranteed even if app code has a
  gap. The `access_log` table is the queryable accounting; pgaudit is the un-bypassable
  backstop. The two are reconciled during compliance review.
- **Cost we accept by turning this on:** an extra insert on every PHI read path (mitigated
  by async/fire-and-forget writes), and high row volume. `access_log` is **partitioned by
  month** with a defined retention policy (set during compliance review) to stay
  manageable.

### 7.4 Internal baseline curation (out of tenant path)

A Coverlog-staff-only surface (separate route group, gated to internal users, **service
role**) is the only writer of `org_id IS NULL` baseline rows in `payer_code_coverage` and
`payer_claim_rules`. Not exposed to tenants. v1 populates the baseline by hand;
schema is crowd-sourcing-ready (`promoted_from_org`) but that path is not built.

### 7.5 Atomic "log a check"

Implemented as a Postgres function (RPC) invoked from a single server action, so the
`eligibility_checks` insert and the `patients` update commit together. Eliminates the
two-query divergence risk in the original Retool spec.

---

## 8. Email Alert Layer

- **Daily Vercel cron** computes, per org: *due this week*, *needs attention*, *licenses
  expiring* (30/60-day), *revalidations due*, and sends a digest to org admins via **AWS SES**.
- **PHI-minimized by construction:** digests carry **counts and "log in to view"** — never
  patient names, member IDs, or any SUD-identifying content.
- **No user-composed / freeform email in v1.** The only email path is this templated cron
  digest. Adding any "email the patient/record" feature later MUST trigger a fresh
  PHI/Part 2 review — it is explicitly out of scope here so it cannot ship quietly on top
  of the alert plumbing.
- No-ops cleanly if SES credentials are absent (matches our graceful-degradation convention).

---

## 9. Feature / Page Map

**Core**
- Supabase Auth sign-in + org onboarding.
- `/dashboard` — stat cards: *verified today · due this week · needs attention · licenses
  expiring soon · enrollments due for revalidation*.
- `/patients` — searchable/filterable table, sorted by `next_due`.
- `/patients/[id]` — chart: check history, **consent-status banner**, log-a-check action,
  coverage cross-reference against `primary_payer`. Opening the chart and viewing check
  history each write an `access_log` row (full read-logging, §7.3).
- **Log a Check** drawer → atomic insert+update (§7.5).
- **Add Patient** modal.
- **CSV import** — validated bulk insert; logged.
- **CSV export** — **gated on a valid consent + writes a `disclosure_log` row** (export = disclosure).

**Module 8**
- `/payers` + `/payers/[id]` — tabbed **Payer Profile**: *Portal Access · Enrolled
  Providers · Covered Codes · Claim Rules* (baseline + org merged with provenance badges;
  admins add org overrides).
- `/providers` — list/add/edit providers + licenses; per-payer enrollment status.
- `/admin` — staff & roles, consent management.

**Internal (not tenant-facing)**
- Baseline curation surface for `payer_code_coverage` / `payer_claim_rules` (§7.4).

**Roles:** `admin` manages staff, consents, and org overrides; `specialist` logs checks,
views, and exports (when consent permits). Enforced in server actions and, where possible, RLS.

---

## 10. Compliance (42 CFR Part 2 + HIPAA)

- **BAAs required before any real patient data** — now only three vendors:
  **Supabase, Vercel, AWS.** (Clerk and Resend were dropped specifically to shrink this
  surface.) Each must be comfortable with **42 CFR Part 2** data, not just HIPAA.
- **Synthetic/demo data only** until BAAs are signed.
- **Part 2 controls built in:** consent capture with required elements; re-disclosure
  prohibition notice surfaced on exports; disclosure accounting (`disclosure_log`); clear
  labeling of Part 2 records (`patients.part2_protected`).
- **`payer_directory.login_notes` / `username_hint`** are credential-adjacent: a hard rule
  that **passwords are never stored**, and these fields are treated as elevated sensitivity.
- Encryption at rest + in transit; minimize PHI in emails and application logs.
- ⚠️ **Engineering delivers the controls, not the legal sign-off.** A qualified Part 2 /
  HIPAA compliance review before go-live is still required.

### Estimated monthly BAA-tier cost (verified 2026-06)

| Vendor | Tier | Est. monthly |
|--------|------|-------------|
| Supabase | Team ($599) + HIPAA add-on (~$350) | ~$950 |
| Vercel | Pro + HIPAA add-on ($350) | ~$370 |
| AWS SES | under AWS BAA | ~$0–50 |
| **Total** | | **~$1,350/mo** |

(Roughly half the ~$3,300+/mo of the original Clerk+Resend path; Clerk's enterprise BAA
was the dominant line item removed.)

---

## 11. Out of Scope (v1)

- Office Ally / EDI (X12 270/271) automation — deferred; the additive `source` column on
  `eligibility_checks` keeps the door open.
- Crowd-sourcing of the shared baseline — schema-ready (`promoted_from_org`), not built.
- Claim scrubbing / 837P submission — lookup/checklist only.
- SMS.
- Any user-composed / freeform email.

---

## 12. Testing

No test suites exist in our projects today. Introduce a focused set for the
correctness-critical paths only:

- **RLS policy tests** — verify cross-tenant isolation *and* the shared-read / org-write /
  precedence rules. Highest-priority surface given Part 2.
- **Atomic log-a-check** — no `patients` / `eligibility_checks` divergence on partial failure.
- **Consent-gating on export** — export blocked without valid consent; `disclosure_log` row written.
- **Full read-logging** — every PHI read path writes an `access_log` row; no read path
  bypasses the data-access layer (the central enforcement point).

---

## 13. Build Order

1. Supabase project + schema + RLS policies + `auth.user_org_id()` helper.
2. Supabase Auth + staff/org onboarding.
3. Patient list + Add Patient.
4. Log-a-Check (atomic RPC + server action).
5. Dashboard stat queries.
6. Centralized PHI data-access layer + `access_log` (full read-logging) + `pgaudit`
   backstop; consent capture + disclosure logging; gate CSV export on consent.
7. Payer Directory + Payer Profile shell.
8. Providers + payer enrollments + credentialing dashboard cards.
9. Payer code coverage + claim rules (hybrid baseline/override + provenance UI).
10. Internal baseline curation surface.
11. CSV import / export.
12. Email alert cron (AWS SES).

---

## 14. Open Questions / Dependencies

- **Canonical payer reference** (`payer_master`) design for joining global baseline rows to
  per-org payers — to settle in the implementation plan (§7.2 note).
- Confirm each vendor (Supabase, Vercel, AWS) will sign a BAA covering **42 CFR Part 2** data, not just HIPAA.
- Confirm required content/elements for a valid Part 2 consent with the customer's compliance reviewer.
- **Logging is full read-logging** (decided): outward disclosures/exports → `disclosure_log`;
  *every* internal PHI read → `access_log`, with `pgaudit` as a database-level backstop
  (§7.3). Remaining detail for the plan/compliance review: `access_log` **retention period**
  and monthly-partition pruning policy.
