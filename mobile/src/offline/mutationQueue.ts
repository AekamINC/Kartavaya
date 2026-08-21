/**
 * Offline Mutation Queue — v3
 * ──────────────────────────
 * MMKV-backed queue with:
 *   • Serial replay in enqueue-order (causally safe)
 *   • A stable, persisted `Idempotency-Key` on every item, so a CREATE can be
 *     retried — see THE KEY below
 *   • Exponential backoff tracking per item (1s → 2s → 4s before each retry)
 *   • Max 3 retries; permanently-failed items MOVE to a dead-letter store
 *     rather than being discarded
 *   • Squash: consecutive PATCH/PUT to the same URL collapse into one
 *     (last-writer-wins for body; metadata from oldest entry kept).
 *     NEVER for POST or DELETE.
 *   • Deduplication: re-enqueue with same optimistic_id replaces in-place
 *
 * Usage:
 *   enqueueMutation({ method: 'PATCH', url: '/tasks/t_abc', body: { status: 'done' },
 *                     optimistic_id: 't_abc_status', entity_type: 'task', entity_id: 't_abc' });
 *   await flushQueue();   // called by NetInfo reconnect handler in App.tsx
 *
 * ── THE KEY, AND WHY A CREATE COULD NOT BE QUEUED WITHOUT ONE ────────────────
 *
 * This queue retries. A retry of a PATCH is free — writing `status: 'done'`
 * twice leaves one done task. A retry of a POST is not: the first attempt may
 * have reached the server and succeeded with only its RESPONSE lost, which is
 * the ordinary outcome on a bad link, and the retry then makes a SECOND
 * invoice, a second deal, a second task. Nothing afterwards can tell the two
 * apart, because nothing in either row records that they were the same intent.
 *
 * That is why creates were online-only — which is precisely backwards, since
 * the field user on Indian mobile data is the one who most needs to create
 * something while out of signal. `components/NewTaskSheet.tsx:222` already
 * queues `POST /tasks` offline today, with no key at all.
 *
 * So every item carries `idempotency_key`:
 *
 *   · GENERATED ONCE, at enqueue, from `Crypto.randomUUID()`.
 *   · PERSISTED WITH THE ITEM. The queue is one JSON blob in MMKV, so the key
 *     survives a force-quit, a crash and an OTA update for free — there is no
 *     separate store to keep in step.
 *   · NEVER REGENERATED ON RETRY. `flushQueue` re-persists the item with a
 *     bumped `retries` and the same key. Regenerating it would restore the
 *     exact bug the key exists to remove. `punchQueue.ts` states the same rule
 *     about `client_punch_id`, one queue over.
 *   · SENT AS THE `Idempotency-Key` HEADER on every attempt, for all four
 *     methods. One rule, no per-method table: the queue's whole premise is
 *     "this request may be sent more than once", and that is true of a DELETE
 *     (whose replay would otherwise 404 and be reported to the user as "that
 *     item no longer exists" for something that in fact succeeded) as much as
 *     of a POST.
 *
 * REGENERATION HAS EXACTLY ONE EXCEPTION, and it is the opposite of what it
 * first looks like. When a squash or a dedup CHANGES THE BODY under a key that
 * may already be in flight, the request is no longer the same request. The
 * server fingerprints the body under a key and refuses a changed one with 422,
 * so keeping the key would guarantee a rejection and the user's newer edit
 * would be thrown away while the server kept the older value. So:
 *
 *     body changed, method is PATCH/PUT/DELETE  →  NEW key.
 *         Safe, because those are idempotent by URL: re-running the earlier
 *         body and then the later one converges on the later one.
 *     body changed, method is POST              →  KEEP the key.
 *         A create must never be re-keyed. If the server has already recorded
 *         the original, the revision comes back 422 — which is the truth
 *         ("you already created this, your edit is too late") and is surfaced
 *         loudly rather than silently making a second row.
 *
 * ── WHAT THE SERVER OWES, IN ONE PARAGRAPH ───────────────────────────────────
 *
 * Nothing honours this header yet. `backend/migrations/186_idempotency.sql` is
 * the store, written and NOT applied; the endpoint layer that reads it does
 * not exist. Until it does, this header is ignored exactly as any unknown
 * header is, and a retried POST still makes a second row. The contract is:
 * scope `(user_id, key)`; unknown key → run and record; known and completed →
 * return the stored status and body byte-for-byte with `Idempotent-Replay:
 * true`; known and still running → 409; known with a different body → 422; a
 * 5xx deletes the record so the retry genuinely re-runs.
 *
 * ── THE SIX-DAY CEILING ──────────────────────────────────────────────────────
 *
 * The server's key expires after SEVEN days (migration 186, `expires_at`
 * DEFAULT). After that there is no protection: a very late retry re-executes
 * and duplicates. So this queue refuses to DISPATCH a create older than SIX
 * days and fails it loudly instead. The 24-hour margin is the point — there
 * must be no window in which the client believes it is protected and the
 * server has already forgotten the key, including for a request that spends
 * minutes in transit.
 *
 * If either number moves, BOTH move, in one commit. They name each other.
 *
 * The ceiling applies to CREATES ONLY. A six-day-old PATCH is stale, but
 * re-sending it merely overwrites a field with what the user asked for; the
 * only thing expiry endangers is a duplicate creation.
 *
 * ── WHAT HAPPENS WHEN SOMETHING CAN NEVER SUCCEED ────────────────────────────
 *
 * An item is given up on in three ways: the server refuses it with a 4xx that
 * is not 429 ('rejected'), it fails four times — the original attempt and
 * three retries ('exhausted'), or it is a create past the six-day ceiling
 * ('expired').
 *
 * In all three it MOVES to a dead-letter store (`getFailedMutations()`), it is
 * not deleted. It used to be dropped on the floor: it appeared once in
 * `flushQueue`'s `failed[]`, `App.tsx` painted a seven-second banner, and then
 * the only copy of what the user typed was gone. For a PATCH that is survivable
 * — the record is still on screen. For a POST it is not: the thing was never
 * created and nothing anywhere remembers it was meant to be.
 *
 * `screens/unsent/UnsentScreen.tsx` RENDERS IT. Keeping the payload was
 * necessary and was not sufficient — until a screen showed it, the failure was
 * only as loud as `App.tsx`'s seven-second banner and the last copy of what the
 * user typed sat in storage nothing read. That screen is reached from Settings
 * and from the banner itself, names each entry from its payload rather than
 * from its URL, and offers exactly three things: retry where
 * `canRetryFailed` says retrying could work, a confirmed discard where it
 * cannot, and copy-out always.
 *
 * ── WHAT THIS QUEUE STILL CANNOT DO ──────────────────────────────────────────
 *
 * A CREATE FOLLOWED BY AN EDIT OF THE SAME RECORD, OFFLINE. The POST has no
 * server id yet, so a follow-up `PATCH /tasks/{id}` has no URL to be built
 * from; there is no id-remapping here and adding one is a real feature, not a
 * flag. Until there is, a screen must not offer edits on a record that is
 * still queued — `queuedEntityIds()` is how it finds out — or the PATCH 404s,
 * is treated as permanent, and lands in the dead letter.
 */

