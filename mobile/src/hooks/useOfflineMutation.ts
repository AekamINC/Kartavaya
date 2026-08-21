/**
 * useOfflineMutation
 * ──────────────────
 * Drop-in wrapper around TanStack Query's `useMutation` that falls back to
 * the MMKV offline queue when the device has no internet.
 *
 * Guarantees:
 *   1. When online  → normal mutation (server response, cache invalidation)
 *   2. When offline → enqueueMutation + optimistic cache update
 *   3. On reconnect → App.tsx flushQueue() replays in order
 *
 * ── CREATES ──────────────────────────────────────────────────────────────────
 *
 * `method: 'POST'` is queueable as of the idempotency work. Every item the
 * queue holds now carries a stable `Idempotency-Key` generated once at enqueue
 * and never regenerated, so a retried create cannot make a second row — see the
 * header of `offline/mutationQueue.ts` for the whole mechanism and for what the
 * server still owes before the key means anything.
 *
 * Two things a create needs that an update does not:
 *
 *  · NO ID EXISTS YET, so nothing may PATCH the record until the create has
 *    landed. `queuedEntityIds()` is how a screen finds out. There is no id
 *    remapping in the queue and adding one is a feature, not a flag.
 *  · IF YOU WANT ONE KEY ACROSS BOTH PATHS, supply `idempotencyKey`. The queue
 *    mints its own when you do not, which is right for a write that only ever
 *    goes out through the queue and wrong for one that may be attempted online
 *    first — see `fallbackToQueue`.
 *
 * Usage:
 *   const { mutate, isQueued } = useOfflineMutation({
 *     method:      'PATCH',
 *     urlBuilder:  (vars) => `/tasks/${vars.taskId}`,
 *     mutationFn:  (vars) => tasksApi.update(vars.taskId, vars.patch),
 *     onlineOptions: {
 *       onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
 *     },
 *     optimisticUpdate: (vars, qc) => {
 *       qc.setQueryData(['task', vars.taskId], (old) => old ? { ...old, ...vars.patch } : old);
 *     },
 *     rollback: (vars, snapshot, qc) => {
 *       if (snapshot) qc.setQueryData(['task', vars.taskId], snapshot);
 *     },
 *     snapshotKey: (vars) => ['task', vars.taskId],
 *     optimisticId: (vars) => `task_${vars.taskId}_status`,
 *   });
 */

import { useRef } from 'react';
import { useMutation, useQueryClient, type UseMutationOptions, type QueryClient } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { enqueueMutation, type EnqueueOptions } from '../offline/mutationQueue';

// ─────────────────────────────────────────────────────────────────────────────

export interface OfflineMutationOptions<TVariables, TData = unknown, TSnapshot = unknown> {
  /** HTTP method for the queue */
  method:       EnqueueOptions['method'];
  /** Build the URL from variables (used when queueing offline) */
  urlBuilder:   (vars: TVariables) => string;
  /** The actual async mutation function (online path) */
  mutationFn:   (vars: TVariables) => Promise<TData>;
  /** Optional TanStack mutation options (onSuccess, onError, etc.) for the online path */
  onlineOptions?: Omit<UseMutationOptions<TData, Error, TVariables>, 'mutationFn'>;
  /**
   * Apply optimistic update to the cache immediately (both online + offline).
   * Called before the request fires. Return value is ignored.
   */
  optimisticUpdate?: (vars: TVariables, qc: QueryClient) => void;
  /**
   * Roll back the optimistic update when an online mutation fails.
   * Snapshot (captured before optimisticUpdate) is passed in.
   */
  rollback?: (vars: TVariables, snapshot: TSnapshot | undefined, qc: QueryClient) => void;
  /**
   * Query key to snapshot before optimistic update (for rollback).
   * Only used on the online path.
   */
  snapshotKey?: (vars: TVariables) => readonly unknown[];
  /**
   * Build a stable dedup key for the queue (prevents duplicate enqueues).
   * Example: (vars) => `task_${vars.taskId}_patch`
   */
  optimisticId?: (vars: TVariables) => string;
  /** Body builder for offline queue (defaults to vars) */
  bodyBuilder?: (vars: TVariables) => unknown;
  /** Entity type for squash logic */
  entity_type?: string;
  /** Entity id for squash logic */
  entityId?: (vars: TVariables) => string;
  /**
   * Supply the `Idempotency-Key` instead of letting the queue mint one.
   *
   * Needed by exactly one caller shape: a mutation that is ATTEMPTED ONLINE and
   * may then be queued. The online attempt and the queued replay have to
   * present the SAME key, or the replay is a stranger to the server and a
   * create that already succeeded becomes a second row. So the caller mints the
   * key, sends it as the `Idempotency-Key` header from its own `mutationFn`,
   * and hands the same value here.
   *
   * Must be STABLE for a given `vars` — deriving it from a draft id is right,
   * `() => randomUUID()` is not, because it is called once per attempt.
   *
   * Omit it for a queue-only write. `enqueueMutation` mints one and that is
   * both sufficient and simpler.
   */
  idempotencyKey?: (vars: TVariables) => string;
  /**
   * On a TRANSPORT failure of the online attempt, queue the write instead of
   * surfacing an error. Default false — no existing caller changes behaviour.
   *
   * "Transport failure" means the request produced no HTTP response at all: a
   * timeout, a dropped connection, DNS. If the server answered — any status,
   * including 500 — it is NOT queued, because the server has an opinion and
   * replaying against it is the queue's job only when the queue was the one
   * that sent it.
   *
   * WHY IT IS OPT-IN AND WHY POST REFUSES IT WITHOUT A KEY. `NetInfo` said
   * online, so the request may have REACHED the server and succeeded with only
   * its response lost. Queueing an unkeyed create in that state is the exact
   * duplicate this whole change exists to remove — it would be a second POST
   * the server has no way to recognise. With `idempotencyKey` supplied and sent
   * on the online attempt too, the queued replay presents a key the server has
   * already seen and comes back as a replay. Without it, `mutateAsync` throws
   * rather than quietly creating the conditions for a duplicate.
   */
  fallbackToQueue?: boolean;
}

