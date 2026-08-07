/**
 * Push registration: the two things that made it silently do nothing.
 *
 * The defect: `registerForPushNotificationsAsync` opened with
 * `if (!Constants.isDevice) return null;`. `isDevice` was removed from
 * expo-constants in v16 and this app is on 16.0.2, so the read was `undefined`,
 * the negation was true, and the function returned on its first line — on every
 * device, forever. No `getExpoPushTokenAsync`, no `POST /me/push_tokens`, no
 * token on any device, and therefore not one deliverable mention notification.
 * The only path that ever registered was the manual toggle in SettingsScreen,
 * which has no such gate.
 *
 * It shipped twice, and neither `tsc` nor the suite saw it, because
 * `NativeConstants` in `Constants.types.d.ts` ends with `[key: string]: any`.
 * Every misspelling of a Constants property is `any` and typechecks clean. That
 * index signature is not going away, so the check has to live here.
 *
 * ── Why these are source-contract tests ───────────────────────────────────────
 *
 * `usePushNotifications.ts` cannot be imported by `node --test`: it pulls in
 * `expo-notifications`, whose `DevicePushTokenAutoRegistration.fx` imports
 * `abort-controller/polyfill` extensionless, which Node's resolver rejects and
 * `src/test/register.mjs` does not stub. Making it importable means a new stub
 * in a file this agent does not own. Until then the function's behaviour is
 * reachable by reading it, and only by reading it. See `test/source.ts` for
 * what that instrument is and is not good for.
 *
 * `constantsProperties` below is the exception, and it is the important one: it
 * is not pinning text, it is comparing the app against the ground truth in
 * `node_modules`. It fails on `Constants.isDevice` and on any other property
 * name someone assumes rather than checks — which is the actual class of bug,
 * in any file, not just this one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { srcPath, readCode, readSkeleton, stripComments } from '../../test/source.ts';

const HOOK = 'hooks/usePushNotifications.ts';

/* ── The installed package's own property list ───────────────────────────── */

/**
 * `Constants.types.d.ts` from the resolved expo-constants.
 *
 * Walked up from `src/` rather than joined to a fixed depth, so a hoisted
 * `node_modules` at the repository root resolves the same as `mobile/`'s own.
 * A miss throws rather than skips: a test that quietly stops checking is how
 * this defect survived two releases.
 */
function constantsTypesFile(): string {
  let dir = srcPath('..');
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(
      dir, 'node_modules', 'expo-constants', 'build', 'Constants.types.d.ts',
    );
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Could not resolve expo-constants from mobile/. Run `npm install` in mobile/ '
    + 'before `npm test` — this test compares the app against the installed '
    + 'package and has nothing to compare against otherwise.',
  );
}

/**
 * Every property `Constants` actually declares, read out of its `.d.ts`.
 *
 * Only the two interfaces the default export is typed as — `NativeConstants`
 * and the `Constants` that extends it. Harvesting the whole file would also
 * collect `IOSManifest` and `PlatformManifest` members and let a wrong name
 * through if it happened to exist on an unrelated shape.
 *
 * Depth-tracked so that the nested `{ hostUri?: string }` inside `expoConfig`
 * does not contribute `hostUri` as a top-level property.
 */
