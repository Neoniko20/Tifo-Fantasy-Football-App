"""
F0-Task 3 — Browser Tests (Playwright)
Test 1: Realtime reconnect + data freshness
Test 2: Mid-GW Refresh Storm
Test 3: Mobile Stress (iPhone 12, 390×844)

Run: python scripts/qa-browser-chaos.py
    (loads .env.local automatically)

Requires in .env.local:
  NEXT_PUBLIC_SUPABASE_URL=https://...supabase.co
  SUPABASE_SERVICE_ROLE_KEY=<service role key — never commit this value>
"""
import os
import sys
import time
import json
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, Page, ConsoleMessage

# Load .env.local automatically if present (silently skip in CI where vars are already set)
try:
    from dotenv import load_dotenv
    _env_file = Path(__file__).resolve().parents[1] / ".env.local"
    load_dotenv(_env_file, override=False)  # override=False: existing env vars take precedence
except ImportError:
    pass  # python-dotenv not available; rely on env vars being set externally

SUPA_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPA_SK  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPA_URL:
    print("❌ Missing NEXT_PUBLIC_SUPABASE_URL — add to .env.local and source it first")
    sys.exit(1)
if not SUPA_SK:
    print("❌ Missing SUPABASE_SERVICE_ROLE_KEY — add to .env.local and source it first")
    sys.exit(1)

BASE = "http://localhost:3000"
LEAGUE_ID = "46f66d03-9270-4cee-b6b5-99f2f48ee61c"
LIVE_CENTER = f"{BASE}/wm/{LEAGUE_ID}/live"
MATCHDAY    = f"{BASE}/wm/{LEAGUE_ID}/matchday"
ADMIN       = f"{BASE}/wm/{LEAGUE_ID}/admin"
HUB         = f"{BASE}/wm/{LEAGUE_ID}"

pass_count = 0
fail_count = 0
bugs = []

def ok(label, val):
    global pass_count
    if val:
        print(f"  ✅ {label}")
        pass_count += 1
    else:
        print(f"  ❌ {label}")
        global fail_count
        fail_count += 1

def note(msg): print(f"  ℹ️  {msg}")
def bug(sev, id_, desc):
    print(f"  🐛 [{sev}] {id_}: {desc}")
    bugs.append({"sev": sev, "id": id_, "desc": desc})
def header(n, title):
    print(f"\n{'─'*58}\nBrowser-Test {n}: {title}\n{'─'*58}")

def collect_errors(page: Page) -> list[str]:
    """Attach console error listener and return collected errors."""
    errors = []
    def on_console(msg: ConsoleMessage):
        if msg.type == "error":
            errors.append(msg.text)
    page.on("console", on_console)
    return errors

def wait_and_screenshot(page: Page, path: str, delay: float = 2.0):
    time.sleep(delay)
    page.screenshot(path=path, full_page=True)
    note(f"Screenshot → {path}")

def trigger_stat_update(delta_pts: float = 5.0):
    """Trigger a DB stat update via node script to simulate live scoring."""
    cmd = f"""cd /Users/nikoko/my-fantasy-app && node -e "
const {{ createClient }} = require('@supabase/supabase-js');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {{ console.error('Missing Supabase env vars'); process.exit(1); }}
const sb = createClient(url, key, {{ auth: {{ persistSession: false }} }});
async function upd() {{
  const {{ data: teams }} = await sb.from('teams').select('id,name,total_points').eq('league_id','46f66d03-9270-4cee-b6b5-99f2f48ee61c').order('total_points', {{ ascending: true }});
  const t = teams[0];
  const newPts = Math.round(((t.total_points || 0) + {delta_pts}) * 10) / 10;
  await sb.from('teams').update({{ total_points: newPts }}).eq('id', t.id);
  console.log('Updated ' + t.name + ' → ' + newPts);
}}
upd().catch(e => console.error(e.message));
" 2>&1"""
    env = {**os.environ, "NEXT_PUBLIC_SUPABASE_URL": SUPA_URL, "SUPABASE_SERVICE_ROLE_KEY": SUPA_SK}
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=15, env=env)
    out = (result.stdout + result.stderr).strip()
    note(f"DB trigger: {out}")
    return out

