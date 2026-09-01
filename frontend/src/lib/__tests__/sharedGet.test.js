/**
 * `sharedGet` collapses concurrent identical GETs into one request.
 *
 * The measurement that produced it: the tasks page fired EIGHT calls for FIVE
 * endpoints, with `/tasks`, `/teams` and `/categories` each requested twice by
 * components that know nothing about each other.
 *
 * Every check here is written so that removing the dedupe makes it fail.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api', () => ({
  api: { get: vi.fn() },
}));

import { api } from '../api';
import { sharedGet } from '../sharedGet';

/** A request that stays in the air until the test releases it. */
function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sharedGet', () => {
  it('makes ONE request when two callers ask at the same moment', async () => {
    const d = deferred();
    api.get.mockReturnValueOnce(d.promise);

    const a = sharedGet('/teams');
    const b = sharedGet('/teams');
    d.resolve({ data: [{ id: 1, name: 'Ops' }] });
    const [ra, rb] = await Promise.all([a, b]);

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/teams');
    expect(ra.data).toEqual([{ id: 1, name: 'Ops' }]);
    expect(rb.data).toEqual([{ id: 1, name: 'Ops' }]);
  });

  it('gives each caller its OWN copy, so one cannot mutate the other', async () => {
    // Two components sharing a list means one sorting it in place silently
    // changes what the other rendered. The clone is what stops that.
    const d = deferred();
    api.get.mockReturnValueOnce(d.promise);

    const a = sharedGet('/categories');
    const b = sharedGet('/categories');
    d.resolve({ data: [{ id: 1 }, { id: 2 }] });
    const [ra, rb] = await Promise.all([a, b]);

    expect(ra.data).not.toBe(rb.data);
    ra.data.push({ id: 99 });
    expect(rb.data).toHaveLength(2);
  });

  it('does NOT cache — a later call goes to the network again', async () => {
    // In-flight only. A resolved cache would need an invalidation story for
    // every endpoint, and getting it wrong shows a customer a team that no
    // longer exists.
    api.get.mockResolvedValueOnce({ data: ['first'] });
    await sharedGet('/teams');
    api.get.mockResolvedValueOnce({ data: ['second'] });
    const again = await sharedGet('/teams');

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(again.data).toEqual(['second']);
  });

  it('keeps different urls apart', async () => {
    api.get.mockResolvedValueOnce({ data: 'teams' });
    api.get.mockResolvedValueOnce({ data: 'categories' });
    const [t, c] = await Promise.all([sharedGet('/teams'), sharedGet('/categories')]);

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(t.data).toBe('teams');
    expect(c.data).toBe('categories');
  });

  it('⚠ a FAILED request does not poison the url for the life of the tab', async () => {
    // Leaving a rejected promise in the map would make one dropped request
    // break every later attempt at that url — worse than the bug being fixed.
    const d = deferred();
    api.get.mockReturnValueOnce(d.promise);
    const failing = sharedGet('/teams');
    d.reject(new Error('offline'));
    await expect(failing).rejects.toThrow('offline');

    api.get.mockResolvedValueOnce({ data: ['recovered'] });
    const after = await sharedGet('/teams');
    expect(after.data).toEqual(['recovered']);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('both callers see the failure, not just the one that asked first', async () => {
    const d = deferred();
    api.get.mockReturnValueOnce(d.promise);
    const a = sharedGet('/teams');
    const b = sharedGet('/teams');
    d.reject(new Error('offline'));

    await expect(a).rejects.toThrow('offline');
    await expect(b).rejects.toThrow('offline');
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('passes a non-object body straight through', async () => {
    api.get.mockResolvedValueOnce({ data: null });
    const r = await sharedGet('/teams');
    expect(r.data).toBeNull();
  });
});
