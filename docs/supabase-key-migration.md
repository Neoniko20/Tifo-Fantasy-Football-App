# Supabase API Key Migration — Legacy JWT → Publishable Key

**Date:** 2026-06-02  
**Status:** ✅ Migration complete — legacy key monitoring period active

---

## Summary

`NEXT_PUBLIC_SUPABASE_ANON_KEY` has been migrated from the legacy `eyJ…` anon JWT format to the
new Supabase Publishable Key format (`sb_publishable_…`) across all environments.

No code changes were required — only the environment variable *value* was updated. The variable
name remains `NEXT_PUBLIC_SUPABASE_ANON_KEY` throughout the codebase.

---

## Migration Checklist

### Code audit (pre-migration)

- [x] Confirmed zero hardcoded `eyJ` tokens in `app/`, `lib/`, `scripts/` — all access via `process.env`
- [x] Confirmed `@supabase/supabase-js ^2.100.1` fully compatible with `sb_publishable_` format
- [x] Identified 27 usage sites: `lib/supabase.ts` (1), `app/api/` routes (19), `scripts/` (5), `app/api/import-players/route.ts` (2)

### Local environment

- [x] `.env.local` — `NEXT_PUBLIC_SUPABASE_ANON_KEY` updated to new publishable key
- [x] `npm run typecheck` → ✅ clean
- [x] `npm run test` → ✅ 27/27 passing
- [x] `npm run build` → ✅ exit 0
- [x] `grep -R "eyJ" app/ lib/ scripts/` → ✅ no legacy tokens in source

### Remote environments

- [x] **GitHub Secret** `NEXT_PUBLIC_SUPABASE_ANON_KEY` updated
- [x] **Vercel** `NEXT_PUBLIC_SUPABASE_ANON_KEY` updated (Production + Preview + Development)
- [x] Vercel Production redeploy triggered and successful
- [x] App loads normally — no 401 / 403 errors

### Pending (monitoring period)

- [ ] 24h monitoring — confirm no auth failures in Vercel / Supabase logs
- [ ] Revoke legacy `eyJ` anon JWT in Supabase Dashboard (after monitoring passes)
- [ ] Update this document: mark legacy key as revoked + date

---

## Scope of change

| Layer | Change | Code modified? |
|-------|--------|---------------|
| `lib/supabase.ts` | Env var value only | No |
| `app/api/` (19 routes) | Env var value only | No |
| `scripts/` (5 files) | Env var value only | No |
| `.env.local` | Value replaced | Not committed |
| GitHub Secret | Value replaced | — |
| Vercel Env Vars | Value replaced | — |

---

## Why this migration

The legacy Supabase anon key was a long-lived JWT (`eyJ…`) that could not be meaningfully
scoped or rotated without a full key replacement. The new Publishable Key format:

- Supports key rotation via the Supabase Dashboard without codebase changes
- Is recognisably distinct from secret/service-role keys (`sb_publishable_` vs `sb_secret_`)
- Is compatible with the weekly Security Scan pattern check added in PR #15

---

## Legacy key deactivation (to be completed after monitoring)

Once the 24h monitoring period passes without issues:

1. Supabase Dashboard → Project Settings → API → Legacy JWT anon key → **Revoke**
2. Verify app still functions (the new publishable key is already active)
3. Update this document: add revocation date below

**Revocation date:** _(pending)_

---

## Related

- PR #11 — removed hardcoded service role keys from QA scripts
- PR #12 — auto-load `.env.local` in QA scripts
- PR #15 — weekly security scan (blocking pattern check for `eyJ` tokens)
- `docs/security-scan-baseline.md` — npm audit vulnerability baseline
