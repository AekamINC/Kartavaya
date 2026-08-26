/**
 * geo.js — one-shot geolocation capture for attendance punches.
 *
 * Wraps the W3C Geolocation API in a promise that never rejects. A denied
 * permission, a timed-out fix, or a browser with no geolocation at all all
 * resolve to `null` — clocking in must never be blocked by GPS.
 *
 * iOS notes:
 *   - Geolocation requires a secure context (https), which Vercel gives us.
 *   - Safari only prompts in response to a user gesture, so call this from
 *     the click handler, not on mount.
 *   - `altitude` is null unless the fix came from GPS; a wifi/cell fix
 *     reports horizontal position only. We record whatever we are given.
 */

// A GPS fix can take a few seconds on first use; 15 s is long enough to get
// a real reading without leaving the user staring at a spinner.
const GEO_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 0, // never reuse a cached position for an attendance record
};

/** Which surface the punch came from, for the audit trail. */
export function detectSource() {
  if (typeof navigator === 'undefined') return 'browser';
  const standalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true;
  if (!standalone) return 'browser';
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'ios-pwa' : 'android-pwa';
}

/**
 * Capture a single position fix.
 * @returns {Promise<object|null>} payload matching the backend GeoFix model,
 *   or null when a fix could not be obtained.
 */
export function captureGeoFix() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const c = position.coords;
        resolve({
          latitude:  c.latitude,
          longitude: c.longitude,
          altitude:  c.altitude,
          accuracy:  c.accuracy,
          altitude_accuracy: c.altitudeAccuracy,
          source: detectSource(),
        });
      },
      () => resolve(null),   // denied, unavailable, or timed out — punch anyway
      GEO_OPTIONS,
    );
  });
}

/** Human-readable summary of a stored location, for the UI. */
export function formatLocation(loc) {
  if (!loc || loc.latitude == null || loc.longitude == null) return null;
  const coords = `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`;
  const altitude = loc.altitude != null ? ` · ${Math.round(loc.altitude)} m alt` : '';
  const accuracy = loc.accuracy != null ? ` · ±${Math.round(loc.accuracy)} m` : '';
  return `${coords}${altitude}${accuracy}`;
}
