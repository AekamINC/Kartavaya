/**
 * Unit tests for errorKind() in components/ui/ErrorState.jsx.
 *
 * The classification order is load-bearing and easy to break by "tidying":
 * the no-response check has to come before any status read, or a network
 * failure gets reported as a server error and blames us for the user's
 * train tunnel.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { errorKind } from '../components/ui/ErrorState';

function setOnline(v) {
  Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });
}

afterEach(() => setOnline(true));

describe('errorKind()', () => {
  it('reports offline when the browser is offline, whatever the error looks like', () => {
    setOnline(false);
    expect(errorKind({ response: { status: 500 } })).toBe('offline');
    expect(errorKind(new Error('boom'))).toBe('offline');
  });

  it('reports offline for a rejection carrying no response', () => {
    setOnline(true);
    // An axios network failure: request made, nothing came back.
    expect(errorKind({ message: 'Network Error' })).toBe('offline');
    expect(errorKind(undefined)).toBe('offline');
    expect(errorKind(null)).toBe('offline');
  });

  it('maps 403 to denied and 404 to missing', () => {
    setOnline(true);
    expect(errorKind({ response: { status: 403 } })).toBe('denied');
    expect(errorKind({ response: { status: 404 } })).toBe('missing');
  });

  it('maps 5xx to server', () => {
    setOnline(true);
    for (const status of [500, 502, 503, 504]) {
      expect(errorKind({ response: { status } })).toBe('server');
    }
  });

  it('does not classify a real HTTP response as offline', () => {
    setOnline(true);
    // The regression this guards: a 500 must never read as a connectivity
    // problem, because the two have different correct actions.
    expect(errorKind({ response: { status: 500 } })).not.toBe('offline');
  });

  it('classifies every other 4xx as a request problem, not a server one', () => {
    setOnline(true);
    // The regression this guards is a live contradiction, not a nicety.
    // `approvals_router.py:562` answers a spent magic link with
    // `400 "This approval link is no longer active"`, and ApprovePage renders
    // that sentence as ErrorState's `detail` under ErrorState's own title.
    // While 400 mapped to `server`, the card read:
    //
    //     Something broke on our side, not yours
    //     This approval link is no longer active.
    //
    // The first line is false and it is the one that tells the visitor to wait
    // for us. 4xx is by definition a statement about the request.
    for (const status of [400, 409, 410, 422, 429, 418]) {
      expect(errorKind({ response: { status } })).toBe('request');
    }
  });

  it('keeps 403 and 404 out of the generic request bucket', () => {
    setOnline(true);
    // Both are 4xx but both have their own copy and their own one correct
    // action — "request access" and "go back". Collapsing them into `request`
    // would lose that, so the specific checks must stay ahead of the range.
    expect(errorKind({ response: { status: 403 } })).not.toBe('request');
    expect(errorKind({ response: { status: 404 } })).not.toBe('request');
  });

  it('still reports a genuine 5xx as server', () => {
    setOnline(true);
    // The inverse guard: widening 4xx must not have swept 5xx along with it.
    expect(errorKind({ response: { status: 500 } })).toBe('server');
    expect(errorKind({ response: { status: 503 } })).toBe('server');
  });
});
