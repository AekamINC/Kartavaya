/**
 * The stale-chunk guard.
 *
 * A deploy renames every code-split chunk (the filename carries a content
 * hash). A tab that was already open keeps asking for the OLD names, the SPA
 * rewrite answers with index.html, and the browser reports a module with the
 * wrong MIME type. Live, that showed every page as "This page didn't load" for
 * every member at once while the build itself was perfectly healthy.
 *
 * The two properties that matter are opposites, and both are tested:
 *   · a stale chunk reloads the page, so the tab heals itself;
 *   · it reloads AT MOST ONCE, because a reload loop is a worse failure than
 *     the one being fixed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { lazyPage, markAppLoaded } from '../lazyPage';

const STALE = new TypeError(
  'Failed to fetch dynamically imported module: https://x/assets/GanitPage-CJQr3QBN.js');
const MIME = new TypeError(
  'Failed to load module script: Expected a JavaScript-or-Wasm module script '
  + 'but the server responded with a MIME type of "text/html".');

let reloads;
let realLocation;

beforeEach(() => {
  reloads = 0;
  sessionStorage.clear();
  realLocation = window.location;
  delete window.location;
  window.location = { ...realLocation, reload: () => { reloads += 1; } };
});

afterEach(() => {
  window.location = realLocation;
  sessionStorage.clear();
});

/** Pull the loader out of the lazy component without rendering React. */
const loaderOf = (component) => component._payload._result;

describe('a chunk that vanished under an open tab', () => {
  it('reloads the page so the tab picks up the new chunk names', async () => {
    const C = lazyPage(() => Promise.reject(STALE));
    const p = loaderOf(C)();
    // The promise deliberately never settles — the reload is already underway
    // and resolving would flash a boundary the user is navigating away from.
    const settled = await Promise.race([
      p.then(() => 'resolved', () => 'rejected'),
      new Promise((r) => setTimeout(() => r('pending'), 30)),
    ]);
    expect(settled).toBe('pending');
    expect(reloads).toBe(1);
  });

  it('also catches the MIME-type shape, which is what the SPA rewrite produces', async () => {
    const C = lazyPage(() => Promise.reject(MIME));
    loaderOf(C)();
    await new Promise((r) => setTimeout(r, 10));
    expect(reloads).toBe(1);
  });

  it('reloads AT MOST ONCE — a loop is worse than the bug', async () => {
    const first = lazyPage(() => Promise.reject(STALE));
    loaderOf(first)();
    await new Promise((r) => setTimeout(r, 10));
    expect(reloads).toBe(1);

    // Second failure in the same tab: it must surface, not reload again.
    const second = lazyPage(() => Promise.reject(STALE));
    await expect(loaderOf(second)()).rejects.toThrow(/dynamically imported/);
    expect(reloads).toBe(1);
  });

  it('gets a fresh attempt after the app has rendered, for the NEXT deploy', async () => {
    const first = lazyPage(() => Promise.reject(STALE));
    loaderOf(first)();
    await new Promise((r) => setTimeout(r, 10));
    expect(reloads).toBe(1);

    markAppLoaded();

    const later = lazyPage(() => Promise.reject(STALE));
    loaderOf(later)();
    await new Promise((r) => setTimeout(r, 10));
    expect(reloads).toBe(2);
  });
});

describe('a real error in the page itself', () => {
  it('is NOT swallowed by a reload', async () => {
    const boom = new Error('Cannot read properties of undefined (reading map)');
    const C = lazyPage(() => Promise.reject(boom));
    await expect(loaderOf(C)()).rejects.toThrow(/Cannot read properties/);
    expect(reloads).toBe(0);
  });

  it('a module that loads normally is untouched', async () => {
    const mod = { default: () => null };
    const C = lazyPage(() => Promise.resolve(mod));
    await expect(loaderOf(C)()).resolves.toBe(mod);
    expect(reloads).toBe(0);
  });
});