import * as Crypto from 'expo-crypto';
import { storage } from '../lib/storage';
import { apiClient } from '../api/client';
import type { MutationQueueItem, FailedMutation } from '../api/types';

const QUEUE_KEY        = 'mutation_queue';
const FAILED_KEY       = 'mutation_queue_failed';
const MAX_RETRIES      = 3;

/**
 * The header. Spelled once, here, so the queue and any test agree on it.
 * `Idempotency-Key` is the name in the IETF draft and the one every payment
 * API uses; a bespoke `X-Kartavaya-…` would buy nothing and cost recognition.
 */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/**
 * SIX DAYS. Deliberately one day inside the server's seven-day TTL
 * (`expires_at` DEFAULT in `backend/migrations/186_idempotency.sql`).
 *
 * Past this, the server may already have forgotten the key, so re-sending a
 * create is unprotected and would duplicate. The item is failed loudly instead.
 * MOVE THIS AND MOVE THE MIGRATION, IN ONE COMMIT.
 */
export const CREATE_MAX_AGE_MS = 6 * 24 * 60 * 60 * 1000;

/** What the user is told about an item the ceiling refused. */
export const EXPIRED_MESSAGE =
  'This was created offline more than 6 days ago and can no longer be sent '
  + 'safely. Please enter it again.';

