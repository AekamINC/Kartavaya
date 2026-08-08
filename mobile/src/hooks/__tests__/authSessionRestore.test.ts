/**
 * The signed-in user who was shown the login screen.
 *
 * Two faults, both of which only ever appeared on a real APK:
 *
 *  1. `restoreToken()` reads SecureStore asynchronously and `AuthProvider`
 *     fired `apiMe()` on mount without waiting for it. When `apiMe()` won, the
 *     request carried no Authorization header, the backend answered 401, and
 *     the app showed Login — with a valid token still sitting in storage.
 *     Invisible in development, because the `__DEV__` token sets the header
 *     synchronously at module load and Metro strips that branch from release.
 *
 *  2. The provider caught EVERY `apiMe()` error as "signed out". A 15-second
 *     timeout on a bad connection, a 500, or a DNS failure all logged the user
 *     out of a session that was perfectly valid. That second copy lived in
 *     `refresh()`, which screens call while the app is in use — so one dropped
 *     request threw a working user back to Login mid-task.
 *
 * The assertions are on source rather than behaviour deliberately: reproducing
 * the race needs real timer interleaving against a native module, and a test
 * that flaky is a test that gets deleted. What is pinned is the shape that makes
 * the race impossible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// `__dirname` does not exist under the ESM loader this suite runs on.
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', '..', p), 'utf8');

test('restoreToken exposes a promise the rest of the app can wait on', () => {
  const auth = SRC('api/auth.ts');
  assert.ok(
    auth.includes('export const tokenRestored'),
    'api/auth.ts no longer exports `tokenRestored`, so nothing can wait for the token to reach the client.',
  );
  assert.match(
    auth, /finally\s*\{[\s\S]*resolveRestored\(\)/,
    'The promise is not resolved inside a `finally`. If SecureStore throws it stays pending for ever and the app hangs on a blank screen — worse than the bug being fixed.',
  );
});

test('AuthProvider waits for the token before asking who we are', () => {
  const hook = SRC('hooks/useAuth.ts');
  const awaitPos = hook.indexOf('await tokenRestored');
  const mePos = hook.indexOf('await apiMe()');
  assert.notEqual(awaitPos, -1, 'AuthProvider no longer awaits `tokenRestored`.');
  assert.notEqual(mePos, -1, 'AuthProvider no longer calls apiMe().');
  assert.ok(
    awaitPos < mePos,
    'apiMe() runs BEFORE the token is restored. On a release build that request goes out with no Authorization header, the backend answers 401, and a signed-in user is shown the login screen.',
  );
});

test('only a rejected credential signs anyone out', () => {
  const hook = SRC('hooks/useAuth.ts');
  assert.doesNotMatch(
    hook, /catch\s*\{\s*(\/\/[^\n]*\n\s*)*setUser\(null\)/,
    'A bare `catch { setUser(null) }` is back. That signs the user out on a timeout, a 500 or a DNS failure — a network fault is not a credential fault.',
  );
  // BOTH sites: the mount effect and `refresh()`. The second is the one that
  // hurts, because it fires while somebody is using the app.
  const guards = hook.match(/status === 401/g) || [];
  assert.ok(
    guards.length >= 2,
    `Expected a status guard at both sign-out sites (mount and refresh); found ${guards.length}.`,
  );
});
