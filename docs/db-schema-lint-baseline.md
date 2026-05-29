# DB Schema Lint Baseline

## Status (2026-05-29)

`python -m sqlfluff lint db/ --dialect postgres --exclude-rules layout` meldet **85 Violations in 14 von 24 Dateien**.

Layout-Regeln (LT*) sind ausgeblendet — sie betreffen nur Einrückung und Zeilenlänge.
Der Workflow `.github/workflows/db-schema.yml` läuft daher **non-blocking** (`continue-on-error: true`).

---

## Violation-Übersicht (ohne Layout-Regeln)

| Regel | Kategorie | Anzahl | Bedeutung |
|-------|-----------|--------|-----------|
| `RF05` | references.special_chars | 41 | Sonderzeichen in Identifiern (z.B. `$`) |
| `CP01` | capitalisation.keywords | 17 | Groß-/Kleinschreibung bei Keywords |
| `RF06` | references.quoting | 12 | Unnötige Anführungszeichen (RLS Policy-Namen) |
| `RF04` | references.keywords | 9 | SQL-Keywords als Identifier genutzt |
| `RF03` | references.consistent | 4 | Inkonsistente Referenz-Qualifizierung |
| `AL01` | aliasing.table | 2 | Tabellen-Aliasing-Stil |
| `PRS` | parse_error | 1 | Echter Parse-Fehler in `migrations.sql` |

**Wichtig:** Die meisten RF06-Violations sind Supabase-RLS-Policy-Namen in Anführungszeichen — valides PostgreSQL, sqlfluff-Eigenheit.

---

## Echter Parse-Fehler (prioritär)

**`db/migrations.sql` Zeile 13:** `ALTER TABLE wm_nations ADD CONSTRAINT` — sqlfluff kann diese Syntax nicht parsen.  
Wahrscheinlich ein sqlfluff-Dialekt-Limitierung, kein echter SQL-Fehler (Supabase führt es korrekt aus).  
Trotzdem sollte dieser Eintrag geprüft werden.

---

## Empfohlene Aufräum-Reihenfolge

1. **PRS-Fehler klären** (`migrations.sql` L:13) — ist es ein echter Bug oder sqlfluff-Limitation?
2. **CP01** (Keyword-Casing) — mechanisch fixbar, `sqlfluff fix --rules capitalisation`
3. **RF04/RF06** (Keywords/Quoting) — einzeln prüfen, einige sind Supabase-spezifisch valide
4. **RF05** (Special chars) — meist `$` in `gen_random_uuid()` o.ä., kein Fix nötig
5. **Layout-Regeln** — erst nach Stufen 1–4, koordiniert mit `docs/lint-cleanup-plan.md`

---

## CI-Status

| Workflow | Datei | SQL-Check | Blockierend |
|----------|-------|-----------|-------------|
| `DB Schema Check` | `.github/workflows/db-schema.yml` | ja | nein (`continue-on-error: true`) |

Wird auf blockierend umgestellt, sobald Baseline auf 0 reduziert ist.
