/**
 * usePushNotifications — Expo push token registration + tap-to-navigate.
 *
 * Call once inside InnerApp (after AuthProvider).
 * - Requests permissions on first mount when user is authenticated.
 * - Registers/refreshes token with backend via POST /me/push_tokens.
 * - Handles a notification tap: TaskDetail for a task push, Chat for a Sanvaad
 *   mention, and a sentence rather than silence for a Sanvaad url this version
 *   cannot read.
 *
 * ── The mention tap was a no-op, and that is worse than no notification ───────
 *
 * This handler read `data.taskId` and nothing else. A mention push arrives as
 * `data = { url: "/sanvaad?channel=…&message=…[&thread=…]" }` with NO `taskId` —
 * `services/samvaad_mentions.py:_push_one` passes `task_id=None` deliberately,
 * because a non-null one makes the web inbox open an empty task drawer and
 * ignore `url`. So the guard failed, the tap was discarded, and the person who
 * was mentioned believed they had seen it.
 *
 * ── Cold start is a different code path, and it is the one that gets missed ───
 *
 * A tap that RESUMES the app fires `addNotificationResponseReceivedListener`,
 * and by then the navigator is mounted. A tap that LAUNCHES the app may deliver
 * its response before this hook has subscribed, and — the part that actually
 * bites — `RootStack` renders `<Splash/>` while `useAuth` verifies the session,
 * so for the first second there is no NavigationContainer to push onto at all.
 * `navigationRef.isReady()` is false and a `navigate` is dropped in silence.
 *
 * Both are handled by holding the target and replaying it: the launch response
 * is read once with `getLastNotificationResponseAsync()`, deduplicated against
 * the listener by notification identifier, and delivery is retried until the
 * navigator exists or auth resolves to a definite answer.
 *
 * ── There is no device gate any more, and removing it IS the fix ──────────────
 *
 * `registerForPushNotificationsAsync` used to open with
 * `if (!Constants.isDevice) return null;`. `isDevice` does not exist in
 * expo-constants 16.0.2 — its own CHANGELOG lists it among the properties
 * removed in v16, next to `installationId` and `nativeAppVersion`, and neither
 * interface in `Constants.types.d.ts` declares it. So the read was `undefined`,
 * `!undefined` was true, and this function returned on its first line on every
 * device that has ever run this build. `getExpoPushTokenAsync` was never
 * reached and `POST /me/push_tokens` never fired, which means no device held a
 * token and no mention notification could be delivered to anyone. The whole
 * tap-handling apparatus above it was correct and unreachable.
 *
 * `tsc` cannot see this and never could: `NativeConstants` ends with a
 * `[key: string]: any` index signature, so every misspelling of a Constants
 * property is `any` and typechecks clean.
 *
 * Nothing replaces the gate. The SDK is the authority on whether this device
 * can mint a token — `getExpoPushTokenAsync` throws when it cannot, and the
 * catch below already turns that into the same `null` the gate was trying to
 * produce. A pre-emptive guess can only be wrong in the direction that costs a
 * token, and it was: an Android emulator with Play services registers perfectly
 * well through a dev client, and the emulator is where this gets tested.
 *
 * `hooks/__tests__/pushRegistration.test.ts` holds both halves of that: no
 * unexplained early return in front of the token call, and no `Constants.<x>`
 * anywhere in `src/` that the installed package does not actually declare.
 */
