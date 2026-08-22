/**
 * punchQueue — attendance punches, queued separately from every other mutation.
 *
 * 17-mobile-app.md: "Punches need their own retention: 72 hours, never dropped on
 * failure, idempotent via a client-generated `client_punch_id`, and the recorded
 * time is when the punch happened, not when it synced. A dropped punch is an
 * unpaid day."
 *
 * That sentence is why this is not `mutationQueue`. Three of its behaviours are
 * right for everything else and wrong for a punch:
 *
 *   · It discards after MAX_RETRIES = 3. A punch must survive an outage longer
 *     than three backoff steps, so nothing here is ever dropped for failing.
 *     Only age retires a punch, at the 72 hours `07-pahchan.md` sets.
 *   · It squashes consecutive PATCH/PUT to the same URL. Two punches are two
 *     facts — an in and an out, or two shifts — and collapsing them loses a day.
 *     This queue is append-only and never merges.
 *   · Its `created_at` is when the item was enqueued. For a punch the payroll-
 *     relevant time is `captured_at`, taken when the employee pressed the button,
 *     which may be days before it reaches a network.
 *
 * It also lives under its own MMKV key, so `clearQueue()` on the mutation queue
 * cannot wipe attendance. Wiping pending edits must never wipe someone's pay.
 *
 * Field names are 07 §4's punch contract exactly: `direction`, `captured_at`,
 * `photo_key`. `captured_at` and `received_at` are NOT interchangeable — the
 * server stamps `received_at` itself, and an offline punch captured at 09:41 and
 * synced at 11:38 is a 09:41 punch.
 */

import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import { storage } from '../lib/storage';
import { apiClient } from '../api/client';

const PUNCH_KEY = 'punch_queue';

/** 07 §2's offline buffer. Measured from `captured_at`, not from enqueue time. */
export const PUNCH_RETENTION_MS = 72 * 60 * 60 * 1000;

export type PunchDirection = 'in' | 'out';

export interface QueuedPunch {
  /** Idempotency key. The server dedups on (org_id, client_punch_id), so a
   *  replayed punch after a timeout-then-success cannot create a second record.
   *  Generated once at capture and NEVER regenerated on retry — regenerating it
   *  is exactly how one punch becomes two. */
  client_punch_id: string;
  direction:       PunchDirection;
  /** When the employee pressed the button. Never when it synced. */
  captured_at:     string;
  lat?:            number;
  lng?:            number;
  /** Metres. Never defaulted to 0 — absent stays undefined and the server flags
   *  it, because 0 would read as a perfect fix. */
  accuracy_m?:     number;
  /** Metres above sea level, and the device's own uncertainty about it.
   *
   *  THE SAME RULE AS `accuracy_m`, AND IT MATTERS MORE HERE. A device that
   *  reports no altitude is ordinary — indoors, and permanently on some Android
   *  hardware — so `undefined` is a state that will occur on real punches every
   *  day. Defaulting either to 0 would put the punch at sea level, and a site
   *  with a vertical window set anywhere above that would flag every punch from
   *  that handset for a fact about the hardware.
   *
   *  Held on the queue rather than only sent live because a punch may sit here
   *  for 72 hours: a field the queue does not carry is a field an offline punch
   *  loses, and there is no way to recover it afterwards. */
  altitude_m?:          number;
  altitude_accuracy_m?: number;
  site_id?:        string | null;
  /** Object-store key, set once the photo has uploaded. Null until then. */
  photo_key?:      string | null;
  /** Local file URI, held until the upload succeeds. */
  photo_uri?:      string | null;
  /** null = not checked on this platform, which is not the same as false. */
  mock_location?:  boolean | null;
  /** Advisory only — an anomaly signal, not an auth factor. */
  device_id?:      string | null;
  /** Captures that FAILED before this one landed — distinct from `attempts`,
   *  which counts send retries after a successful capture. The server flags
   *  `retries` at 3 so a manager checks the day; it never refuses the punch. */
  retry_count?:    number;
  /** Attempts so far. Diagnostics only; it never causes a drop. */
  attempts:        number;
  last_error?:     string | null;
  /** Device clock at enqueue. Paired with `captured_at` it exposes clock drift. */
  enqueued_at:     string;
}

// ── Persistence ───────────────────────────────────────────────────────────────

function read(): QueuedPunch[] {
  const raw = storage.getString(PUNCH_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as QueuedPunch[]; } catch { return []; }
}

function write(q: QueuedPunch[]): void {
  storage.set(PUNCH_KEY, JSON.stringify(q));
}

export function getPunchCount(): number {
  return read().length;
}