/** How many dead-letter entries are kept. See `recordFailure`. */
const MAX_FAILED = 100;

// ── Low-level persistence ─────────────────────────────────────────────────────

function readQueue(): MutationQueueItem[] {
  const raw = storage.getString(QUEUE_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as MutationQueueItem[]; } catch { return []; }
}

function writeQueue(q: MutationQueueItem[]): void {
  storage.set(QUEUE_KEY, JSON.stringify(q));
}

export function getQueueCount(): number {
  return readQueue().length;
}

export function clearQueue(): void {
  writeQueue([]);
}

/**
 * Every pending item, in replay order.
 *
 * Read-only by contract — mutating what this returns does not touch MMKV.
 * It exists so a screen (and the suite) can see the key an item will send
 * without having to intercept a request. `punchQueue.getQueuedPunches` is the
 * same affordance one queue over.
 */
export function getQueuedMutations(): MutationQueueItem[] {
  return readQueue();
}

/**
 * Count plus the age of the oldest item.
 *
 * The reference banner reads `Offline. 3 changes queued · oldest 12 min`
 * (`Mobile.jsx:82`) — the age is half of it, and the build was showing only the
 * count. The difference matters on this product specifically: attendance has a
 * 72-hour ceiling, so "how long has this been waiting" is the number that says
 * whether anything is at risk. A count alone is the same message on minute one
 * and hour seventy-one.
 */
export interface QueueSummary {
  count: number;
  /** ISO timestamp of the oldest queued write, or null when the queue is empty. */
  oldestAt: string | null;
}

export function getQueueSummary(): QueueSummary {
  const q = readQueue();
  if (q.length === 0) return { count: 0, oldestAt: null };
  // Enqueue order is replay order, so the head IS the oldest — but a squash
  // rewrites an entry in place and keeps the original `created_at`, so reducing
  // is correct where `q[0]` would only usually be.
  let oldest = q[0].created_at;
  for (const item of q) {
    if (new Date(item.created_at).getTime() < new Date(oldest).getTime()) oldest = item.created_at;
  }
  return { count: q.length, oldestAt: oldest };
}

/**
 * Which records of a given kind have an unsent write against them.
 *
 * This is what lets a task row render its own pending state instead of the app
 * asserting it globally in a banner. §7.1: never lie about state — a row showing
 * `done` with nothing else on it claims the server agreed, and until this
 * returns empty for that id, it has not.
 */
export function queuedEntityIds(entityType: string): Set<string> {
  const ids = new Set<string>();
  for (const item of readQueue()) {
    if (item.entity_type === entityType && item.entity_id) ids.add(item.entity_id);
  }
  return ids;
}

// ── The dead letter ───────────────────────────────────────────────────────────

function readFailed(): FailedMutation[] {
  const raw = storage.getString(FAILED_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as FailedMutation[]; } catch { return []; }
}

function writeFailed(f: FailedMutation[]): void {
  storage.set(FAILED_KEY, JSON.stringify(f));
}

/**
 * Writes that will never be sent, newest last. Survives a restart.
 *
 * NOT the same store as the live queue, and `clearQueue()` does not touch it —
 * "clear my pending edits" and "forget what failed" are two different things a
 * user might mean, and collapsing them loses the second one silently.
 */