export interface OfflineMutationResult<TVariables> {
  mutate:      (vars: TVariables) => void;
  mutateAsync: (vars: TVariables) => Promise<void>;
  isQueued:    boolean;       // true if last call was enqueued offline
  isPending:   boolean;
  isError:     boolean;
  error:       Error | null;
  reset:       () => void;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * React hook that wraps a TanStack mutation with offline-queue fallback.
 * When the device is online the mutation fires normally; when offline the
 * payload is enqueued in MMKV and an optimistic cache update is applied.
 */
export function useOfflineMutation<TVariables, TData = unknown, TSnapshot = unknown>(
  opts: OfflineMutationOptions<TVariables, TData, TSnapshot>
): OfflineMutationResult<TVariables> {
  const qc = useQueryClient();
  const isQueuedRef = useRef(false);

  const mutation = useMutation<TData, Error, TVariables, TSnapshot | undefined>({
    mutationFn: opts.mutationFn,
    // Cast callbacks as `any` — TQ v5.51's MutationFunctionContext context type
    // doesn't align with older generic signatures under TS 5.3.3 strict mode.
    onMutate: (async (vars: TVariables) => {
      if (opts.snapshotKey) {
        const key = opts.snapshotKey(vars);
        await qc.cancelQueries({ queryKey: key });
        const snapshot = qc.getQueryData<TSnapshot>(key);
        opts.optimisticUpdate?.(vars, qc);
        return snapshot;
      }
      opts.optimisticUpdate?.(vars, qc);
      return undefined;
    }) as any,
    onError: ((err: Error, vars: TVariables, snapshot: TSnapshot | undefined) => {
      opts.rollback?.(vars, snapshot, qc);
      (opts.onlineOptions?.onError as any)?.(err, vars, snapshot);
    }) as any,
    onSuccess: ((data: TData, vars: TVariables, ctx: TSnapshot | undefined) => {
      (opts.onlineOptions?.onSuccess as any)?.(data, vars, ctx);
    }) as any,
    onSettled: ((data: TData | undefined, err: Error | null, vars: TVariables, ctx: TSnapshot | undefined) => {
      (opts.onlineOptions?.onSettled as any)?.(data, err, vars, ctx);
    }) as any,
    ...opts.onlineOptions,
  });

  /** Build the queue entry for `vars`. Identical on both paths into the queue. */
  const queueIt = (vars: TVariables): void => {
    enqueueMutation({
      method:        opts.method,
      url:           opts.urlBuilder(vars),
      body:          opts.bodyBuilder ? opts.bodyBuilder(vars) : (vars as unknown),
      optimistic_id: opts.optimisticId?.(vars),
      entity_type:   opts.entity_type,
      entity_id:     opts.entityId?.(vars),
      // undefined → the queue mints its own, which is right for a write that
      // only ever goes out through the queue.
      idempotency_key: opts.idempotencyKey?.(vars),
    });
  };

  /** Fire the mutation; enqueues offline when there is no internet connection. */
  const mutateAsync = async (vars: TVariables): Promise<void> => {
    // Refused here rather than at the point of failure, so a caller finds out
    // on the first run and not on the first bad train journey. A create queued
    // after an online attempt whose outcome is unknown, with no shared key, is
    // a duplicate row waiting for a network blip.
    if (opts.fallbackToQueue && opts.method === 'POST' && !opts.idempotencyKey) {
      throw new Error(
        'useOfflineMutation: fallbackToQueue on a POST requires idempotencyKey. '
        + 'The online attempt may have succeeded with its response lost; without '
        + 'a key the queued replay creates a second record.',
      );
    }

    const state = await NetInfo.fetch();
    const online = !!(state.isConnected && state.isInternetReachable !== false);

    if (!online) {
      // Apply optimistic update immediately even in offline path
      opts.optimisticUpdate?.(vars, qc);
      queueIt(vars);
      isQueuedRef.current = true;
      return;
    }

    isQueuedRef.current = false;

    if (!opts.fallbackToQueue) {
      await mutation.mutateAsync(vars);
      return;
    }

    try {
      await mutation.mutateAsync(vars);
    } catch (err: any) {
      // A response of ANY status means the server answered and had an opinion.
      // Only a request that never got one is a candidate for the queue.
      if (err?.response) throw err;

      queueIt(vars);
      // TanStack's onError has already run `opts.rollback`, which undid the
      // optimistic update on the assumption the write was lost. It is not lost
      // — it is queued — so the optimistic state is true again and is put back.
      // Re-applying is idempotent by construction: `optimisticUpdate` writes a
      // value, it does not increment one.
      opts.optimisticUpdate?.(vars, qc);
      isQueuedRef.current = true;
    }
  };

  /** Fire-and-forget wrapper around mutateAsync (errors surface via mutation.error). */
  const mutate = (vars: TVariables): void => {
    mutateAsync(vars).catch(() => {/* errors surfaced via mutation.error */});
  };

  return {
    mutate,
    mutateAsync,
    get isQueued()  { return isQueuedRef.current; },
    get isPending() { return mutation.isPending; },
    get isError()   { return mutation.isError; },
    get error()     { return mutation.error; },
    reset:          mutation.reset,
  };
}
