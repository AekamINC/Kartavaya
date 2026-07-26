/**
 * punchQueue — attendance punches, queued separately from every other mutation.
 *
 * 17-mobile-app.md: "Punches need their own retention: 72 hours, never dropped on
 * failure, idempotent via a client-generated `client_punch_id`, and the recorded
 * time is when the punch happened, not when it synced. A dropped punch is an
 * unpaid day."
 *
 * That sentence is why this is not `mutationQueue`. Three of its behaviours are
 * wrong for a punch, and all three are correct for everything else:
 *
 *   · It discards after MAX_RETRIES = 3. A punch must survive an outage longer
 *     than three backoff steps, so nothing here is ever dropped for failing.
 *     Only age retires a punch, and 72 hours is the window `07-pahchan.md` sets.
 *   · It squashes consecutive PATCH/PUT to the same URL. Two punches are two
 *     facts — an in and an out, or two shifts — and collapsing them loses a day.
 *     Punches are append-only and never merged.
 *   · Its `created_at` is when the item was enqueued. For a punch the payroll-
 *     relevant time is `occurred_at`, captured when the employee pressed the
 *     button, which may be days before it reaches the server.
 *
 * `clearQueue()` on the mutation queue also cannot touch these, because they live
 * under a different MMKV key. Wiping pending edits must never wipe attendance.
 */

import * as Crypto from 'expo-crypto';
import { storage } from '../lib/storage';
import { apiClient } from '../api/client';

const PUNCH_KEY = 'punch_queue';

/** 07-pahchan.md's buffer. Measured from `occurred_at`, not from enqueue time. */
export const PUNCH_RETENTION_MS = 72 * 60 * 60 * 1000;

export type PunchType = 'in' | 'out';

export interface QueuedPunch {
  /** Idempotency key. The server dedups on this, so a replayed punch after a
   *  timeout-then-success cannot create a second record. Generated at capture,
   *  never regenerated on retry — regenerating it is how you get duplicates. */
  client_punch_id: string;
  type:            PunchType;
  /** When the employee pressed the button. Never when it synced. */
  occurred_at:     string;
  lat?:            number;
  lng?:            number;
  accuracy_m?:     number;
  site_id?:        string | null;
  /** R2 key of the uploaded selfie, or null while the image is still local. */
  selfie_key?:     string | null;
  /** Local file URI, kept until the selfie has been uploaded. */
  selfie_uri?:     string | null;
  /** Advisory only — an anomaly signal, not an auth factor. */
  device_id?:      string | null;
  /** Attempts so far. Recorded for diagnostics; it never causes a drop. */
  attempts:        number;
  last_error?:     string | null;
  /** Device clock at enqueue. Paired with occurred_at, it exposes clock drift —
   *  the server compares its own receipt time against both. */
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

/**
 * Drop punches older than the retention window.
 *
 * The only way a punch leaves this queue unsent. Beyond 72 hours the server
 * will not accept it against the right day anyway, and holding it forever turns
 * a sync problem into an ever-growing queue. Expired punches are RETURNED rather
 * than silently deleted so the caller can surface them — an employee whose punch
 * expired needs to raise a regularisation, and only they know it happened.
 */
export function pruneExpired(now = Date.now()): QueuedPunch[] {
  const q = read();
  const live: QueuedPunch[] = [];
  const expired: QueuedPunch[] = [];
  for (const punch of q) {
    const at = new Date(punch.occurred_at).getTime();
    // An unparseable timestamp is kept, not discarded: losing a punch to a bad
    // date string is exactly the outcome this queue exists to prevent.
    if (Number.isNaN(at) || now - at < PUNCH_RETENTION_MS) live.push(punch);
    else expired.push(punch);
  }
  if (expired.length) write(live);
  return expired;
}

export function getPunchCount(): number {
  return read().length;
}

export function getQueuedPunches(): QueuedPunch[] {
  return read();
}

// ── Enqueue ───────────────────────────────────────────────────────────────────

export interface EnqueuePunchInput {
  type:        PunchType;
  occurred_at?: string;
  lat?:        number;
  lng?:        number;
  accuracy_m?: number;
  site_id?:    string | null;
  selfie_uri?: string | null;
  selfie_key?: string | null;
  device_id?:  string | null;
}

/**
 * Append a punch. Returns its `client_punch_id`.
 *
 * Append-only and never deduped against an existing entry. Two punches in the
 * same minute are unusual but legitimate — a mis-tap corrected immediately, or a
 * short break — and it is the server's job to reconcile them, not the client's to
 * decide one did not happen.
 */
export function enqueuePunch(input: EnqueuePunchInput): string {
  const q = read();
  const client_punch_id = Crypto.randomUUID();
  q.push({
    client_punch_id,
    type:        input.type,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    lat:         input.lat,
    lng:         input.lng,
    accuracy_m:  input.accuracy_m,
    site_id:     input.site_id ?? null,
    selfie_uri:  input.selfie_uri ?? null,
    selfie_key:  input.selfie_key ?? null,
    device_id:   input.device_id ?? null,
    attempts:    0,
    last_error:  null,
    enqueued_at: new Date().toISOString(),
  });
  write(q);
  return client_punch_id;
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
 * Order matters: an `out` replayed before its `in` gives the server a shift it
 * cannot close, so this is serial and in `occurred_at` order rather than parallel.
 *
 * A failure keeps the punch and records the reason. There is no retry ceiling.
 */
export async function flushPunches(): Promise<PunchFlushResult> {
  const expired = pruneExpired();
  const queue = read().slice().sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  );

  const remaining: QueuedPunch[] = [];
  const errors: PunchFlushResult['errors'] = [];
  let sent = 0;

  for (const punch of queue) {
    // A punch whose selfie has not been uploaded yet is not ready to send:
    // 07-pahchan.md makes selfie_key required on the punch payload. It waits
    // rather than going without, because a punch with no photo cannot be verified.
    if (!punch.selfie_key) {
      remaining.push(punch);
      continue;
    }
    try {
      await apiClient.post('/v1/pahchan/punch', {
        type:            punch.type,
        occurred_at:     punch.occurred_at,
        lat:             punch.lat,
        lng:             punch.lng,
        accuracy_m:      punch.accuracy_m,
        site_id:         punch.site_id,
        selfie_key:      punch.selfie_key,
        device_id:       punch.device_id,
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

/**
 * Attach an uploaded selfie key to a queued punch, so flushPunches can send it.
 *
 * Separate from enqueue because the capture and the upload fail independently:
 * the punch is recorded the instant the button is pressed, and the image may take
 * three days and four networks to get there.
 */
export function attachSelfieKey(clientPunchId: string, selfieKey: string): void {
  const q = read();
  const idx = q.findIndex(p => p.client_punch_id === clientPunchId);
  if (idx === -1) return;
  q[idx] = { ...q[idx], selfie_key: selfieKey };
  write(q);
}
