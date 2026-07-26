import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { ensureServiceWorkerRegistered, urlBase64ToUint8Array } from '../../lib/push';
import { getNotifSoundId, setNotifSoundId } from '../../lib/notifSound';
import { getTimeFormat, setTimeFormat } from '../../lib/timeFormat';
import { useCustomize } from '../../components/CustomizePanel';
import SoundGrid from '../../components/customize/SoundGrid';
import Seg from '../../components/customize/Seg';

/**
 * TabNotifications — absorbed from NotificationsSettingsPage.
 *
 * Notification preferences are preferences; keeping them on a separate route
 * meant "where do I turn that off" had two answers. The old page's push logic
 * is carried over intact, including the guard that stopped it throwing on
 * browsers with no Notification API — iOS Safari before 16.4, embedded
 * webviews, and anything outside a secure context, where reading
 * Notification.permission unguarded rendered a blank screen.
 */
export default function TabNotifications() {
  const { prefs, setPrefs } = useCustomize();
  const [supported,  setSupported]  = useState(false);
  const [permission, setPermission] = useState('default');
  const [enabled,    setEnabled]    = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [soundId,    setSoundId]    = useState(getNotifSoundId());
  const [timeFmt,    setTimeFmt]    = useState(getTimeFormat());

  useEffect(() => {
    const hasNotification = typeof window !== 'undefined' && 'Notification' in window;
    setSupported('serviceWorker' in navigator && 'PushManager' in window && hasNotification);
    setPermission(hasNotification ? Notification.permission : 'unsupported');
  }, []);

  const refreshEnabled = async () => {
    if (!supported) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return setEnabled(false);
    setEnabled(!!(await reg.pushManager.getSubscription()));
  };

  useEffect(() => { refreshEnabled().catch(() => {}); }, [supported]);

  const statusColor = useMemo(() => {
    if (!supported || permission === 'denied') return 'var(--danger)';
    if (enabled) return 'var(--ok)';
    return 'var(--on-surface-3)';
  }, [supported, permission, enabled]);

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

  const chooseSound = (id) => { setSoundId(id); setNotifSoundId(id); };
  const chooseTimeFormat = (f) => { setTimeFmt(f); setTimeFormat(f); };

  return (
    <div className="st__group">
      <div className="sr">
        <div className="sr__l">
          <div className="sr__t">Browser push</div>
          <div className="sr__d">
            Supported: <strong>{supported ? 'Yes' : 'No'}</strong> · Permission:{' '}
            <strong>{permission === 'unsupported' ? 'not available' : permission}</strong>
          </div>
          {permission === 'denied' && (
            <div className="sr__d" style={{ color: 'var(--danger)' }}>
              Blocked in your browser settings. Allow this site in your browser notification preferences.
            </div>
          )}
          {/* `unsupported` needs its own copy — the `denied` message would tell
              the user to change a setting their browser does not have. */}
          {permission === 'unsupported' && (
            <div className="sr__d">
              This browser doesn’t support push. You’ll still see in-app notifications from the bell.
            </div>
          )}
        </div>
        <div className="sr__c" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="k-statuschip" style={{ '--c': statusColor }}>
            <span className="k-statuschip__dot" />
            {enabled ? 'Enabled' : 'Disabled'}
          </span>
          <button className="k-btn k-btn--primary k-btn--sm" onClick={enablePush}
                  disabled={loading || !supported || enabled}>Enable</button>
          <button className="k-btn k-btn--ghost k-btn--sm" onClick={disablePush}
                  disabled={loading || !supported || !enabled}>Disable</button>
        </div>
      </div>

      <div className="sr sr--col">
        <div className="sr__l">
          <div className="sr__t">Notification sound</div>
          <div className="sr__d">
            Plays when a reminder or toast appears while Kartavaya is open. Tap a card to hear it.
          </div>
        </div>
        <SoundGrid value={soundId} onChange={chooseSound} />
      </div>

      <div className="sr">
        <div className="sr__l">
          <div className="sr__t">Toast position</div>
          <div className="sr__d">Where in-app messages appear.</div>
        </div>
        <div className="sr__c">
          <Seg
            label="Toast position"
            value={prefs.toastPos || 'tr'}
            onChange={v => setPrefs({ toastPos: v })}
            options={[
              { label: 'Top left',     value: 'tl' },
              { label: 'Top right',    value: 'tr' },
              { label: 'Bottom left',  value: 'bl' },
              { label: 'Bottom right', value: 'br' },
            ]}
          />
        </div>
      </div>

      <div className="sr">
        <div className="sr__l">
          <div className="sr__t">Time format</div>
          <div className="sr__d">
            Applies to due dates and reminders. Doesn’t change your browser’s own
            date picker, which follows your device.
          </div>
        </div>
        <div className="sr__c">
          <Seg
            label="Time format"
            value={timeFmt}
            onChange={chooseTimeFormat}
            options={[
              { label: '12-hour · 5:00 PM', value: '12h' },
              { label: '24-hour · 17:00',   value: '24h' },
            ]}
          />
        </div>
      </div>

      <div className="sr">
        <div className="sr__l">
          <div className="sr__t">Reminder defaults</div>
          <div className="sr__d">
            New tasks default to reminders 1 hour and 15 minutes before the due date.
            Change them per task in the drawer or the New Task form.
          </div>
        </div>
      </div>
    </div>
  );
}
