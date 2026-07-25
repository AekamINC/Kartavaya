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

  it('falls back to server for unexpected 4xx', () => {
    setOnline(true);
    expect(errorKind({ response: { status: 418 } })).toBe('server');
  });
});
