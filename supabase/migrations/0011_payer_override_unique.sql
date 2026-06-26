-- Unique per-org override keys so upsert (insert-or-update) is well-defined.
-- Full indexes (no WHERE clause) are required because supabase-js cannot emit a
-- matching WHERE on ON CONFLICT. NULLS NOT DISTINCT (Postgres 17) ensures that
-- baseline rows (org_id IS NULL, added by Task 4 curation) also conflict with each
-- other so a re-curation upsert updates in place rather than inserting a duplicate.
create unique index org_coverage_unique
  on public.payer_code_coverage (org_id, payer_master_id, cpt_code) nulls not distinct;
create unique index org_claimrule_unique
  on public.payer_claim_rules (org_id, payer_master_id, rule_category, field_reference) nulls not distinct;
