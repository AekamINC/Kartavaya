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
  site_id?:        string | null;
  /** Object-store key, set once the photo has uploaded. Null until then. */
  photo_key?:      string | null;
  /** Local file URI, held until the upload succeeds. */
  photo_uri?:      string | null;
  /** null = not checked on this platform, which is not the same as false. */
  mock_location?:  boolean | null;
  /** Advisory only — an anomaly signal, not an auth factor. */
  device_id?:      string | null;
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
  site_id?:      string | null;
  photo_uri?:    string | null;
  photo_key?:    string | null;
  mock_location?: boolean | null;
  device_id?:    string | null;
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
    site_id:       input.site_id ?? null,
    photo_uri:     input.photo_uri ?? null,
    photo_key:     input.photo_key ?? null,
    mock_location: input.mock_location ?? null,
    device_id:     input.device_id ?? null,
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
        site_id:         punch.site_id,
        photo_key:       punch.photo_key,
        device_id:       punch.device_id,
        mock_location:   punch.mock_location,
        // Anything replayed from this queue was captured while offline, whatever
        // the connection looks like now. The server flags it, and the reviewer
        // sees why captured_at and received_at differ.
        source:          'offline',
        client_punch_id: punch.client_punch_id,
      });
      sent += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ client_punch_id: punch.client_punch_id, error: message });
      remaining.push({ ...punch, attempts: punch.attempts + 1, last_error: message });
    }
  }

  write(remaining);
  return { sent, pending: remaining.length, expired, errors };
}
