"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { BottomNav } from "@/app/components/BottomNav";
import { useToast } from "@/app/components/ToastProvider";
import { ThemeSwitcher } from "@/app/components/ThemeSwitcher";
import { Spinner } from "@/app/components/ui/Spinner";

export default function AccountPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<"main" | "username" | "email" | "password">("main");
  const router = useRouter();

  // Edit state
  const [username, setUsername] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Avatar
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      setUsername(data.user.user_metadata?.username || "");
      setAvatarUrl(data.user.user_metadata?.avatar_url || null);

      setLoading(false);
    });
  }, []);

  function flash(text: string, ok = true) {
    toast(text, ok ? "success" : "error");
  }

  // ── Avatar upload ──────────────────────────────────────
  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 2 * 1024 * 1024) { flash("Max. 2 MB", false); return; }

    setUploadingAvatar(true);
    try {
      // Try Supabase Storage first
      const ext = file.name.split(".").pop();
      const path = `avatars/${user.id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars").upload(path, file, { upsert: true });

      let url: string;
      if (upErr) {
        // Fallback: store as data URL in user_metadata
        url = await new Promise((res) => {
          const reader = new FileReader();
          reader.onload = (ev) => res(ev.target?.result as string);
          reader.readAsDataURL(file);
        });
      } else {
        const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
        url = pub.publicUrl + `?t=${Date.now()}`;
      }

      await supabase.auth.updateUser({ data: { avatar_url: url } });
      setAvatarUrl(url);
      flash("Profilbild aktualisiert");
    } catch (err: any) {
      flash(err.message || "Fehler beim Upload", false);
    } finally {
      setUploadingAvatar(false);
    }
  }

  // ── Save username ─────────────────────────────────────
  async function saveUsername() {
    if (!username.trim()) { flash("Benutzername darf nicht leer sein", false); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({
      data: { username: username.trim() },
    });
    setSaving(false);
    if (error) { flash(error.message, false); return; }
    // Also update teams name if desired (optional)
    flash("Benutzername gespeichert");
    setSection("main");
  }

  // ── Save email ────────────────────────────────────────
  async function saveEmail() {
    if (!newEmail.trim()) { flash("E-Mail darf nicht leer sein", false); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    setSaving(false);
    if (error) { flash(error.message, false); return; }
    flash("Bestätigungs-E-Mail wurde gesendet");
    setSection("main");
  }

  // ── Save password ─────────────────────────────────────
  async function savePassword() {
    if (newPassword.length < 6) { flash("Mindestens 6 Zeichen", false); return; }
    if (newPassword !== confirmPassword) { flash("Passwörter stimmen nicht überein", false); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);
    if (error) { flash(error.message, false); return; }
    flash("Passwort aktualisiert");
    setNewPassword(""); setConfirmPassword(""); setOldPassword("");
    setSection("main");
  }

  // ── Logout ────────────────────────────────────────────
  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/auth";
  }

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center"
      style={{ background: "var(--bg-page)" }}>
      <Spinner />
    </main>
  );

  const displayName = user?.user_metadata?.username || user?.email?.split("@")[0] || "–";
  const initial = displayName[0]?.toUpperCase() || "?";

  // ── Sub-sections ──────────────────────────────────────

  if (section === "username") return (
    <SubSection title="Benutzername" onBack={() => setSection("main")}>
      <p className="text-[8px] font-black uppercase tracking-widest mb-4" style={{ color: "var(--color-muted)" }}>
        Wird in der App und als Teamname angezeigt
      </p>
      <input
        value={username}
        onChange={e => setUsername(e.target.value)}
        placeholder="Benutzername"
        className="w-full px-4 py-3 rounded-xl text-sm font-black outline-none mb-4"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border-subtle)", color: "var(--color-text)" }}
        maxLength={24}
        autoFocus
      />
      <SaveButton onClick={saveUsername} saving={saving} />
    </SubSection>
  );

  if (section === "email") return (
    <SubSection title="E-Mail ändern" onBack={() => setSection("main")}>
      <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>
        Aktuelle E-Mail
      </p>
      <p className="text-sm font-black mb-4" style={{ color: "var(--color-dim)" }}>{user?.email}</p>
      <input
        value={newEmail}
        onChange={e => setNewEmail(e.target.value)}
        placeholder="Neue E-Mail-Adresse"
        type="email"
        className="w-full px-4 py-3 rounded-xl text-sm font-black outline-none mb-4"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border-subtle)", color: "var(--color-text)" }}
        autoFocus
      />
      <p className="text-[8px] mb-4" style={{ color: "var(--color-muted)" }}>
        Du erhältst eine Bestätigungs-E-Mail an die neue Adresse.
      </p>
      <SaveButton onClick={saveEmail} saving={saving} label="E-Mail ändern" />
    </SubSection>
  );

  if (section === "password") return (
    <SubSection title="Passwort ändern" onBack={() => setSection("main")}>
      {[
        { val: newPassword,     set: setNewPassword,     label: "Neues Passwort",      placeholder: "Mindestens 6 Zeichen" },
        { val: confirmPassword, set: setConfirmPassword,  label: "Passwort bestätigen", placeholder: "Wiederholen" },
      ].map(({ val, set, label, placeholder }) => (
        <div key={label} className="mb-3">
          <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>{label}</p>
          <input
            value={val}
            onChange={e => set(e.target.value)}
            placeholder={placeholder}
            type="password"
            className="w-full px-4 py-3 rounded-xl text-sm font-black outline-none"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border-subtle)", color: "var(--color-text)" }}
          />
        </div>
      ))}
      <div className="mb-4" />
      <SaveButton onClick={savePassword} saving={saving} label="Passwort speichern" />
    </SubSection>
  );

  // ── Main account view ─────────────────────────────────
  return (
    <main className="flex min-h-screen flex-col pb-24" style={{ background: "var(--bg-page)", paddingTop: 16 }}>

      <div className="max-w-[480px] mx-auto w-full px-4">

        {/* Header */}
        <div className="flex items-center justify-between mb-6 pt-2">
          <h1 className="text-sm font-black uppercase tracking-widest" style={{ color: "var(--color-text)" }}>
            Konto
          </h1>
        </div>

        {/* Avatar + name hero */}
        <div className="flex flex-col items-center mb-6">
          <div className="relative mb-3">
            <div className="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center"
              style={{ border: "3px solid var(--color-primary)", background: "var(--bg-card)" }}>
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl font-black" style={{ color: "var(--color-primary)" }}>{initial}</span>
              )}
              {uploadingAvatar && (
                <div className="absolute inset-0 flex items-center justify-center rounded-full"
                  style={{ background: "rgba(0,0,0,0.7)" }}>
                  <span className="text-[8px] font-black animate-pulse" style={{ color: "var(--color-primary)" }}>...</span>
                </div>
              )}
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadingAvatar}
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center transition-all"
              style={{ background: "var(--color-primary)", border: "2px solid var(--bg-page)" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--bg-page)" strokeWidth="2.5">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={handleAvatarChange} />
          </div>
          <p className="font-black text-base" style={{ color: "var(--color-text)" }}>{displayName}</p>
          <p className="text-[9px] mt-0.5" style={{ color: "var(--color-muted)" }}>{user?.email}</p>
        </div>

        {/* Settings sections */}
        <div className="space-y-2">

          {/* Profil */}
          <SectionGroup label="Profil">
            <SettingsRow
              label="Benutzername"
              value={displayName}
              onClick={() => setSection("username")}
            />
            <SettingsRow
              label="E-Mail"
              value={user?.email}
              onClick={() => setSection("email")}
            />
            <SettingsRow
              label="Passwort"
              value="••••••••"
              onClick={() => setSection("password")}
            />
          </SectionGroup>

          {/* Benachrichtigungen */}
          <SectionGroup label="Benachrichtigungen">
            <SettingsRow
              label="Push-Benachrichtigungen"
              value="Einstellungen"
              onClick={() => router.push('/account/notifications')}
            />
          </SectionGroup>

          {/* Theme */}
          <div>
            <p className="text-[8px] font-black uppercase tracking-widest mb-1.5 px-1"
              style={{ color: "var(--color-muted)" }}>
              Design
            </p>
            <ThemeSwitcher />
          </div>

          {/* App Info */}
          <SectionGroup label="App">
            <div className="px-4 py-3 flex items-center justify-between">
              <p className="text-xs font-black" style={{ color: "var(--color-muted)" }}>Version</p>
              <p className="text-xs font-black" style={{ color: "var(--color-border-subtle)" }}>1.0.0</p>
            </div>
            <div style={{ borderTop: "1px solid var(--bg-elevated)" }}>
              <button
                onClick={() => window.open("mailto:support@tifo.gg", "_blank")}
                className="w-full px-4 py-3 flex items-center justify-between transition-opacity hover:opacity-70 text-left">
                <p className="text-xs font-black" style={{ color: "var(--color-muted)" }}>Support kontaktieren</p>
                <span style={{ color: "var(--color-muted)" }}>›</span>
              </button>
            </div>
          </SectionGroup>

          {/* Logout */}
          <button
            onClick={logout}
            className="w-full py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest mt-2 transition-all"
            style={{ background: "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))", color: "var(--color-error)", border: "1px solid color-mix(in srgb, var(--color-error) 20%, transparent)" }}>
            Abmelden
          </button>
        </div>
      </div>

      <BottomNav />
    </main>
  );
}

// ── Helper components ─────────────────────────────────────

function SubSection({
  title, onBack, children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col pb-24" style={{ background: "var(--bg-page)" }}>
      <div className="max-w-[480px] mx-auto w-full px-4 pt-4">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack}
            className="text-[9px] font-black uppercase tracking-widest"
            style={{ color: "var(--color-muted)" }}>
            ‹ Zurück
          </button>
          <h1 className="text-sm font-black uppercase tracking-widest" style={{ color: "var(--color-text)" }}>
            {title}
          </h1>
        </div>
        {children}
      </div>
      <BottomNav />
    </main>
  );
}

function SectionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[8px] font-black uppercase tracking-widest mb-1.5 px-1"
        style={{ color: "var(--color-muted)" }}>
        {label}
      </p>
      <div className="rounded-2xl overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
        {children}
      </div>
    </div>
  );
}

function SettingsRow({
  label, value, onClick, valueColor,
}: {
  label: string;
  value?: string;
  onClick?: () => void;
  valueColor?: string;
}) {
  return (
    <button onClick={onClick}
      className="w-full px-4 py-3.5 flex items-center justify-between transition-opacity hover:opacity-70 text-left [&:not(:first-child)]:border-t"
      style={{ borderColor: "var(--bg-elevated)" }}
    >
      <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>{label}</p>
      <div className="flex items-center gap-2">
        {value && (
          <p className="text-xs font-black max-w-[150px] truncate"
            style={{ color: valueColor || "var(--color-muted)" }}>
            {value}
          </p>
        )}
        <span style={{ color: "var(--color-muted)" }}>›</span>
      </div>
    </button>
  );
}

function SaveButton({
  onClick, saving, label = "Speichern",
}: {
  onClick: () => void;
  saving: boolean;
  label?: string;
}) {
  return (
    <button onClick={onClick} disabled={saving}
      className="w-full py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
      style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
      {saving ? "Wird gespeichert..." : label}
    </button>
  );
}
