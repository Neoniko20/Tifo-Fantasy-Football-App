'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  getLeaguePrefs,
  setLeaguePrefs,
  type LeaguePrefs,
  DEFAULT_LEAGUE,
} from '@/lib/notification-prefs';

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-4 rounded-2xl"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--color-border)', opacity: disabled ? 0.4 : 1 }}>
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-xs font-black" style={{ color: 'var(--color-text)' }}>{label}</p>
        {desc && <p className="text-[9px] mt-0.5" style={{ color: 'var(--color-muted)' }}>{desc}</p>}
      </div>
      <button
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="flex-shrink-0 relative w-10 h-5 rounded-full transition-all"
        style={{ background: checked ? 'var(--color-primary)' : 'var(--color-border)' }}>
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
          style={{
            background: checked ? 'var(--bg-page)' : 'var(--color-muted)',
            left: checked ? 'calc(100% - 18px)' : '2px',
          }}
        />
      </button>
    </div>
  );
}

export default function LeagueNotificationsPage() {
  const router = useRouter();
  const { leagueId } = useParams<{ leagueId: string }>();
  const [prefs, setPrefs] = useState<LeaguePrefs>(DEFAULT_LEAGUE);
  const [leagueName, setLeagueName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [leaguePrefs, leagueRow] = await Promise.all([
        getLeaguePrefs(supabase, leagueId),
        supabase.from('leagues').select('name').eq('id', leagueId).maybeSingle(),
      ]);
      setPrefs(leaguePrefs);
      setLeagueName(leagueRow.data?.name ?? '');
      setLoading(false);
    }
    load();
  }, [leagueId]);

  async function toggle(key: keyof LeaguePrefs, value: boolean) {
    const updated = { ...prefs, [key]: value };
    setPrefs(updated); // optimistic
    await setLeaguePrefs(supabase, leagueId, { [key]: value });
  }

  const masterDisabled = !prefs.enabled;

  return (
    <main className="flex min-h-screen flex-col pb-24" style={{ background: 'var(--bg-page)', paddingTop: 16 }}>
      <div className="max-w-[480px] mx-auto w-full px-4">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6 pt-2">
          <button
            onClick={() => router.back()}
            className="w-8 h-8 flex items-center justify-center rounded-xl"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--color-border)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="text-sm font-black uppercase tracking-widest truncate" style={{ color: 'var(--color-text)' }}>
            {leagueName || 'Liga'}
          </h1>
        </div>

        {loading ? (
          <p className="text-[9px] text-center mt-8" style={{ color: 'var(--color-muted)' }}>Laden...</p>
        ) : (
          <div className="space-y-6">

            {/* Master toggle */}
            <ToggleRow
              label="Liga-Benachrichtigungen"
              desc="Alle Benachrichtigungen für diese Liga"
              checked={prefs.enabled}
              onChange={(v) => toggle('enabled', v)}
            />

            {/* Event-specific toggles */}
            <section>
              <p className="text-[8px] font-black uppercase tracking-widest mb-2 px-1"
                style={{ color: 'var(--color-muted)' }}>Ergebnisse</p>
              <div className="space-y-2">
                <ToggleRow
                  label="Waiver-Ergebnisse"
                  checked={prefs.waiver_results}
                  onChange={(v) => toggle('waiver_results', v)}
                  disabled={masterDisabled}
                />
                <ToggleRow
                  label="Trade-Ergebnisse"
                  checked={prefs.trade_results}
                  onChange={(v) => toggle('trade_results', v)}
                  disabled={masterDisabled}
                />
              </div>
            </section>

            <section>
              <p className="text-[8px] font-black uppercase tracking-widest mb-2 px-1"
                style={{ color: 'var(--color-muted)' }}>Chat</p>
              <ToggleRow
                label="Chat-Nachrichten"
                checked={prefs.chat_messages}
                onChange={(v) => toggle('chat_messages', v)}
                disabled={masterDisabled}
              />
            </section>

            <section>
              <p className="text-[8px] font-black uppercase tracking-widest mb-2 px-1"
                style={{ color: 'var(--color-muted)' }}>Live</p>
              <ToggleRow
                label="Tore & Assists"
                desc="Benachrichtigung wenn deine aufgestellten Spieler treffen (erfordert Live-Modus)"
                checked={prefs.live_goals}
                onChange={(v) => toggle('live_goals', v)}
                disabled={masterDisabled}
              />
            </section>

          </div>
        )}
      </div>
    </main>
  );
}