export function getFailedMutations(): FailedMutation[] {
  return readFailed();
}

export function getFailedCount(): number {
  return readFailed().length;
}

/** Drop one dead-letter entry, by its item id. For a UI's dismiss control. */
export function discardFailedMutation(id: string): void {
  writeFailed(readFailed().filter(f => f.item.id !== id));
}

export function clearFailedMutations(): void {
  writeFailed([]);
}

/**
 * Can this dead-letter entry meaningfully be sent again?
 *
 * NOT `reason !== 'expired'`, and the difference is the whole reason this is a
 * function. `expired` is how an item ARRIVED here; the six-day ceiling is a
 * property of the item's age, which keeps advancing after it arrives. An
 * `exhausted` create that failed on day two and is looked at on day seven is
 * exactly as unsendable as one the ceiling caught directly, and offering it a
 * Retry button would be offering the unprotected replay `CREATE_MAX_AGE_MS`
 * exists to prevent — the item would be requeued, refused at the next flush,
 * and land straight back here, having taught the user that Retry does nothing.
 *
 * A PATCH, PUT or DELETE is always retryable however old it is. Re-sending one
 * overwrites a field with what its author asked for; only creation duplicates.
 *
 * The screen and `retryFailedMutation` both ask THIS, so the button and the
 * store can never disagree about what is possible.
 */
export function canRetryFailed(entry: FailedMutation, now: number = Date.now()): boolean {
  return !isExpiredCreate(entry.item, now);
}

/** What `retryFailedMutation` did. Distinguishable so the UI can say which. */
export type RetryOutcome =
  /** Back in the live queue; it will go out on the next flush. */
  | 'queued'
  /** No entry with that id — already retried or discarded on another screen. */
  | 'not-found'
  /** A create past the six-day ceiling. Refused rather than silently re-failed. */
  | 'expired-create';

/**
 * Move one dead-letter entry back into the live queue.
 *
 * ── What is preserved, and why each one matters ──────────────────────────────
 *
 * `idempotency_key` — UNCHANGED. This is the same rule the file header states
 * for retries, and a user-initiated retry is still a retry. The earlier attempt
 * may have reached the server and succeeded with only its response lost; the
 * whole point of the key is that the replay is then recognised instead of making
 * a second row. Minting a fresh one here would be the duplicate bug, reintroduced
 * behind a button.
 *
 * `created_at` — UNCHANGED. It is what the six-day ceiling is measured from.
 * Resetting it to now would make every expired create retryable by pressing a
 * button, which is the ceiling deleted rather than the ceiling respected.
 *
 * `retries` — RESET TO 0. The person asked for this explicitly, so it gets a
 * full round of attempts rather than immediately re-exhausting on the one
 * attempt it had left. This is the only field that changes.
 *
 * ── Order of writes ──────────────────────────────────────────────────────────
 *
 * Queue first, dead letter second. A crash between the two leaves the item in
 * BOTH stores: it sends normally and a stale entry is left on this screen for
 * the user to discard. The other order would lose the payload outright if the
 * process died in the gap, and this is the last copy of it.
 */
export function retryFailedMutation(id: string, now: number = Date.now()): RetryOutcome {
  const failed = readFailed();
  const entry = failed.find(f => f.item.id === id);
  if (!entry) return 'not-found';

  if (!canRetryFailed(entry, now)) return 'expired-create';

  const q = readQueue();
  // A double tap, or the same entry retried from two screens, must not enqueue
  // the write twice — two POSTs sharing one key is a 409 at best and a second
  // row until migration 186 is applied.
  if (!q.some(i => i.id === entry.item.id)) {
    q.push({ ...entry.item, retries: 0 });
    writeQueue(q);
  }

  writeFailed(readFailed().filter(f => f.item.id !== id));
  return 'queued';
}

