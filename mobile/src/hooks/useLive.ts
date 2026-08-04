/**
 * useLive — the single `/live` poll for the whole app.
 *
 * ── Why this is a poll and not a socket ──────────────────────────────────────
 *
 * Not a compromise and not a stopgap. Supabase's pooler runs in TRANSACTION mode
 * on :6543, where `LISTEN`/`NOTIFY` does not work at all — a listener is bound to
 * a connection the pooler hands to somebody else between statements. On top of
 * that the API runs several gunicorn workers, so an in-process broadcast would
 * reach whichever clients happened to be attached to one worker and silently
 * miss the rest. `backend/routers/messaging.py:live` states the same decision
 * from the server's side (D4). There is no websocket to build here; there is a
 * poll, and its job is to be cheap.
 *
 * ── Why there is exactly ONE of it ───────────────────────────────────────────
 *
 * Every badge, the typing line, the presence dots and the tab count all read one
 * `['messaging','live']` query owned by `LiveProvider`, mounted once in App.tsx.
 * No screen calls `messagesApi.live` directly. That is what makes the request
 * rate a property of the APP rather than of how many screens happen to be
 * mounted — the answer to both the battery complaint and the Railway bill.
 *
 * ── Who polls at all ─────────────────────────────────────────────────────────
 *
 * `GET /v1/messaging/live` sits behind `require_module("sanvaad")`
 * (`backend/routers/messaging.py:107`, applied at `:1439`), so it answers 403 to
 * anyone the org has not granted the module: an attendance-only account, a
 * client portal login, an ordinary member whose admin never ticked Messaging.
 * This provider is mounted above the navigator for EVERY signed-in user, so
 * gating it on `!!uid` alone pointed three 403s a minute — foreground, forever,
 * with no back-off — at the one group of people who can never get anything back
 * for them.
 *
 * Two gates, in the order that costs least:
 *
 *   1. THE ROLE, before any request exists. A client, an attendance or a
 *      pahchan_only account has no Sanvaad in its shell at all — RootStack hands
 *      it `PahchanTabs` or `ClientPortalScreen`, neither of which has a Messages
 *      tab to badge. Those accounts now make ZERO live requests, ever.
 *   2. A 403, which switches the poll off until something could plausibly have
 *      changed. Everything else — an org that never bought the module, a member
 *      with no grant — is knowable only from the server, so a refusal latches
 *      the poll off instead of repeating itself three times a minute. Four
 *      requests an hour instead of roughly nine hundred a day.
 *
 * `messagesApi.me()` was the other candidate for gate 2 and is deliberately not
 * used: `GET /messaging/me` carries the SAME `_gate` (`messaging.py:508`), so it
 * 403s for exactly the same people and learns nothing the first `/live` does not
 * — while costing every GRANTED user an extra round trip at launch and putting
 * the first payload behind it. Its `level` answers depth (may I post), and the
 * question here is reach.
 *
 * The latch is keyed to the user id rather than a boolean, so signing in as
 * somebody else starts clean with no reset to forget. The away beacon further
 * down is gated on the same answer: a refused account must not fire a 403 every
 * time it backgrounds the app either.
 *
 * ── Why the latch expires, and what a 403 actually means ─────────────────────
 *
 * It was permanent for the session, which is only correct if 403 means "this
 * account has no grant". It does not. `require_module`
 * (`backend/middleware/subscription.py`) raises 403 eight ways, four of which
 * can reach THIS route — sanvaad is in neither `SENSITIVE_MODULES` nor
 * `BUNDLED_MODULES`, and `_is_write` is false for a GET — and exactly one of the
 * four is that:
 *
 *   :175  "You don't have access to the sanvaad module. Ask your org admin to
 *          grant it."
 *   :115  "The {role} role cannot access the sanvaad module."
 *          Per-USER, both of them, and both read from the database on EVERY
 *          request — no cache. An admin who grants the module mid-session has
 *          already fixed it server-side; only this hook is still refusing.
 *
 *   :218  "Subscription is not active"
 *   :203  "Module 'sanvaad' is not active. Contact your administrator to
 *   :243   activate it."
 *          Per-ORG, and both answers are written into a process-local dict with
 *          a five-minute TTL (`_CACHE_TTL`, :49) — in each gunicorn worker
 *          independently. A billing webhook or a plan edit that flips
 *          `subscriptions.status` for one moment poisons those entries for the
 *          rest of their five minutes.
 *
 * (`get_org_id` answers 403 too — "You do not belong to this organisation" — and
 *  a proxy can answer one with no JSON at all. An unrecognised body is treated
 *  as the per-user case, which is the safe direction: it retries sooner.)
 *
 * So a permanent latch turned a five-minute server hiccup into a dead app until
 * the user killed it: every badge 0, no typing line, no presence dots, and the
 * only notice a `__DEV__` warning nobody on a phone can see. The latch now lifts
 *
 *   ON THE NEXT FOREGROUND TRANSITION — the moment a user who noticed the dead
 *   badges would act — unless the refusal was org-level and less than five
 *   minutes old, because inside that window the server answers from the very
 *   entry that refused and the request is provably wasted; and
 *
 *   FIFTEEN MINUTES AFTER THE REFUSAL, with nobody touching the phone — the app
 *   only has to be in front, which is exactly the case where somebody is looking
 *   at the empty badges. Three times the server's TTL, so it is clear of a cache
 *   entry written by any worker at the moment of the refusal.
 *
 * A genuinely ungranted account therefore costs four requests an hour plus one
 * per app switch instead of nine hundred a day — 99% of what the latch was
 * worth — and every recoverable cause recovers by itself.
 *
 * ── The cadence ──────────────────────────────────────────────────────────────
 *
 *   foreground, a channel open      4 000 ms   the server's typing window is 8 s
 *   foreground, a messaging screen 20 000 ms   badges, the rail, presence dots
 *   foreground, anywhere else      60 000 ms   the heartbeat, and little else
 *   backgrounded / inactive             off    a phone polling in a pocket is
 *                                              the complaint, not the feature
 *   background → active            one immediate poll, then resume
 *   arriving on a messaging screen one immediate poll, then resume
 *
 * ── Why the third row exists, and why it is 60 s and not 300 ─────────────────
 *
 * Every poll is a `samvada_presence` UPSERT — a WRITE, on a GET — plus a scan of
 * every channel in the org carrying two correlated subqueries each, `mentions`
 * and `unread` (`messaging.py:1586`). A thirty-channel org is sixty correlated
 * counts per poll. Paying that three times a minute while the user reads the
 * Board buys exactly one thing they are not looking at: the number on the
 * Messages tab. A mention already arrives as a push, so that badge is the second
 * telling and not the first.
 *
 * 60 000 ms is not a round number chosen for feel. Presence is read as
 *
 *     CASE WHEN p.status = 'online'
 *           AND p.last_seen_at > now() - interval '70 seconds'
 *          THEN 'online' ELSE 'away' END        -- messaging.py:1630
 *
 * so the heartbeat this poll IS has a 70-second deadline, and the row is dropped
 * from the map entirely after five minutes. Any interval above 70 s turns a
 * colleague who is sitting in the app on another tab into an 'away' dot in
 * somebody's DM header; worse, anything between 70 s and 5 min makes that dot
 * FLICKER — online for the seventy seconds after each poll, away for the rest.
 * 60 s is the slowest cadence that keeps the dot honest, with ten seconds of
 * slack for a slow request.
 *
 * So: do not raise it to save requests without moving the server's window first,
 * and do not drop it back to 20 s for a badge nobody is looking at.
 *
 * ── The typing flag rides the poll ───────────────────────────────────────────
 *
 * `useTypingPing()` sets a module-level boolean and NEVER issues a request. The
 * next scheduled poll carries `typing=1`; when the draft empties the next one
 * carries `typing=0`, which DELETEs the caller's typing row and is what stops
 * the dots for everybody else. Worst case the dots are one interval (4 s) late,
 * inside the server's 8 s read window.
 *
 * A dedicated typing POST would be 20 writes a minute per user against a
 * 120-per-IP-per-minute write limiter — four colleagues behind one office NAT
 * would spend two-thirds of that office's whole write budget on animated dots.
 * Adding one is the mistake this design exists to prevent.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { messagesApi } from '../api/messages';
import type { LivePayload } from '../api/messages';
import { navigationRef } from '../nav/navigationRef';
import type { MainTabParamList, RootStackParamList } from '../nav/RootStack';
import { useAuth } from './useAuth';

/** The server reads a typing row for 8 seconds. Dots have to arrive inside it. */
const INTERVAL_IN_CHANNEL = 4_000;
/** A messaging screen with no room open — the rail, mentions, search. 3/min. */
const INTERVAL_MESSAGING  = 20_000;
/** Anywhere else in the app. 1/min, and the reason is the 70-second presence
 *  window quoted at the top of this file — not a taste for round numbers. */
