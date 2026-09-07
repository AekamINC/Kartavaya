import { useCallback } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';

/**
 * The allow-list guard, exported because it is the CONTRACT and the hook around
 * it cannot be reached from the test suite — `src/test/register.mjs` does not
 * render, by design, so nothing here can call a hook.
 *
 * It is also the half that faces hostile input. A deep link is typed by whoever
 * sends it: `getStateFromPath('approvals/nonsense')` resolves happily and hands
 * the screen `{ tab: 'nonsense' }` — measured, not assumed — so this function is
 * the only thing between that and a screen rendering no panel at all.
 */
export function resolveTab<T extends string>(
  raw: unknown,
  values: readonly T[],
  fallback: T,
): T {
  return values.includes(raw as T) ? (raw as T) : fallback;
}

/**
 * useRouteTab — which tab a screen is showing, kept in the ROUTE rather than in
 * component state.
 *
 * ── WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ──────────────────────────
 *
 * The web app spent 2026-09-07 moving three things out of `useState` and into
 * the URL — `?tab=` (which module section), `?open=` (which record is open) and
 * `?view=` (which shape the content is in) — because a screen with no address
 * cannot be opened in a second browser tab, sent to a colleague, or survive a
 * refresh. The owner asked for "the same" here.
 *
 * ⚠ IT IS NOT THE SAME, and pretending otherwise would build the wrong thing.
 * React Native has no browser: no second tab, no href, no ctrl-click, and this
 * app does not restore navigation state on a cold start either, so "survives a
 * refresh" buys nothing. Exactly ONE of the web's payoffs survives the crossing,
 * and it is the one that matters most on a phone:
 *
 *     A PUSH NOTIFICATION CAN LAND ON THE RIGHT TAB.
 *
 * "A leave request needs approving" should open Approvals on Pending, not on
 * whatever the screen happens to default to, leaving the reader to find it.
 * That is what a route param buys and component state cannot.
 *
 * ── WHY `setParams` AND NOT A NAVIGATE ─────────────────────────────────────
 *
 * `setParams` rewrites the CURRENT route's params in place. It pushes nothing,
 * so the Android hardware Back button still leaves the screen rather than
 * walking backwards through every tab the reader looked at. That is the same
 * conclusion the web reached for its view strips — `hooks/useUrlView.js` there
 * replaces rather than pushes, for the same reason — and here it is the default
 * behaviour rather than something to ask for.
 *
 * ── `values` IS AN ALLOW-LIST, NOT DECORATION ──────────────────────────────
 *
 * A deep link is user input: `kartavaya://approvals/nonsense` must open the
 * default tab, not an empty screen and not whatever the string happens to
 * match. `linking.ts` is only loosely type-checked (see its header), so nothing
 * upstream of this guarantees the value is one of the ones the screen knows.
 */
export function useRouteTab<T extends string>(
  param: string,
  values: readonly T[],
  fallback: T,
): readonly [T, (next: T) => void] {
  const nav = useNavigation();
  const route = useRoute();

  const raw = (route.params as Record<string, unknown> | undefined)?.[param];
  const value = resolveTab(raw, values, fallback);

  const select = useCallback(
    (next: T) => {
      // `as never` only to satisfy the untyped-navigator signature: `useRoute`
      // here is the generic one, so TypeScript cannot know this screen's param
      // list. The screen's own ParamList is what actually types the value, and
      // `values` is what checks it at runtime.
      nav.setParams({ [param]: next } as never);
    },
    [nav, param],
  );

  return [value, select] as const;
}

export default useRouteTab;
