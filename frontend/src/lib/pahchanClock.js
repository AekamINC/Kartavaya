/**
 * pahchanClock.js — what the web clock screen needs and the browser does not give.
 *
 * Three jobs: a location fix that never throws, a selfie small enough for the
 * server to accept, and the id that makes a retry safe.
 *
 * Everything here is deliberately non-blocking. §2 of `design-handover/07-pahchan.md`
 * is that NOTHING BLOCKS A PUNCH — location off, no reference pair, outside the
 * geofence, all of them record and flag. `ClockScreen.tsx` learned the same
 * lesson the hard way and its comment is worth repeating: the client used to
 * hide the shutter after three camera errors, "which contradicted this module's
 * own rule that nothing blocks a punch -- three camera errors in a dark doorway
 * locked someone out of clocking in entirely."
 *
 * So a failure here returns null and lets the punch through flagged. It never
 * throws at the caller.
 */

/**
 * The server refuses anything larger — `MAX_PHOTO_BYTES` in routers/pahchan.py.
 * Duplicated as a number rather than imported because the frontend cannot read
 * Python; if that constant moves, this one has to move with it.
 */
export const SERVER_PHOTO_LIMIT_BYTES = 768 * 1024;

/**
 * What we actually aim for, with room underneath the server's cap.
 *
 * The margin is not politeness. A front camera on a recent iPhone produces a
 * 2–4 MB JPEG, so an uncompressed capture is refused outright — the selfie is
 * mandatory, which means an oversized one costs the employee their punch. The
 * gap between this and the cap absorbs the multipart envelope and the fact that
 * `toBlob` quality is a hint rather than a guarantee.
 */
const TARGET_BYTES = 600 * 1024;

/** Longest edge of the stored selfie. A face at 1080px is more than a reviewer
 *  comparing it against two reference photos needs, and every pixel past that
 *  is bytes on a site worker's mobile data. */
const MAX_EDGE_PX = 1080;

/** Quality ladder. Descending, and it stops at the first rung under budget. */
const QUALITY_STEPS = [0.82, 0.7, 0.6, 0.5, 0.4];

/**
 * How long a punch waits for a GPS fix before going without one.
 *
 * Matched to `ClockScreen.tsx`, which documents the failure this prevents: an
 * `await` that never settles is neither a fix nor a refusal, "and it blocked
 * the punch exactly as" a hard error would.
 */
const GEO_TIMEOUT_MS = 12_000;

const GEO_OPTIONS = {
  enableHighAccuracy: true,
  timeout: GEO_TIMEOUT_MS,
  // Never a cached position. A punch is a claim about where somebody is now.
  maximumAge: 0,
};

/**
 * One position fix, shaped for `PunchBody`.
 *
 * Resolves null when location is off, denied, or slow. Never rejects — the
 * caller punches anyway and the server flags it `geo`.
 *
 * `accuracy` and the altitude pair are passed through as the device reported
 * them, INCLUDING null. PunchBody's comments are emphatic about why: a missing
 * accuracy "is None and flags. Zero would read as a perfect fix and clear the
 * very check it should fail", and a defaulted altitude "would place every
 * silent device on the beach".
 */
export function captureGeoFix() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const c = position.coords;
          done({
            lat: c.latitude,
            lng: c.longitude,
            accuracy_m: c.accuracy ?? null,
            // ⚠ THE ALTITUDE PAIR IS GATED ON A POSITIVE ACCURACY, not on the
            // value being non-null, and the two are not the same test.
            //
            // The mobile app carried the null-check version and it was not
            // enough: expo-location passes Android's `getAltitude()` straight
            // through, and that returns **0.0** when the fix has no altitude —
            // so a handset with no vertical fix punched in at sea level. On the
            // web the spec says null, but a browser is free to report 0 with no
            // vertical fix, and iOS reports a NEGATIVE `altitudeAccuracy` when
            // the vertical solution is invalid.
            //
            // A strictly positive accuracy is the only thing that means "a
            // height was actually measured", on every platform. The pair
            // travels together or not at all: an altitude with no accuracy
            // cannot be judged against a site's vertical tolerance, and an
            // accuracy with no altitude says nothing. Absent stays absent, and
            // the server records "not reported" — the honest answer for a phone
            // indoors and for every device with no barometer.
            //
            // ⚠ THE KEYS ARE ALWAYS PRESENT, EXPLICITLY NULL WHEN THERE IS NO
            // VERTICAL FIX. A first version of this guard spread the pair in
            // only when it was valid, which left the keys ABSENT — and
            // `__tests__/pahchanClock.test.js` caught it: "a silent altimeter
            // must not be placed at sea level" asserts `toBeNull()`, and it got
            // `undefined`. Pydantic treats absent and null identically, so the
            // server never noticed; the payload shape changed for no gain.
            // Saying null out loud is the same fact stated rather than implied.
            ...(typeof c.altitudeAccuracy === 'number' && c.altitudeAccuracy > 0
                && typeof c.altitude === 'number'
              ? { altitude_m: c.altitude, altitude_accuracy_m: c.altitudeAccuracy }
              : { altitude_m: null, altitude_accuracy_m: null }),
          });
        },
        () => done(null),
        GEO_OPTIONS,
      );
    } catch {
      // Some embedded browsers throw synchronously rather than calling back.
      done(null);
    }
    // Belt and braces: Safari has shipped builds where neither callback fires
    // if the permission sheet is dismissed by a backgrounding. The punch must
    // not wait forever on that.
    setTimeout(() => done(null), GEO_TIMEOUT_MS + 1_000);
  });
}

