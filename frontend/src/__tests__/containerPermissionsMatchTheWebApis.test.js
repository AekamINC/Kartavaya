/**
 * The native containers must declare exactly the permissions the web code uses.
 *
 * ── WHY THIS IS A TEST AND NOT A CHECKLIST ──────────────────────────────────
 *
 * Kartavaya ships the same web build three ways: the browser, an Android
 * WebView and an iOS WKWebView (`frontend/android`, `frontend/ios`, Capacitor).
 * Pahchan's clock-in asks for a camera and a location with the PLAIN browser
 * APIs, so that one code path serves all three:
 *
 *     navigator.mediaDevices.getUserMedia   Clock.jsx, Enroll.jsx
 *     navigator.geolocation                 pahchanClock.js, Sites.jsx
 *
 * A container that has not declared the matching permission does not throw and
 * does not log. On Android an undeclared runtime permission is refused by the
 * framework with no dialog shown; on iOS a missing usage string kills the app at
 * the moment of the request, and — worse — WKWebView never ASKS for location at
 * all, so the geolocation callback simply never arrives. Every one of those is
 * silent at the only place anybody is watching, which is the phone.
 *
 * That is the same shape as the invoice custom fields: the engine complete, the
 * entry point absent, nothing red anywhere. So the declarations are derived from
 * the CALLS rather than pinned to a list — add `audio: true` to a getUserMedia
 * anywhere and this file starts demanding a microphone permission, without
 * anybody remembering to come back here.
 *
 * ⚠ NEITHER CONTAINER HAS EVER BEEN COMPILED. This asserts that the manifests
 * agree with the source. It cannot tell you the app runs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..');
const FRONTEND = path.join(SRC, '..');

const MANIFEST = path.join(FRONTEND, 'android', 'app', 'src', 'main',
                           'AndroidManifest.xml');
const INFO_PLIST = path.join(FRONTEND, 'ios', 'App', 'App', 'Info.plist');
const PBXPROJ = path.join(FRONTEND, 'ios', 'App', 'App.xcodeproj',
                          'project.pbxproj');
const IOS_APP = path.join(FRONTEND, 'ios', 'App', 'App');

const read = (p) => fs.readFileSync(p, 'utf8');

/** Every .js/.jsx under src/, excluding tests — the shipped web code. */
function sourceFiles(dir = SRC, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (/\.jsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

/** What the shipped web code actually asks the device for. */
function deviceApisUsed() {
  const used = { camera: [], microphone: [], location: [] };
  for (const file of sourceFiles()) {
    const src = read(file);
    const rel = path.relative(FRONTEND, file).replace(/\\/g, '/');

    // A getUserMedia CALL, not a capability check — `?.getUserMedia` guards
    // appear beside every call and would double-count.
    for (const m of src.matchAll(/getUserMedia\(\s*\{([\s\S]{0,400}?)\}\s*\)/g)) {
      const constraints = m[1];
      // Read the VALUE and compare it, rather than a negative lookahead after
      // `\s*` — that backtracks to zero width and then happily reports
      // `audio: false` as a microphone request. It did exactly that here.
      const value = (key) => (new RegExp(`\\b${key}\\s*:\\s*([^,}\\s]+)`)
        .exec(constraints) || [])[1];
      if (value('video') && value('video') !== 'false') used.camera.push(rel);
      if (value('audio') && value('audio') !== 'false') used.microphone.push(rel);
    }
    if (/navigator\.geolocation\.(getCurrentPosition|watchPosition)\s*\(/.test(src)) {
      used.location.push(rel);
    }
  }
  return used;
}

describe('the anti-vacuity floor', () => {
  it('the scanner actually finds the calls it reasons about', () => {
    // Every claim below is conditional on what this returns. If the scanner
    // silently matched nothing, the whole file would pass over an app with no
    // permissions declared at all.
    const used = deviceApisUsed();
    expect(used.camera.length, `camera calls found: ${used.camera}`)
      .toBeGreaterThanOrEqual(2);          // Clock.jsx + Enroll.jsx
    expect(used.location.length, `geolocation calls found: ${used.location}`)
      .toBeGreaterThanOrEqual(2);          // pahchanClock.js + Sites.jsx
  });

  it('the container files are readable and non-empty', () => {
    for (const p of [MANIFEST, INFO_PLIST, PBXPROJ]) {
      expect(read(p).length, `${p} is empty`).toBeGreaterThan(200);
    }
  });
});

describe('Android declares what the WebView will be asked for', () => {
  const used = deviceApisUsed();
  const manifest = read(MANIFEST);
  const declares = (perm) =>
    manifest.includes(`android.permission.${perm}`);

  it('CAMERA, because getUserMedia asks for video', () => {
    // Capacitor's BridgeWebChromeClient.onPermissionRequest already requests
    // CAMERA at runtime — but the framework refuses an undeclared permission
    // WITHOUT showing a dialog, so the declaration is what makes that reachable.
    expect(used.camera.length).toBeGreaterThan(0);
    expect(declares('CAMERA'), 'getUserMedia asks for video and CAMERA is not declared').toBe(true);
  });

  it('both location permissions, because Capacitor requests both', () => {
    expect(used.location.length).toBeGreaterThan(0);
    // onGeolocationPermissionsShowPrompt launches COARSE and FINE together;
    // declaring only one makes the whole request fail.
    expect(declares('ACCESS_COARSE_LOCATION')).toBe(true);
    expect(declares('ACCESS_FINE_LOCATION')).toBe(true);
  });

  it('NO microphone, because every getUserMedia passes audio: false', () => {
    // The rule cuts both ways. A permission the app does not use is a claim on
    // the person's device it cannot justify, and Play asks about each one.
    expect(used.microphone, 'a getUserMedia now asks for audio').toEqual([]);
    expect(declares('RECORD_AUDIO'),
      'RECORD_AUDIO is declared but nothing opens the microphone').toBe(false);
  });

  it('the camera is not an install requirement', () => {
    // Without this, Play treats CAMERA as implied hardware and hides the app
    // from tablets that have none — which would still run the other 15 modules.
    expect(manifest).toMatch(
      /<uses-feature[^>]*android\.hardware\.camera[^>]*android:required="false"/);
  });
});

describe('iOS declares what the WKWebView will be asked for', () => {
  const used = deviceApisUsed();
  const plist = read(INFO_PLIST);

  it('NSCameraUsageDescription, with a real explanation', () => {
    expect(used.camera.length).toBeGreaterThan(0);
    const m = plist.match(
      /<key>NSCameraUsageDescription<\/key>\s*<string>([\s\S]*?)<\/string>/);
    expect(m, 'NSCameraUsageDescription is missing — iOS kills the app on the ask')
      .toBeTruthy();
    // Apple rejects a placeholder, and so should we: the string is what the
    // person reads before deciding.
    expect(m[1].trim().length).toBeGreaterThan(40);
  });

  it('NSLocationWhenInUseUsageDescription, with a real explanation', () => {
    expect(used.location.length).toBeGreaterThan(0);
    const m = plist.match(
      /<key>NSLocationWhenInUseUsageDescription<\/key>\s*<string>([\s\S]*?)<\/string>/);
    expect(m, 'NSLocationWhenInUseUsageDescription is missing').toBeTruthy();
    expect(m[1].trim().length).toBeGreaterThan(40);
  });

  it('NO microphone string, because nothing opens the microphone', () => {
    expect(used.microphone).toEqual([]);
    // Info.plist carries a comment reasoning about exactly this for the photo
    // library; the same rule applies here.
    expect(/<key>NSMicrophoneUsageDescription<\/key>/.test(plist)).toBe(false);
  });

  it('something native asks for location, because WKWebView will not', () => {
    // THE ONE THAT IS NOT A STRING. A usage description does not make the
    // prompt appear. WKWebView has a delegate callback for camera capture —
    // Capacitor answers it with .grant — and NONE for geolocation: the web view
    // inherits the host app's authorization, and if the app never requests any,
    // `navigator.geolocation` calls back never. No prompt, no error, a punch
    // that cannot find where it happened.
    const swift = fs.readdirSync(IOS_APP).filter((f) => f.endsWith('.swift'));
    const asking = swift.filter((f) =>
      /requestWhenInUseAuthorization\s*\(/.test(read(path.join(IOS_APP, f))));
    expect(asking.length,
      `no Swift file requests location authorization; searched ${swift}`)
      .toBeGreaterThan(0);
  });

  it('and that file is in the build, not merely in the folder', () => {
    // THE ORPHANED-CAPABILITY CHECK. A .swift sitting next to the others but
    // absent from project.pbxproj is not compiled — the code is perfect, the
    // behaviour is missing, and Xcode says nothing. Same shape as the invoice
    // custom field that no screen could define.
    const pbx = read(PBXPROJ);
    const swift = fs.readdirSync(IOS_APP).filter((f) => f.endsWith('.swift'));
    const orphans = swift.filter((f) => !pbx.includes(f));
    expect(orphans,
      'Swift sources not referenced by project.pbxproj — they will not compile')
      .toEqual([]);

    // Paired presence assertion: an empty folder would satisfy the line above.
    expect(swift.length).toBeGreaterThanOrEqual(3);

    // Referenced is not the same as COMPILED — a file can be declared and left
    // out of the Sources phase, which is the silent half of this failure.
    const sources = pbx.match(
      /\/\* Sources \*\/ = \{[\s\S]*?files = \(([\s\S]*?)\);/);
    expect(sources, 'could not find the Sources build phase').toBeTruthy();
    for (const f of swift) {
      expect(sources[1], `${f} is not in the Sources build phase`).toContain(f);
    }
  });
});
