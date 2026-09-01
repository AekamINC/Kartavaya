import CoreLocation

/**
 WHY THE CONTAINER ASKS FOR LOCATION, WHEN NOTHING NATIVE READS IT.

 Pahchan records where a person clocked in, and the web layer does it with the
 plain browser API — `navigator.geolocation.getCurrentPosition`, in
 `src/lib/pahchanClock.js` and `src/pages/pahchan/Sites.jsx`. That same call runs
 on the web, on Android and here. The container's job is to make the web API
 work, not to hand the web code a second path to maintain for one platform.

 WKWebView supports `navigator.geolocation` — but it will not ASK for
 permission, and that is the whole problem. For the camera there is a delegate
 callback, `requestMediaCapturePermissionFor`, and Capacitor already answers it
 with `.grant`; that is why `getUserMedia` needs nothing from this file. There is
 no equivalent callback for geolocation. A WKWebView simply inherits whatever
 authorization the HOST APP holds, and when the app holds none the geolocation
 callback never arrives at all: no prompt, and no error for the JS to catch. The
 punch sits on "finding you" forever.

 `pahchanClock.js` does impose its own timeout, so the screen fails rather than
 hangs — but it fails for a reason no operator can act on, because iOS never
 offered them the permission to grant.

 ── THE TRADE-OFF, STATED RATHER THAN HIDDEN ────────────────────────────────
 This asks at first launch, which means a person who only ever opens Ganit is
 asked for location too. The in-context alternative is to ask at the moment
 Pahchan first needs it, which needs either a Capacitor plugin (and a branch in
 shared web code) or KVO on the web view's URL to catch client-side route
 changes. Both were rejected for the same reason: this container has never been
 compiled, and an untested clever path that fails SILENTLY is worse than a
 tested-by-inspection simple one that fails LOUDLY. Revisit once the app builds.

 ⚠ NEVER COMPILED. The iOS container has not been built once. This file is
 written from the documented behaviour of WKWebView and CoreLocation and must be
 run on a device before anybody relies on it.
 */
final class LocationAuthorization: NSObject, CLLocationManagerDelegate {

    static let shared = LocationAuthorization()

    /// Retained deliberately. A `CLLocationManager` held only in a local goes
    /// out of scope before iOS can present the prompt, and then the prompt never
    /// appears — with no error and no log line, which is the same silent failure
    /// this file exists to remove.
    private let manager = CLLocationManager()

    private override init() {
        super.init()
        manager.delegate = self
    }

    /// Ask once, and only if iOS has not already decided.
    ///
    /// Any status other than `.notDetermined` is the person's settled answer —
    /// including a denial, which re-asking cannot change and which iOS would
    /// ignore anyway. Safe to call on every foreground.
    func requestWhenInUseIfNeeded() {
        guard manager.authorizationStatus == .notDetermined else { return }
        manager.requestWhenInUseAuthorization()
    }
}