/**
 * Count, the oldest capture time, and how long that punch has left.
 *
 * The 72 hours in `PUNCH_RETENTION_MS` was a promise the UI never showed. It was
 * enforced silently by `pruneExpired` and only ever surfaced as an Alert AFTER a
 * punch had already aged out — at which point the employee's options are a
 * regularisation request and an awkward conversation. Naming the remaining
 * window while it is still open is what makes the retention a promise rather
 * than a deadline that arrives without warning.
 *
 * `hoursLeft` is measured from `captured_at`, matching `pruneExpired` exactly,
 * so the number shown and the number enforced cannot drift apart. It floors at
 * 0 rather than going negative: a punch past the window has no time left, and
 * "-3 hours remaining" is not a sentence.
 */
export interface PunchSummary {
  count: number;
  /** ISO capture time of the oldest queued punch, or null when none are queued. */
  oldestCapturedAt: string | null;
  /** Whole hours before the oldest punch is retired. Null when nothing is queued. */
  hoursLeft: number | null;
}

export function getPunchSummary(now = Date.now()): PunchSummary {
  const q = read();
  if (q.length === 0) return { count: 0, oldestCapturedAt: null, hoursLeft: null };

  let oldest: number | null = null;
  let oldestIso: string | null = null;
  for (const punch of q) {
    const at = new Date(punch.captured_at).getTime();
    // Same rule as pruneExpired: an unparseable timestamp is kept, and it also
    // does not get to claim it is the oldest.
    if (Number.isNaN(at)) continue;
    if (oldest === null || at < oldest) { oldest = at; oldestIso = punch.captured_at; }
  }

  if (oldest === null) return { count: q.length, oldestCapturedAt: null, hoursLeft: null };

  const msLeft = PUNCH_RETENTION_MS - (now - oldest);
  return {
    count: q.length,
    oldestCapturedAt: oldestIso,
    hoursLeft: Math.max(0, Math.floor(msLeft / (60 * 60 * 1000))),
  };
}

/**
 * Delete a punch selfie from the device.
 *
 * The queue itself holds no image bytes — only `photo_uri`, a path to a JPEG in
 * the app's own sandbox. So removing a queue entry frees the pointer and leaves
 * the photograph, and a face on a phone is exactly the thing 07 §5's retention
 * promise is about. Nothing else on the device would ever have deleted it: the
 * app never lists that directory, so the file would sit there for the life of
 * the install.
 *
 * Never throws. A punch must not fail to send, or fail to be retired, because
 * the filesystem would not delete a JPEG — the queue entry is the durable record
 * and the file is a leftover.
 */
async function discardPhoto(uri?: string | null): Promise<void> {
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Already gone, or a path the OS will not let us touch. Either way there is
    // nothing useful to do and nothing worth failing a punch over.
  }
}

export function getQueuedPunches(): QueuedPunch[] {
  return read();
}

/**
 * Retire punches past the retention window.
 *
 * The only way a punch leaves this queue unsent. Expired punches are RETURNED
 * rather than silently deleted, so the caller can tell the employee: someone
 * whose punch aged out needs to raise a regularisation, and only they know it
 * happened. Deleting it quietly turns a sync failure into a missing day nobody
 * can explain.
 */
export function pruneExpired(now = Date.now()): QueuedPunch[] {
  const q = read();
  const live: QueuedPunch[] = [];
  const expired: QueuedPunch[] = [];
  for (const punch of q) {
    const at = new Date(punch.captured_at).getTime();
    // An unparseable timestamp is KEPT. Losing a punch to a bad date string is
    // precisely the outcome this queue exists to prevent.
    if (Number.isNaN(at) || now - at < PUNCH_RETENTION_MS) live.push(punch);
    else expired.push(punch);
  }
  if (expired.length) write(live);
  return expired;
}

// ── Enqueue ───────────────────────────────────────────────────────────────────

export interface EnqueuePunchInput {
  direction:     PunchDirection;
  captured_at?:  string;
  lat?:          number;
  lng?:          number;
  accuracy_m?:   number;
  /** Both absent unless the fix carried them. Never coerced to 0 — see
   *  `QueuedPunch.altitude_m`. */
  altitude_m?:          number;
  altitude_accuracy_m?: number;
  site_id?:      string | null;
  photo_uri?:    string | null;
  photo_key?:    string | null;
  mock_location?: boolean | null;
  device_id?:    string | null;
  /** Captures that failed before this one landed. The server flags at 3. */
  retry_count?:  number;
}

/**
 * Append a punch. Returns its `client_punch_id`.
 *
 * Never deduped against an existing entry. Two punches a minute apart are
 * unusual but legitimate — a short break, a corrected mis-tap — and reconciling
 * them is the server's job, not the client's to decide one did not happen.
 */