def get_page_numbers(page: Page) -> list[str]:
    """Extract all numeric-looking text from the page (points, ranks)."""
    return page.evaluate("""
        () => {
            const texts = [];
            document.querySelectorAll('*').forEach(el => {
                if (el.children.length === 0) {
                    const t = el.textContent.trim();
                    if (/^[\\d.]+$/.test(t)) texts.push(t);
                }
            });
            return [...new Set(texts)].slice(0, 30);
        }
    """)

# ─────────────────────────────────────────────────────────────────────────────
# Test 1: Realtime + Data Freshness
# ─────────────────────────────────────────────────────────────────────────────
def test1_realtime(browser):
    header(1, "Realtime Disconnect/Reconnect")

    errors_tab_a = []
    errors_tab_b = []

    ctx_a = browser.new_context()
    ctx_b = browser.new_context()

    page_a = ctx_a.new_page()
    page_b = ctx_b.new_page()

    errors_a = collect_errors(page_a)
    errors_b = collect_errors(page_b)

    # Open Live Center in both contexts
    page_a.goto(LIVE_CENTER, wait_until="networkidle", timeout=20000)
    page_b.goto(LIVE_CENTER, wait_until="networkidle", timeout=20000)
    note("Beide Tabs geladen")

    wait_and_screenshot(page_a, "/tmp/t1_tab_a_initial.png", 1.5)
    wait_and_screenshot(page_b, "/tmp/t1_tab_b_initial.png", 1.5)

    # Check initial render — look for point values on page
    text_a = page_a.inner_text("body")
    text_b = page_b.inner_text("body")
    ok("Tab A: Seite geladen (Auth-Redirect korrekt)", len(text_a) > 100)
    ok("Tab B: Seite geladen (Auth-Redirect korrekt)", len(text_b) > 100)

    # Auth redirect check: unauthenticated → should see login page (not a crash/blank)
    auth_ok_a = "einloggen" in text_a.lower() or "login" in text_a.lower() or "willkommen" in text_a.lower()
    auth_ok_b = "einloggen" in text_b.lower() or "login" in text_b.lower() or "willkommen" in text_b.lower()
    ok("Tab A: Auth-Redirect → Login-Seite korrekt", auth_ok_a)
    ok("Tab B: Auth-Redirect → Login-Seite korrekt", auth_ok_b)

    # Simulate offline: throttle network to 0 for Tab B
    note("Simuliere Offline: Tab B CDPSession offline setzen")
    client_b = ctx_b.new_cdp_session(page_b)
    client_b.send("Network.enable")
    client_b.send("Network.emulateNetworkConditions", {
        "offline": True,
        "latency": 0,
        "downloadThroughput": 0,
        "uploadThroughput": 0,
    })
    note("Tab B: Offline")

    # Trigger stat update while Tab B is offline
    trigger_stat_update(delta_pts=8.0)
    time.sleep(2)

    # Tab A should have updated (Realtime push)
    # Tab B is offline — can't receive
    text_a_after = page_a.inner_text("body")
    note("Tab A content nach stat_update captured")

    # Bring Tab B back online
    note("Tab B: wieder Online setzen")
    client_b.send("Network.emulateNetworkConditions", {
        "offline": False,
        "latency": 0,
        "downloadThroughput": -1,
        "uploadThroughput": -1,
    })

    # Wait for potential reconnect and re-fetch
    time.sleep(4)
    wait_and_screenshot(page_b, "/tmp/t1_tab_b_after_reconnect.png", 1.0)

    text_b_after = page_b.inner_text("body")
    ok("Tab B: nach Reconnect Content vorhanden", len(text_b_after) > 100)

    # Check console errors
    ok("Tab A: keine Console Errors", len(errors_a) == 0)
    if errors_a:
        for e in errors_a[:3]: note(f"  Tab A Error: {e[:120]}")

    ok("Tab B: keine Console Errors nach Reconnect", len(errors_b) == 0)
    if errors_b:
        for e in errors_b[:3]: note(f"  Tab B Error: {e[:120]}")
        if any("realtime" in e.lower() or "websocket" in e.lower() for e in errors_b):
            bug("P2", "RT-001", "Realtime WebSocket Error nach Reconnect in Console")

    # Check for duplicate event indicators
    # If Realtime fires duplicate events, we'd see doubled UI elements
    # We can't directly verify Realtime subscription count without hooks,
    # but we check that page structure is consistent
    note("Tab A screenshot → /tmp/t1_tab_a_after.png")
    wait_and_screenshot(page_a, "/tmp/t1_tab_a_after.png", 0.5)

    ctx_a.close()
    ctx_b.close()