const INTERVAL_ELSEWHERE  = 60_000;

/** `_CACHE_TTL` — `backend/middleware/subscription.py:49`. The two org-level
 *  refusals are written into that dict, so a retry inside this window is
 *  answered by the entry that refused rather than by the database. */
const SERVER_MODULE_CACHE_TTL = 5 * 60_000;
/** How long a refusal keeps the poll off with nobody touching the phone. */
const DENIAL_REARM = 15 * 60_000;

/**
 * The routes on which `/live` is doing visible work.
 *
 * `Search` is in the list because ChatScreen pushes it on top of an open room
 * and its own comment promises the cadence drops "from four seconds back to
 * twenty" when it does; dropping to sixty there would quietly make that comment
 * false. `Mentions` is the one screen whose entire content is the number this
 * poll carries.
 *
 * Typed against the two param lists rather than written as bare strings: a route
 * renamed in RootStack.tsx has to fail HERE, at compile time. The alternative
 * failure is a screen that silently polls once a minute instead of three times,
 * which nobody would notice until somebody complained that the dots are slow —
 * the `Channel.topic` shape of defect this whole feature has already paid for.
 * The declared type stays `ReadonlySet<string>` so `.has()` takes the plain
 * `string` that `getCurrentRoute()` returns, with no cast at the call site.
 */
