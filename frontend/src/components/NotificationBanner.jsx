import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Moon, X } from 'lucide-react';
import { api } from '../lib/api';
import { ensureServiceWorkerRegistered, urlBase64ToUint8Array } from '../lib/push';
import {
  clearAskReason, inDND, notifPermission, pushSupported, readNotifPrefs, useNotifications,
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
 * which is what the third row says out loud.
 */

const DISMISS_KEY = 'kv_notif_banner_dismissed';

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
    <div className="k-notifbanner" data-tone={tone} role="status">
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
  const { askReason } = useNotifications({ autoLoad: false });
  const [permission, setPermission] = useState('default');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState(() => new Set());
  const [prefs, setPrefs] = useState({});

  // The guarded read happens in an effect, never at module scope or in the
  // initial state — a throw at either of those points is a blank screen rather
  // than a missing banner.
  useEffect(() => {
    setPermission(notifPermission());
    setDismissed(readDismissed());
    setPrefs(readNotifPrefs());
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

  if (inDND(prefs)) {
    rows.push(
      <Row
        key="dnd"
        tone="info"
        icon={<Moon size={15} />}
        title="Quiet hours are on"
        hi="शांत समय"
        body={`Toasts, sounds and push are muted until ${prefs.dndTo || '07:00'}. Notifications still arrive here, timestamped when they happened.`}
      />
    );
  }

  if (!rows.length) return null;
  return <div className="k-notifbanners">{rows}</div>;
}