import { useCallback, useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { Alert, Platform } from 'react-native';
import { MMKV } from 'react-native-mmkv';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from './useAuth';
import { navigationRef } from '../nav/navigationRef';
import { apiClient } from '../api/client';
import { BRAND } from '../theme/tokens';
import { parseSanvaadUrl, isSanvaadUrl } from '../lib/deepLink';

/**
 * The Settings switch, exported so there is exactly ONE spelling of it.
 *
 * SettingsScreen writes it and this hook reads it. When each held its own
 * literal, the write and the read were one typo away from silently disagreeing
 * — and the symptom of that disagreement is a phone that buzzes while the
 * screen says notifications are off, which nobody would think to blame on a
 * string.
 *
 * Tri-state on purpose: `'false'` is off, `'true'` is on, and ABSENT is "never
 * asked", which must keep registering. Everyone who has never opened Settings
 * has no value here.
 */
export const PUSH_ENABLED_KEY = 'push_enabled';

const storage = new MMKV({ id: 'push_tokens' });
const DEVICE_ID_KEY = 'push_device_id';
/**
 * The last notification response this device acted on, kept across launches.
 *
 * `getLastNotificationResponseAsync()` returns the most recent response, not
 * "the one that launched this process" — so without a memory, every subsequent
 * cold start would re-open the same message. `clearLastNotificationResponseAsync`
 * is called too; this is the belt to that pair of braces, because a tap silently
 * re-navigating a week later is the kind of bug nobody reproduces on demand.
 */
const HANDLED_RESPONSE_KEY = 'push_last_handled_response';

/**
 * Return a stable cryptographically-random device ID, generating and persisting
 * one in MMKV on the first call. Exported so useAuth can deregister on logout.
 */
export function getDeviceId(): string {
  let id = storage.getString(DEVICE_ID_KEY);
  if (!id) {
    id = `device_${Crypto.randomUUID()}`;
    storage.set(DEVICE_ID_KEY, id);
  }
  return id;
}

// Configure how notifications are handled while app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Request push-notification permissions and return the Expo push token.
 *
 * Returns null when the person refuses permission, or when this platform cannot
 * mint a token at all — a simulator, or Expo Go on a version that dropped remote
 * push. Both of those are the SDK's answer to give, not ours to guess in
 * advance; see the header for what guessing cost.
 */
async function registerForPushNotificationsAsync(): Promise<string | null> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return null;

    // Android requires a notification channel.
    //
    // `lightColor` was '#0082C6' — the brand blue that 00 §9 retired. It is the
    // notification LED and the accent Android tints the small icon with, and it
    // already disagreed with app.json's expo-notifications `color: '#05b7aa'`,
    // so the same notification arrived blue-lit and teal-iconed. Taking it from
    // BRAND means the two cannot drift again.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: BRAND.teal,
      });
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return tokenData.data;
  } catch (err) {
    // The only place a platform without push is detected now. An iOS simulator
    // and a dev client with no Firebase config both throw on the line above,
    // which is exactly the answer the removed gate was trying to guess — except
    // this one is the SDK's, so it is right about the Android emulator too.
    //
    // And because it is the only place, it has to SAY so. This caught silently,
    // and two separate registration failures shipped through it unnoticed — the
    // `Constants.isDevice` gate in front of it, and Android having no FCM
    // configuration at all, which makes `getExpoPushTokenAsync` throw here on
    // every Android build. A `catch {}` on the one detector of a failure is how
    // "push doesn't work" stays a mystery for two releases.
    if (__DEV__) {
      console.warn(
        '[push] no token: registration failed, so this device will receive ' +
        'nothing. On Android this is usually the missing Firebase config ' +
        '(no google-services.json, no android.googleServicesFile in app.json); ' +
        'on an iOS simulator it is expected. Cause:',
        err,
      );
    }
    return null;
  }
}

// ── Where a tap is trying to go ───────────────────────────────────────────────

type PushTarget =
  | { kind: 'task'; taskId: string }
  | { kind: 'chat'; channelId: string; message?: string; thread?: string };

/**
 * The tap that has not landed yet.
 *
 * Module-level rather than a ref, because the two producers (the launch read and
 * the listener) and the consumer (the retry pump) live in different effects that
 * re-run on auth changes. A ref would be reset by a remount at exactly the
 * moment a cold-start tap is waiting for the navigator.
 */
let pending: PushTarget | null = null;

/** Guards against the launch read and the listener delivering the same tap. */
let handledInSession: string | null = null;