export function enqueuePunch(input: EnqueuePunchInput): string {
  const q = read();
  const client_punch_id = Crypto.randomUUID();
  q.push({
    client_punch_id,
    direction:     input.direction,
    captured_at:   input.captured_at ?? new Date().toISOString(),
    lat:           input.lat,
    lng:           input.lng,
    accuracy_m:    input.accuracy_m,
    // NO `?? 0` and NO `?? null` on these two. `undefined` survives
    // `JSON.stringify` by being dropped from the object entirely, which is
    // exactly right: the key is absent on the wire and the server's
    // `Optional[float] = None` reads it as "not reported". A null would be
    // equivalent; a 0 would be a claim about sea level that nobody made.
    altitude_m:          input.altitude_m,
    altitude_accuracy_m: input.altitude_accuracy_m,
    site_id:       input.site_id ?? null,
    photo_uri:     input.photo_uri ?? null,
    photo_key:     input.photo_key ?? null,
    mock_location: input.mock_location ?? null,
    device_id:     input.device_id ?? null,
    retry_count:   input.retry_count ?? 0,
    attempts:      0,
    last_error:    null,
    enqueued_at:   new Date().toISOString(),
  });
  write(q);
  return client_punch_id;
}

/**
 * Attach an uploaded photo key so `flushPunches` can send the punch.
 *
 * Separate from enqueue because capture and upload fail independently: the punch
 * is recorded the instant the button is pressed, and the image may take three
 * days and four networks to arrive.
 */
export function attachPhotoKey(clientPunchId: string, photoKey: string): void {
  const q = read();
  const idx = q.findIndex(p => p.client_punch_id === clientPunchId);
  if (idx === -1) return;
  q[idx] = { ...q[idx], photo_key: photoKey };
  write(q);
}

// ── Flush ─────────────────────────────────────────────────────────────────────

export interface PunchFlushResult {
  sent:    number;
  /** Still queued after this attempt. Never dropped, only carried forward. */
  pending: number;
  expired: QueuedPunch[];
  errors:  { client_punch_id: string; error: string }[];
}

/**
 * Replay queued punches oldest-first.
 *
 * Serial and ordered by `captured_at`, not parallel: an `out` that lands before
 * its `in` gives the server a shift it cannot close.
 *
 * A failure keeps the punch and records the reason. There is no retry ceiling.
 */
export async function flushPunches(): Promise<PunchFlushResult> {
  const expired = pruneExpired();
  const queue = read().slice().sort(
    (a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime(),
  );

  const remaining: QueuedPunch[] = [];
  const errors: PunchFlushResult['errors'] = [];
  let sent = 0;

  for (const punch of queue) {
    // A punch whose photo has not uploaded yet is not ready. 07 §4 makes
    // photo_key part of the contract, and a punch that cannot be compared
    // against the reference pair cannot be verified — so it waits rather than
    // going without.
    if (!punch.photo_key) {
      remaining.push(punch);
      continue;
    }
    try {
      await apiClient.post('/v1/pahchan/punch', {
        direction:       punch.direction,
        captured_at:     punch.captured_at,
        lat:             punch.lat,
        lng:             punch.lng,
        accuracy_m:      punch.accuracy_m,
        // Replayed exactly as captured. A punch that waited three days for
        // signal is judged against the height it was actually made at.
        altitude_m:          punch.altitude_m,
        altitude_accuracy_m: punch.altitude_accuracy_m,
        site_id:         punch.site_id,
        photo_key:       punch.photo_key,
        device_id:       punch.device_id,
        mock_location:   punch.mock_location,
        // Anything replayed from this queue was captured while offline, whatever
        // the connection looks like now. The server flags it, and the reviewer
        // sees why captured_at and received_at differ.
        source:          'offline',
        retry_count:     punch.retry_count ?? 0,
        client_punch_id: punch.client_punch_id,
      });
      sent += 1;
      // Sent and acknowledged: the selfie is on the server, inside the 90-day
      // window the org promised, and the local copy is now a second store of the
      // same biometric with nobody's retention job pointed at it.
      await discardPhoto(punch.photo_uri);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ client_punch_id: punch.client_punch_id, error: message });
      remaining.push({ ...punch, attempts: punch.attempts + 1, last_error: message });
    }
  }

  write(remaining);

  // An expired punch is never going to be sent, so its photograph has no purpose
  // left. Retiring the entry and keeping the face is the worst of both — the
  // employee has lost the punch AND the image outlives it. After write(), because
  // the queue mutation is the durable part and must not wait on a filesystem.
  await Promise.all(expired.map(p => discardPhoto(p.photo_uri)));

  return { sent, pending: remaining.length, expired, errors };
}
