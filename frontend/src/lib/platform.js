/**
 * platform — is this the installed app, or the website?
 *
 * The two need different first screens, and until now they got the same one.
 *
 * `/` renders the marketing landing page to anyone not signed in: a hero, a
 * module tour, plans, a "Request a demo" button. That is right on the web,
 * where the page's job is to explain the product to someone who has never seen
 * it. It is wrong in the APK, where the person has already been given an
 * account by their firm's admin, already installed a 8MB app, and is opening it
 * to do a day's work. Nobody installs an app and then needs convincing to try
 * the product.
 *
 * Same reasoning one screen deeper: the sign-in page devotes half its width to
 * a rotating panel selling Ganit, Dristi and the invite-only access model. On a
 * tablet in landscape that panel is 640px of advertising shown to someone whose
 * only intent is to type a password they already have.
 *
 * ── What counts as "the app" ────────────────────────────────────────────────
 *
 * Capacitor is the definite case: `window.Capacitor` is injected by the native
 * bridge, so its presence is proof, not a guess.
 *
 * An INSTALLED PWA counts too. A user who added Kartavaya to their home screen
 * from the browser is in exactly the same position — they have an account, they
 * launched from an icon, and a standalone window with no address bar is not
 * where anyone browses marketing copy. `display-mode: standalone` is how the
 * platform reports that, and `navigator.standalone` is the iOS Safari spelling
 * of the same fact.
 *
 * Deliberately NOT included: viewport width, user agent, touch support. A
 * narrow browser window is still the website, and someone reading the landing
 * page on a phone should still get the landing page. This asks how the product
 * was LAUNCHED, which is the question that actually distinguishes the cases.
 */

/** True inside the Capacitor container — the APK or an iOS build. */
export function isNativeApp() {
  if (typeof window === 'undefined') return false;
  const cap = window.Capacitor;
  if (!cap) return false;
  // Capacitor 8 exposes a function; older bridges set a boolean. Accept both
  // rather than depending on a bridge version the web build never loads.
  if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform();
  return cap.isNative === true;
}

/**
 * True for the APK and for an installed PWA — anything launched from an icon
 * rather than typed into an address bar.
 *
 * Read at call time, not cached at module load: the bridge is injected before
 * the bundle evaluates, but `display-mode` can change within a session when a
 * browser tab is installed to the home screen, and a stale `false` would strand
 * that user on marketing copy for the rest of the session.
 */
export function isInstalledApp() {
  if (typeof window === 'undefined') return false;
  if (isNativeApp()) return true;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  } catch { /* matchMedia is absent in some embedded webviews */ }
  return window.navigator?.standalone === true;
}