/**
 * The notification identifier behind `pending`, held until the tap lands.
 *
 * The MMKV record used to be written the moment a response was READ. On a cold
 * start the read happens up to twelve seconds before delivery — the pump is
 * waiting on the session verify — and anything that ends the process inside that
 * window (a swipe-away, an OOM kill, a slow verify the user gives up on) left
 * the identifier marked handled with nothing delivered. The next launch reads
 * the same response, hits the early return in `receive`, and the mention is
 * consumed forever. So the identifier travels with the target and is written
 * only once the tap has an outcome.
 */
let pendingId: string | null = null;

/**
 * This tap is finished with: forget it, and remember that across launches.
 *
 * `handledInSession` is deliberately NOT what persists. It dies with the
 * process, which is exactly right for a tap that never landed — that one should
 * come back.
 */
function consumePending(): void {
  const id = pendingId;
  pending   = null;
  pendingId = null;
  if (id) storage.set(HANDLED_RESPONSE_KEY, id);
}

/**
 * Which users have a stack containing TaskDetail and Chat. Only `client` does
 * not.
 *
 * ── This used to also refuse attendance-only accounts, and that was false ─────
 *
 * It read `role !== 'client' && role !== 'attendance' && role !== 'pahchan_only'`,
 * copying `isAttendanceOnly` from nav/RootStack.tsx on the belief that those
 * roles get a stack without these screens. They do not.
 * `RootStack.tsx:300` uses `isAttendanceOnly` for ONE thing — which component
 * the `Main` screen renders, `PahchanTabs` instead of `MainTabs`. TaskDetail,
 * Board and Chat are registered as SIBLINGS of `Main` in the same navigator for
 * every non-client role, so `navigate('TaskDetail')` pushes fine over
 * PahchanTabs. An attendance-only user who gets assigned a task was told "this
 * account can't open that" about a screen that was sitting there waiting.
 *
 * `client` is genuinely refused: `RootStack.tsx:295` replaces the WHOLE stack
 * with the one-screen client portal, so there is no TaskDetail and no Chat in it
 * to reach.
 *
 * useLive's `hasSanvaadShell` keeps the wider list on purpose and is not now out
 * of step — it asks whether the Messages TAB exists, and in `PahchanTabs` it
 * does not. This asks whether the SCREEN is registered. Different question,
 * different answer.
 *
 * Whether the account may READ that task or channel is the server's to answer
 * and it does — a 403 renders a ScreenState. Guessing it here can only refuse
 * something that would have worked, which is the whole lesson of the device
 * gate in the header.
 */
function hasTaskAndChatScreens(role: string | null | undefined): boolean {
  return role !== 'client';
}

/**
 * A task id, as far as this handler has any business caring.
 *
 * ── A task id is NOT a uuid, and gating on one broke every task push ──────────
 *
 * This branch was `/^[0-9a-f-]{32,36}$/i`. The backend builds task ids as
 * `f"task_{uuid.uuid4().hex[:12]}"` (`server.py:1446`, `:1778`, `:2497`) and
 * `f"task_{uuid.uuid4().hex[:10]}"` (`routers/templates.py:137`) — 17 and 15
 * characters, containing `t`, `s`, `k` and `_`, none of which that character
 * class admits. **It could not match a real id, ever.** So every task, approval
 * and reminder push missed this branch, fell through to `parseSanvaadUrl` (which
 * returns null for `/tasks/…`), and told the person their app was out of date
 * for a notification that was perfectly current. `NotificationBanner` never had
 * the regex, so the same approval opened from the in-app banner and insulted
 * them from the push.
 *
 * What replaces it is deliberately NOT a second guess at the format. The only
 * thing that has to be true is that this string is safe to interpolate: it goes
 * straight into `` `/tasks/${taskId}` `` in `api/tasks.ts` with no encoding, so
 * a `/`, a `.` or a `%` in it would address a different endpoint. Charset and
 * length, nothing about the prefix — an id of some older shape still opens the
 * task, and there is no format assumption left here to be wrong about.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Read a tap into a target, and SAY SO when it cannot be read.
 *
 * Order matters and matches the in-app banner: task first, then the mention url.
 */
