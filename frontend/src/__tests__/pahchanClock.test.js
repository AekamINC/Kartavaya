import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  captureGeoFix, compressCapture, newClientPunchId, nextDirection,
  SERVER_PHOTO_LIMIT_BYTES,
} from '../lib/pahchanClock';

/**
 * The web clock screen's three non-obvious pieces.
 *
 * All three exist to keep §2 of `07-pahchan.md` true — nothing blocks a punch —
 * so most of what is asserted here is that a failure returns a value rather
 * than throwing.
 */

afterEach(() => { vi.unstubAllGlobals(); });

// ── nextDirection ────────────────────────────────────────────────────────────

describe('nextDirection', () => {
  const now = new Date('2026-08-26T18:00:00+05:30');
  const at = (iso) => ({ direction: 'in', captured_at: iso });

  it('offers "in" when nothing has been punched', () => {
    expect(nextDirection([], now)).toBe('in');
    expect(nextDirection(null, now)).toBe('in');
    expect(nextDirection(undefined, now)).toBe('in');
  });

  it('offers "out" after an "in" earlier today', () => {
    expect(nextDirection([at('2026-08-26T09:30:00+05:30')], now)).toBe('out');
  });

  it('offers "in" again after the day has been closed', () => {
    const punches = [
      { direction: 'out', captured_at: '2026-08-26T17:30:00+05:30' },
      { direction: 'in', captured_at: '2026-08-26T09:30:00+05:30' },
    ];
    expect(nextDirection(punches, now)).toBe('in');
  });

  it('ignores yesterday, so an unclosed shift never blocks the morning', () => {
    // The owner's rule: somebody who forgot to clock out last night must be
    // offered "Clock in" today, not "Clock out" against a dead shift.
    const punches = [{ direction: 'in', captured_at: '2026-08-25T09:30:00+05:30' }];
    expect(nextDirection(punches, now)).toBe('in');
  });

  it('does not trust the order it is given', () => {
    // Same two punches, oldest first. A client that assumed newest-first would
    // offer the opposite of the right button.
    const punches = [
      { direction: 'in', captured_at: '2026-08-26T09:30:00+05:30' },
      { direction: 'out', captured_at: '2026-08-26T17:30:00+05:30' },
    ];
    expect(nextDirection(punches, now)).toBe('in');
  });

  it('skips rows with a missing or unparseable timestamp', () => {
    const punches = [
      { direction: 'in', captured_at: null },
      { direction: 'in', captured_at: 'not a date' },
    ];
    expect(nextDirection(punches, now)).toBe('in');
  });
});

// ── newClientPunchId ─────────────────────────────────────────────────────────

describe('newClientPunchId', () => {
  it('clears the 8-character floor the server enforces', () => {
    const id = newClientPunchId();
    expect(id.length).toBeGreaterThanOrEqual(8);
    expect(id.length).toBeLessThanOrEqual(64);
  });

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newClientPunchId()));
    expect(ids.size).toBe(50);
  });

  it('still produces a usable id without crypto.randomUUID', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (arr) => { arr.fill(7); return arr; },
    });
    const id = newClientPunchId();
    expect(id.length).toBeGreaterThanOrEqual(8);
    expect(id.length).toBeLessThanOrEqual(64);
  });
});

// ── captureGeoFix ────────────────────────────────────────────────────────────

