/**
 * The OTA release channel, and the version bump that silently ends delivery.
 *
 * ── WHY THIS IS A TEST AND NOT A COMMENT IN eas.json ─────────────────────────
 *
 * Because eas.json cannot hold one. `eas-cli@22`'s bundled
 * `@expo/eas-json/build/build/accessor.js` reads the file with a bare
 * `JSON.parse` — not JSON5, not jsonc — so a `//` line or a `"//"` key is a
 * parse error, not a comment. (`vercel.json` taught this repo the same lesson
 * the expensive way: a `"//"` key killed a deploy before the build started, with
 * no logs.) So the reasoning lives here, next to `useAppUpdate.ts`, which is the
 * code that consumes what eas.json declares — and unlike a comment, this fails.
 *
 * ── WHAT WAS BROKEN ──────────────────────────────────────────────────────────
 *
 * None of the four build profiles carried a `channel`. `eas update` publishes
 * INTO a channel; a build with none is not subscribed to anything, so there was
 * nowhere to publish and nothing to receive. `useAppUpdate.ts` swallows exactly
 * this — its catch names "no channel configured" among the failures that all
 * mean "no update today" to the person holding the phone. The result is an OTA
 * pipeline that looks wired end to end and has never delivered a byte.
 *
 * ── THE TRAP: `version` AND `runtimeVersion` ─────────────────────────────────
 *
 * `app.json` sets `runtimeVersion: { policy: "appVersion" }`, so the runtime
 * version IS `version` — 2.0.3 today. An update is only offered to a build whose
 * runtime version matches the one it was published against. Bumping `version` to
 * ship an OTA fix therefore does the opposite of what it looks like: it strands
 * every installed 2.0.3 build on the old bundle for ever, because the update now
 * belongs to a runtime nobody is running. A JS-only fix ships by publishing at
 * the SAME version. `version` moves only when a new binary goes to the store.
 *
 * This file pins both halves: the channels exist, and the runtime-version policy
 * that makes the trap real is still the one described above.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { srcPath } from '../../test/source.ts';

/** `mobile/`, from `mobile/src`. */
const MOBILE = path.dirname(srcPath('.'));

function readJson(rel: string): Record<string, any> {
  // Deliberately `JSON.parse`, matching eas-cli. If a comment is ever added to
  // either file this throws here rather than at `eas build` time.
  return JSON.parse(readFileSync(path.join(MOBILE, rel), 'utf8'));
}

/** The profile names EAS builds from, and the channels they must subscribe to. */
const PROFILES = ['development', 'preview', 'simulator', 'production'] as const;

test('every build profile subscribes to a channel named after itself', () => {
  const eas = readJson('eas.json');
  const missing: string[] = [];
  for (const name of PROFILES) {
    const profile = eas.build?.[name];
    assert.ok(profile, `build profile "${name}" has disappeared from eas.json`);
    if (profile.channel !== name) missing.push(`${name} → ${profile.channel ?? '(none)'}`);
  }
  assert.deepEqual(
    missing, [],
    'a build profile has no channel, or one that does not match its name. '
    + '`eas update --branch X` publishes into a CHANNEL; a build subscribed to '
    + 'none can never receive an update, and useAppUpdate swallows the failure '
    + 'silently: ' + missing.join(', '),
  );
});

test('no build profile declares a channel EAS would reject', () => {
  // `@expo/eas-json` validates with /^[a-z\d][a-z\d._-]*$/. A capital or a
  // leading dash fails at build submission, long after the commit.
  const eas = readJson('eas.json');
  for (const name of PROFILES) {
    assert.match(
      String(eas.build[name].channel), /^[a-z\d][a-z\d._-]*$/,
      `${name}'s channel is not a legal EAS channel name`,
    );
  }
});

test('every profile still names the API it points at', () => {
  // The channel does not decide the backend — `EXPO_PUBLIC_API_URL` does, and
  // it is inlined at build time. Adding a channel must not be mistaken for
  // making the environment switchable: production is reached only by naming it,
  // because staging and production share a Supabase database.
  const eas = readJson('eas.json');
  for (const name of PROFILES) {
    const url = eas.build[name].env?.EXPO_PUBLIC_API_URL;
    assert.ok(url, `${name} no longer names an API URL — it would fall back to staging`);
    if (name === 'production') {
      assert.match(url, /production/, 'the production profile stopped naming production');
    } else {
      assert.match(url, /staging/, `${name} points somewhere other than staging`);
    }
  }
});

test('runtimeVersion is still the appVersion policy the trap depends on', () => {
  // If this ever becomes a fingerprint or a literal, the paragraph in this
  // file's header stops being true and the advice in it becomes wrong.
  const app = readJson('app.json');
  assert.deepEqual(
    app.expo?.runtimeVersion, { policy: 'appVersion' },
    'runtimeVersion changed. Re-read this file: the "never bump version to ship '
    + 'an OTA" rule is a consequence of the appVersion policy, not a law.',
  );
  assert.match(String(app.expo?.version), /^\d+\.\d+\.\d+$/, 'version is not a semver triple');
});

test('updates are enabled and point at this project', () => {
  const app = readJson('app.json');
  assert.equal(app.expo?.updates?.enabled, true, 'OTA updates are switched off');
  const projectId = app.expo?.extra?.eas?.projectId;
  assert.ok(projectId, 'no EAS projectId — the update URL cannot be for this app');
  assert.ok(
    String(app.expo?.updates?.url).includes(projectId),
    'the updates URL names a different project than extra.eas.projectId',
  );
});