function targetOf(response: Notifications.NotificationResponse): PushTarget | null {
  const data = (response.notification?.request?.content?.data ?? {}) as Record<string, unknown>;

  const taskId = data.taskId;
  if (typeof taskId === 'string' && SAFE_ID.test(taskId)) {
    return { kind: 'task', taskId };
  }

  const target = parseSanvaadUrl(data.url);
  if (target) {
    return {
      kind: 'chat',
      channelId: target.channelId,
      message:   target.message,
      thread:    target.thread,
    };
  }

  // The alert is for a url addressed to SANVAAD that this version still cannot
  // read — that one is a product bug, and silence is what made the last three
  // invisible. It is not for every url, because `data.url` does not belong to
  // Sanvaad alone. The older `services/expo_push_service.send_expo_push` writes
  // `{"url": url, "taskId": task_id}` on EVERY send from five call sites
  // (`server.py:550`, `approvals_router.py:516` and `:617`,
  // `routers/task_reminders.py:136`, `services/reminder_service.py:146`), and
  // `url` defaults to `"/"` there, so `data.url` is always a string — including
  // for a reminder whose only destination is the home screen. Gating on
  // `typeof data.url === 'string'` therefore alerted on all of them.
  // `isSanvaadUrl` is the predicate that tells "a url I cannot use" apart from
  // "a url that was never mine", and it is the one `NotificationBanner` uses for
  // exactly this distinction.
  if (isSanvaadUrl(data.url)) {
    Alert.alert(
      'Can’t open that',
      'This notification points somewhere this version of the app doesn’t know '
      + 'about. Update the app, or open it on the web.',
    );
  }
  return null;
}

/**
 * React hook that registers the device for Expo push notifications and wires
 * up a tap listener that navigates to the task or the message that was tapped.
 * Call once inside InnerApp after AuthProvider.
 */