describe('captureGeoFix', () => {
  it('resolves null rather than rejecting when permission is denied', async () => {
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: (_ok, fail) => fail({ code: 1 }) },
    });
    await expect(captureGeoFix()).resolves.toBeNull();
  });

  it('resolves null when the browser has no geolocation at all', async () => {
    vi.stubGlobal('navigator', {});
    await expect(captureGeoFix()).resolves.toBeNull();
  });

  it('resolves null when getCurrentPosition throws synchronously', async () => {
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: () => { throw new Error('embedded webview'); } },
    });
    await expect(captureGeoFix()).resolves.toBeNull();
  });

  it('passes lat, lng, accuracy and BOTH altitude fields through', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (ok) => ok({
          coords: {
            latitude: 23.0225, longitude: 72.5714, accuracy: 12,
            altitude: 53.4, altitudeAccuracy: 3.5,
          },
        }),
      },
    });
    await expect(captureGeoFix()).resolves.toEqual({
      lat: 23.0225,
      lng: 72.5714,
      accuracy_m: 12,
      altitude_m: 53.4,
      altitude_accuracy_m: 3.5,
    });
  });

  it('keeps a missing accuracy as null and never as zero', async () => {
    // PunchBody is explicit: "a missing accuracy is None and flags. Zero would
    // read as a perfect fix and clear the very check it should fail."
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (ok) => ok({
          coords: {
            latitude: 1, longitude: 2,
            accuracy: undefined, altitude: undefined, altitudeAccuracy: undefined,
          },
        }),
      },
    });
    const fix = await captureGeoFix();
    expect(fix.accuracy_m).toBeNull();
    // And a silent altimeter must not be placed at sea level.
    expect(fix.altitude_m).toBeNull();
    expect(fix.altitude_accuracy_m).toBeNull();
  });
});

// ── compressCapture ──────────────────────────────────────────────────────────

/** A canvas whose encoder returns `sizeFor(quality)` bytes. */
function stubCanvas(sizeFor, seen = []) {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: () => {} }),
    toBlob: (cb, _type, quality) => {
      seen.push(quality);
      cb({ size: sizeFor(quality), type: 'image/jpeg' });
    },
  };
  vi.stubGlobal('document', { createElement: () => canvas });
  return canvas;
}

describe('compressCapture', () => {
  it('stops at the first quality under budget', async () => {
    const seen = [];
    stubCanvas((q) => (q > 0.75 ? 900 * 1024 : 300 * 1024), seen);
    const blob = await compressCapture({}, 1280, 960);
    expect(blob.size).toBe(300 * 1024);
    // Two rungs tried, not the whole ladder.
    expect(seen).toEqual([0.82, 0.7]);
  });

  it('produces something the server would accept from a 4MB source', async () => {
    // The real failure this prevents: a raw front-camera JPEG is 2-4MB and
    // MAX_PHOTO_BYTES is 768KB, so an uncompressed capture is refused and the
    // mandatory selfie costs the employee the punch.
    stubCanvas((q) => Math.round(4 * 1024 * 1024 * q * 0.15));
    const blob = await compressCapture({}, 3024, 4032);
    expect(blob.size).toBeLessThan(SERVER_PHOTO_LIMIT_BYTES);
  });

  it('scales the longest edge down to 1080', async () => {
    const canvas = stubCanvas(() => 100);
    await compressCapture({}, 3024, 4032);
    expect(Math.max(canvas.width, canvas.height)).toBe(1080);
    // Aspect ratio preserved: 3024/4032 = 0.75 → 810 x 1080.
    expect(canvas.width).toBe(810);
    expect(canvas.height).toBe(1080);
  });

  it('does not upscale a small capture', async () => {
    const canvas = stubCanvas(() => 100);
    await compressCapture({}, 640, 480);
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
  });

  it('returns the smallest attempt rather than nothing when all are over', async () => {
    // Better a large photo the server might still take than no photo at all.
    stubCanvas((q) => Math.round(2_000_000 * q));
    const blob = await compressCapture({}, 1000, 1000);
    expect(blob.size).toBe(Math.round(2_000_000 * 0.4));
  });

  it('returns null when the browser cannot encode', async () => {
    vi.stubGlobal('document', {
      createElement: () => ({ getContext: () => null, width: 0, height: 0 }),
    });
    await expect(compressCapture({}, 100, 100)).resolves.toBeNull();
  });

  it('returns null for a source with no dimensions', async () => {
    // A <video> read before metadata arrives reports 0x0.
    stubCanvas(() => 100);
    await expect(compressCapture({}, 0, 0)).resolves.toBeNull();
  });
});
