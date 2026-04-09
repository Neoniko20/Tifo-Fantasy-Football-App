-- ═══════════════════════════════════════════════════════════════════
-- TIFO — CRON SUPPORT POLICIES
-- The cron endpoint runs with the SUPABASE_SERVICE_ROLE_KEY which
-- bypasses RLS automatically. No extra policies are required for
-- writes from the cron, but we add an explicit "system insert"
-- policy on the audit log for clarity (and in case we ever switch
-- to anon-key + RPC later).
-- ═══════════════════════════════════════════════════════════════════

-- Allow service-role-equivalent inserts when actor_label = 'cron'.
-- Service role bypasses RLS, so this policy is documentation only;
-- it makes the intent explicit.
CREATE POLICY "Cron insert liga_admin_audit_log"
  ON liga_admin_audit_log FOR INSERT TO service_role
  WITH CHECK (actor_label = 'cron');