/*
 * There is deliberately no `detectSource()` here.
 *
 * Recording whether a punch came from an installed iOS home-screen app or a
 * browser tab would be genuinely useful — it is the adoption number this whole
 * feature exists to move. But `PunchBody.source` only accepts `live|offline`,
 * and `device_id`, the one free-text field that could carry it, is declared on
 * the model and read by nothing: no INSERT references it and the mobile client
 * never sends it. Writing the surface into a column nothing selects is not
 * telemetry, it is litter. If this is wanted, it wants a column and a reader.
 */

/**
 * Idempotency key for one punch attempt.
 *
 * `client_punch_id` is 8–64 characters and is what makes a retry after a
 * timeout return the original punch instead of recording a second one. Generated
 * once when the shutter fires and reused for every retry of THAT punch.
 *
 * `crypto.randomUUID` where it exists; the fallback is only for older WebViews
 * and still clears the 8-character floor.
 */
export function newClientPunchId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `pw-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/** Scale a source frame down so its longest edge is at most MAX_EDGE_PX. */
function fittedSize(width, height) {
  const longest = Math.max(width, height);
  if (!longest || longest <= MAX_EDGE_PX) return { width, height };
  const scale = MAX_EDGE_PX / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function toBlob(canvas, quality) {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') { resolve(null); return; }
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

/**
 * Draw a video frame (or any canvas-drawable source) to a JPEG under budget.
 *
 * Walks the quality ladder and returns the first blob under TARGET_BYTES. If
 * even the lowest rung is over — a pathological source, not a real selfie — the
 * smallest attempt is returned anyway rather than nothing, because a large
 * photo the server might still accept beats no photo at all.
 *
 * Returns null only when the browser cannot encode at all, which is the one
 * case the caller treats as "no photo" and punches through flagged.
 *
 * @param {CanvasImageSource} source  a <video>, <img> or canvas
 * @param {number} width   intrinsic width of the source
 * @param {number} height  intrinsic height of the source
 */
export async function compressCapture(source, width, height) {
  if (typeof document === 'undefined' || !width || !height) return null;

  const size = fittedSize(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, size.width, size.height);

  let smallest = null;
  for (const quality of QUALITY_STEPS) {
    // eslint-disable-next-line no-await-in-loop -- the ladder is sequential by
    // design: each rung only runs because the previous one was over budget.
    const blob = await toBlob(canvas, quality);
    if (!blob) continue;
    if (!smallest || blob.size < smallest.size) smallest = blob;
    if (blob.size <= TARGET_BYTES) return blob;
  }
  return smallest;
}

/**
 * Which way the next punch goes.
 *
 * Mirrors `ClockScreen.tsx` exactly — `lastToday?.direction === 'in' ? 'out' : 'in'`
 * — so the two clients never disagree about what the button means.
 *
 * Deliberately scoped to TODAY. Someone who clocked in yesterday and never
 * clocked out is offered "Clock in" this morning, not "Clock out" against a
 * shift that ended sixteen hours ago. The unpaired punch is the bridge's
 * problem, and it already treats it as one: "An unpaired punch produces hours
 * of NULL, not zero. Someone who clocked in and never clocked out has an
 * unknown day, not an empty one."
 *
 * @param {Array} punches  from GET /v1/pahchan/me, newest first
 * @param {Date}  now      injectable so the tests do not depend on the clock
 */
export function nextDirection(punches, now = new Date()) {
  const today = (Array.isArray(punches) ? punches : []).filter((p) => {
    if (!p?.captured_at) return false;
    const at = new Date(p.captured_at);
    return !Number.isNaN(at.valueOf()) && at.toDateString() === now.toDateString();
  });
  // `/me` returns newest first, but sort rather than trust it: a client that
  // assumed order and got it wrong would offer the opposite of the right button.
  today.sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
  return today[0]?.direction === 'in' ? 'out' : 'in';
}
