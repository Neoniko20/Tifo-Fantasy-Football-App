# Security Scan Baseline

**Last updated:** 2026-06-02  
**npm audit result:** 17 vulnerabilities (1 critical, 9 high, 7 moderate)  
**Status:** Baseline documented — `npm audit` step runs with `continue-on-error: true` until resolved

---

## Summary

| Severity | Count | Primary source |
|----------|-------|----------------|
| Critical | 1     | `vitest` (via `@vitest/mocker`) |
| High     | 9     | `next-pwa` chain + `next` + `lodash` + `fast-uri` + `@babel/...` |
| Moderate | 7     | `vite` / `esbuild` / `postcss` / `brace-expansion` / `ws` |

---

## Details

### CRITICAL

| Package | Via | Notes |
|---------|-----|-------|
| `vitest` | `@vitest/mocker` (advisory 1120011) | Dev-only — not in production bundle |

### HIGH

| Package | Via / Advisory | Notes |
|---------|----------------|-------|
| `next` | advisories 1116375, 1117930 | Upgrade to latest Next.js patch when stable |
| `next-pwa` | `workbox-webpack-plugin → workbox-build → rollup-plugin-terser → serialize-javascript` | Build-time only; no runtime exposure. `next-pwa` has no active maintainer — migration to `@ducanh2912/next-pwa` or `@serwist/next` planned separately |
| `rollup-plugin-terser` | `serialize-javascript` | Transitive via next-pwa chain |
| `serialize-javascript` | advisory 1113686 | Transitive via next-pwa chain |
| `workbox-build` | `rollup-plugin-terser` | Transitive via next-pwa chain |
| `workbox-webpack-plugin` | `workbox-build` | Transitive via next-pwa chain |
| `lodash` | advisories 1115806, 1115810 | Transitive dep — check if direct upgrade is possible |
| `fast-uri` | advisories 1117870, 1117884 | Transitive dep |
| `@babel/plugin-transform-modules-systemjs` | advisory 1117908 | Transitive via build tools |

### MODERATE

| Package | Via / Advisory | Notes |
|---------|----------------|-------|
| `vite` | advisories 1116229 + `esbuild` | Dev-only |
| `esbuild` | advisory 1102341 | Dev-only |
| `@vitest/mocker` | `vite` | Dev-only |
| `vite-node` | `vite` | Dev-only |
| `postcss` | advisory 1117015 | Build-time only |
| `brace-expansion` | advisories 1115540, 1119088 | Transitive |
| `ws` | advisory 1119108 (uninitialized memory disclosure) | `npm audit fix` resolves this |

---

## Remediation Plan

### Short-term (can be done now)

```bash
# Fix ws and other auto-fixable vulns
npm audit fix
# Verify nothing broke
npm run typecheck && npm test
```

### Medium-term

- **`next`**: Upgrade to latest Next.js 16.x patch release once CI validates it
- **`lodash`**: Run `npm audit fix --force` in a separate branch and test thoroughly
- **`vitest` / `vite` / `esbuild`**: Upgrade devDependencies in a dedicated PR

### Long-term

- **`next-pwa`**: Migrate to `@serwist/next` or `@ducanh2912/next-pwa` (actively maintained forks)
  — this resolves the entire workbox chain (6 high + 1 critical)

---

## Secret Pattern Scan

The blocking secret-pattern checks (eyJ JWT tokens, sb_secret_ keys, service_role literals,
hardcoded Supabase URLs) were **all clean** as of 2026-06-02 following PRs #11 and #12.

### anon key migration (2026-06-02)

`NEXT_PUBLIC_SUPABASE_ANON_KEY` migrated from legacy `eyJ…` anon JWT to new `sb_publishable_…`
format across all environments (local, GitHub Secrets, Vercel). No code changes required.
See `docs/supabase-key-migration.md` for full details and legacy key deactivation checklist.

See `.github/workflows/security-scan.yml` for the scan configuration.

---

## When to Remove `continue-on-error`

Remove `continue-on-error: true` from the `npm audit` step once:
1. `next-pwa` is migrated or removed (resolves ~10 vulns)
2. `npm audit fix` has been applied and tested (resolves `ws` + auto-fixable items)
3. Remaining vuln count drops to 0 high/critical
