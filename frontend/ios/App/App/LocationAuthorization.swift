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
 callback never arrives at all: no prompt, and no error for the JS to catch.

 ── ASKED WHEN PAHCHAN ASKS, NOT AT LAUNCH ──────────────────────────────────
 This used to request at first launch, which meant someone who only ever opens
 Ganit was asked for their location too — bad manners, and the kind of thing
 App Review reads as a permission without context (guideline 5.1.1).

 It is now demand-driven: `KartavayaViewController` wraps `navigator.geolocation`
 in the page, and the first call from anywhere in the web app arrives here. So
 the prompt appears against the clock-in screen that needs it, and a person who
 never opens Pahchan is never asked at all.

 `ensureAuthorization` is the whole reason this is a class and not a one-liner.
 A person takes seconds to answer a system prompt, and the JS caller has to wait
 for the ANSWER rather than for the ask — otherwise the geolocation call runs
 while the dialog is still on screen, and fails for the same reason it would have
 failed with no dialog at all.

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

    /// Callers waiting for the person to answer. Everything here runs on the
    /// main queue: the manager is created on it, so its delegate callbacks
    /// arrive on it, and both entry points below are called from it.
    private var waiting: [() -> Void] = []

    private override init() {
        super.init()
        manager.delegate = self
    }

    /// Run `completion` once iOS has an answer — granted OR refused.
    ///
    /// A refusal still completes. The web call is then allowed to proceed and
    /// fail on its own terms, which is what the screen is written for: the
    /// alternative is a caller stranded forever on a question that has already
    /// been answered.
    func ensureAuthorization(_ completion: @escaping () -> Void) {
        guard manager.authorizationStatus == .notDetermined else {
            // Already settled, in either direction. Re-asking cannot change it
            // and iOS would not show the prompt again anyway.
            completion()
            return
        }

        let alreadyAsked = !waiting.isEmpty
        waiting.append(completion)
        // Only the first caller triggers the prompt; the rest queue behind the
        // same answer. Two clock-in attempts must not stack two dialogs.
        if !alreadyAsked {
            manager.requestWhenInUseAuthorization()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        // Fires once as soon as the delegate is set, with the current status —
        // so an undetermined status here is that first call, not an answer.
        guard manager.authorizationStatus != .notDetermined else { return }

        let settled = waiting
        waiting = []
        settled.forEach { $0() }
    }
}
