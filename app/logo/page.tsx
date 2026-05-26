"use client";

import { TifoHeroLogo } from "@/app/components/brand/TifoHeroLogo";
import { TifoUILogo } from "@/app/components/brand/TifoUILogo";
import { TifoAppIcon } from "@/app/components/brand/TifoAppIcon";

// ─── Shared layout helpers ──────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: "'Unbounded', sans-serif",
      fontSize: 8,
      letterSpacing: "0.25em",
      textTransform: "uppercase" as const,
      color: "var(--color-text-secondary, #a88858)",
    }}>
      {children}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontFamily: "'Unbounded', sans-serif",
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: "0.3em",
      textTransform: "uppercase" as const,
      color: "var(--color-primary, #F4C430)",
      marginBottom: 20,
      opacity: 0.7,
    }}>
      {children}
    </p>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 52 }}>
      <SectionTitle>{title}</SectionTitle>
      {children}
    </section>
  );
}

function Card({ label, bg = "var(--bg-card, #1a1200)", children }: {
  label: string; bg?: string; children: React.ReactNode
}) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column" as const,
      alignItems: "center",
      gap: 14,
      padding: "24px 28px",
      borderRadius: 14,
      background: bg,
      border: "1px solid var(--color-border, rgba(255,255,255,0.07))",
    }}>
      {children}
      <Label>{label}</Label>
    </div>
  );
}

function Row({ children, gap = 16 }: { children: React.ReactNode; gap?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", flexWrap: "wrap" as const, gap }}>
      {children}
    </div>
  );
}

function Rule({ text }: { text: string }) {
  return (
    <p style={{
      fontFamily: "sans-serif",
      fontSize: 11,
      color: "var(--color-text-secondary, #a88858)",
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 8,
      padding: "8px 12px",
      marginTop: 12,
    }}>
      {text}
    </p>
  );
}

// ─── Hero placeholder (until /public/brand/tifo-hero-fabric.webp exists) ────

// ─── Page ───────────────────────────────────────────────────────────────────

export default function LogoSandboxPage() {
  return (
    <main style={{
      minHeight: "100vh",
      background: "var(--bg-page, #0c0900)",
      color: "var(--color-text, #c8b080)",
      padding: "48px 24px 80px",
      maxWidth: 760,
      margin: "0 auto",
    }}>

      {/* Header */}
      <div style={{ marginBottom: 56 }}>
        <p style={{
          fontFamily: "'Unbounded', sans-serif",
          fontWeight: 900,
          fontSize: 11,
          letterSpacing: "0.4em",
          textTransform: "uppercase",
          color: "var(--color-primary)",
          marginBottom: 4,
        }}>
          TIFO — Brand System
        </p>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "sans-serif" }}>
          Alle Logo-Varianten · /logo
        </p>
      </div>

      {/* ── 1. HERO LOGO ─────────────────────────────────────────────────── */}
      <Section title="1 · Hero Logo — Auth / Splash / Home Hero">
        <Row gap={20}>
          <Card label="sm — 180px">
            <TifoHeroLogo size="sm" />
          </Card>
          <Card label="md — 320px (default)">
            <TifoHeroLogo size="md" priority />
          </Card>
          <Card label="lg — 420px">
            <TifoHeroLogo size="lg" />
          </Card>
        </Row>
        <Rule text="Einsatz: Auth, Splash, Home Hero — NICHT in Navigation oder BottomNav." />
      </Section>

      {/* ── 2. UI ICON ───────────────────────────────────────────────────── */}
      <Section title="2 · UI Icon — BottomNav / kleine Flächen">
        <Row>
          {(["lg", "md", "sm"] as const).map((s) => (
            <Card key={s} label={s}>
              <TifoUILogo variant="icon" size={s} />
            </Card>
          ))}
          <Card label="24px raw">
            <TifoUILogo variant="icon" size="sm" />
          </Card>
        </Row>
        <Rule text="Einsatz: BottomNav-Icon, kleine Badge-Flächen — kein Wordmark nötig." />
      </Section>

      {/* ── 3. UI WORDMARK ───────────────────────────────────────────────── */}
      <Section title="3 · UI Wordmark — TopNav / Header">
        <Row>
          {(["sm", "md", "lg"] as const).map((s) => (
            <Card key={s} label={s}>
              <TifoUILogo variant="wordmark" size={s} />
            </Card>
          ))}
        </Row>
        <Rule text="Einsatz: TopNav, App-Header — gibt Kontext ohne das Hero-Foto zu brauchen." />
      </Section>

      {/* ── 4. APP ICON ──────────────────────────────────────────────────── */}
      <Section title="4 · App Icon — PWA / Loading">
        <Row>
          <Card label="64 no glow">
            <TifoAppIcon size={64} />
          </Card>
          <Card label="96 glow">
            <TifoAppIcon size={96} glow />
          </Card>
          <Card label="128 glow">
            <TifoAppIcon size={128} glow />
          </Card>
          <Card label="192 glow">
            <TifoAppIcon size={192} glow />
          </Card>
        </Row>
        <Rule text="Einsatz: PWA-Splash, Loading-Screen, Onboarding." />
      </Section>

      {/* ── 5. KONTEXT: TopNav ───────────────────────────────────────────── */}
      <Section title="5 · Kontext — TopNav">
        <div style={{
          width: "100%",
          maxWidth: 400,
          height: 54,
          borderRadius: 14,
          background: "var(--bg-card, #1a1200)",
          border: "1px solid var(--color-border, rgba(255,255,255,0.07))",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          justifyContent: "space-between",
        }}>
          <TifoUILogo variant="wordmark" size="sm" />
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {["🔔", "👤"].map((icon, i) => (
              <span key={i} style={{ fontSize: 16, opacity: 0.5 }}>{icon}</span>
            ))}
          </div>
        </div>
        <Rule text="TopNav: immer TifoUILogo wordmark sm — nie das Hero-Foto." />
      </Section>

      {/* ── 6. KONTEXT: Home Hero ────────────────────────────────────────── */}
      <Section title="6 · Kontext — Home Hero">
        <div style={{
          width: "100%",
          maxWidth: 400,
          borderRadius: 14,
          background: "var(--bg-card, #1a1200)",
          border: "1px solid var(--color-border, rgba(255,255,255,0.07))",
          padding: 24,
          display: "flex",
          flexDirection: "column" as const,
          alignItems: "center",
          gap: 16,
        }}>
          {/* TopNav in context */}
          <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <TifoUILogo variant="wordmark" size="sm" />
            <span style={{ opacity: 0.4, fontSize: 14 }}>🔔</span>
          </div>
          <div style={{ width: "100%", height: 1, background: "rgba(255,255,255,0.05)" }} />
          {/* Hero area */}
          <TifoHeroLogo size="sm" />
          <p style={{ fontFamily: "sans-serif", fontSize: 11, color: "var(--color-text-secondary)", textAlign: "center" }}>
            Hero-Bereich: TifoHeroLogo groß, atmosphärisch.<br />
            TopNav oben: TifoUILogo wordmark — nicht beides prominent.
          </p>
        </div>
      </Section>

    </main>
  );
}