function recordFailure(
  item:   MutationQueueItem,
  error:  string,
  reason: FailedMutation['reason'],
): void {
  const f = readFailed();
  f.push({ item, error, failed_at: new Date().toISOString(), reason });
  // MMKV is a bounded store on a phone, so this cannot grow for ever. A device
  // holding a hundred writes that will never send has a problem this cap is not
  // the cause of; the oldest go first because the newest are the ones the user
  // still remembers making.
  writeFailed(f.length > MAX_FAILED ? f.slice(f.length - MAX_FAILED) : f);
}

// ── Enqueue ───────────────────────────────────────────────────────────────────

export interface EnqueueOptions {
  method:        'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url:           string;
  body?:         unknown;
  optimistic_id?: string;  // dedup key: re-enqueue with same id replaces in-place
  entity_type?:  string;   // e.g. 'task', 'comment' — used for squashing
  entity_id?:    string;   // e.g. the task_id
  /** Keys to strip from body before persisting (e.g. passwords, tokens) */
  stripFields?:  string[];
  /**
   * Supply the idempotency key rather than letting the queue mint one.
   *
   * The one caller that needs this is `useOfflineMutation`, which mints a key
   * per user intent so that the SAME key is used whether the mutation goes out
   * online or falls back into this queue. A create that half-succeeded online
   * and is then queued must not arrive under a second identity.
   */
  idempotency_key?: string;
}

/**
 * A fresh key. UUIDv4 from `expo-crypto`, which is the platform CSPRNG.
 *
 * Opaque to the server by design (migration 186 refuses to parse it), so the
 * only properties that matter are: unguessable, unique, and stable once
 * written.
 */
export function newIdempotencyKey(): string {
  return Crypto.randomUUID();
}

/**
 * The key an item should carry once its body has been replaced.
 *
 * A create keeps its key unconditionally — re-keying a POST is how one create
 * becomes two, and no amount of body revision changes that. Everything else
 * takes a fresh key when the body actually differs, because the old key may
 * already be bound server-side to the old bytes and would be refused with 422.
 */
function keyAfterBodyChange(item: MutationQueueItem, nextBody: unknown): string | undefined {
  if (item.method === 'POST') return item.idempotency_key;
  const unchanged = JSON.stringify(item.body) === JSON.stringify(nextBody);
  return unchanged ? item.idempotency_key : newIdempotencyKey();
}

function scrubBody(body: unknown, stripFields?: string[]): unknown {
  if (!stripFields || !stripFields.length) return body;
  if (typeof body !== 'object' || body === null) return body;
  const scrubbed = { ...(body as Record<string, unknown>) };
  for (const key of stripFields) delete scrubbed[key];
  return scrubbed;
}