export function usePushNotifications() {
  const { user, loading } = useAuth();
  const notifListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();

  // Read by the retry pump, which runs on a timer after the render that set it.
  const auth = useRef({ user, loading });
  useEffect(() => { auth.current = { user, loading }; }, [user, loading]);

  /**
   * One delivery attempt. `'wait'` means the app is not yet in a state where
   * this tap has an answer — try again shortly; anything else is final.
   */
  const attempt = useCallback((): 'done' | 'wait' => {
    const target = pending;
    if (!target) return 'done';

    // Auth has not resolved: RootStack is still rendering <Splash/> and there is
    // no navigator behind it. Not an error, just early.
    if (auth.current.loading) return 'wait';

    const u = auth.current.user;
    if (!u) {
      Alert.alert(
        'Sign in to open this message',
        'You’ve been signed out on this device. Sign in and the message will be '
        + 'waiting for you.',
      );
      consumePending();
      return 'done';
    }

    if (!hasTaskAndChatScreens(u.role)) {
      Alert.alert(
        'This account can’t open that',
        'The client portal on this device shows the work shared with you and '
        + 'nothing else. Open it on the web, or ask your admin for access.',
      );
      consumePending();
      return 'done';
    }

    // The navigator exists but may still be mounting on a cold start.
    if (!navigationRef.isReady()) return 'wait';

    if (target.kind === 'task') {
      navigationRef.navigate('TaskDetail', { taskId: target.taskId });
    } else {
      // `channelName` is deliberately not passed — a url cannot supply one, and
      // ChatScreen resolves it from ['messaging','channels'].
      navigationRef.navigate('Chat', {
        channelId: target.channelId,
        message:   target.message,
        thread:    target.thread,
      });
    }
    // After the navigate, never before it: if that throws, the tap is still
    // pending and the pump gets another go rather than the record saying it
    // already arrived.
    consumePending();
    return 'done';
  }, []);

  /**
   * Retry until the app can answer. 200 ms × 60 ≈ 12 s, which covers a cold
   * start on a slow device with the session check in front of it.
   *
   * On exhaustion `pending` is deliberately LEFT SET rather than dropped: the
   * effect below re-pumps whenever auth changes, so a tap that arrived during a
   * sign-in still lands once the stack exists.
   */
  const pump = useRef<ReturnType<typeof setInterval> | null>(null);
  const startPump = useCallback(() => {
    if (attempt() === 'done') return;
    if (pump.current) return;

    let tries = 0;
    pump.current = setInterval(() => {
      tries += 1;
      if (attempt() === 'done' || tries >= 60) {
        if (pump.current) clearInterval(pump.current);
        pump.current = null;
      }
    }, 200);
  }, [attempt]);

  const receive = useCallback((response: Notifications.NotificationResponse) => {
    const id = response.notification?.request?.identifier ?? null;
    if (id && id === handledInSession) return;
    if (id && storage.getString(HANDLED_RESPONSE_KEY) === id) return;
    handledInSession = id;

    const target = targetOf(response);
    if (!target) {
      // Unreadable is still an outcome — the alert has been shown, or there was
      // nothing here to open — so this one IS finished with. Written directly
      // rather than through `consumePending`, which belongs to whichever tap is
      // in flight; a second, unreadable tap must not discard the first.
      if (id) storage.set(HANDLED_RESPONSE_KEY, id);
      return;
    }
    pending   = target;
    pendingId = id;
    startPump();
  }, [startPump]);

  // ── Token registration. Gated on a signed-in user; the tap path is not. ─────
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      // Honour the Settings switch. Without this the "off" survives exactly one
      // launch: SettingsScreen DELETEs the token row, but this effect runs on
      // every launch and `POST /me/push_tokens` is ON CONFLICT DO UPDATE, so
      // the row comes straight back — while the switch, reading the same stored
      // flag, still shows OFF. The phone buzzes and the screen says it should
      // not, which is worse than never having offered the switch.
      //
      // ABSENT is not "off". The key is unset for everyone who has never opened
      // that screen, and treating that as off would silence them all. Only the
      // explicit string counts. The guard lives here and NOT inside
      // `registerForPushNotificationsAsync` — a return added there trips
      // `pushRegistration.test.ts`, correctly: that test exists to stop a silent
      // early exit reappearing in front of the token request.
      if (await AsyncStorage.getItem(PUSH_ENABLED_KEY) === 'false') return;

      const token = await registerForPushNotificationsAsync();
      if (!token || cancelled) return;

      const deviceId = getDeviceId();
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';

      try {
        await apiClient.post('/me/push_tokens', { token, device_id: deviceId, platform });
      } catch {
        // Non-fatal — push will just not work until next launch
      }
    })();

    return () => { cancelled = true; };
  }, [user?.user_id]);  // re-register if user changes (e.g. logout → login)

  // ── Taps. Registered unconditionally, INCLUDING while signed out, so a tap
  //    on a mention gets "Sign in to open this message" instead of nothing. ────
  useEffect(() => {
    let cancelled = false;

    // The resume path.
    responseListener.current = Notifications.addNotificationResponseReceivedListener(receive);

    // Foreground receipt. The banner is drawn by the OS handler above; nothing
    // to do here yet, but the subscription is kept so badge work has a home.
    notifListener.current = Notifications.addNotificationReceivedListener(() => {});

    // The cold-start path. Read once, then cleared so the next launch does not
    // re-open the same message — `receive` dedupes on the identifier as well,
    // because clearing is best-effort on some platforms.
    (async () => {
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (cancelled || !last) return;
        receive(last);
        await Notifications.clearLastNotificationResponseAsync?.();
      } catch {
        // A launch we cannot read is a tap we cannot honour. Nothing to retry.
      }
    })();

    return () => {
      cancelled = true;
      notifListener.current?.remove();
      responseListener.current?.remove();
      if (pump.current) { clearInterval(pump.current); pump.current = null; }
    };
  }, [receive]);

  // A tap held through a cold start or a sign-in gets another go the moment the
  // answer could have changed.
  useEffect(() => {
    if (pending) startPump();
  }, [user?.user_id, loading, startPump]);
}
