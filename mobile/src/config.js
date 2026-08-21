// The API base URL, resolved at RUNTIME with a build-time fallback.
//
// Development  → EXPO_PUBLIC_API_URL in mobile/.env
// APK builds   → eas.json `development` / `preview` / `simulator` profiles, all staging
// Store builds → eas.json `production` profile, which sets production explicitly
//
// ── WHY THERE IS A RUNTIME OVERRIDE AT ALL ───────────────────────────────────
//
// `process.env.EXPO_PUBLIC_API_URL` is not read at runtime. Expo INLINES it into
// the bundle at build time — the shipped JS contains the literal string, and
// there is no environment left on the device to consult. So the API host is
// welded to the binary: moving to https://api.kartavaya.aekaminc.com, or
// repointing a build after Railway hands out a new hostname, means a rebuild, a
// store review and a wait, for a change that is one string long.
//
// A persisted override breaks that weld. `storage` is MMKV — on-device, survives
// restarts, and readable before the first network call — so a build can be
// repointed by writing one key, and an OTA update can carry the write. That is
// the whole deliverable: a SEAM. There is deliberately no UI for it, because a
// text field that changes which database a user writes to is a support incident
// waiting to be talked through over the phone.
//
// ── THE SAFETY PROPERTY, UNCHANGED ───────────────────────────────────────────
//
// THE FALLBACK IS STAGING, deliberately. The build-time value is only reached
// when EXPO_PUBLIC_API_URL is unset — a bare `expo start`, a misconfigured
// profile, a build env that failed to inject. Every one of those is an
// unverified configuration, and staging and production share a Supabase
// database, so an unverified client defaulting to production writes real rows
// against real customer data. Production is reached only by NAMING it.
//
// The override does not weaken that. An absent, blank, malformed or non-HTTPS
// stored value resolves to the build-time value, which resolves to staging — a
// corrupt key can only ever fail toward the safer host, never toward production.
//
// ── THE OTA TRAP THIS FILE'S NEIGHBOUR CANNOT DOCUMENT ───────────────────────
//
// eas.json is read with a bare `JSON.parse`, so it cannot carry a comment. The
// rule that belongs beside its `channel` keys: `app.json` sets
// `runtimeVersion: { policy: "appVersion" }`, so bumping `version` to ship a
// JS-only fix STRANDS every installed build on the old bundle — the update is
// published against a runtime nobody is running. Publish at the same version;
// move `version` only when a new binary goes to the store. Pinned by
// `hooks/__tests__/otaChannel.test.ts`.

import { storage } from './lib/storage';

/**
 * The MMKV key holding the runtime override. Namespaced like the rest of this
 * app's keys so it cannot collide with a query-cache entry.
 */
export const API_BASE_URL_KEY = 'config.apiBaseUrl';

/** Compiled into the bundle. Staging unless a profile named otherwise. */
export const BUILD_BACKEND_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://kartavya-staging.up.railway.app';

/**
 * A stored override, or undefined if there is nothing usable there.
 *
 * HTTPS ONLY, and that is a rule rather than a preference: auth here is an
 * httpOnly cookie, and a plaintext base URL would put it on the wire. `http://`
 * is rejected rather than upgraded, because silently rewriting somebody's
 * configured value is how a device ends up talking to a host nobody chose.
 *
 * Every failure path returns undefined so the caller falls back — a malformed
 * key must not be able to break the app's ability to reach any API at all.
 */
function readOverride() {
  try {
    const raw = storage.getString(API_BASE_URL_KEY);
    if (typeof raw !== 'string') return undefined;
    const value = raw.trim().replace(/\/+$/, ''); // a trailing slash would make `//api`
    if (!value) return undefined;
    if (!/^https:\/\/[^\s/]+/i.test(value)) return undefined;
    return value;
  } catch {
    // MMKV unavailable — Expo Go, a test harness, a JSI that has not attached
    // yet. Not reaching the store is "no override", never a crash on import.
    return undefined;
  }
}

/**
 * The base URL to use right now.
 *
 * A FUNCTION as well as the constant below, because the constant is evaluated
 * once at import and a caller that wants to honour an override written after
 * launch — the point of the seam — has to be able to ask again.
 */
export function resolveBackendUrl() {
  return readOverride() ?? BUILD_BACKEND_URL;
}

/**
 * Store an override. Returns false and writes NOTHING if the value is not an
 * HTTPS URL, so a bad value cannot brick a device's networking.
 */
export function setBackendUrl(url) {
  const value = String(url ?? '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+/i.test(value)) return false;
  storage.set(API_BASE_URL_KEY, value);
  return true;
}

/** Drop the override and fall back to the build-time value. */
export function clearBackendUrl() {
  storage.delete(API_BASE_URL_KEY);
}

/**
 * Resolved once at import, which is what every existing consumer expects.
 * Changing an override therefore takes effect on the next app start — or
 * immediately for anything that calls `resolveBackendUrl()` instead.
 */
export const BACKEND_URL = resolveBackendUrl();

export const API_URL = `${BACKEND_URL}/api`;
