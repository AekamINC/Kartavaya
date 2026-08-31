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
// ── THE FALLBACK, AND WHY IT CHANGED ─────────────────────────────────────────
//
// ⚠ THERE IS NO STAGING ENVIRONMENT. Retired 2026-08-30; everything moved to
// production. The fallback is now `https://api.kartavaya.com`.
//
// The old fallback was staging, on the reasoning that defaulting to production
// would write real customer rows. THAT REASONING WAS BACKWARDS, and it is worth
// writing down so it is not reintroduced: the staging host reached the SAME
// Supabase project, the same schema, the same R2 bucket. Nothing in the backend
// branches on environment before a write. So the staging default never protected
// one row — it only suppressed outbound mail (OUTBOUND_MODE=dry), on a backend
// 30 commits stale. It bought mail safety and was described as data safety.
//
// There is no safer host to fail toward, so the fallback now points at the one
// host that is real and that we own the name of. A name we own does not move
// when Railway renames a service — which has already happened once and shipped
// an APK aimed at a host answering 404.
//
// The override does not weaken this. An absent, blank, malformed or non-HTTPS
// stored value resolves to the build-time value, which resolves to production —
// the only environment there is.
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
  process.env.EXPO_PUBLIC_API_URL ?? 'https://api.kartavaya.com';

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