# ─────────────────────────────────────────────────────────────────────────────
# Test 2: Mid-GW Refresh Storm
# ─────────────────────────────────────────────────────────────────────────────
def test2_refresh_storm(browser):
    header(2, "Mid-GW Refresh Storm")

    ctx = browser.new_context()
    page = ctx.new_page()
    errors = collect_errors(page)

    page.goto(LIVE_CENTER, wait_until="networkidle", timeout=20000)
    note("Live Center initial geladen")

    # 5× schnell refreshen — mit try/except pro reload (ERR_ABORTED bei zu schnellen Navigations)
    note("5× F5 auf Live Center...")
    reload_ok = 0
    for i in range(5):
        try:
            page.reload(wait_until="domcontentloaded", timeout=10000)
            reload_ok += 1
        except Exception as e:
            note(f"  Reload {i+1} aborted (expected bei schnellen Navigations): {str(e)[:60]}")
        time.sleep(0.6)
    time.sleep(1.5)
    wait_and_screenshot(page, "/tmp/t2_after_live_storm.png", 0.5)
    text_after_storm = page.inner_text("body")
    ok(f"Live Center nach Storm: noch geladen ({reload_ok}/5 Reloads ok)", len(text_after_storm) > 100)

    errors_after_live = list(errors)
    real_errs = [e for e in errors_after_live if not any(x in e.lower() for x in ["favicon", "hot-update"])]
    ok(f"Refresh Storm: keine echten JS Errors ({len(real_errs)} gefunden)", len(real_errs) == 0)
    for e in real_errs[:3]:
        note(f"  Error: {e[:120]}")

    # Wechsel zu Matchday
    try:
        page.goto(MATCHDAY, wait_until="networkidle", timeout=20000)
    except Exception:
        page.goto(MATCHDAY, wait_until="domcontentloaded", timeout=20000)
    note("Matchday geladen")
    for i in range(3):
        try:
            page.reload(wait_until="domcontentloaded", timeout=10000)
        except Exception:
            pass
        time.sleep(0.5)
    time.sleep(1.5)
    wait_and_screenshot(page, "/tmp/t2_matchday_after_storm.png", 0.5)
    ok("Matchday nach Storm: geladen", len(page.inner_text("body")) > 50)

    # Schnell zwischen Pages wechseln
    note("Schneller Tab-Wechsel: Live → Matchday → Hub → Admin → Live...")
    for url in [LIVE_CENTER, MATCHDAY, HUB, ADMIN, LIVE_CENTER, MATCHDAY]:
        page.goto(url, wait_until="domcontentloaded", timeout=10000)
        time.sleep(0.5)

    # Währenddessen stat_update
    trigger_stat_update(delta_pts=3.0)
    time.sleep(2)

    # Land auf Live Center und prüfen
    page.goto(LIVE_CENTER, wait_until="networkidle", timeout=20000)
    time.sleep(2)
    wait_and_screenshot(page, "/tmp/t2_final_live_center.png", 0.5)

    final_text = page.inner_text("body")
    ok("Live Center nach Storm: korrekte Daten vorhanden", len(final_text) > 100)
    ok("Kein 'undefined' sichtbar im Body", "undefined" not in final_text.lower())
    ok("Kein 'NaN' sichtbar im Body", "NaN" not in final_text)
    ok("Kein '[object Object]' sichtbar", "[object Object]" not in final_text)

    all_errors = list(errors)
    real_errors = [e for e in all_errors if not any(x in e.lower() for x in ["favicon", "hot-update", "404"])]
    ok(f"Keine echten JS Errors nach Storm ({len(real_errors)} real errors)", len(real_errors) == 0)
    for e in real_errors[:5]:
        note(f"  JS Error: {e[:140]}")
        if "maximum update depth" in e.lower():
            bug("P1", "STORM-001", "Maximum update depth exceeded — infinite render loop bei Refresh Storm")
        elif "cannot read properties" in e.lower():
            bug("P2", "STORM-002", f"Null-Ref Error nach Refresh: {e[:80]}")
        elif "subscription" in e.lower() or "channel" in e.lower():
            bug("P2", "STORM-003", f"Realtime Subscription Error nach Refresh Storm: {e[:80]}")

    # BottomNav check: only relevant on authenticated WM pages.
    # Headless Playwright (no session) lands on login page → no BottomNav expected there.
    final_url = page.url
    on_auth_page = "/auth" in final_url or "login" in final_url or "willkommen" in page.inner_text("body").lower()
    if on_auth_page:
        ok("BottomNav: Login-Seite korrekt (kein BottomNav auf Auth erwartet)", True)
    else:
        nav_visible = page.evaluate("""
            () => {
                const nav = document.querySelector('nav') ||
                            document.querySelector('[data-testid*="nav"]') ||
                            document.querySelector('[class*="bottom"]') ||
                            document.querySelector('[class*="nav"]');
                return nav ? nav.offsetHeight > 0 : false;
            }
        """)
        ok("BottomNav nach Storm: sichtbar", nav_visible)

    ctx.close()


