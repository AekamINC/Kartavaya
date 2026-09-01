# The iOS / iPadOS container

Phase 1 of proposal 94. The iOS target now exists at `frontend/ios/`, built by
Capacitor around the same `dist/` the web app ships. There is no second codebase
and no second clock screen — an iPhone runs `frontend/src/pages/pahchan/Clock.jsx`,
the one the browser already runs.

## What is done, and what is not

| | State |
|---|---|
| iOS target scaffolded (`npx cap add ios`) | done — committed |
| Camera + location usage strings | done — pinned by a test |
| `npm run ios` | done |
| Web assets sync into the container | done (`npx cap sync ios`) |
| **Compiled, run in a simulator** | **not done — needs a Mac** |
| TestFlight / App Store | needs the paid Apple Developer account |

⚠ **Nothing here has been compiled.** Xcode does not run on Windows, so the
scaffold, the plist and the sync are verified and the *build* is not. Treat
"it builds" as unproven until somebody runs step 3 below. This is the honest
line between what was done and what is claimed.

## Building it (on a Mac)

```bash
cd frontend && npm install && npm run ios
```

That builds `dist/`, syncs it into `ios/App/App/public`, and opens Xcode. Then in
Xcode: pick a simulator and press Run.

Capacitor 8 uses Swift Package Manager, **not CocoaPods** — there is no
`pod install` step and no `Podfile`. (This is also why `cap add ios` succeeded on
Windows at all.)

## What the paid Apple account is actually for

Distribution, and only distribution. A simulator build needs no account; running
on your own iPhone with a free personal team works for seven days at a time.
TestFlight and the App Store need the $99/year membership. Nothing before that
does — so a demo to a director is not blocked on Apple.

## The two permission strings

`ios/App/App/Info.plist` carries `NSCameraUsageDescription` and
`NSLocationWhenInUseUsageDescription`, copied **verbatim** from
`mobile/app.json`, where they were written for the Expo build.

`src/__tests__/iosContainerPermissions.test.js` fails if the two files drift, if
either key goes missing, or if `NSPhotoLibraryUsageDescription` appears. That
last one is not tidiness: both capture screens refuse the gallery on purpose,
because a reference photo chosen from disk lets somebody enroll a face that is
not theirs, and every later comparison then confirms the substitution rather than
catching it. Declaring the key would advertise a capability the product
deliberately does not have.

A missing usage string is not a cosmetic gap. iOS refuses to show the permission
sheet at all when the key is absent — no warning, no fallback — so the camera
never opens and the punch cannot be made.

## Why phase 0 came first

An iPhone punch would have arrived flagged exactly like the fourteen before it.
Phase 0 fixed the reasons, all of them in shared web code, so the Android app and
the browser got the same fixes:

- `accuracy_m = 0` cleared the very check it should fail — every one of the 14
  existing punches carries it, the signature of a scripted browser.
- The altitude pair was gated on non-null, and Android's `getAltitude()` returns
  `0.0` with no vertical fix, so silent devices punched in at sea level. Now
  gated on a strictly positive `altitudeAccuracy`, on both clients.
- The location fix was taken *after* the photo upload, so on a slow connection it
  described where somebody was thirty seconds after the moment the punch records.
  It is taken at the shutter now.
- Nothing opened the clock by URL, so a home-screen icon landed on the dashboard.
  `/pahchan?tab=clock` works and the manifest carries a shortcut.
- **There was no self-enrollment screen anywhere on the web**, which is why 0
  enrollment photos existed product-wide and all 14 punches were flagged `noref`.
  `Pahchan → My photos` is that screen.

## The blocker that is not Apple

22 of 30 employees have no login, so they would be refused on any device. That is
worth fixing before a demo and no amount of iOS work touches it.