function declaredConstantsProperties(): Set<string> {
  const src = stripComments(readFileSync(constantsTypesFile(), 'utf8'));
  const found = new Set<string>();

  for (const name of ['NativeConstants', 'Constants']) {
    /**
     * `interface X … {` OR `type X = … {`.
     *
     * SDK 51's expo-constants declared both of these as INTERFACES. SDK 54
     * declares them as type aliases — `export type NativeConstants = {` and
     * `export type Constants = NativeConstants & {` — which is a pure
     * refactor of the declaration and changes none of the members.
     *
     * This test failing on that upgrade was the correct outcome and is why the
     * regex is widened rather than the assertion dropped: the guard exists
     * because `NativeConstants` ends in `[key: string]: any`, so EVERY
     * misspelling of a Constants property typechecks clean. `Constants.isDevice`
     * read `undefined` on every device that ever ran this build and returned
     * `registerForPushNotificationsAsync` on its first line, so no device held a
     * push token at all. A guard that silently stops matching would put that
     * back.
     */
    const head = new RegExp(`(?:interface\\s+${name}\\b[^{]*|type\\s+${name}\\b[^{;]*=[^{;]*)\\{`).exec(src);
    assert.ok(
      head,
      `expo-constants no longer declares ${name} as either an interface or a type `
      + 'alias. Find where its members moved and point this at them — do NOT delete '
      + 'the check; see the comment above for what it is holding back.',
    );

    let depth = 0;
    let i = head.index + head[0].length - 1; // at the opening brace
    let line = '';

    /**
     * Take `line` as a member of THIS interface if it declares one.
     *
     * Called on `{` as well as on `;` and newline, because `expoConfig` opens a
     * nested object on its own declaration line — `expoConfig: (ExpoConfig & {`
     * — and reading the brace before the name dropped it. The sanity check in
     * the test below is what caught that.
     */
    const flush = () => {
      const m = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:/.exec(line);
      if (depth === 1 && m) found.add(m[1]);
      line = '';
    };

    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') { flush(); depth++; continue; }
      if (c === '}') { flush(); depth--; if (depth === 0) break; continue; }
      if (c === ';' || c === '\n') { flush(); continue; }
      line += c;
    }
    assert.equal(depth, 0, `unbalanced braces reading interface ${name}`);
  }

  return found;
}

/**
 * Every file under `src/` that imports expo-constants, relative to `src/`.
 *
 * Walked rather than listed, so a file that starts reading `Constants` next
 * month is covered without anyone remembering to register it.
 *
 * Skipping `__tests__` is not tidiness — it is required. `readCode` strips
 * comments but keeps string literals, and the assertion messages below contain
 * the text `Constants.isDevice`; scanning this directory would make the sweep
 * fail on its own error message.
 */
function filesImportingConstants(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(srcPath('.'), dir), { withFileTypes: true })) {
      const rel = dir === '.' ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'test') continue;
        walk(rel);
      } else if (/\.tsx?$/.test(entry.name) && readCode(rel).includes("from 'expo-constants'")) {
        out.push(rel);
      }
    }
  };
  walk('.');
  return out.sort();
}

/**
 * Property names read off `Constants` in a file.
 *
 * Matches the bare `Constants.foo` and the cast `(Constants as any).foo` that
 * `SettingsScreen` uses — the cast is the more dangerous of the two, since it
 * defeats the type surface deliberately rather than by accident.
 */
function constantsReads(code: string): string[] {
  const re = /\bConstants\b(?:\s+as\s+\w+)?\s*\)?\s*\.\s*([A-Za-z_$][\w$]*)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) out.push(m[1]);
  return out;
}

test('every Constants property this app reads is one expo-constants declares', () => {
  const declared = declaredConstantsProperties();

  // Sanity: if the parse silently returned nothing, everything below passes for
  // the wrong reason. These three are the ones this app depends on.
  for (const known of ['expoConfig', 'easConfig', 'executionEnvironment']) {
    assert.ok(declared.has(known), `parse of Constants.types.d.ts missed ${known}`);
  }

  const files = filesImportingConstants();
  assert.ok(files.length > 0, 'no file imports expo-constants — has the sweep broken?');

  for (const file of files) {
    for (const prop of constantsReads(readCode(file))) {
      assert.ok(
        declared.has(prop),
        `${file} reads Constants.${prop}, which the installed expo-constants does `
        + `not declare. It is \`undefined\` at runtime and \`any\` to tsc, because `
        + `NativeConstants ends with an [key: string]: any index signature. `
        + `Check the property against node_modules before using it.`,
      );
    }
  }
});

