import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Moon, X } from 'lucide-react';
import { api } from '../lib/api';
import { ensureServiceWorkerRegistered, urlBase64ToUint8Array } from '../lib/push';
import {
  clearAskReason, notifPermission, pushSupported, useNotifications,
} from '../context/NotificationContext';

/**
 * NotificationBanner — why you are or are not being told.
 *
 * Two defects from `21-notifications-inbox.md` land here.
 *
 * Defect 3 · `Notification.permission` read without a guard. The API is absent
 * in iOS Safari before 16.4, in embedded webviews, and outside a secure
 * context. `notifPermission()` returns the string `'unsupported'` there, and
 * `unsupported` gets its OWN copy — not the `denied` copy, which tells the user
 * to change a browser setting that does not exist.
 *
 * Defect 4 · the permission prompt fires on a timer. `AppShell` asks 4 seconds
 * into the first authenticated load, before the user has created anything; deny
 * once and the browser blocks it permanently, and no code can ask again. This
 * banner renders the ask ONLY once `askAfterAction()` has recorded an event that
 * would actually produce a notification, so the prompt explains itself. With no
 * such event it renders nothing at all — silence is the correct default, not a
 * countdown.
 *
 * Nothing here suppresses a notification. Quiet hours mute the toast, the sound
 * and the push; the record still arrives in the Inbox with its real timestamp,
 * which is what the fourth row says out loud.
 *
 * QUIET HOURS COME FROM THE SERVER. The handover's `inDND()` read
 * `prefs.dnd` / `dndFrom` / `dndTo` out of `k_prefs`, three keys that are not in
 * CustomizePanel's DEFAULTS and were deliberately never added — so the read was
 * always undefined, the check always false, and this row could never render.
 * The capability was never missing, only unreachable: `push_service.py` refuses
 * delivery inside the window stored on the `notification_prefs` row, and
 * `GET /api/me/notification_prefs` is where that window lives. This banner now
 * reports THAT value, so it says what the sender will actually do. The window is
 * evaluated in IST, as the server evaluates it, not against the device clock.
 */

const DISMISS_KEY = 'kv_notif_banner_dismissed';

/** 07:00 → "7:00 am". The stored value is 24-hour; the sentence is not. */
function clock(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm || '';
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function readDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); }
  catch (_) { return new Set(); }
}

function writeDismissed(next) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...next])); } catch (_) {}
}

async function subscribeToPush() {
  const reg = await ensureServiceWorkerRegistered();
  const keyRes = await api.get('/push/vapid-public-key');
  const pubKey = keyRes.data?.public_key;
  if (!pubKey || pubKey === 'not-configured') return;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(pubKey),
  });
  await api.post('/push/subscribe', sub.toJSON());
}