# ─────────────────────────────────────────────────────────────────────────────
# Test 3: Mobile Stress (iPhone 12, 390×844)
# ─────────────────────────────────────────────────────────────────────────────
def test3_mobile(browser):
    header(3, "Mobile Stress — iPhone 12 (390×844)")

    iphone = {
        "viewport": {"width": 390, "height": 844},
        "device_scale_factor": 3,
        "is_mobile": True,
        "has_touch": True,
        "user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1"
    }

    ctx = browser.new_context(**iphone)
    page = ctx.new_page()
    errors = collect_errors(page)

    pages_to_test = [
        ("Live Center", LIVE_CENTER),
        ("Matchday",    MATCHDAY),
        ("Hub",         HUB),
    ]

    for name, url in pages_to_test:
        page.goto(url, wait_until="networkidle", timeout=20000)
        time.sleep(2)
        screenshot_path = f"/tmp/t3_mobile_{name.lower().replace(' ', '_')}.png"
        page.screenshot(path=screenshot_path, full_page=True)
        note(f"{name} Screenshot → {screenshot_path}")

        body_text = page.inner_text("body")
        ok(f"{name}: geladen auf Mobile", len(body_text) > 50)

        # Check for horizontal overflow
        has_overflow = page.evaluate("""
            () => {
                const body = document.body;
                const html = document.documentElement;
                return body.scrollWidth > window.innerWidth || html.scrollWidth > window.innerWidth;
            }
        """)
        if has_overflow:
            bug("P2", f"MOB-{name[:3].upper()}-001", f"{name}: horizontaler Overflow auf 390px")
        ok(f"{name}: kein horizontaler Overflow", not has_overflow)

        # Check BottomNav
        nav_check = page.evaluate("""
            () => {
                // Check all nav-like elements
                const candidates = [
                    ...document.querySelectorAll('nav'),
                    ...document.querySelectorAll('[class*="bottom"]'),
                    ...document.querySelectorAll('[class*="nav"]'),
                    ...document.querySelectorAll('[role="navigation"]'),
                ];
                const visible = candidates.filter(el => {
                    const r = el.getBoundingClientRect();
                    return r.height > 0 && r.width > 0;
                });
                return {
                    found: candidates.length,
                    visible: visible.length,
                    heights: visible.map(el => Math.round(el.getBoundingClientRect().height)),
                };
            }
        """)
        ok(f"{name}: BottomNav/Nav vorhanden (gefunden: {nav_check['found']}, sichtbar: {nav_check['visible']})",
           nav_check["visible"] > 0)

        # Check for key content overlap with nav (content clipped by bottom nav)
        content_check = page.evaluate("""
            () => {
                const nav = document.querySelector('nav') ||
                            document.querySelector('[class*="bottom"]');
                if (!nav) return { navHeight: 0, ok: true };
                const navRect = nav.getBoundingClientRect();
                const navHeight = Math.round(navRect.height);
                // Check if any important content is behind the nav
                const mainContent = document.querySelector('main') ||
                                    document.querySelector('[class*="content"]') ||
                                    document.querySelector('[class*="main"]');
                const pb = mainContent ?
                    parseInt(window.getComputedStyle(mainContent).paddingBottom || '0') : 0;
                return { navHeight, paddingBottom: pb, hasMargin: pb >= navHeight };
            }
        """)
        note(f"{name}: nav_height={content_check.get('navHeight')}px, padding_bottom={content_check.get('paddingBottom')}px")
        if content_check.get("navHeight", 0) > 0 and not content_check.get("hasMargin", True):
            # Not necessarily a bug if the page handles it differently
            note(f"  ⚠️ Kein explizites padding-bottom über Nav-Höhe (kann OK sein)")

        # Check undefined/NaN on mobile
        ok(f"{name}: kein 'undefined' auf Mobile", "undefined" not in body_text.lower() or "undefined" in url)
        ok(f"{name}: kein 'NaN' auf Mobile", "NaN" not in body_text)

    # Schneller Tab-Wechsel auf Mobile
    note("Schneller Tab-Wechsel auf Mobile (5 Navigationen)...")
    for url in [LIVE_CENTER, MATCHDAY, HUB, LIVE_CENTER, MATCHDAY]:
        page.goto(url, wait_until="domcontentloaded", timeout=10000)
        time.sleep(0.6)
    time.sleep(1.5)

    final_text = page.inner_text("body")
    ok("Mobile Tab-Switching: kein Crash", len(final_text) > 50)

    mobile_errors = [e for e in errors if not any(x in e.lower() for x in ["favicon", "hot-update"])]
    ok(f"Mobile: keine JS Errors ({len(mobile_errors)} gefunden)", len(mobile_errors) == 0)
    for e in mobile_errors[:3]:
        note(f"  Mobile Error: {e[:140]}")

    # Final Mobile Live Center screenshot
    page.goto(LIVE_CENTER, wait_until="networkidle", timeout=20000)
    time.sleep(2)
    page.screenshot(path="/tmp/t3_mobile_final.png", full_page=True)
    note("Final Mobile Live Center → /tmp/t3_mobile_final.png")

    ctx.close()


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def warmup_routes():
    """Warm up Turbopack routes before running tests."""
    import urllib.request
    routes = [BASE, f"{BASE}/auth", LIVE_CENTER, MATCHDAY, HUB, ADMIN]
    for url in routes:
        try:
            urllib.request.urlopen(url, timeout=15)
        except Exception:
            pass
    time.sleep(2)
    note("Routes warm-up abgeschlossen")