const MESSAGING_ROUTES: ReadonlySet<string> =
  new Set<keyof RootStackParamList | keyof MainTabParamList>(
    ['Messages', 'Chat', 'Mentions', 'Search'],
  );

/**
 * Is a messaging screen in front?
 *
 * Read from `navigationRef` rather than from a hook, because this provider is
 * mounted ABOVE `NavigationContainer` (App.tsx) — `useIsFocused`, `useRoute` and
 * `useNavigationState` are all unavailable out there. `isReady()` is checked
 * first because every other method on the ref logs `NOT_INITIALIZED_ERROR` to
 * the console when the container has not mounted, which is the whole of a cold
 * start. Not-ready answers false, which is the cheap side.
 */
function onMessagingRoute(): boolean {
  if (!navigationRef.isReady()) return false;
  const name = navigationRef.getCurrentRoute()?.name;
  return name != null && MESSAGING_ROUTES.has(name);
}

/**
 * Which accounts have Sanvaad in their shell at all.
 *
 * A third copy of `isAttendanceOnly` from nav/RootStack.tsx, which is not
 * exported and belongs to that file; `usePushNotifications.hasFullShell` is the
 * second and makes exactly this list. Kept as a POSITIVE check for the reason it
 * is one there: a role added later should default to having the module rather
 * than silently losing its badges. `client` is included because the client
 * portal replaces the whole stack — there is no Messages tab behind it.
 */
function hasSanvaadShell(role: string | null | undefined): boolean {
  return role !== 'client' && role !== 'attendance' && role !== 'pahchan_only';
}

/**
 * The HTTP status off a rejection, without dragging axios into a hook.
 *
 * `api/client.ts` attaches `friendlyMessage` and rethrows the ORIGINAL error, so
 * `err.response.status` is still the server's own answer here. Typed through
 * `unknown` rather than `any` so a shape change is a compile error and not a
 * poll that quietly never latches off.
 */