function Row({ tone, icon, title, hi, body, actions, onDismiss }) {
  return (
    // No `role="status"` per row. Up to four of these can be on screen at once,
    // and four status regions announce four times over each other on mount. The
    // live region is the container, once, so an arriving row is announced and a
    // row that was already there is not re-read. 23 §3.
    <div className="k-notifbanner" data-tone={tone}>
      <span className="k-notifbanner__ic" aria-hidden="true">{icon}</span>
      <span className="k-notifbanner__body">
        <span className="k-notifbanner__t">
          {title}
          {hi && <span className="k-notifbanner__hi" lang="hi">{hi}</span>}
        </span>
        <span className="k-notifbanner__d">{body}</span>
      </span>
      {actions && <span className="k-notifbanner__act">{actions}</span>}
      {onDismiss && (
        <button type="button" className="k-notifbanner__x" onClick={onDismiss} aria-label="Dismiss this notice">
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default function NotificationBanner() {
  // `autoLoad: false` — the banner never reads the list, so it must not be the
  // thing that fetches it. `quietHours: true` — the window is the one server
  // value it does render.
  const { askReason, quiet, inQuiet } = useNotifications({ autoLoad: false, quietHours: true });
  const [permission, setPermission] = useState('default');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState(() => new Set());

  // The guarded read happens in an effect, never at module scope or in the
  // initial state — a throw at either of those points is a blank screen rather
  // than a missing banner.
  useEffect(() => {
    setPermission(notifPermission());
    setDismissed(readDismissed());
  }, []);

  // Quiet hours open and close on the clock, not on an event. Without a tick a
  // tab left open across 22:00 keeps saying notifications are arriving while the
  // server has already stopped sending them. Once a minute is the resolution of
  // the window itself — it is stored as HH:MM.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const dismiss = useCallback((id) => {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      writeDismissed(next);
      return next;
    });
  }, []);

  const enable = useCallback(async () => {
    if (!pushSupported()) return;
    setBusy(true);
    setFailed(false);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      clearAskReason();
      if (perm === 'granted') await subscribeToPush();
    } catch (_) {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);

  const rows = [];

  if (permission === 'unsupported' && !dismissed.has('unsupported')) {
    rows.push(
      <Row
        key="unsupported"
        tone="info"
        icon={<BellOff size={15} />}
        title="This browser can't show push notifications"
        hi="पुश उपलब्ध नहीं"
        body="Everything still arrives here, in full, with its real timestamp. Nothing is lost — only the desktop pop-up is unavailable."
        onDismiss={() => dismiss('unsupported')}
      />
    );
  }

  if (permission === 'denied' && !dismissed.has('denied')) {
    rows.push(
      <Row
        key="denied"
        tone="warn"
        icon={<BellOff size={15} />}
        title="Push notifications are blocked"
        hi="पुश अवरुद्ध"
        // No "Enable" button. Once the browser has recorded a denial the page
        // cannot ask again, and a button that silently does nothing is worse
        // than no button — it teaches the user the product is broken.
        body="Your browser is blocking them for this site, and a page can't ask again once that's set. Allow notifications for Kartavaya in your browser's site settings to turn them back on."
        onDismiss={() => dismiss('denied')}
      />
    );
  }

  if (permission === 'default' && askReason && pushSupported()) {
    rows.push(
      <Row
        key="ask"
        tone="primary"
        icon={<Bell size={15} />}
        title="Get told when this happens again"
        hi="सूचना चालू करें"
        body={
          failed
            ? "That didn't go through. Try again, or turn push on from Customize → Notifications."
            : `You just ${askReason}. Turn on notifications and Kartavaya will tell you the moment there's something to act on, even in another tab.`
        }
        actions={
          <>
            <button type="button" className="btn btn--ghost btn--sm" onClick={clearAskReason} disabled={busy}>
              Not now
            </button>
            <button type="button" className="btn btn--fill btn--sm" onClick={enable} disabled={busy}>
              {busy ? 'Asking…' : 'Turn on'}
            </button>
          </>
        }
      />
    );
  }

  // `inQuiet` is false until the window has actually been read back from the
  // server — an unread schedule is not a schedule we may announce.
  if (inQuiet) {
    rows.push(
      <Row
        key="quiet"
        tone="info"
        icon={<Moon size={15} />}
        title="Quiet hours are on"
        hi="शांत समय"
        body={`Push is held until ${clock(quiet.end)} IST — the window is ${clock(quiet.start)} to ${clock(quiet.end)}, and it's applied on the server, not on this device. Notifications still arrive here, timestamped when they happened. Change the window in Customize → Notifications.`}
      />
    );
  }

  // The live region is a SEPARATE, always-mounted node, not the visible
  // container. A live region only announces changes made INSIDE a region the
  // screen reader was already tracking, so `role="status"` on a container that
  // is created together with its first row announces nothing — which is what
  // per-row `role="status"` did here. This element is present whenever the
  // banner is, and its text changes, which is the case that does announce.
  // `.k-sr-only` is `position: absolute`, so it is out of flow and adds no gap
  // to `.k-screen`'s flex column even when the visible container is gone.
  const announce = rows.length ? rows.map((r) => r.props.title).join('. ') : '';

  return (
    <>
      <p className="k-sr-only" role="status">{announce}</p>
      {rows.length > 0 && <div className="k-notifbanners">{rows}</div>}
    </>
  );
}
