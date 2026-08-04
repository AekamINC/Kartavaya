import { QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query';
import type { Query } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';
import { storage } from '../lib/storage';

// MMKV-backed storage adapter for TanStack Query persistence
const mmkvStorageAdapter = {
  setItem:    (key: string, value: string) => { storage.set(key, value); },
  getItem:    (key: string): string | null => storage.getString(key) ?? null,
  removeItem: (key: string) => { storage.delete(key); },
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:         60_000,          // 1 min — don't refetch if fresh
      gcTime:            1000 * 60 * 60 * 2,  // 2h cache — keeps MMKV write size small
      retry:             2,
      refetchOnWindowFocus: false,        // mobile: refetch on app-foreground instead
    },
    mutations: {
      retry: 0,
    },
  },
});

export const persister = createSyncStoragePersister({
  storage: mmkvStorageAdapter,
  key:     'rq_cache',
  throttleTime: 1000,
});

/**
 * Query keys that must never touch MMKV.
 *
 * The persister serialises the ENTIRE cache to one MMKV string on a 1-second
 * throttle. `['messaging','live']` polls every four seconds, so leaving it in
 * means a full `JSON.stringify` of every task, project and message this device
 * has ever seen, roughly once a second, on the JS thread, forever.
 *
 * `search` and `directory` are keyed on a debounced query string: each keystroke
 * would mint its own cache entry, get written to disk, and be held for the full
 * two-hour maxAge. None of the three is worth anything after a cold start
 * anyway — a live poll, a search and an @-autocomplete are all re-fetched the
 * moment the screen that needs them opens.
 */
const EPHEMERAL = new Set(['live', 'search', 'directory']);

export const shouldDehydrateQuery = (q: Query): boolean => {
  const k = q.queryKey as unknown[];
  if (k[0] === 'messaging' && typeof k[1] === 'string' && EPHEMERAL.has(k[1])) return false;
  return defaultShouldDehydrateQuery(q);
};

/**
 * Folded into `persistOptions` below rather than passed at each call site. There
 * are TWO persistence paths and both run — `setupQueryPersistence()` here and
 * the `persistOptions` prop on `PersistQueryClientProvider` in App.tsx — and a
 * filter applied to one but not the other leaves the hole open. The symptom of
 * missing it is a phone writing megabytes to flash every second, which no build
 * log shows.
 */
export const dehydrateOptions = { shouldDehydrateQuery };

/**
 * A stamp on the SHAPE of the persisted cache. Not the app version — it was
 * spelled `'2.0.0'` here, which read as one and so got left behind when App.tsx
 * grew its own persistence path and passed no buster at all.
 *
 * That is not a cosmetic mismatch. `persistQueryClientRestore` busts on
 * `persisted.buster !== buster`, both paths restore from the SAME MMKV key
 * (`rq_cache`), and the library's default buster is `''` — so on every launch
 * one path read the other's stamp, called `removeClient()`, and the offline
 * cache this whole module exists to keep was empty before the first screen
 * mounted. It had never survived a launch.
 *
 * Bumped past both of the old values on purpose rather than settling on
 * `'2.0.0'`: whatever is sitting in `rq_cache` right now was written by a build
 * where `['messaging','messages',id]` held a bare `Message[]`, and this build
 * reads that key as an infinite query's `{pages, pageParams}`. ChatScreen
 * guards the mismatch at render, but the first launch after this change is the
 * first launch where a restore actually lands, so it discards once and starts
 * clean instead of relying on that guard.
 */
const CACHE_BUSTER = 'rq-cache-v3';

/**
 * The single source for both persistence paths — spread into `persistQueryClient`
 * below and handed whole to `PersistQueryClientProvider` in App.tsx. Neither
 * call site builds an options literal of its own, because the last two that did
 * disagreed.
 *
 * `buster` and `maxAge` are REQUIRED here, which the library's own type does not
 * make them. Both are optional on `PersistQueryClientOptions` and both silently
 * default — `buster` to `''` and `maxAge` to 24 hours — so an options object
 * that has lost one still compiles, still runs, and is wrong in a way no build
 * log shows. Deleting either line is now a typecheck failure.
 *
 * `maxAge` had drifted too, and just as quietly: this path passed 2h, App.tsx
 * passed nothing and took the 24h default. On a device where the restore had
 * won, that arm would have hydrated rows twelve hours past the `gcTime` the
 * cache is configured for.
 */
export const persistOptions:
  Omit<PersistQueryClientOptions, 'queryClient' | 'buster' | 'maxAge'>
  & Required<Pick<PersistQueryClientOptions, 'buster' | 'maxAge'>> = {
  persister,
  maxAge: 1000 * 60 * 60 * 2,    // 2h — matches gcTime
  buster: CACHE_BUSTER,
  dehydrateOptions,
};

export function setupQueryPersistence() {
  persistQueryClient({ queryClient, ...persistOptions });
}
