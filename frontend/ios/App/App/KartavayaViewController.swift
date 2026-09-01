import Capacitor
import WebKit

/**
 The container's own bridge view controller.

 It exists for one job: make `navigator.geolocation` work inside a WKWebView
 without the web app knowing it is inside one.

 ── WHY A SCRIPT AND NOT A PLUGIN ───────────────────────────────────────────
 WKWebView supports `navigator.geolocation` but never ASKS for permission —
 there is no delegate callback for it the way there is for camera capture. The
 web view just inherits whatever the host app holds, so with no authorization
 the callback never arrives: no prompt, no error, nothing for the JS to catch.
 Something native has to ask, and it has to ask at the moment the web app cares.

 The two alternatives were rejected:

   · a Capacitor geolocation plugin means `pahchanClock.js` and `Sites.jsx`
     branch on the platform, so one screen grows two ways of finding a location
     and only one of them is exercised by the web tests;
   · KVO on the web view's URL to spot a `/pahchan` route is indirect — it fires
     on navigation, and the thing that actually needs permission is a CALL.

 Wrapping the API itself is neither. The prompt appears exactly when Pahchan asks
 for a position, from whatever screen asks, and the web code is identical on all
 three platforms. Someone who only opens Ganit is never asked.

 ── WHY IT IS SAFE TO WRAP ──────────────────────────────────────────────────
 The shim never answers a geolocation call itself. It waits for iOS to settle the
 permission and then hands the ORIGINAL function the caller's own arguments, so
 success, error and options behave exactly as the platform defines them. A
 refusal is not swallowed either: the real call runs and fails on its own terms,
 which is what the screen is written to handle.

 ⚠ NEVER COMPILED. Written from the documented behaviour of WKWebView,
 WKUserScript and CoreLocation. Must be run on a device before it is trusted.
 */
final class KartavayaViewController: CAPBridgeViewController {

    /// The one name the Swift and the JavaScript both have to agree on. Kept in
    /// a single constant and interpolated into the script below, so the two
    /// halves cannot drift into a channel that posts into nothing.
    static let locationChannel = "KartavayaLocation"

    private var locationBridge: LocationBridge?

    /// `capacitorDidLoad` runs inside `loadView()` — the web view and its
    /// content controller exist, and `loadWebView()` has NOT yet fetched the
    /// page. That ordering is what makes an `.atDocumentStart` script able to
    /// gate the very first call the app makes.
    ///
    /// The configuration returned by `webViewConfiguration(for:)` is the wrong
    /// place: Capacitor REPLACES `userContentController` with its own after that
    /// method returns, and anything added there is silently discarded.
    override func capacitorDidLoad() {
        super.capacitorDidLoad()

        guard let webView = webView else { return }
        let controller = webView.configuration.userContentController

        let bridge = LocationBridge()
        bridge.webView = webView
        locationBridge = bridge

        controller.add(bridge, name: Self.locationChannel)
        controller.addUserScript(
            WKUserScript(source: Self.geolocationShim,
                         injectionTime: .atDocumentStart,
                         forMainFrameOnly: true)
        )
    }

    /// Separate from the view controller on purpose: `add(_:name:)` retains its
    /// handler strongly, so registering `self` would make the root view
    /// controller immortal. This holds the web view weakly and breaks the cycle.
    private final class LocationBridge: NSObject, WKScriptMessageHandler {
        weak var webView: WKWebView?

        func userContentController(_ userContentController: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            guard message.name == KartavayaViewController.locationChannel else { return }

            LocationAuthorization.shared.ensureAuthorization { [weak self] in
                // Release every queued caller. Guarded on the JS side so a
                // reply that arrives after a reload cannot throw.
                self?.webView?.evaluateJavaScript(
                    "window.__kartavayaLocationSettled && window.__kartavayaLocationSettled()"
                )
            }
        }
    }

    /// Runs before any app code. Defers `navigator.geolocation` calls until iOS
    /// has settled the permission, then replays them into the real API.
    private static let geolocationShim = """
    (function () {
      var geo = navigator.geolocation;
      var handler = window.webkit
        && window.webkit.messageHandlers
        && window.webkit.messageHandlers.\(locationChannel);
      // Not in the container (a browser, or a frame with no bridge): leave the
      // platform API exactly as it is.
      if (!geo || !handler) { return; }

      var settled  = false;
      var waiting  = [];

      // Called by LocationBridge once iOS has an answer, either way.
      window.__kartavayaLocationSettled = function () {
        settled = true;
        var queued = waiting;
        waiting = [];
        for (var i = 0; i < queued.length; i++) {
          try { queued[i](); } catch (e) { /* one caller must not stop the rest */ }
        }
      };

      function whenSettled(run) {
        if (settled) { run(); return; }
        waiting.push(run);
        // Ask on every call, not just the first: the native side collapses them
        // onto one prompt, and a page that reloaded after an answer needs to
        // learn the status again.
        try {
          handler.postMessage({});
        } catch (e) {
          // The bridge is gone. Run anyway — a stranded caller is worse than one
          // that fails the way it would have failed before any of this existed.
          run();
        }
      }

      var realGet   = geo.getCurrentPosition.bind(geo);
      var realWatch = geo.watchPosition.bind(geo);
      var realClear = geo.clearWatch.bind(geo);

      geo.getCurrentPosition = function (onOk, onErr, options) {
        whenSettled(function () { realGet(onOk, onErr, options); });
      };

      // Pahchan does not call watchPosition today. It is wrapped anyway, because
      // the one that is NOT wrapped is the one that silently skips the prompt
      // when somebody adds it later. A watch id has to be returned
      // synchronously, so a negative placeholder stands in until the real watch
      // starts, and clearWatch maps it back.
      var nextPlaceholder = -1;
      var realIds   = {};
      var cancelled = {};

      geo.watchPosition = function (onOk, onErr, options) {
        var id = nextPlaceholder--;
        whenSettled(function () {
          if (cancelled[id]) { return; }
          realIds[id] = realWatch(onOk, onErr, options);
        });
        return id;
      };

      geo.clearWatch = function (id) {
        if (id < 0) {
          cancelled[id] = true;
          if (realIds[id] !== undefined) {
            realClear(realIds[id]);
            delete realIds[id];
          }
          return;
        }
        realClear(id);
      };
    })();
    """
}
