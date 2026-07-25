import React, { useEffect, useState } from 'react';
import Button from './Button';

/**
 * Four failure states, not one "Something went wrong"
 * (02-common-components.md §Revision).
 *
 * A single generic error tells the user nothing and gives them nothing to do.
 * These four are distinguishable at the point of failure and each has exactly
 * one correct action.
 */

/**
 * Classify an axios-style rejection.
 *
 * The `!err?.response` check comes BEFORE reading a status, and that ordering is
 * the whole point: a rejection with no response is a network failure, and
 * reporting it as a server error blames us for the user's train tunnel.
 */
export function errorKind(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  if (!err?.response) return 'offline';
  const s = err.response.status;
  if (s === 403) return 'denied';
  if (s === 404) return 'missing';
  return 'server';
}

const COPY = {
  offline: {
    title: 'You’re offline',
    detail: 'Changes are saved and will sync when you’re back.',
  },
  server: {
    title: 'Something broke on our side, not yours',
    detail: 'This wasn’t caused by anything you did. Try again in a moment.',
  },
  denied: {
    title: 'You don’t have access to this',
    detail: 'Access is granted by role.',
  },
  missing: {
    title: 'This doesn’t exist, or it was deleted',
    detail: 'It may have been removed since you last saw it.',
  },
};

const ICONS = {
  offline: <path d="M2 8a12 12 0 0 1 16 0M5.5 11.5a7 7 0 0 1 9 0M10 15.5h.01M2 2l16 16" />,
  server:  <><path d="M10 6v5" /><path d="M10 14h.01" /><circle cx="10" cy="10" r="8" /></>,
  denied:  <><rect x="4" y="9" width="12" height="8" rx="1.5" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></>,
  missing: <><circle cx="9" cy="9" r="6" /><path d="M13.5 13.5L18 18" /></>,
};

/**
 * `denied` must name the missing GRANT and never the record. "You don't have
 * access to invoice INV-1043" confirms INV-1043 exists to someone who should
 * not know that — pass `grant` ("viewer access to Ganit"), not a record id.
 */
export function ErrorState({ kind = 'server', grant, detail, onRetry, backTo, backLabel = 'Go back' }) {
  const copy = COPY[kind] || COPY.server;
  const body = detail
    || (kind === 'denied' && grant ? `You need ${grant}.` : null)
    || copy.detail;

  return (
    <div className="k-err" data-kind={kind} role="alert">
      <div className="k-err__ic" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round">
          {ICONS[kind] || ICONS.server}
        </svg>
      </div>
      <p className="k-err__t">{copy.title}</p>
      {body && <p className="k-err__d">{body}</p>}

      {kind === 'server' && onRetry && <Button variant="out" onClick={onRetry}>Try again</Button>}
      {kind === 'denied' && onRetry && <Button variant="out" onClick={onRetry}>Request access</Button>}
      {kind === 'missing' && backTo && <Button variant="out" onClick={backTo}>{backLabel}</Button>}
      {/* offline gets no action — it resolves itself. */}
    </div>
  );
}

export function OfflineBanner() {
  const [off, setOff] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);

  useEffect(() => {
    const on = () => setOff(false);
    const down = () => setOff(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', down);
    };
  }, []);

  if (!off) return null;
  return (
    <div className="k-offline" role="status">
      You’re offline — changes are saved locally and will sync.
    </div>
  );
}

export default ErrorState;
