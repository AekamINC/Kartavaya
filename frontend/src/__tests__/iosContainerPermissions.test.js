/**
 * The iOS container asks for exactly what it uses, in words somebody reviewed.
 *
 * ── WHY A TEST AND NOT A COMMENT ────────────────────────────────────────────
 *
 * The permission sentences now live in TWO files: `mobile/app.json` for the Expo
 * build, and `frontend/ios/App/App/Info.plist` for the Capacitor container. That
 * is one rule in two copies, which is the shape CLAUDE.md already records going
 * wrong three times ("three copies of one rule"). Nothing in a build catches a
 * drift between them — an edited sentence in one file simply means two products
 * tell the same employee two different things about what is read and when.
 *
 * ── AND THE FAILURE IS WORSE THAN COSMETIC ──────────────────────────────────
 *
 * iOS refuses to SHOW a permission sheet whose usage-description key is absent.
 * It does not warn, and it does not fall back: the camera call fails, the shutter
 * never opens, and the punch cannot be made. On the App Store it is a rejection;
 * on a simulator demo it is the feature not working in front of a director. A
 * missing key here is the whole clock screen, silently.
 *
 * ── THE ABSENCES ARE ASSERTED TOO ───────────────────────────────────────────
 *
 * `NSPhotoLibraryUsageDescription` must NOT be here. Both capture screens refuse
 * the gallery on purpose — a reference photo chosen from disk lets somebody
 * enroll a face that is not theirs, and every later comparison confirms the
 * substitution rather than catching it. Declaring the key would advertise a
 * capability the product deliberately does not have, and invite an App Review
 * question with no good answer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = ['.', '..'].map((p) => path.resolve(process.cwd(), p))
  .find((p) => existsSync(path.join(p, 'mobile', 'app.json')));

const PLIST = ['frontend/ios/App/App/Info.plist', 'ios/App/App/Info.plist']
  .map((p) => path.resolve(process.cwd(), p))
  .find(existsSync);

/** One <string> value by its <key>, without a plist parser dependency. */
function plistString(xml, key) {
  const m = xml.match(
    new RegExp(`<key>${key}</key>\\s*<string>([\\s\\S]*?)</string>`),
  );
  return m ? m[1].trim() : null;
}

const plist = PLIST ? readFileSync(PLIST, 'utf8') : '';
const expo = ROOT
  ? JSON.parse(readFileSync(path.join(ROOT, 'mobile', 'app.json'), 'utf8'))
  : null;
const expoStrings = expo?.expo?.ios?.infoPlist || {};

/** The two the container actually needs: a selfie and a fix, per punch. */
const REQUIRED = ['NSCameraUsageDescription', 'NSLocationWhenInUseUsageDescription'];

/** Capabilities the product refuses. Present here would be a lie about it. */
const FORBIDDEN = ['NSPhotoLibraryUsageDescription', 'NSMicrophoneUsageDescription'];

describe('iOS container — Info.plist', () => {
  it('exists at all', () => {
    // `npx cap add ios` generates it. A repo without it has no iOS target, and
    // every assertion below would otherwise pass vacuously over an empty string.
    expect(PLIST, 'no ios/App/App/Info.plist — was `npx cap add ios` run?').toBeTruthy();
    expect(plist.length).toBeGreaterThan(0);
  });

  it('reads the Expo manifest it is meant to agree with', () => {
    // The other half of the anti-vacuity floor: if this file could not find
    // mobile/app.json, the drift test below would compare null to null.
    expect(ROOT, 'could not locate mobile/app.json').toBeTruthy();
    for (const key of REQUIRED) {
      expect(expoStrings[key], `mobile/app.json has no ${key}`).toBeTruthy();
    }
  });

  it.each(REQUIRED)('declares %s', (key) => {
    const value = plistString(plist, key);
    expect(value, `Info.plist is missing ${key} — iOS will not show the sheet`).toBeTruthy();
    expect(value.length).toBeGreaterThan(20);
  });

  it.each(REQUIRED)('says the same thing as the Expo build for %s', (key) => {
    expect(plistString(plist, key)).toBe(expoStrings[key]);
  });

  it.each(FORBIDDEN)('does not declare %s', (key) => {
    expect(plist).not.toContain(`<key>${key}</key>`);
  });

  it('tells the employee WHEN location is read, not just that it is', () => {
    // "While using the app" is what iOS says. It is not what this product does,
    // and the permission sheet is the only place most employees will ever be
    // told the difference.
    const loc = plistString(plist, 'NSLocationWhenInUseUsageDescription') || '';
    expect(loc).toContain('at the moment you punch and at no other time');
  });

  it('answers the export-compliance question up front', () => {
    // Absent, Apple asks it on every single upload.
    expect(plist).toContain('<key>ITSAppUsesNonExemptEncryption</key>');
  });

  it('ships under the same bundle id as the Android build', () => {
    const cfg = JSON.parse(
      readFileSync(path.resolve(process.cwd(), existsSync('capacitor.config.json')
        ? 'capacitor.config.json' : 'frontend/capacitor.config.json'), 'utf8'),
    );
    expect(cfg.appId).toBe('com.aekam.kartavaya');
  });
});
