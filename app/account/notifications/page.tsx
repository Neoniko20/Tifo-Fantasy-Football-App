'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import PushSubscriptionManager from '@/app/components/PushSubscriptionManager';
import {
  getGlobalPrefs,
  setGlobalPrefs,
  type GlobalPrefs,
  DEFAULT_GLOBAL,
} from '@/lib/notification-prefs';

type League = { id: string; name: string };

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

export default function NotificationsPage() {
  const router = useRouter();
  const [prefs, setPrefs] = useState<GlobalPrefs>(DEFAULT_GLOBAL);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const globalPrefs = await getGlobalPrefs(supabase);
      setPrefs(globalPrefs);

      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        // Step 1: get league IDs from teams table (uses user_id column)
        const { data: teams } = await supabase
          .from('teams')
          .select('league_id')
          .eq('user_id', userData.user.id)
          .not('league_id', 'is', null);

        const leagueIds = (teams ?? []).map((t: any) => t.league_id);

        if (leagueIds.length > 0) {
          // Step 2: fetch league details
          const { data: leagueData } = await supabase
            .from('leagues')
            .select('id, name')
            .in('id', leagueIds);
          setLeagues((leagueData ?? []) as League[]);
        }
      }
      setLoading(false);
    }
    load();
  }, []);

  async function toggle(key: keyof GlobalPrefs, value: boolean) {
    const updated = { ...prefs, [key]: value };
    setPrefs(updated); // optimistic
    await setGlobalPrefs(supabase, { [key]: value });
  }

  const disabled = !prefs.push_enabled;

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
          <h1 className="text-sm font-black uppercase tracking-widest" style={{ color: 'var(--color-text)' }}>
            Benachrichtigungen
          </h1>
        </div>

        {loading ? (
          <p className="text-[9px] text-center mt-8" style={{ color: 'var(--color-muted)' }}>Laden...</p>
        ) : (
          <div className="space-y-6">

            {/* Push manager */}
            <section>
              <p className="text-[8px] font-black uppercase tracking-widest mb-2 px-1"
                style={{ color: 'var(--color-muted)' }}>Push</p>
              <PushSubscriptionManager
                onStatusChange={(active) => toggle('push_enabled', active)}
              />
            </section>

            {/* Global toggles */}
            <section>
              <p className="text-[8px] font-black uppercase tracking-widest mb-2 px-1"
                style={{ color: 'var(--color-muted)' }}>Global</p>
              <div className="space-y-2">
                <ToggleRow
                  label="Spieltag-Start"
                  checked={prefs.gw_start}
                  onChange={(v) => toggle('gw_start', v)}
                  disabled={disabled}
                />
                <ToggleRow
                  label="Spieltag-Ende"
                  checked={prefs.gw_end}
                  onChange={(v) => toggle('gw_end', v)}
                  disabled={disabled}
                />
                <ToggleRow
                  label="Draft: Du bist dran"
                  checked={prefs.draft_your_turn}
                  onChange={(v) => toggle('draft_your_turn', v)}
                  disabled={disabled}
                />
                <ToggleRow
                  label="Draft: Spieler gepickt"
                  desc="Benachrichtigung bei jedem Pick in deinen Ligen"
                  checked={prefs.draft_pick_made}
                  onChange={(v) => toggle('draft_pick_made', v)}
                  disabled={disabled}
                />
              </div>
            </section>

            {/* Per-league navigation */}
            {leagues.length > 0 && (
              <section>
                <p className="text-[8px] font-black uppercase tracking-widest mb-2 px-1"
                  style={{ color: 'var(--color-muted)' }}>Ligen</p>
                <div className="space-y-2">
                  {leagues.map((league) => (
                    <button
                      key={league.id}
                      onClick={() => router.push(`/account/notifications/${league.id}`)}
                      className="w-full flex items-center justify-between p-4 rounded-2xl text-left"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--color-border)' }}>
                      <span className="text-xs font-black" style={{ color: 'var(--color-text)' }}>
                        {league.name}
                      </span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        style={{ color: 'var(--color-muted)' }}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  ))}
                </div>
              </section>
            )}

          </div>
        )}
      </div>
    </main>
  );
}