function httpStatus(err: unknown): number | undefined {
  const status = (err as { response?: { status?: unknown } } | null | undefined)?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * FastAPI's `detail`, off the same rejection. Present for every refusal
 * `require_module` raises, absent for a 403 that came from anywhere else — a
 * proxy, an HTML error page — which is why the reader below treats null as a
 * cause it does not recognise rather than as a cause it can rule out.
 */
function httpDetail(err: unknown): string | null {
  const detail = (err as { response?: { data?: { detail?: unknown } } } | null | undefined)
    ?.response?.data?.detail;
  return typeof detail === 'string' ? detail : null;
}

/**
 * Which side of the gate refused — see "Why the latch expires" at the top. The
 * distinction buys one thing: whether a foreground transition inside the next
 * five minutes is worth a request, or is answered by the server's own cache.
 */
type DenialScope = 'org' | 'account';

interface Denial {
  uid:    string;
  scope:  DenialScope;
  /** `Date.now()` at the refusal. The re-arm is measured from HERE, so time the
   *  phone spent in a pocket counts toward it. */
  at:     number;
  /** The server's own sentence, so the development warning can name the cause
   *  instead of asserting one. */
  detail: string | null;
}

/**
 * The sentences that mean the ORG was refused, and are therefore answered from
 * the server's five-minute cache — `subscription.py:218` and `:203`/`:243`.
 * Matched on a fragment because the module code is interpolated into them, and
 * lower-cased because the only thing worse than matching prose is matching its
 * capitalisation.
 *
 * Everything else lands in 'account': the per-user grant, the platform-role
 * refusal, both of `get_org_id`'s, and a 403 with no detail at all. That is the
 * safe direction — a mislabelled refusal only retries earlier than it had to.
 */
const ORG_LEVEL_403 = [
  'subscription is not active',
  'is not active. contact your administrator',
  // `:227`, and unreachable today: it is raised only for `BUNDLED_MODULES`
  // (srijan, esign) and sanvaad is not one. It is here because it is cached like
  // the other two, so if sanvaad is ever bundled this stays right by itself.
  'requires a paid plan',
];

function denialScope(detail: string | null): DenialScope {
  const text = detail?.toLowerCase() ?? '';
  return ORG_LEVEL_403.some(fragment => text.includes(fragment)) ? 'org' : 'account';
}

/** May this refusal be retried yet? An org-level one inside the server's TTL may
 *  not: the process-local entry that refused is still the one that would answer. */
function rearmable(d: Denial, now: number): boolean {
  return d.scope !== 'org' || now - d.at >= SERVER_MODULE_CACHE_TTL;
}

/**
 * Is the app in front?
 *
 * Written as "not explicitly away" rather than `=== 'active'` because
 * `AppState.currentState` is `'unknown'` on Android until the first change
 * event, and on a cold start that is precisely when this is first read. Testing
 * for 'active' there would leave the poll switched off until the user
 * backgrounded and returned — every badge stuck at its first value, with no
 * error anywhere. Same optimistic default `useOnline` takes, for the same
 * reason: the false negative is the one that does not correct itself visibly.
 */
const isForeground = (s: AppStateStatus): boolean => s !== 'background' && s !== 'inactive';

/**
 * Returned before the first poll and after a failure, so no caller ever has to
 * defend against `undefined.channels`. Frozen and module-level: a fresh object
 * literal here would give every consumer a new reference on every render of the
 * provider and re-render the whole tree four seconds apart for nothing.
 */
const EMPTY: LivePayload = Object.freeze({
  channels:       {},
  typing:         [],
  presence:       {},
  mention_unread: 0,
  server_time:    null,
}) as LivePayload;

/**
 * The typing flag, module-level rather than state, because it changes on every
 * keystroke and nothing about it should re-render a provider that sits above
 * the entire app. The poll reads it at fetch time.
 */
let typingFlag = false;

interface LiveContextValue {
  payload:    LivePayload;
  setChannel: (id: string | null) => void;
  setTyping:  (typing: boolean) => void;
  /** False on the default context — see `useLiveContext`. */
  mounted:    boolean;
}

const noop = () => {};

const LiveContext = createContext<LiveContextValue>({
  payload:    EMPTY,
  setChannel: noop,
  setTyping:  noop,
  mounted:    false,
});

/**
 * Reads the context and, in development, SAYS SO when the provider is missing.
 *
 * A React context default is the quietest failure in this build: with no
 * `LiveProvider` above them every badge reads 0, the typing line never renders
 * and the presence dots never appear — and nothing throws, nothing logs, and the
 * typecheck is green. That exact shape (both ends of a chain rewritten, the
 * middle untouched) is what cost the web build three rounds.
 */
function useLiveContext(who: string): LiveContextValue {
  const ctx = useContext(LiveContext);
  useEffect(() => {
    if (ctx.mounted || !__DEV__) return;
    console.warn(
      `[useLive] ${who}() was called with no <LiveProvider> above it. Every live ` +
      'number will read empty forever. Mount LiveProvider once in App.tsx, ' +
      'inside AuthProvider and outside RootStack.',
    );
  }, [ctx.mounted, who]);
  return ctx;
}

/**
 * Mount ONCE, in App.tsx, inside AuthProvider and PersistQueryClientProvider and
 * OUTSIDE RootStack. One poll for the whole app — that is the point.
 *
 * Built with `createElement` rather than JSX because this file is a `.ts`: the
 * node test harness strips types but does not transform JSX, and five other
 * modules import from here.
 */
export function LiveProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { user } = useAuth();
  const uid = user?.user_id ?? null;

  const [channelId, setChannelId] = useState<string | null>(null);
  const [appActive, setAppActive] = useState<boolean>(() => isForeground(AppState.currentState));
  /**
   * The refusal `/live` last answered with, or null. Keyed by user id rather
   * than held as a boolean so a sign-out and a sign-in as somebody else starts
   * clean without a reset effect that somebody has to remember exists; carries
   * its own timestamp and cause so the two re-arms below can read them.
   */
  const [denial, setDenial] = useState<Denial | null>(null);
  const [messagingFocused, setMessagingFocused] = useState<boolean>(onMessagingRoute);

  /**
   * The one answer everything below is gated on. Both halves are described under
   * "Who polls at all" — the role costs nothing, and the latch costs one 403.
   */
  const canPoll = !!uid && hasSanvaadShell(user?.role) && denial?.uid !== uid;

  // Read inside the queryFn and inside the AppState listener, both of which run
  // outside the render that produced the value.
  const channelRef = useRef<string | null>(null);
  const uidRef     = useRef<string | null>(uid);
  const canPollRef = useRef<boolean>(canPoll);
  const denialRef  = useRef<Denial | null>(denial);
  useEffect(() => { channelRef.current = channelId; }, [channelId]);
  useEffect(() => { uidRef.current = uid; }, [uid]);
  useEffect(() => { canPollRef.current = canPoll; }, [canPoll]);
  useEffect(() => { denialRef.current = denial; }, [denial]);

  const query = useQuery<LivePayload>({
    queryKey: ['messaging', 'live'],
    queryFn: async () => {
      try {
        return await messagesApi.live({
          channelId: channelRef.current,
          // `may_type` on the server needs a channel id it can resolve and the
          // caller may read, so the flag without a channel is a wasted parameter
          // rather than a ping. Do not send it.
          typing: typingFlag && !!channelRef.current,
          away:   false,
        });
      } catch (err) {
        // A 403 here is the module gate, not a transient: retrying it on the
        // next tick produces the identical 403 three times a minute. Latch it
        // off — but with the cause and the clock, because three of the four
        // things that raise it are fixed elsewhere while the app is still
        // running (see the header). Every other failure — a 500, a timeout, a
        // dead link — stays exactly what it was, a poll that is simply the next
        // poll.
        if (httpStatus(err) === 403 && uidRef.current) {
          const detail = httpDetail(err);
          setDenial({
            uid:   uidRef.current,
            scope: denialScope(detail),
            at:    Date.now(),
            detail,
          });
        }
        throw err;
      }
    },
    enabled:   canPoll,
    staleTime: 0,
    // Never persisted (see offline/queryClient.ts) and worth nothing after a
    // cold start, so there is nothing to keep once the provider unmounts.
    gcTime:    0,
    // A poll that retries twice on a flaky link stacks requests behind an
    // interval that is still firing. A failed poll is simply the next poll.
    retry:     false,
    // `canPoll` is restated here rather than left to `enabled`, because this is
    // the line a future reader will change and the interval is what actually
    // costs money. An open channel wins over the route check: `useLiveChannel`
    // is already nulled on blur, so a non-null id can only mean ChatScreen is in
    // front, and trusting it avoids a one-frame race between the two signals
    // dropping the dots mid-sentence.
    refetchInterval: appActive && canPoll
      ? (channelId
          ? INTERVAL_IN_CHANNEL
          : messagingFocused ? INTERVAL_MESSAGING : INTERVAL_ELSEWHERE)
      : false,
    refetchOnWindowFocus: false,
  });

  // Held in a ref so the two effects below can have empty-ish dependency lists.
  // Re-subscribing to AppState on every poll would be the alternative.
  const refetchRef = useRef(query.refetch);
  useEffect(() => { refetchRef.current = query.refetch; }, [query.refetch]);

  /**
   * Foreground / background.
   *
   * Turning the interval off is not the same as the app being suspended: on
   * Android a JS timer keeps firing for a while after the screen goes off, and
   * `inactive` on iOS (control centre, an incoming call) is long enough to be
   * worth pausing for.
   */
  useEffect(() => {
    const seen = { current: AppState.currentState as AppStateStatus };

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const was = isForeground(seen.current);
      const now = isForeground(next);
      seen.current = next;
      if (was === now) return;

      if (now) {
        setAppActive(true);

        // A latched account gets its ONE chance here instead of a poll, because
        // it has no poll to make: coming back to the app is when a user who
        // noticed dead badges would act, and it is the cheapest place to learn
        // that an admin fixed the grant or that the subscription flip has aged
        // out of the server's cache. Clearing the latch IS the request: an
        // `enabled` false→true over an empty cache (gcTime 0) fetches by itself
        // — `shouldFetchOptionally`, query-core — which resuming the INTERVAL
        // below does not. Calling refetch here too would make it two.
        const d = denialRef.current;
        if (d && d.uid === uidRef.current) {
          if (rearmable(d, Date.now())) setDenial(null);
          return;
        }

        // Exactly one immediate poll — the same shape NotificationContext
        // already uses on foreground. Turning the interval back on does NOT
        // fetch by itself, so this is the only request the transition makes.
        if (canPollRef.current) refetchRef.current();
        return;
      }

      setAppActive(false);
      // The one fire-and-forget /live outside the poll. Without it the user
      // reads `online` to their colleagues for the next 70 seconds while their
      // screen is off — that is the server's staleness window, not a guess.
      //
      // It carries the open channel and `typing: false` as well, because it is
      // the same single request either way and it deletes the typing row rather
      // than leaving the dots up for the server's 8-second backstop to clear.
      //
      // Gated on `canPoll`, not merely on being signed in: an account with no
      // Sanvaad grant would otherwise fire one more 403 every time the phone
      // went into a pocket, which is the same defect the latch above exists to
      // close, arriving through the one request that is not the poll.
      typingFlag = false;
      if (canPollRef.current) {
        messagesApi
          .live({ channelId: channelRef.current, typing: false, away: true })
          .catch(() => { /* a beacon nobody is waiting for */ });
      }
    });

    return () => sub.remove();
  }, []);

  /**
   * Which route is in front, read from outside the navigator.
   *
   * `BaseNavigationContainer` emits `state` on its first state effect as well as
   * on every change, so the initial route arrives here without a separate read
   * and without polling for readiness. Subscribing before the container exists
   * is supported: `createNavigationContainerRef` queues the listener and
   * attaches it when the container mounts, and still returns an unsubscribe.
   */
  useEffect(() => {
    const read = () => setMessagingFocused(prev => {
      const next = onMessagingRoute();
      // Same answer is the common case — a push inside Chat, a param change —
      // and returning `prev` keeps it from restarting the interval out of phase.
      return prev === next ? prev : next;
    });
    read();
    return navigationRef.addListener('state', read);
  }, []);

  /**
   * Opening a channel must not wait out the rail cadence. Without this, walking
   * into a room where somebody is mid-sentence shows no dots for up to twenty
   * seconds — long enough that the feature reads as broken rather than late.
   */
  useEffect(() => {
    if (!channelId || !canPoll) return;
    refetchRef.current();
  }, [channelId, canPoll]);

  /**
   * ARRIVING on a messaging screen must not wait out the 60-second cadence
   * either. `['messaging','channels']` refetches when the rail mounts, so
   * without this the user would read counts from that list next to counts up to
   * a minute older overlaid from here — and the two disagreeing is precisely the
   * flicker the server's matching count rules were written to prevent.
   *
   * Only the TRANSITION, tracked in a ref: firing on every render where the flag
   * happens to be true would put a request behind each keystroke in Search.
   */
  const wasMessaging = useRef(messagingFocused);
  useEffect(() => {
    const entered = messagingFocused && !wasMessaging.current;
    wasMessaging.current = messagingFocused;
    if (entered && canPollRef.current) refetchRef.current();
  }, [messagingFocused]);

  /**
   * The latch lifting on its own, with nobody touching the phone.
   *
   * Only while the app is in front — a phone in a pocket has nothing to show
   * and the transition above re-checks on the way back anyway. The wait is
   * computed from the refusal rather than restarted here, so backgrounded time
   * still counts and a latch that has already outlived it clears on the next
   * tick rather than fifteen minutes after being noticed.
   */
  useEffect(() => {
    if (!denial || denial.uid !== uid || !appActive) return;
    const wait  = Math.max(0, denial.at + DENIAL_REARM - Date.now());
    const timer = setTimeout(() => setDenial(null), wait);
    return () => clearTimeout(timer);
  }, [denial, uid, appActive]);

  /**
   * The latch, said out loud in development.
   *
   * A 403 disables every badge, the typing line and the presence dots at once,
   * and it does it silently by design — which is the same shape as a missing
   * provider, and that one cost the web build three rounds. The server's own
   * sentence is quoted rather than paraphrased: this used to report "no Sanvaad
   * grant", which is the right cause for one of the four things that raise a
   * 403 here and a wrong accusation for the other three.
   */
  useEffect(() => {
    if (denial == null || denial.uid !== uid || !__DEV__) return;
    console.warn(
      `[useLive] /live answered 403 (${denial.scope}-level): ` +
      `${denial.detail ?? 'no detail on the response'}. The poll is off and every ` +
      'live number reads empty until it re-arms — on a foreground transition, or ' +
      `${DENIAL_REARM / 60_000} minutes after the refusal, whichever comes first. ` +
      'That is the module gate, not a fault in this hook.',
    );
  }, [denial, uid]);

  const setChannel = useCallback((id: string | null) => {
    // Same id twice is the common case (a re-render of ChatScreen); bailing
    // early keeps it from restarting the interval out of phase.
    setChannelId(prev => (prev === id ? prev : id));
  }, []);

  const setTyping = useCallback((typing: boolean) => { typingFlag = !!typing; }, []);

  const payload = query.data ?? EMPTY;

  const value = useMemo<LiveContextValue>(
    () => ({ payload, setChannel, setTyping, mounted: true }),
    [payload, setChannel, setTyping],
  );

  return React.createElement(LiveContext.Provider, { value }, children);
}