export function enqueueMutation(opts: EnqueueOptions): string {
  const q = readQueue();

  const id = opts.optimistic_id ?? Crypto.randomUUID();

  const safeBody = scrubBody(opts.body, opts.stripFields);

  // Dedup: if optimistic_id already exists replace it (update overrides update).
  //
  // This is the EXPLICIT collapse — the caller opted in by handing over a
  // stable id whose documented meaning is "this is the same logical write". It
  // is therefore allowed for a POST, where it means "the draft was revised
  // before it ever went out", and the key is carried over so the revision
  // cannot become a second create.
  //
  // It only fires when the METHOD AND URL also match. An optimistic_id that
  // collides across two different endpoints is a caller bug, and merging a
  // POST body into a queued DELETE would turn that bug into a wrong request;
  // falling through and queueing both is worse for nobody.
  if (opts.optimistic_id) {
    const idx = q.findIndex(i => i.optimistic_id === opts.optimistic_id);
    if (idx !== -1 && q[idx].method === opts.method && q[idx].url === opts.url) {
      q[idx] = {
        ...q[idx],
        body: safeBody,
        idempotency_key: keyAfterBodyChange(q[idx], safeBody),
      };
      writeQueue(q);
      return id;
    }
  }

  // Squash: for PATCH/PUT, merge body into the last matching entry.
  //
  // THIS IS THE IMPLICIT COLLAPSE — nobody asked for it; it happens because two
  // writes share a URL. That is why it is confined to PATCH and PUT, which are
  // idempotent by URL and where merging two field updates loses nothing.
  //
  // IT MUST NEVER TOUCH A POST. Two POSTs to `/tasks` are two different tasks
  // that happen to share an endpoint, and collapsing them destroys one of them
  // with no trace — the user typed two things and one silently never existed.
  // The same holds for DELETE, where the URL is the resource: two DELETEs to
  // one URL are already a single effect, and merging bodies there means nothing.
  //
  // Use a backward loop (findLastIndex is ES2023 and may not exist on Hermes).
  if (opts.method === 'PATCH' || opts.method === 'PUT') {
    let lastIdx = -1;
    for (let i = q.length - 1; i >= 0; i--) {
      if (q[i].url === opts.url && q[i].method === opts.method) { lastIdx = i; break; }
    }
    if (lastIdx !== -1) {
      const merged = typeof q[lastIdx].body === 'object' && typeof safeBody === 'object'
        ? { ...(q[lastIdx].body as object), ...(safeBody as object) }
        : safeBody;
      q[lastIdx] = {
        ...q[lastIdx],
        body: merged,
        idempotency_key: keyAfterBodyChange(q[lastIdx], merged),
      };
      writeQueue(q);
      return q[lastIdx].id;
    }
  }

  const item: MutationQueueItem = {
    id,
    method:        opts.method,
    url:           opts.url,
    body:          safeBody,
    optimistic_id: opts.optimistic_id,
    // Both of these were being accepted and discarded, which is why nothing in
    // the app could ask "is this task still queued?". See MutationQueueItem.
    entity_type:   opts.entity_type,
    entity_id:     opts.entity_id,
    created_at:    new Date().toISOString(),
    retries:       0,
    // Once, here, and never again for the life of this item.
    idempotency_key: opts.idempotency_key ?? newIdempotencyKey(),
  };

  q.push(item);
  writeQueue(q);
  return id;
}

// ── Flush ─────────────────────────────────────────────────────────────────────

export interface FailedItem {
  item:        MutationQueueItem;
  error:       string;
  permanent:   boolean;   // true = moved to the dead letter, false = will retry next flush
  /** Why it was given up on. Only meaningful when `permanent` is true. */
  reason?:     FailedMutation['reason'];
}

export interface FlushResult {
  succeeded:   number;
  failed:      FailedItem[];
}

/**
 * Give a key to any item written by a build that predates this field.
 *
 * Done ONCE, before the first dispatch of a flush, and persisted immediately —
 * minting lazily at read time would hand out a different key on every read,
 * which is worse than having none. Returns the normalised queue.
 *
 * Legacy items are PATCH and DELETE only (a create could not be queued before
 * this change existed), so nothing here was ever at risk of duplication; the
 * backfill is so that the rest of the file has one shape to reason about.
 */
function normaliseKeys(q: MutationQueueItem[]): MutationQueueItem[] {
  let changed = false;
  const out = q.map(item => {
    if (item.idempotency_key) return item;
    changed = true;
    return { ...item, idempotency_key: newIdempotencyKey() };
  });
  if (changed) writeQueue(out);
  return out;
}

/** True when a create has aged past the point where its key is still honoured. */
function isExpiredCreate(item: MutationQueueItem, now: number): boolean {
  if (item.method !== 'POST') return false;
  const created = new Date(item.created_at).getTime();
  // An unparseable timestamp is a bug in whatever wrote it, and dropping a
  // user's work over one would be the wrong way round. Treat it as fresh.
  if (!Number.isFinite(created)) return false;
  return now - created > CREATE_MAX_AGE_MS;
}

