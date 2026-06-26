# Coverlog Visual Restyle (Kinship/CredFlow look) — Design

**Status:** Approved direction (2026-06-25). This is **Plan A** of a 4-part UI initiative: **A. visual restyle (this doc)** → B. provider credentialing fields (status/specialty) → C. mockup dashboard (Pending Verifications / Flagged) → D. nav/IA rename (Insurance Eligibility/Credentialing). B/C/D are separate specs.

## Goal

Restyle the existing Coverlog UI to match the customer's mockup look-and-feel (a Base44 prototype, "CredFlow"), whose visual language is the **same family as the Kinship EHR** (`~/projects/kinship`). Kinship is the **source of exact, copy-able Tailwind class strings**; the mockup confirms the target (left sidebar, teal primary, white rounded cards, pill statuses, dashboard greeting). **Visual only** — no schema or behavior changes.

## Stack reality (no changes needed)

Coverlog and Kinship already share the styling stack: **Tailwind v4** (CSS-config, no `tailwind.config`), `@tailwindcss/postcss`, **Geist + Geist_Mono** via `next/font/google`, and a nearly identical `globals.css` (`@import "tailwindcss"`, `:root` `--background/--foreground`, `@theme inline` mapping `--font-sans`/`--font-mono` to the Geist variables). No new dependencies. Coverlog already wires `--font-geist-sans`/`--font-geist-mono` on `<html>`.

## Decisions (resolved in brainstorming)

1. **Shell:** adopt Kinship's **left sidebar + 3px teal accent bar** on a `bg-slate-50` content area (replaces the current top nav).
2. **Fidelity:** full visual match across all pages.
3. **Branding:** **"Coverlog"** (teal "C" logo mark) — NOT the mockup's "CredFlow".
4. **Dashboard:** add the mockup's **greeting + summary line**; keep the *current* stat set for now (the mockup's exact metrics — Pending Review / Flagged — and the Pending Verifications / Expiring Credentials panels come in Plan C, which needs Plan B's data).
5. **Out of scope for A (deferred):** functional search bars (B/C), provider status/specialty (B), mockup dashboard panels/metrics (C), nav rename (D).

## Hard safety constraint

This pass changes **only** Tailwind classes and presentational wrapper markup. It MUST preserve, verbatim, on every page:
- every form field `name=` attribute, every `<form action={…}>` server-action wiring, every hidden input;
- every `href`, route, and `params`/`searchParams` usage;
- every conditional (e.g. `ctx.role === "admin"` gates, the consent banner condition, provenance chips, `deleted_at`/status-driven rendering);
- table **columns and the data rendered in them**, and all existing data fetches.

The full test suite (DB/lib integration + action-export smoke tests) asserts behavior/exports, not classes, so **it must stay green unchanged** — that is the regression gate. A silently renamed form field or dropped action import is the main risk; reviews check for it.

## Architecture

