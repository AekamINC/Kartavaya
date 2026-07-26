import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { ensureServiceWorkerRegistered, urlBase64ToUint8Array } from '../lib/push';
import { PageHeader } from '../components/editorial';
import { NOTIF_SOUND_GROUPS, getNotifSoundId, setNotifSoundId, playNotifSound } from '../lib/notifSound';
import { getTimeFormat, setTimeFormat } from '../lib/timeFormat';

export default function NotificationsSettingsPage() {
  const [supported,  setSupported]  = useState(false);
  const [permission, setPermission] = useState('default');
  const [enabled,    setEnabled]    = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [soundId,    setSoundId]    = useState(getNotifSoundId());
  const [timeFmt,    setTimeFmt]    = useState(getTimeFormat());

  useEffect(() => {
    // Notification.permission was read WITHOUT a guard, so this page threw on
    // mount — a blank screen — anywhere the API is absent: iOS Safari before
    // 16.4, embedded webviews, and any page not in a secure context. AppShell
    // guards this correctly in four places; this file did not.
    const hasNotification = typeof window !== 'undefined' && 'Notification' in window;
    setSupported('serviceWorker' in navigator && 'PushManager' in window && hasNotification);
    setPermission(hasNotification ? Notification.permission : 'unsupported');
  }, []);

  const chooseSound = (id) => {
    setSoundId(id);
    setNotifSoundId(id);
    if (id !== 'none') playNotifSound();
  };

  const chooseTimeFormat = (fmt) => {
    setTimeFmt(fmt);
    setTimeFormat(fmt);
  };

  const statusColor = useMemo(() => {
    if (!supported || permission === 'denied') return 'var(--danger)';
    if (enabled) return 'var(--ok)';
    return 'var(--ink-3)';
  }, [supported, permission, enabled]);

  const refreshEnabled = async () => {
    if (!supported) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return setEnabled(false);
    const sub = await reg.pushManager.getSubscription();
    setEnabled(!!sub);
  };

  useEffect(() => { refreshEnabled().catch(() => {}); }, [supported]);

  const enablePush = async () => {
    if (!supported) return;
    setLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return;
      const reg = await ensureServiceWorkerRegistered();
      const keyRes = await api.get('/push/vapid-public-key');
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyRes.data.public_key),
      });
      await api.post('/push/subscribe', subscription);
      await refreshEnabled();
    } finally { setLoading(false); }
  };

  const disablePush = async () => {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await api.post('/push/unsubscribe', sub); await sub.unsubscribe(); }
      await refreshEnabled();
    } finally { setLoading(false); }
  };

  return (
    <div className="k-screen">
      <PageHeader
        kicker="SETTINGS"
        title="Notifications"
        sanskrit="सूचना"
        lede="Enable browser push notifications. Works on desktop and mobile."
      />

      {/* Push subscription card */}
      <section className="k-card">
        <div className="k-card__head">
          <div className="k-card__titles">
            <h3 className="k-card__title">Browser push</h3>
            <span className="k-card__sans">ब्राउज़र</span>
          </div>
          <span className="k-statuschip" style={{ '--c': statusColor, marginLeft: 'auto' }}>
            <span className="k-statuschip__dot" />
            {enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div className="k-card__body">
          <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 16 }}>
            Supported: <strong>{supported ? 'Yes' : 'No'}</strong> · Permission: <strong>{permission === 'unsupported' ? 'not available' : permission}</strong>
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="k-btn k-btn--primary" onClick={enablePush} disabled={loading || !supported || enabled}>
              Enable
            </button>
            <button className="k-btn k-btn--ghost" onClick={disablePush} disabled={loading || !supported || !enabled}>
              Disable
            </button>
          </div>
          {permission === 'denied' && (
            <p style={{ marginTop: 14, fontSize: 12, color: 'var(--danger)' }}>
              Notifications are blocked in your browser settings. Allow this site in your browser notification preferences.
            </p>
          )}
          {/* `unsupported` needs its own copy. Showing the `denied` message here
              would tell the user to change a browser setting that does not
              exist on their browser. */}
          {permission === 'unsupported' && (
            <p style={{ marginTop: 14, fontSize: 12, color: 'var(--ink-3)' }}>
              This browser doesn’t support push notifications. You’ll still see in-app notifications from the bell.
            </p>
          )}
        </div>
      </section>

      {/* Notification sound */}
      <section className="k-card">
        <div className="k-card__head">
          <div className="k-card__titles">
            <h3 className="k-card__title">Notification sound</h3>
            <span className="k-card__sans">ध्वनि</span>
          </div>
        </div>
        <div className="k-card__body">
          <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 18 }}>
            Plays when an in-app reminder or notification toast appears while Kartavaya is open.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {NOTIF_SOUND_GROUPS.map(g => (
              <div key={g.group}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>
                  {g.group}{g.hi && <span style={{ fontFamily: 'var(--font-hindi)', fontWeight: 400, marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>{g.hi}</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {g.sounds.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => chooseSound(s.id)}
                      className="k-btn k-btn--sm"
                      style={{
                        border: `1.5px solid ${soundId === s.id ? 'var(--k-primary)' : 'var(--rule)'}`,
                        background: soundId === s.id ? 'color-mix(in srgb, var(--k-primary) 12%, transparent)' : 'transparent',
                        color: soundId === s.id ? 'var(--k-primary)' : 'var(--ink-2)',
                        fontWeight: soundId === s.id ? 700 : 400,
                      }}
                    >
                      {s.label}{s.hi && <span style={{ fontFamily: 'var(--font-hindi)', fontWeight: 400, opacity: 0.7, marginLeft: 4 }}>{s.hi}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Time format */}
      <section className="k-card">
        <div className="k-card__head">
          <div className="k-card__titles">
            <h3 className="k-card__title">Time format</h3>
            <span className="k-card__sans">समय प्रारूप</span>
          </div>
        </div>
        <div className="k-card__body">
          <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 14 }}>
            Applies to due dates and reminders shown on cards and in the task drawer. Doesn't change your browser's
            own date/time picker popup — that follows your device settings.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            {[{ id: '12h', label: '12-hour', example: '5:00 PM' }, { id: '24h', label: '24-hour', example: '17:00' }].map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => chooseTimeFormat(f.id)}
                className="k-btn k-btn--sm"
                style={{
                  border: `1.5px solid ${timeFmt === f.id ? 'var(--k-primary)' : 'var(--rule)'}`,
                  background: timeFmt === f.id ? 'color-mix(in srgb, var(--k-primary) 12%, transparent)' : 'transparent',
                  color: timeFmt === f.id ? 'var(--k-primary)' : 'var(--ink-2)',
                  fontWeight: timeFmt === f.id ? 700 : 400,
                }}
              >
                {f.label} <span style={{ opacity: 0.65 }}>({f.example})</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Reminder defaults */}
      <section className="k-card">
        <div className="k-card__head">
          <div className="k-card__titles">
            <h3 className="k-card__title">Reminder defaults</h3>
            <span className="k-card__sans">स्मरण</span>
          </div>
        </div>
        <div className="k-card__body">
          <p style={{ fontSize: 13, color: 'var(--ink-2)' }}>
            New tasks default to reminders <strong>1 hour</strong> and <strong>15 minutes</strong> before the due date.
            Pick from 2 days down to 15 minutes, with separate in-app/push/email toggles, in the task drawer or New Task form.
          </p>
        </div>
      </section>
    </div>
  );
}
