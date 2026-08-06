/**
 * waWindow.js — Meta's 24-hour customer service window.
 *
 * `06-sanvaad-varta.md` §9: "Outside a 24-hour window from the customer's last
 * message, Meta rejects free-form text — only approved templates go through.
 * WAChat offers a plain text field regardless, so the send fails and surfaces as
 * a generic error toast. The composer must know the window state: countdown
 * while open, template picker when closed."
 *
 * `06` §4 wants a new `GET /whatsapp/conversations/:id/window` returning
 * `{open, expires_at}`. The backend is not this module's to edit — and it does
 * not need to be for correctness here: `varta_messages` carries `direction` and
 * `created_at`, and the conversation's message page is already fetched, so the
 * window is the newest inbound message plus 24 hours. The endpoint is still
 * worth adding, because this derivation only sees the newest page (50 messages);
 * a conversation with more than 50 outbound messages since the last inbound one
 * reads as "never opened", which is the safe direction to be wrong in — it
 * offers templates rather than a send that Meta will reject.
 *
 * ── The endpoint now exists ─────────────────────────────────────────────────
 *
 * `GET /api/v1/whatsapp/conversations/:id/window` was added, and so was the
 * thing that actually matters: `POST .../messages` REFUSES a free-form send
 * outside the window rather than storing it and reporting 201. A rule enforced
 * only by the control that offers it is not enforced — the composer hid the
 * text field, and a stale tab, a retry or curl sent through it anyway, at which
 * point Meta rejected the message at its edge and our record of the
 * conversation stopped matching the customer's.
 *
 * Both derivations are kept and they do different jobs. `fromServer` is the
 * authority — it reads MAX(created_at) over every inbound row, not a page of
 * fifty. `windowState` is the fallback while that request is in flight or after
 * it fails, so the composer never renders in an unknown state, and it is the
 * one the tests exercise for the arithmetic.
 */

export const WINDOW_MS = 24 * 60 * 60 * 1000;

/** `{open, expiresAt, remainingMs, everInbound}` from a message list. */
export function windowState(messages, now = Date.now()) {
  let lastInbound = 0;
  for (const m of messages) {
    if (m?.direction !== 'inbound') continue;
    const t = new Date(m.created_at || 0).getTime();
    if (t > lastInbound) lastInbound = t;
  }
  if (!lastInbound) return { open: false, expiresAt: null, remainingMs: 0, everInbound: false };
  const expiresAt = lastInbound + WINDOW_MS;
  const remainingMs = expiresAt - now;
  return { open: remainingMs > 0, expiresAt, remainingMs, everInbound: true };
}

/**
 * The same `{open, expiresAt, remainingMs, everInbound}` shape, from the
 * server's `{open, expires_at, remaining_seconds, ever_inbound}`.
 *
 * `open` is recomputed from `expires_at` against the caller's clock rather than
 * trusted from the payload. The payload's own `open` was true at the instant
 * the request was served; between a five-second poll and a user reading the
 * screen, a window with forty seconds left expires while the banner still says
 * it is open. The timestamp is the fact; the boolean is that fact at a moment
 * that has passed.
 *
 * Returns `null` — not a closed window — when the payload cannot be read.
 * A null tells the caller to fall back to `windowState`; a closed window would
 * silently replace the composer for a conversation that is fine.
 */
export function fromServer(payload, now = Date.now()) {
  if (!payload || typeof payload !== 'object') return null;
  if (!payload.ever_inbound) {
    return { open: false, expiresAt: null, remainingMs: 0, everInbound: false };
  }
  const expiresAt = new Date(payload.expires_at || 0).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt === 0) return null;
  const remainingMs = expiresAt - now;
  return { open: remainingMs > 0, expiresAt, remainingMs, everInbound: true };
}

/** "7h 20m left" — coarse on purpose; a ticking second hand on a 24-hour
 *  countdown is motion with no information in it. */
export function formatRemaining(ms) {
  if (ms <= 0) return 'closed';
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 1) return `${h}h ${m}m left`;
  return `${m}m left`;
}
