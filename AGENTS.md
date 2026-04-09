<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:cron-deployment -->
# GW Auto-Import Cron

The endpoint `/api/cron/import-gw-stats` is hit daily at 02:00 UTC by Vercel Cron (configured in `vercel.json`).

## Required environment variables

These MUST be set in **Vercel Project → Settings → Environment Variables** for Production:

| Variable | Source | Notes |
|---|---|---|
| `CRON_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | Bearer token Vercel Cron sends in the `Authorization` header |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Studio → Settings → API → service_role | Bypasses RLS — SERVER ONLY, never expose to client |

The same two variables are also required in `.env.local` for local development.

## How it works

1. Vercel Cron hits `GET /api/cron/import-gw-stats` daily at 02:00 UTC
2. The endpoint validates `Authorization: Bearer $CRON_SECRET`
3. It queries `liga_gameweeks` for rows where `end_date < today` AND `status != 'finished'`
4. For each such row, it calls `importGameweekForLeague` from `lib/gw-import.ts`
5. Each import is logged to `liga_admin_audit_log` with `actor_label = 'cron'`
6. Admin UI (`/leagues/<id>/admin`) shows the audit log under "📜 Admin-Verlauf"

## Manual verification

```bash
# Start dev server
npm run dev

# In another terminal:
node scripts/verify-cron-import.mjs
```

## Schedule

Currently `0 2 * * *` (daily at 02:00 UTC). To change, edit `vercel.json`. Vercel Cron supports standard cron syntax — see https://vercel.com/docs/cron-jobs.
<!-- END:cron-deployment -->
