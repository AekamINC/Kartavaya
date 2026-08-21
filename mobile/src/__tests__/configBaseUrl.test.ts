/**
 * The API base URL seam, and the one property it must never lose.
 *
 * `config.js` gained a runtime override so a domain move stops requiring a
 * rebuild and a store release. The override is the feature; the FALLBACK is the
 * safety rule, and it is the half worth pinning: staging and production share a
 * single Supabase database, so a client that resolves to production without
 * being told to writes real rows against real customer data.
 *
 * Every assertion below is a way the override could fail toward production or
 * toward no API at all. The real `lib/storage.ts` runs against the in-memory
 * MMKV stub, so this exercises the actual read path rather than a mock of it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { storage } from '../lib/storage.ts';
import {
  API_BASE_URL_KEY, BUILD_BACKEND_URL, BACKEND_URL, API_URL,
  resolveBackendUrl, setBackendUrl, clearBackendUrl,
} from '../config.js';

const clean = () => storage.delete(API_BASE_URL_KEY);

// ── The safety property ───────────────────────────────────────────────────────

test('with no override at all, the URL is the build-time value', () => {
  clean();
  assert.equal(resolveBackendUrl(), BUILD_BACKEND_URL);
});

test('the build-time fallback is STAGING, never production', () => {
  // `EXPO_PUBLIC_API_URL` is unset in this process, which is exactly the
  // unverified-configuration case the fallback exists for.
  assert.match(
    BUILD_BACKEND_URL, /staging/,
    'the unconfigured fallback moved off staging. Production shares a database '
    + 'with it; an unverified client must never default there.',
  );
});

test('a junk override falls back rather than breaking networking', () => {
  // A corrupt key must not be able to leave the app unable to reach any API.
  for (const junk of ['', '   ', 'not a url', '://nope', 'ftp://x.example']) {
    storage.set(API_BASE_URL_KEY, junk);
    assert.equal(
      resolveBackendUrl(), BUILD_BACKEND_URL,
      `"${junk}" should have been rejected and fallen back`,
    );
  }
  clean();
});

test('a plaintext http override is REFUSED, not upgraded', () => {
  // Auth is an httpOnly cookie. http:// would put it on the wire, and silently
  // rewriting a configured value sends the device to a host nobody chose.
  storage.set(API_BASE_URL_KEY, 'http://api.kartavaya.com');
  assert.equal(resolveBackendUrl(), BUILD_BACKEND_URL);
  assert.equal(setBackendUrl('http://api.kartavaya.com'), false, 'http was accepted by the writer');
  clean();
});

// ── The seam ──────────────────────────────────────────────────────────────────

test('a stored https override wins over the build-time value', () => {
  assert.equal(setBackendUrl('https://api.kartavaya.aekaminc.com'), true);
  assert.equal(resolveBackendUrl(), 'https://api.kartavaya.aekaminc.com');
  assert.notEqual(resolveBackendUrl(), BUILD_BACKEND_URL);
  clean();
});

test('a trailing slash is stripped, both writing and reading', () => {
  // `${BACKEND_URL}/api` on a value ending in "/" yields "//api", which is a
  // 404 on every request and looks like the backend is down.
  setBackendUrl('https://api.kartavaya.aekaminc.com/');
  assert.equal(resolveBackendUrl(), 'https://api.kartavaya.aekaminc.com');

  storage.set(API_BASE_URL_KEY, 'https://api.kartavaya.aekaminc.com///');
  assert.equal(resolveBackendUrl(), 'https://api.kartavaya.aekaminc.com');
  clean();
});

test('clearing the override returns to the build-time value', () => {
  setBackendUrl('https://api.kartavaya.aekaminc.com');
  clearBackendUrl();
  assert.equal(resolveBackendUrl(), BUILD_BACKEND_URL);
});

test('a rejected write leaves the previous override untouched', () => {
  setBackendUrl('https://good.example');
  assert.equal(setBackendUrl('http://bad.example'), false);
  assert.equal(resolveBackendUrl(), 'https://good.example', 'a refused write still clobbered the key');
  clean();
});

// ── The constants existing callers read ───────────────────────────────────────

test('the exported constants still agree with each other', () => {
  // `BACKEND_URL` is resolved once at import — nothing here has written an
  // override at that point, so it is the build-time value.
  assert.equal(BACKEND_URL, BUILD_BACKEND_URL);
  assert.equal(API_URL, `${BACKEND_URL}/api`);
  assert.doesNotMatch(API_URL, /\/\/api$/, 'API_URL has a doubled slash before /api');
});