test('Constants.isDevice — the exact read that blocked every push token — is gone', () => {
  // Named separately from the sweep above so the regression is unmistakable in
  // the output rather than one line of a generic failure.
  for (const file of filesImportingConstants()) {
    assert.ok(
      !constantsReads(readCode(file)).includes('isDevice'),
      `${file} reads Constants.isDevice. It was removed in expo-constants v16 `
      + `(see its CHANGELOG) and this app is on 16.0.2, so it is undefined — a `
      + `guard on it returns early always, and no device registers for push.`,
    );
  }
});

/* ── Nothing bails out in front of the token call ─────────────────────────── */

/**
 * The body of `registerForPushNotificationsAsync` up to the token call, with
 * comments AND string contents removed.
 *
 * Strings are stripped because the file explains this defect in prose and the
 * assertions below would otherwise read the explanation as the code it warns
 * about — the same trap `test/source.ts` documents.
 */
function bodyBeforeTokenCall(): string {
  const code = readSkeleton(HOOK);

  const start = code.indexOf('async function registerForPushNotificationsAsync');
  assert.notEqual(
    start, -1,
    'registerForPushNotificationsAsync is gone or renamed in ' + HOOK
    + '. If it moved, move this test with it — do not delete it.',
  );

  const call = code.indexOf('getExpoPushTokenAsync(', start);
  assert.notEqual(
    call, -1,
    'registerForPushNotificationsAsync no longer calls getExpoPushTokenAsync. '
    + 'Without that call no device can hold a push token.',
  );

  return code.slice(start, call);
}

/**
 * The condition that controls the `return` at `at` — its enclosing statement.
 *
 * Deliberately NOT a fixed character window. A window wide enough to reach the
 * condition of a braced `if (…) { return null; }` also reaches back into the
 * PREVIOUS statement, so `if (finalStatus !== 'granted') return null;` sitting
 * one line above a bogus gate would lend it the word `finalStatus` and the test
 * would pass on the very shape it exists to catch.
 *
 * So: back up to the nearest statement boundary, and when that boundary is the
 * `{` of a block, take the header in front of it too. That is the condition and
 * nothing else, in both the braced and the one-line form.
 */
function guardOf(body: string, at: number): string {
  const boundary = (from: number) => {
    let i = from;
    while (i >= 0 && !';{}'.includes(body[i])) i--;
    return i;
  };

  const b = boundary(at - 1);
  let guard = body.slice(b + 1, at);
  if (body[b] === '{') guard = body.slice(boundary(b - 1) + 1, b) + guard;
  return guard;
}

test('the only early exit before a token is requested is a refused permission', () => {
  const body = bodyBeforeTokenCall();

  const returns: number[] = [];
  const re = /\breturn\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) returns.push(m.index);

  assert.ok(
    returns.length > 0,
    'expected the permission refusal to still return early before requesting a token',
  );

  for (const at of returns) {
    const guard = guardOf(body, at);
    assert.match(
      guard, /\bfinalStatus\b|\bexistingStatus\b|\bstatus\b/,
      'An early return was added in front of getExpoPushTokenAsync that is not '
      + 'the permission check:\n\n    ' + guard.trim().replace(/\s+/g, ' ') + ' return …\n\n'
      + 'The last one of these was `if (!Constants.isDevice) return null;`, on a '
      + 'property that does not exist, and it meant no device registered for push '
      + 'in two shipped releases. Whatever this new condition is, satisfy yourself '
      + 'that it is FALSE on an Android emulator — that is where push is tested — '
      + 'and that it cannot be undefined. Then widen this test deliberately.',
    );
  }
});

test('a token that is obtained is actually sent to the backend', () => {
  // The consequence the guard suppressed, pinned at its far end: registration
  // is only real if the token reaches this route.
  assert.ok(
    readCode(HOOK).includes('/me/push_tokens'),
    HOOK + ' no longer posts to /me/push_tokens, so no token is ever stored.',
  );
});