export async function flushQueue(): Promise<FlushResult> {
  const q = normaliseKeys(readQueue());
  if (q.length === 0) return { succeeded: 0, failed: [] };

  const result: FlushResult = { succeeded: 0, failed: [] };
  const remaining: MutationQueueItem[] = [];
  const now = Date.now();

  for (const item of q) {
    // Checked BEFORE dispatch, never after: the whole point is not to send it.
    // Sending and hoping is exactly the unprotected replay this guards.
    if (isExpiredCreate(item, now)) {
      recordFailure(item, EXPIRED_MESSAGE, 'expired');
      result.failed.push({ item, error: EXPIRED_MESSAGE, permanent: true, reason: 'expired' });
      continue;
    }

    try {
      await dispatch(item);
      result.succeeded += 1;
      // Do NOT push to remaining — success removes from queue
    } catch (err: any) {
      const status     = err?.response?.status;
      const msg        = err?.friendlyMessage ?? err?.message ?? 'Unknown error';
      const newRetries = (item.retries ?? 0) + 1;

      // 4xx (except 429 rate-limit) = permanent client error, give up
      const isPermanent = status && status >= 400 && status < 500 && status !== 429;

      if (isPermanent || newRetries > MAX_RETRIES) {
        const reason: FailedMutation['reason'] = isPermanent ? 'rejected' : 'exhausted';
        // MOVED, not deleted. The payload is the only copy of what the user
        // typed, and for a create there is nothing on screen to re-read it from.
        recordFailure(item, msg, reason);
        result.failed.push({ item, error: msg, permanent: true, reason });
      } else {
        result.failed.push({ item, error: msg, permanent: false });
        // The spread preserves `idempotency_key`. That is the whole mechanism:
        // attempt two presents the same key attempt one did, so a create the
        // server already accepted comes back as a replay instead of a second row.
        remaining.push({ ...item, retries: newRetries });
      }
    }
  }

  writeQueue(remaining);
  return result;
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

/** The axios config a queued item goes out with. */
export interface QueuedRequestConfig {
  headers: Record<string, string>;
}

/**
 * Pure: the request configuration for one queued item.
 *
 * Split out from `dispatch` so the header can be asserted without a transport.
 * A legacy item with no key sends NO header rather than an empty one — an
 * empty `Idempotency-Key` is a value the server would have to have an opinion
 * about, and migration 186's CHECK refuses it anyway.
 */
export function requestConfigFor(item: MutationQueueItem): QueuedRequestConfig {
  return {
    headers: item.idempotency_key
      ? { [IDEMPOTENCY_HEADER]: item.idempotency_key }
      : {},
  };
}

async function dispatch(item: MutationQueueItem): Promise<void> {
  const { method, url, body } = item;
  const config = requestConfigFor(item);
  switch (method.toUpperCase()) {
    case 'POST':   await apiClient.post(url, body, config);   break;
    case 'PUT':    await apiClient.put(url, body, config);    break;
    case 'PATCH':  await apiClient.patch(url, body, config);  break;
    case 'DELETE': await apiClient.delete(url, config);       break;
    default: throw new Error(`Unknown method: ${method}`);
  }
}

// ── Friendly error messages ───────────────────────────────────────────────────

export function friendlyFlushError(error: string): string {
  // Already a sentence written for the user. Passed through first so that the
  // matchers below cannot shred it — it contains the word "safely", and one
  // careless future pattern would turn a precise explanation into "Can't reach
  // the server."
  if (error === EXPIRED_MESSAGE)         return EXPIRED_MESSAGE;
  if (/too large|size/i.test(error))     return 'A file is too large (max 5 MB).';
  if (/5 file|max.*file/i.test(error))   return 'Only 5 files per task are allowed.';
  if (/unsupported|format/i.test(error)) return 'One file has an unsupported format.';
  if (/network|connection/i.test(error)) return "Can't reach the server.";
  if (/session|401/i.test(error))        return 'Session expired — please sign in again.';
  if (/permission|403/i.test(error))     return "You don't have permission to do that.";
  if (/not found|404/i.test(error))      return 'That item no longer exists.';
  return error;
}