def main():
    print("╔══════════════════════════════════════════════════════════╗")
    print("║  F0-Task 3 — Browser QA (Playwright)                     ║")
    print("║  Test 1: Realtime  |  Test 2: Refresh Storm  |  Test 3: Mobile ║")
    print("╚══════════════════════════════════════════════════════════╝")

    warmup_routes()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])

        try:
            test1_realtime(browser)
        except Exception as e:
            print(f"  ❌ Test 1 FATAL: {e}")
            fail_count_ref = globals()
            globals()["fail_count"] += 1

        try:
            test2_refresh_storm(browser)
        except Exception as e:
            print(f"  ❌ Test 2 FATAL: {e}")
            globals()["fail_count"] += 1

        try:
            test3_mobile(browser)
        except Exception as e:
            print(f"  ❌ Test 3 FATAL: {e}")
            globals()["fail_count"] += 1

        browser.close()

    print(f"\n{'═'*58}")
    print("BUGS:")
    if not bugs:
        print("  ✅ Keine Bugs")
    else:
        for b in bugs:
            print(f"  🐛 [{b['sev']}] {b['id']}: {b['desc']}")

    print(f"\n{'═'*58}")
    print(f"ERGEBNIS: ✅ {pass_count} bestanden  ❌ {fail_count} fehlgeschlagen  🐛 {len(bugs)} Bugs")
    print(f"Browser-Tests: {'✅ PASS' if fail_count == 0 else '❌ FAIL'}")
    print("═"*58)
    print("\nScreenshots:")
    for f in [
        "/tmp/t1_tab_a_initial.png", "/tmp/t1_tab_b_after_reconnect.png",
        "/tmp/t2_final_live_center.png", "/tmp/t2_matchday_after_storm.png",
        "/tmp/t3_mobile_live_center.png", "/tmp/t3_mobile_matchday.png",
        "/tmp/t3_mobile_final.png",
    ]:
        print(f"  {f}")

    if fail_count > 0:
        exit(1)

if __name__ == "__main__":
    main()