/**
 * Read the current payload. Never undefined — the empty payload is returned
 * before the first poll and after a failure.
 */
export function useLive(): LivePayload {
  return useLiveContext('useLive').payload;
}

/**
 * Tell the single poll which channel is open. Call from ChatScreen with the
 * channelId; the effect clears it on unmount.
 *
 * Pass `null` when the screen is mounted but NOT focused (a Search or a thread
 * pushed on top of it) — that is what drops the cadence back to 20 s, which
 * holds because `Search` is one of the MESSAGING_ROUTES above. Push something
 * that is not a messaging screen on top and it drops to 60 s instead, which is
 * correct: nobody is watching the dots from a task sheet. Two mounted
 * ChatScreens is not a case that occurs, but last-mount-wins if it ever does.
 */
export function useLiveChannel(channelId: string | null | undefined): void {
  const { setChannel } = useLiveContext('useLiveChannel');
  useEffect(() => {
    setChannel(channelId ?? null);
    return () => setChannel(null);
  }, [channelId, setChannel]);
}

/**
 * Set the typing flag the NEXT scheduled poll carries. It never fires a request
 * of its own.
 *
 * Pass `false` to DELETE the caller's typing row — that is what stops the dots
 * for everybody else, so call it on blur and when the draft empties. The hook
 * also lowers the flag on unmount, so a screen that is popped mid-word cannot
 * leave somebody typing forever.
 */
export function useTypingPing(): (typing: boolean) => void {
  const { setTyping } = useLiveContext('useTypingPing');
  useEffect(() => () => setTyping(false), [setTyping]);
  return setTyping;
}

/** Convenience, so the tab badge and the rail do not each reimplement it. */
export function useMentionUnread(): number {
  return useLiveContext('useMentionUnread').payload.mention_unread;
}
