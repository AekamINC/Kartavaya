/**
 * threadReplies.js — the replies behind an expanded `.m2th`, and the record a
 * message's `metadata` may carry.
 *
 * TWO HELPERS, ONE FILE, AND THE REASON IS OWNERSHIP. `components/sanvaad/`
 * holds the two presentational pieces this module's log renders inside a bubble
 * — `InlineThread` (the disclosure, the face stack, the `.m2th__body` frame) and
 * `RecordCard` (the `.m2rec` object card). Both are deliberately PURE: neither
 * fetches, neither knows an endpoint, and `InlineThread` takes its replies as
 * `children` so a reply is rendered by the same `Message` the log uses and the
 * two cannot drift apart in markup or in mention handling.
 *
 * That leaves two jobs on this side of the line, and this is where they live.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';

/**
 * The replies under one message.
 *
 * `GET /v1/messaging/messages/:id/thread` returns them oldest-first with
 * `sender_name` and `sender_avatar` joined, and it is the ONLY source: both arms
 * of `list_messages` filter `parent_message_id IS NULL`, so the channel page
 * cannot carry a reply and any alternative is a backend change to what every
 * existing client receives.
 *
 * IT FETCHES ONLY WHILE EXPANDED. A channel page is fifty messages and a good
 * few of them have threads; fetching all of them up front is fifty round trips
 * for replies nobody has asked to read, and `.m2th__open` already states the
 * count and the age of the last reply without any of them. `enabled` is the
 * expanded flag, so collapsing stops the reload watcher and expanding again
 * re-reads — a thread the reader comes back to is a thread that may have moved.
 *
 * THE RELOAD IS DRIVEN BY THE PARENT'S COUNT. `count` is `thread_count`, which
 * `list_messages` recomputes on every poll and `useChannelMessages.send` bumps
 * optimistically when a reply goes through the channel composer. Watching it is
 * what refreshes an OPEN thread after somebody replies, because the reply is
 * posted two components away and nothing tells this hook directly. A poll that
 * changes nothing changes no number, so this costs one request per actual new
 * reply rather than one per tick — and the refresh is QUIET, so the replies
 * already on screen are not replaced by a skeleton while the reader is reading
 * them.
 */
export function useThreadReplies(rootId, { enabled = false, count = 0 } = {}) {
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [seenCount, setSeenCount] = useState(count);

  const load = useCallback(async ({ quiet } = {}) => {
    if (!rootId) return;
    if (!quiet) setLoading(true);
    try {
      const r = await api.get(`/v1/messaging/messages/${rootId}/thread`);
      setReplies(Array.isArray(r.data) ? r.data : []);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [rootId]);

  useEffect(() => {
    if (!enabled) return;
    setSeenCount(count);
    load();
    // `count` is deliberately absent: this arm runs on OPEN, and the watcher
    // below is the one that runs on change. Including it here would make every
    // new reply a loud reload with a skeleton in place of the conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled || count === seenCount) return;
    setSeenCount(count);
    load({ quiet: true });
  }, [enabled, count, seenCount, load]);

  /**
   * Local patches for an edit and a delete.
   *
   * The replies are not in `useChannelMessages.messages` — nothing upstream
   * holds them — so a write that only went to the server would leave the row
   * unchanged on screen until the next reload. Each wrapper awaits the caller's
   * handler, which is where the toast and the rethrow live, and then patches
   * here. `get_thread` filters `is_deleted = FALSE`, so a deleted reply is
   * already gone from the server's answer and dropping it locally keeps the list
   * honest rather than leaving a tombstone the next load would not reproduce.
   */
  const patchEdit = useCallback((id, content, row) => {
    setReplies(prev => prev.map(m => (String(m.id) === String(id)
      ? { ...m, content: row?.content ?? content, is_edited: true }
      : m)));
  }, []);

  const patchDelete = useCallback((id) => {
    setReplies(prev => prev.filter(m => String(m.id) !== String(id)));
  }, []);

  return { replies, loading, error, reload: load, patchEdit, patchDelete };
}

/**
 * `msg.metadata` → the props `components/sanvaad/RecordCard` takes, or null.
 *
 * ── This has no producer, and that is stated rather than implied ────────────
 *
 * `send_message` refuses every `type` but `'text'` and `'system'` with a 400,
 * `MessageCreate` has no `metadata` field, and the INSERT omits the `metadata`
 * column that migration 058 already provides. So nothing in the product writes a
 * record into a message and this returns null for every row on the wire today.
 * It is written now for the same reason `Message.actionHref` was: the moment a
 * module posts one, the shape it posts has to already be the shape something
 * reads, and a reader added in the same commit as its first producer is a reader
 * nobody reviewed.
 *
 * ── Every field is type-checked, not truthiness-checked ─────────────────────
 *
 * `metadata` is JSONB and nothing validates its shape on the way in, so `title`
 * can be an object and `fields` can be a string — and React throws on an object
 * child, which would take down the whole message log rather than this one row.
 * `RecordCard` refuses an unrecognised `kind` on its own; everything below is
 * this side's half of the same discipline.
 *
 * The shape a future producer has to write:
 *
 *   metadata.record = {
 *     kind: 'invoice',                  // one of RecordCard's five
 *     reference: 'INV-2026-0184',
 *     title: 'Quarterly retainer',
 *     amount: '₹ 1,20,000',             // already formatted — see below
 *     href: '/ganit/invoices/…',        // an in-app route
 *     fields: [['Due', '11 Aug'], …],
 *     percent: 40,
 *     done: 'Approved by Keval Shah',
 *   }
 *
 * `amount` is a STRING and is not formatted here. A number would have to be
 * given a currency and a locale by this layer, and the module that owns the
 * record is the only place that knows both — Ganit's invoice is INR with Indian
 * digit grouping and a payroll line is not necessarily either.
 */
const str = v => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function recordFromMetadata(metadata) {
  const r = metadata && typeof metadata === 'object' ? metadata.record : null;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;

  const kind = str(r.kind);
  const title = str(r.title);
  // A card with no kind has no tint, no glyph and no module name; a card with no
  // title is an accent strip over an empty line. Neither is worth drawing.
  if (!kind || !title) return null;

  /**
   * The in-app route, through the same guard `Message.actionHref` applies to a
   * system message's link and for the same reason: `metadata` is
   * author-controlled by whatever code path assembled the JSONB, and
   * react-router's `Link` renders `javascript:` as a plain anchor rather than
   * refusing it. A ROOTED PATH ONLY — `//evil.tld` and `/\evil.tld` both leave
   * the origin, because the URL spec folds `\` to `/` for special schemes — and
   * control characters are stripped before the test rather than after.
   *
   * An external record card is refused outright rather than opened in a new tab.
   * A record is by definition one of this product's own objects; a card claiming
   * to be an invoice and pointing at another host is not a formatting question.
   */
  const clean = (str(r.href) || '').replace(/[\u0000-\u001f\u007f]/g, '');
  const href = /^\/(?![/\\])/.test(clean) ? clean : null;

  const pct = Number(r.percent);

  return {
    kind,
    title,
    href,
    reference: str(r.reference),
    amount: str(r.amount),
    done: str(r.done),
    fields: Array.isArray(r.fields)
      ? r.fields
        .filter(f => Array.isArray(f) && str(f[0]) && str(f[1]))
        .slice(0, 4)
        .map(f => [str(f[0]), str(f[1])])
      : [],
    percent: Number.isFinite(pct) ? pct : null,
  };
}