A small set of shared presentational building blocks (emitting Kinship's exact class strings) + a sidebar shell, then a per-page className pass that composes them. No business logic moves.

### Unit 1 — globals + root metadata
- `src/app/globals.css`: change the `body` font-family from the Arial fallback to use the Geist token: `font-family: var(--font-sans), ui-sans-serif, system-ui, sans-serif;` (keep the `@import`, `:root`, `@theme inline`, and dark-mode block as-is). Add `background: #f8fafc;` (slate-50) is optional — layouts set bg; keep body neutral.
- `src/app/layout.tsx`: set `metadata.title = "Coverlog"`, `description = "Insurance eligibility & credentialing tracker"`. Keep the Geist variable wiring. Body className stays `min-h-full flex flex-col` (layouts control bg).

### Unit 2 — shared UI primitives
- `src/lib/ui.ts` — exported class-string constants (verbatim Kinship):
  - `btnPrimary = "bg-teal-500 text-white px-4 py-2.5 rounded-xl font-semibold hover:bg-teal-400 transition-colors text-sm"`
  - `btnSecondary = "border border-slate-200 text-slate-600 px-4 py-2.5 rounded-xl font-medium hover:bg-slate-50 transition-colors text-sm"`
  - `btnDangerText = "text-red-500 hover:text-red-600 text-xs font-medium"`
  - `linkTeal = "text-teal-600 hover:text-teal-700 font-medium"`
  - `card = "bg-white rounded-2xl border border-slate-200"`
  - `inputClass = "w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"`
  - `labelClass = "text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5"`
  - `tableWrap = "bg-white rounded-2xl border border-slate-200 overflow-hidden"`
  - `theadRow = "border-b border-slate-100 bg-slate-50"`
  - `thCell = "text-left px-4 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider"`
  - `tbody = "divide-y divide-slate-50"`, `rowHover = "hover:bg-slate-50 transition-colors"`, `tdCell = "px-4 py-4 text-sm text-slate-600"`
- `src/components/ui/Badge.tsx` — `<span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${statusColor(value)}`}>{label}</span>` plus an exported `statusColor(v: string): string` map:
  - `verified | enrolled | active | in_network → "bg-emerald-100 text-emerald-700"`
  - `pending | out_of_network | expiring → "bg-amber-100 text-amber-700"`
  - `inactive | terminated | not_enrolled | revoked → "bg-slate-100 text-slate-500"`
  - `expired → "bg-amber-100 text-amber-700"`; `flagged | denied → "bg-red-100 text-red-600"`
  - role `admin → "bg-purple-100 text-purple-700"`, `specialist → "bg-slate-100 text-slate-600"`
  - default → `"bg-slate-100 text-slate-600"`
- `src/components/ui/PageHeader.tsx` — props `{ title, subtitle?, backHref?, children? }`; renders `text-2xl font-bold text-slate-900` title (+ optional back `←` link `text-slate-400 hover:text-slate-700`, subtitle `text-slate-500 text-sm mt-0.5`) with `children` as right-aligned actions.
- `src/components/ui/Card.tsx` — props `{ title?, headerRight?, children, className? }`; `bg-white rounded-2xl border border-slate-200 overflow-hidden`, optional header `px-5 py-4 border-b border-slate-100 flex items-center justify-between` with `font-semibold text-slate-900` title.

### Unit 3 — app shell
- `src/app/(app)/_components/Sidebar.tsx` (**client**): `usePathname()` for active state. Logo: teal `w-7 h-7 bg-teal-500 rounded-lg` "C" + `font-bold text-slate-900` "Coverlog". Nav items (`Dashboard`, `Patients`, `Payers`, `Providers`, and `Admin` only when `isAdmin`): active = `bg-[#0d1b2e] text-white`, inactive = `text-slate-600 hover:bg-slate-100 hover:text-slate-900`, both `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium`. Sign out renders the existing `signOutAction` server-action form (imported from `@/app/(app)/actions`) as a button at the bottom. Props: `{ isAdmin: boolean }`.
- `src/app/(app)/layout.tsx`: keep the `getStaffContext` resolve + `redirect("/onboarding")`. Render: `<div className="fixed top-0 left-0 right-0 h-[3px] bg-teal-500 z-50" />` + `<div className="flex min-h-screen bg-slate-50 pt-[3px]"><Sidebar isAdmin={ctx.role === "admin"} /><main className="flex-1 overflow-auto p-6">{children}</main></div>`. (Drop the old `<nav>`.)

### Unit 4 — page restyle (visual only; preserve data/behavior per the safety constraint)
- **Dashboard** (`(app)/dashboard/page.tsx`): fetch the current staff's display name (`staff.name` for the signed-in user) for the greeting; render `Good {morning|afternoon|evening}, {name}` (`text-2xl font-bold text-slate-900`) + a summary line (`text-slate-500 text-sm`, derived from the existing counts, e.g. "N due this week · M need attention"). Render the existing 5 stat values as Kinship tinted stat cards (`{tint} border rounded-2xl p-5` with `text-3xl font-bold text-slate-900` value + `text-sm text-slate-500` label), tints cycling teal/blue/amber/emerald/red. Same `getDashboardStats`/`getCredentialingStats` calls.
- **Patients list** + **detail** + `_components/{AddPatientForm, CsvControls, LogCheckDrawer}`: PageHeader, table in `tableWrap`, status via `<Badge>`, forms via `inputClass`/`labelClass` + `btnPrimary`, banners as Kinship alert cards (`bg-amber-50 border border-amber-200 rounded-2xl …` for the Part 2 consent banner). Preserve all field names + actions + the consent/coverage/history sections.
- **Payers list** + **profile `[id]`** + `_components/{CoveredCodesTab, ClaimRulesTab, EnrolledProvidersTab}`: PageHeader, Portal Access + each tab as `Card`s with styled tables, override/enrollment forms restyled, provenance shown as small chips (`text-xs px-1.5 py-0.5 rounded` — teal for "Your clinic", slate for "Coverlog baseline"). Preserve enrollment form field names + `saveEnrollmentAction`/override actions.
- **Providers** + `_components/AddProviderForm`: PageHeader (+ subtitle count), table in `tableWrap`, remove button as `btnDangerText`, add-form restyled. (No new columns/search — that's Plan B.)
- **Admin overview** + **Admin/staff**: PageHeader, tables in cards, role via `<Badge>`, role-toggle / activate-deactivate buttons restyled (`linkTeal` / `btnDangerText`). Preserve the admin gates + `staffId`/`role` form fields.
- **Auth** (`/sign-in`, `/sign-up`, top-level `/onboarding`): centered card — `min-h-screen bg-slate-50 flex items-center justify-center` wrapper, `bg-white rounded-2xl border border-slate-200 p-8 w-full max-w-sm` card with the teal "C" mark + "Coverlog", `inputClass` fields, `btnPrimary` submit, error text `text-sm text-red-600`. Preserve `signInAction`/`signUpAction`/`submitOnboarding` wiring + field names + the `?error=` rendering.

## Data Flow

Unchanged. Every page keeps its current server fetches, server actions, RLS-bound client usage, and conditionals. Only the rendered markup/classes change. The Sidebar is the one new client component; it reads `usePathname()` and the `isAdmin` prop and reuses the existing `signOutAction`.

## Error Handling

No new error paths. Existing redirects (`/onboarding`, `/dashboard`, `/sign-in`), action error surfacing (`?error=`), and banners are preserved, just restyled.

## Testing

No behavior change, so the bar is **no regression + it compiles/builds**:
- `npx tsc --noEmit` clean (the new client Sidebar, `ui.ts`, and components typecheck).
- `npm run build` completes; all existing routes still present.
- `npm test` — full suite stays green **unchanged** (action-export smoke tests confirm action modules still export the same functions, i.e. forms weren't rewired).
- A `tests/lib/ui-smoke.test.ts` unit test for `statusColor` (known statuses → expected class strings; unknown → default) and that `@/components/ui/Badge`, `PageHeader`, `Card` modules import.
- **Visual verification is manual** (the harness has no visual tests): after the build gate, run the app and eyeball the key pages, or a screenshot pass. Flagged as a manual step, not automated.

## Out of Scope (this plan)

Functional search bars; provider status/specialty + Specialty column; the mockup's Pending-Review/Flagged metrics, Pending Verifications panel, and Expiring Credentials panel; the Insurance Eligibility/Credentialing nav rename; dark mode (kept as the existing `globals.css` media block, components are light-only like Kinship); any animation/collapse on the sidebar (static sidebar — Kinship's collapse is not required).

## File Structure

- `src/app/globals.css` (font), `src/app/layout.tsx` (metadata) — modify
- `src/lib/ui.ts`; `src/components/ui/{Badge,PageHeader,Card}.tsx` — create
- `src/app/(app)/_components/Sidebar.tsx` — create; `src/app/(app)/layout.tsx` — rewrite shell
- `src/app/(app)/dashboard/page.tsx` — greeting + tinted cards
- `src/app/(app)/patients/{page.tsx,[id]/page.tsx,_components/*}` — restyle
- `src/app/(app)/payers/{page.tsx,[id]/page.tsx,[id]/_components/*}` — restyle
- `src/app/(app)/providers/{page.tsx,_components/AddProviderForm.tsx}` — restyle
- `src/app/(app)/admin/{page.tsx,staff/page.tsx}` — restyle
- `src/app/{sign-in,sign-up,onboarding}/page.tsx` — restyle
- `tests/lib/ui-smoke.test.ts` — create
