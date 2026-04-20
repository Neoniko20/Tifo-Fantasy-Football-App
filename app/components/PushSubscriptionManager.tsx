'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;

type Props = {
  onStatusChange?: (active: boolean) => void;
};

export default function PushSubscriptionManager({ onStatusChange }: Props) {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  const isIOS = typeof navigator !== 'undefined' &&
    /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = typeof window !== 'undefined' &&
    ('standalone' in window.navigator
      ? (window.navigator as any).standalone
      : window.matchMedia('(display-mode: standalone)').matches);

  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    setPermission(Notification.permission);

    if (Notification.permission === 'granted' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          const isActive = !!sub;
          setSubscribed(isActive);
          onStatusChange?.(isActive);
        });
      });
    }
  }, []);

  async function getAuthHeader(): Promise<string> {
    const { data } = await supabase.auth.getSession();
    return `Bearer ${data.session?.access_token ?? ''}`;
  }

  async function subscribe() {
    setLoading(true);
    console.log('[Push] VAPID key:', VAPID_PUBLIC_KEY);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return;

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      const json = sub.toJSON();
      const authHeader = await getAuthHeader();
      await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify({
          endpoint: json.endpoint,
          p256dh:   json.keys?.p256dh,
          auth:     json.keys?.auth,
        }),
      });

      setSubscribed(true);
      onStatusChange?.(true);
    } catch (err) {
      console.error('[PushSubscriptionManager] subscribe failed:', err);
    } finally {
      setLoading(false);
    }
  }

  async function unsubscribe() {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const authHeader = await getAuthHeader();
        await fetch('/api/notifications/unsubscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader,
          },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      onStatusChange?.(false);
    } catch (err) {
      console.error('[PushSubscriptionManager] unsubscribe failed:', err);
    } finally {
      setLoading(false);
    }
  }

  // iOS not installed as PWA
  if (isIOS && !isStandalone) {
    return (
      <div className="rounded-2xl p-4"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--color-border)' }}>
        <p className="text-xs font-black mb-1" style={{ color: 'var(--color-text)' }}>
          Push-Benachrichtigungen
        </p>
        <p className="text-[9px]" style={{ color: 'var(--color-muted)' }}>
          Auf iPhone/iPad nur verfügbar wenn die App installiert ist.
          Tippe auf <strong>Teilen</strong> → <strong>Zum Home-Bildschirm</strong>.
        </p>
      </div>
    );
  }

  if (typeof Notification === 'undefined') {
    return (
      <div className="rounded-2xl p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--color-border)' }}>
        <p className="text-[9px]" style={{ color: 'var(--color-muted)' }}>
          Dein Browser unterstützt keine Push-Benachrichtigungen.
        </p>
      </div>
    );
  }

  if (permission === 'denied') {
    return (
      <div className="rounded-2xl p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--color-border)' }}>
        <p className="text-xs font-black mb-1" style={{ color: 'var(--color-error)' }}>Push blockiert</p>
        <p className="text-[9px]" style={{ color: 'var(--color-muted)' }}>
          Bitte in den Browser-Einstellungen unter Benachrichtigungen für diese Seite erlauben.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-4 flex items-center justify-between"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--color-border)' }}>
      <div>
        <p className="text-xs font-black" style={{ color: 'var(--color-text)' }}>
          Push-Benachrichtigungen
        </p>
        <p className="text-[9px] mt-0.5" style={{ color: subscribed ? 'var(--color-success)' : 'var(--color-muted)' }}>
          {subscribed ? 'Aktiv auf diesem Gerät' : 'Nicht aktiviert'}
        </p>
      </div>
      <button
        onClick={subscribed ? unsubscribe : subscribe}
        disabled={loading}
        className="px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
        style={{
          background: subscribed ? 'var(--color-border)' : 'var(--color-primary)',
          color: subscribed ? 'var(--color-text)' : 'var(--bg-page)',
          opacity: loading ? 0.6 : 1,
        }}>
        {loading ? '...' : subscribed ? 'Deaktivieren' : 'Aktivieren'}
      </button>
    </div>
  );
}
