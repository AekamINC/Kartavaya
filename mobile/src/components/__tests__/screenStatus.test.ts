/**
 * The first test in `mobile/`.
 *
 * There was no runner and no test file anywhere under `mobile/` — every mobile
 * claim in `swarm-reports/verify-mobile.md` is marked NOT VERIFIED for that
 * reason. This needs no runner and no new dependency: Node strips the types and
 * `node:test` runs it.
 *
 *     cd mobile && npm test          (→ node --test src/components/__tests__/)
 *
 * It covers `resolveScreenState`, which is the primitive every module screen
 * renders through, and in particular the seventh status — `request` — which is
 * why a 4xx no longer reports as "Something went wrong on our end".
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveScreenState, statusOf, isRequestFault } from '../screenStatus.ts';

/** An axios-shaped rejection. */
const httpError = (status: number) => ({ response: { status } });

const base = {
  isLoading: false,
  isError:   false,
  error:     undefined as unknown,
  online:    true,
  hasData:   false,
  isEmpty:   false,
};

const at = (over: Partial<typeof base>) => resolveScreenState({ ...base, ...over });

test('statusOf reads an axios status and tolerates anything else', () => {
  assert.equal(statusOf(httpError(422)), 422);
  assert.equal(statusOf(new Error('boom')), undefined);
  assert.equal(statusOf(undefined), undefined);
  assert.equal(statusOf(null), undefined);
  assert.equal(statusOf('not an error'), undefined);
});

test('isRequestFault is every 4xx except 403', () => {
  for (const s of [400, 401, 402, 404, 405, 409, 410, 422, 429, 499]) {
    assert.equal(isRequestFault(s), true, `${s} should be a request fault`);
  }
  // 403 has its own state, and must not be swallowed by this one.
  assert.equal(isRequestFault(403), false);
  for (const s of [200, 204, 301, 500, 502, 503, 504]) {
    assert.equal(isRequestFault(s), false, `${s} should not be a request fault`);
  }
  assert.equal(isRequestFault(undefined), false);
});

test('data wins over every failure — a persisted cache is not discarded', () => {
  assert.equal(at({ hasData: true }), 'ready');
  assert.equal(at({ hasData: true, isEmpty: true }), 'empty');
  assert.equal(at({ hasData: true, isError: true, error: httpError(500) }), 'ready');
  assert.equal(at({ hasData: true, online: false }), 'ready');
  assert.equal(at({ hasData: true, isLoading: true }), 'ready');
});

test('403 resolves to forbidden, not error', () => {
  assert.equal(at({ isError: true, error: httpError(403) }), 'forbidden');
});

test('403 beats offline — the answer arrived before the connection went', () => {
  assert.equal(at({ isError: true, error: httpError(403), online: false }), 'forbidden');
});

test('THE FIX — a 4xx is `request`, not `error`', () => {
  for (const s of [400, 404, 409, 410, 422, 429]) {
    assert.equal(
      at({ isError: true, error: httpError(s) }), 'request',
      `${s} must not be reported as a server-side error`,
    );
  }
});

test('request beats offline, for the same reason forbidden does', () => {
  assert.equal(at({ isError: true, error: httpError(422), online: false }), 'request');
});

test('request beats loading — a settled 4xx is not still in flight', () => {
  assert.equal(at({ isError: true, error: httpError(400), isLoading: true }), 'request');
});

test('5xx is still `error` — that one really is our end', () => {
  for (const s of [500, 502, 503, 504]) {
    assert.equal(at({ isError: true, error: httpError(s) }), 'error');
  }
});

test('a rejection with no response is a network failure, not a 4xx', () => {
  assert.equal(at({ isError: true, error: new Error('Network Error') }), 'error');
  assert.equal(at({ isError: true, error: new Error('Network Error'), online: false }), 'offline');
});

test('loading, offline, empty and ready are unchanged', () => {
  assert.equal(at({ isLoading: true }), 'loading');
  assert.equal(at({ online: false }), 'offline');
  assert.equal(at({ isEmpty: true }), 'empty');
  assert.equal(at({}), 'ready');
});

test('offline still beats a plain error with no status', () => {
  assert.equal(at({ isError: true, online: false }), 'offline');
});

test('every returned status is one ScreenState can render', () => {
  const renderable = new Set(['loading', 'offline', 'forbidden', 'request', 'error', 'empty', 'ready']);
  const cases = [
    {}, { isLoading: true }, { online: false }, { isEmpty: true }, { hasData: true },
    { isError: true }, { isError: true, error: httpError(403) },
    { isError: true, error: httpError(422) }, { isError: true, error: httpError(500) },
  ];
  for (const c of cases) assert.ok(renderable.has(at(c)), `unrenderable status from ${JSON.stringify(c)}`);
});
