# Coverlog Nav / IA Rename — Design

**Status:** Approved (2026-06-26). **Plan D** (final) of the UI initiative (A restyle ✅ → B provider status/specialty ✅ → C mockup dashboard ✅ → **D nav rename, this doc**).

## Goal

Relabel the app navigation to the CredFlow mockup's terminology, keeping the existing routes.

## Decisions (resolved in brainstorming)

1. **Relabel + reorder** the sidebar to match the mockup; map Payers → "Insurance Credentialing" (it's where provider↔payer enrollment/credentialing lives — the Enrolled Providers tab) and Patients → "Insurance Eligibility" (eligibility tracking).
2. **Labels only — keep routes.** No URL renames, no redirects, no `href`/`revalidatePath`/test churn. Lowest risk; full visual match.

## Scope

Purely cosmetic string changes — no schema, no behavior, no routes, no form/action/field changes. The full test suite (which asserts data/action exports, not nav text) stays green unchanged; `tsc` + `next build` confirm compilation. Small enough to implement directly (no subagent pipeline), with branch + verify + merge.

## Changes

- `src/app/(app)/_components/Sidebar.tsx` — reorder + relabel the `NAV` array (keep the same `href`s):
  - `Dashboard` (/dashboard) · `Providers` (/providers) · `Insurance Credentialing` (/payers) · `Insurance Eligibility` (/patients). `Admin` (/admin) still appended for admins.
- `src/app/(app)/patients/page.tsx` — `PageHeader title="Insurance Eligibility"` (subtitle unchanged).
- `src/app/(app)/payers/page.tsx` — `PageHeader title="Insurance Credentialing"` (subtitle unchanged).
- `src/app/(app)/providers/page.tsx`, `admin` pages — unchanged. Detail pages (`/patients/[id]`, `/payers/[id]`) title by entity name — unchanged; their back arrows still point at the (renamed) list pages.
- `DEPLOY.md` — update the demo-path nav line to the new labels (doc accuracy).

## Out of scope

- URL/route renames (kept as `/patients`, `/payers`, `/providers`).
- Any IA restructure beyond labels (Covered Codes / Claim Rules stay under the Insurance Credentialing = payer profile, as today).

## Testing

`npx tsc --noEmit`, `npm run build` (all routes present), `npm test` (stays green, unchanged — no test references nav labels).
