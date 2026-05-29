# Lint Cleanup Plan

## Aktueller Status (2026-05-29)

`npm run lint` schlägt mit **832 Problemen** fehl:
- **665 Errors**
- **167 Warnings**

Lint ist daher aus dem blockierenden CI (`ci.yml`) entfernt.
Ein separater nicht-blockierender Workflow (`lint.yml`) zeigt den Status weiterhin an.

---

## Hauptkategorien

| Regel | Typ | Menge (ca.) |
|-------|-----|-------------|
| `@typescript-eslint/no-explicit-any` | Error | hoch |
| `react-hooks/exhaustive-deps` (setState in Effect) | Error | mittel |
| `react-hooks/no-direct-mutation-state` (Immutability) | Error | mittel |
| `@next/next/no-html-link-for-pages` | Error | niedrig |
| `no-unused-vars` / `@typescript-eslint/no-unused-vars` | Error | mittel |
| `@next/next/no-img-element` | Warning | hoch |

---

## Empfohlene Aufräum-Reihenfolge

### Stufe 1 — React-Hook-Fehler (höchste Priorität)
**Warum zuerst:** Echte Bugs, nicht nur Stil-Issues. `setState` im Effect ohne Dependency-Array
kann zu Endlos-Renders führen.

```bash
# Alle Hook-Fehler anzeigen:
npx eslint --rule '{"react-hooks/exhaustive-deps": "error"}' app/ lib/ --format compact
```

### Stufe 2 — Next.js Link-Fehler
**Warum:** `<a href="...">` statt `<Link>` verhindert Client-Side-Navigation.
Einfach zu fixen, hoher Nutzen.

```bash
npx eslint --rule '{"@next/next/no-html-link-for-pages": "error"}' app/ --format compact
```

### Stufe 3 — prefer-const / unused vars
**Warum:** Rein mechanisch, kein Risiko. Viele Fixes sind auto-fixbar.

```bash
npm run lint -- --fix --rule '{"no-unused-vars": "error", "prefer-const": "error"}'
```

### Stufe 4 — `any` schrittweise ersetzen
**Warum:** Nicht alles auf einmal. Nur in kritischen Libs wie `lib/wm-*.ts`, `lib/scoring.ts`.
Zentrale Typen in `app/types/` definieren und von dort importieren.

Vorgehen: Datei für Datei, beginnend mit den meistgenutzten Libs.

### Stufe 5 — `<img>` → `next/image` (zuletzt)
**Warum zuletzt:** Erfordert Layout-Anpassungen (width/height oder fill), hohes Regressions-Risiko.
Erst angehen wenn Stufen 1–4 erledigt sind.

---

## CI-Status

| Workflow | Datei | Lint-Check | Blockierend |
|----------|-------|------------|-------------|
| `CI` | `.github/workflows/ci.yml` | nein | ja (typecheck + test) |
| `Lint` | `.github/workflows/lint.yml` | ja | nein (`continue-on-error: true`) |

Lint wird wieder in `ci.yml` aufgenommen sobald die Fehleranzahl auf 0 gesunken ist.
