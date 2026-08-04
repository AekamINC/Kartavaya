/**
 * usePresence.js — the ONE cross-channel poll: unread counts, mention counts,
 * who is typing, who is online, and the caller's own heartbeat.
 *
 * ── WHY THIS IS A GET, AND WHY IT IS ONE REQUEST ──────────────────────────
 *
 * There is no websocket here and there is not going to be one. Supabase's
 * pooler runs in transaction mode on :6543, where `LISTEN/NOTIFY` does not
 * work at all, and the API runs several gunicorn workers — so an in-process
 * broadcast would reach one worker's clients and nobody else's. Polling is the
 * mechanism, not a placeholder for one, and every number below is chosen with
 * that in mind rather than apologised for.
 *
 * The whole payload rides `GET /v1/messaging/live` because the write budget is
 * 120 POST/PUT/PATCH/DELETE per client IP per wall-clock minute
 * (`server.py:238`, `_write_rate_buckets`). A dedicated typing POST at 3s is 20
 * writes/min/user; four colleagues behind one office NAT would spend
 * two-thirds of the firm's entire write budget on animated dots. Worse,
 * `_is_write` (`middleware/subscription.py:37`) counts any POST whose path
 * does not end in `/pdf|/query|/export|/preview`, so a typing POST would 403
 * for a legacy `viewer` grant-holder before the handler ever ran. A GET is
 * exempt from both meters. So the typing ping, the presence heartbeat, the
 * per-channel unread and mention counts and the presence map are one request.
 *
 * That is also why `setTyping(true)` does NOT fire a request. It sets a flag
 * that the NEXT scheduled poll carries. Turning it into an immediate ping
 * would reintroduce exactly the per-keystroke traffic the single GET exists to
 * avoid — if you are tempted, read the paragraph above again first.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';

/** Visible. Fast enough that a typing indicator reads as live (the server ages
 *  a typing row out at 8s and sweeps it at 15s, so 4s never shows a gap). */
const LIVE_MS = 4000;
/** Hidden. The rail still has to be right when the tab comes back, but nobody
 *  is watching dots move, so this backs off 5x rather than stopping: unread and
 *  mention counts are what a returning reader looks at first. */
const LIVE_HIDDEN_MS = 20000;

/**
 * How long a keystroke keeps the typing flag up with no further keystrokes.
 * The composer clearing is what normally stops the dots — `MentionInput` calls
 * `onTyping(false)` when the box empties and immediately after a send — so this
 * is the backstop for the person who types half a sentence and walks away. It
 * sits comfortably above LIVE_MS so an ordinary typing pause never blinks it.
 */
const TYPING_TTL_MS = 6000;

/**
 * A poll that fails is not an outage. Three consecutive failures is roughly
 * twelve seconds of nothing, which is long enough to mean something and short
 * enough to still be useful. Below that the last good payload stays on screen:
 * blanking every badge in the rail because one request timed out tells the
 * reader their unread messages were read by somebody, which is a lie.
 *
 * KEEPING THE LAST GOOD PAYLOAD IS ONLY HALF OF THAT BARGAIN. Frozen counts are
 * the right thing to show and the wrong thing to show SILENTLY — twelve seconds
 * of dead polling looks exactly like twelve seconds in which nothing happened.
 * `ChannelsTab` reads `error` and says so above the rail; if that consumer is
 * ever dropped again, this constant and the counter under it are decoration.
 */
const FAIL_BEFORE_ERROR = 3;

