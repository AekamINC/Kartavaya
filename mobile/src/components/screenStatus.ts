/**
 * screenStatus.ts — the screen-state DECISION, with no React Native in it.
 *
 * Split out of `ScreenState.tsx` for one reason: this is the primitive every
 * module screen renders through, and it had no test, because `ScreenState.tsx`
 * imports `react-native` and `@expo/vector-icons` at module scope and so cannot
 * be loaded outside a bundler. `mobile/` has no test runner and no test file at
 * all; a pure module can be exercised by `node --test` with nothing installed.
 * `ScreenState.tsx` re-exports everything here, so no caller changes.
 *
 * Erasable syntax only (no `enum`, no parameter properties) — Node strips the
 * types at load time rather than compiling them.
 */

/**
 * The four states every fetched screen has, plus the three this product needs.
 *
 * `offline` is first-class rather than a flavour of error: an Indian site
 * office or a client's basement meeting room is a normal place to open this
 * app, and "check your connection" is a different instruction from "try again".
 *
 * `forbidden` exists because `require_module(code)` raises 403 both when the
 * org has not subscribed to a module and when the user holds no grant for it.
 * On a module surface that is not an error, it is the answer.
 *
 * `request` is the seventh, and it is the same distinction the web made in
 * `errorKind` (`components/ui/ErrorState.jsx:33`): a 4xx is a statement about
 * the REQUEST, not about the server. Without it, every 400, 404, 409, 410, 422
 * and 429 fell through to `error` and told the user "Something went wrong on
 * our end. Pull down or tap retry" — which blames us for something we did not
 * do, and sends them to pull-to-refresh a request that will be refused
 * identically every time. On mobile that is the worse half of the bargain: the
 * web at least shows a page the user can back out of, while a module screen
 * with a doomed retry affordance is the whole screen.
 */
export type ScreenStatus =
  | 'loading'
  | 'offline'
  | 'forbidden'
  | 'request'
  | 'error'
  | 'empty'
  | 'ready';

export interface ResolveArgs {
  isLoading: boolean;
  isError:   boolean;
  error?:    unknown;
  online:    boolean;
  /** True when the query has usable data — including data restored from cache. */
  hasData:   boolean;
  /** True when the query succeeded but returned nothing to show. */
  isEmpty?:  boolean;
}

/** HTTP status off an axios error, if this was one. */
export function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | undefined)?.response?.status;
}

/**
 * A 4xx that is the request's fault rather than ours — and is not the 403 that
 * `forbidden` already answers better.
 *
 * 401 is included deliberately but imperfectly. It is a 4xx, so "that request
 * wasn't accepted" is truer than "something broke on our end" — but what it
 * really means is that the session ended, and this primitive has no state for
 * that. `api/client.ts:43` already writes the right sentence onto the error as
 * `friendlyMessage`; a screen that wants it can pass it through `ScreenState`'s
 * `title`/`body`. A dedicated `expired` state, with a route to sign-in, is the
 * follow-up — it needs a navigation decision, not a copy change.
 */
export function isRequestFault(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500 && status !== 403;
}

/**
 * Decide what a screen should render.
 *
 * Order matters and is deliberate:
 *
 *  1. Data wins over everything. A persisted cache is why this app is usable on
 *     a train, and blanking it to show an error would throw away the one thing
 *     offline support bought.
 *  2. `forbidden` beats `offline`, because a 403 is a real answer that arrived —
 *     the request reached the server. Losing the connection afterwards does not
 *     make the answer less true.
 *  3. `request` sits with `forbidden`, above `offline`, for exactly that reason:
 *     a 422 also arrived. Reporting it as `offline` would tell someone with no
 *     signal to find some, when the server has already answered and will answer
 *     the same way on the best connection they ever get.
 *  4. `offline` beats `error`, because with no connection the error is a symptom
 *     rather than a cause, and the actionable instruction is the connection one.
 */
export function resolveScreenState(a: ResolveArgs): ScreenStatus {
  if (a.hasData) return a.isEmpty ? 'empty' : 'ready';
  if (a.isError && statusOf(a.error) === 403) return 'forbidden';
  if (a.isError && isRequestFault(statusOf(a.error))) return 'request';
  if (a.isLoading) return 'loading';
  if (!a.online) return 'offline';
  if (a.isError) return 'error';
  return a.isEmpty ? 'empty' : 'ready';
}
