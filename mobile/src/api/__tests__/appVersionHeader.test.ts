/**
 * The client states its version in one header — X-App-Version — and the
 * server reads that exact spelling at both collection seams (proposal 68,
 * "App version adoption").
 *
 * Source-contract assertions, not a transport test, and necessarily so: the
 * resolve hook in `src/test/register.mjs` swaps `api/client` for the
 * transport-free stub in every test in this suite (staging shares a Supabase
 * database with production, so the real axios instance must never load
 * here). The header lives in the real module's `axios.create` config, which
 * therefore can only be reached by reading the file — the same reasoning as
 * `serverContract.test.ts`, whose backend-locating helper this file reuses
 * in miniature.
 *
 * What is pinned, and why each pin matters:
 *  · the client attaches X-App-Version, read from `Constants.expoConfig`
 *    — the same embedded config SettingsScreen shows the user, so the
 *    header can never disagree with the About screen;
 *  · the header is attached CONDITIONALLY — a build whose version cannot
 *    be read must omit the header, not invent a value, because the server
 *    upserts whatever non-empty string arrives into the adoption table;
 *  · both server seams (login, delta-sync tombstones) read the same
 *    spelling, case-folded — a renamed header on either side would silently
 *    stop collection while everything stayed green.
 *
 * NOTE: the header reaches real devices only with the next OTA / APK — this
 * file proves the source contract, not adoption.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { srcPath, readCode } from '../../test/source.ts';

/** `backend/` of this repository — serverContract.test.ts's walk, in small. */
function backendDir(): string {
  let dir = srcPath('..');
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'backend');
    if (existsSync(path.join(candidate, 'server.py'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Could not locate backend/ from mobile/src. This is a client↔server '
    + 'contract test; without the server there is nothing to compare against '
    + 'and passing would mean nothing.',
  );
}

const py = (rel: string): string =>
  readFileSync(path.join(backendDir(), rel), 'utf8');

test('the client attaches X-App-Version from the embedded expo config', () => {
  const code = readCode('api/client.ts');
  assert.match(
    code, /['"]X-App-Version['"]/,
    'api/client.ts no longer names the X-App-Version header — the version '
    + 'collector (proposal 68) has gone silent on the client side.',
  );
  assert.match(
    code, /Constants\.expoConfig\?\.version/,
    'the header value is no longer read from Constants.expoConfig?.version — '
    + 'the one source that always agrees with the version SettingsScreen '
    + 'shows the user.',
  );
  assert.match(
    code, /from ['"]expo-constants['"]/,
    'expo-constants is no longer imported; Constants would be undefined at '
    + 'module load and the client would crash before the first request.',
  );
});

test('a build with no readable version omits the header, never invents one', () => {
  const code = readCode('api/client.ts');
  // The conditional spread: `...(APP_VERSION ? { 'X-App-Version': ... } : {})`.
  // The server upserts any non-empty value it receives into the one-row-per-
  // user adoption table, so a hardcoded fallback ('unknown', '0.0.0') would
  // pollute it with a version that was never shipped.
  assert.match(
    code, /\.\.\.\(\s*APP_VERSION\s*\?/,
    'the X-App-Version header is no longer guarded on the version being '
    + 'readable — an unconditional header risks recording a made-up version.',
  );
  assert.doesNotMatch(
    code, /X-App-Version['"]\s*:\s*['"]/,
    'X-App-Version is set to a string literal — the whole point is that the '
    + 'value tracks the build, not the source code.',
  );
});

test('both server seams read the exact header the client sends', () => {
  // Starlette folds header names to lowercase; the client sends canonical
  // casing and both sides meet case-insensitively. What must agree is the
  // hyphenated NAME.
  for (const rel of ['auth_router.py', path.join('routers', 'sync.py')]) {
    const src = py(rel);
    assert.match(
      src, /headers\.get\(\s*['"]x-app-version['"]\s*\)/i,
      `${rel} no longer reads the x-app-version header — that collection `
      + 'seam has gone silent while the client still pays to send it.',
    );
  }
});