export default function usePresence({ channelId = null, enabled = true } = {}) {
  const [channels, setChannels] = useState({});
  const [typing, setTypingList] = useState([]);
  const [presence, setPresence] = useState({});
  const [mentionUnread, setMentionUnread] = useState(0);
  const [error, setError] = useState(null);

  // Everything the poll needs to read at fire time lives in a ref, so changing
  // the focused channel does not tear down and rebuild the interval — which
  // would reset the cadence on every click through the rail.
  const chanRef = useRef(channelId);
  const typingRef = useRef({ on: false, at: 0 });
  const timer = useRef(null);
  const inflight = useRef(false);
  const again = useRef(false);
  const fails = useRef(0);
  const dead = useRef(false);

  /**
   * One tick. The in-flight guard is not a nicety: on a slow connection a 4s
   * interval will happily stack six requests that all answer at once, and the
   * last one to land wins — which is how a badge ends up showing a count from
   * twenty seconds ago. A tick that arrives while one is outstanding is
   * dropped; a `refresh()` that arrives while one is outstanding is remembered
   * and runs once, immediately after.
   */
  const poll = useCallback(async () => {
    if (inflight.current) { again.current = true; return; }
    inflight.current = true;

    const t = typingRef.current;
    if (t.on && Date.now() - t.at > TYPING_TTL_MS) t.on = false;

    const params = { typing: t.on ? 1 : 0, away: document.hidden ? 1 : 0 };
    // A poll with no focused channel is still worth making — it is what lights
    // the rail for channels nobody is reading. `channel_id` is simply omitted.
    if (chanRef.current) params.channel_id = chanRef.current;

    try {
      const r = await api.get('/v1/messaging/live', { params });
      if (dead.current) return;
      const d = r.data || {};
      // Shape-checked rather than trusted. `channels` and `presence` are maps
      // and every consumer indexes into them; a null from a half-built server
      // response would throw inside a render rather than here.
      setChannels(d.channels && typeof d.channels === 'object' ? d.channels : {});
      setTypingList(Array.isArray(d.typing) ? d.typing : []);
      setPresence(d.presence && typeof d.presence === 'object' ? d.presence : {});
      setMentionUnread(Number(d.mention_unread) || 0);
      /**
       * `d.server_time` is READ OFF THE WIRE AND DROPPED, deliberately.
       *
       * It was added so a presence dot could be aged against the database's
       * clock rather than a laptop whose own is four minutes out. But `/live`
       * already finished that job on its side: the presence map arrives as
       * `'online' | 'away'` per user, decided by
       * `last_seen_at > now() - interval '70 seconds'` and bounded by a
       * five-minute cut, both evaluated in Postgres. `ChannelDetails` maps that
       * string straight onto `.sv__pres--on|away|off` and compares no clocks at
       * all — so there is no skew left for a timestamp to correct, and holding
       * one in state was a re-render of every consumer of this hook, every four
       * seconds, for a value nothing read.
       *
       * The field stays on the response. The two places that DO compare a
       * server timestamp to `Date.now()` are `relTime()` in `ChannelList` and
       * in `Message`; if either is ever made skew-aware, this is where the
       * offset comes back — as a ref holding `Date.now() - Date.parse(...)`,
       * not as state.
       */
      fails.current = 0;
      setError(null);
    } catch (e) {
      if (dead.current) return;
      fails.current += 1;
      if (fails.current >= FAIL_BEFORE_ERROR) setError(e);
    } finally {
      inflight.current = false;
      if (again.current && !dead.current) { again.current = false; poll(); }
    }
  }, []);

  /**
   * The focused channel. Deliberately its own effect and deliberately ahead of
   * the loop below, so mount costs exactly one request rather than two: this
   * one fires immediately, the loop only schedules.
   *
   * The typing flag is cleared on the way through. You are not still typing in
   * the channel you just left, and the row you left behind ages out of
   * `samvada_typing` on the server's own 15-second sweep.
   */
  useEffect(() => {
    chanRef.current = channelId;
    typingRef.current = { on: false, at: 0 };
    if (enabled) poll();
  }, [channelId, enabled, poll]);

  useEffect(() => {
    dead.current = false;
    if (!enabled) {
      // Switched off is not failing. The only caller disables this while the
      // channel list itself is refusing, and the rail already carries that
      // reason — a three-strike `error` left standing underneath it would
      // report one failure twice, and it would still be standing the moment
      // the list recovered and polling resumed.
      fails.current = 0;
      setError(null);
      return undefined;
    }

    const schedule = () => {
      clearTimeout(timer.current);
      if (dead.current) return;
      timer.current = setTimeout(run, document.hidden ? LIVE_HIDDEN_MS : LIVE_MS);
    };
    // `clearTimeout` first: `run` can be entered from the visibility handler
    // while a timer is still pending, and without this the two interleave into
    // a double cadence that never settles back down.
    const run = async () => { clearTimeout(timer.current); await poll(); schedule(); };

    schedule();

    // A tab that comes back after ten minutes should not wait out a 20s
    // interval to find out it has nine unread mentions.
    const onVis = () => { if (document.hidden) schedule(); else run(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      dead.current = true;
      clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled, poll]);

  /**
   * The boolean edge, not a request. `MentionInput` reports it on the first
   * keystroke of a non-empty box and again when the box empties or a send
   * lands; this records it and the next scheduled poll carries it. See the
   * header for why it must stay that way.
   */
  const setTyping = useCallback((on) => {
    const t = typingRef.current;
    if (on) { t.on = true; t.at = Date.now(); }
    else { t.on = false; t.at = 0; }
  }, []);

  /** Force a tick now — used after a send, so the sender's own row stops the
   *  dots and the rail's counts catch up without waiting for the interval. */
  const refresh = useCallback(() => { poll(); }, [poll]);

  return { channels, typing, presence, mentionUnread, error, setTyping, refresh };
}

export { usePresence };
