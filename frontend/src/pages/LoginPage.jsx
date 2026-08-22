import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useToast } from '../components/ui/toast';
import AuthShell from '../components/layout/AuthShell';
import BrandLoader from '../components/layout/BrandLoader';
import {
  apiLogin, apiAcceptInvite, apiForgotPassword, apiResetPassword,
  apiInvitePreview, apiDeclineInvite,
} from '../lib/auth';
import { moduleMeta } from '../lib/moduleColors';
import { useSecondary, Secondary } from '../components/Bilingual';
import { useLanguage } from '../components/CustomizePanel';
import { secondaryOf } from '../lib/labels';

/**
 * How long the lotus holds after a sign-in, before the app appears.
 *
 * 5.0s. Two things have to be true for a deliberate delay to be defensible, and
 * both are:
 *
 *   IT COMPLETES THE FIGURE. `lotus-trim` is a 3.2s cycle that draws to full at
 *   42% (1.34s) and holds until 72% (2.30s). Every other wait in the product is
 *   shorter than that, so the mark was only ever seen mid-assembly. Five seconds
 *   is one full cycle and half of the next — the flower is complete, and the
 *   second draw has started, so it reads as alive rather than as a frozen image.
 *
 *   IT IS NOT WASTED. The owner's reason for 5s over 3s was that the app could
 *   load behind it — which it could not, as this was first written: `navigate`
 *   fired AFTER the wait, so the route chunk had not been requested and the hold
 *   simply postponed the work. `preloadHome` below starts it at the top of the
 *   hold instead, so the two overlap and the delay buys something.
 *
 * A hold that neither completes the animation nor covers real work is just a
 * slower product, and should be deleted rather than tuned.
 */
const WELCOME_HOLD_MS = 5000;

/**
 * Pull the destination's chunk while the mark is on screen.
 *
 * `App.jsx` lazy-imports both landing routes, so without this the browser does
 * not begin fetching either until the route changes — the moment the user is
 * finally looking at something. Warming it here means the Suspense fallback
 * after `navigate` is usually never seen at all.
 *
 * Failure is swallowed on purpose: this is an optimisation, and a preload that
 * 404s behind a deploy must not take a successful sign-in with it. The real
 * import runs again on navigate and owns the error.
 */
function preloadHome(isClient) {
  try {
    if (isClient) import('./ClientPages');
    else import('./DashboardPage');
  } catch { /* optimisation only */ }
}

/**
 * How long to hold, for THIS user, right now.
 *
 * Reads `--ix` — the product's own motion multiplier, written by `applyPrefs`
 * and by the `prefers-reduced-motion` query in `a11y.css`. It bottoms out at
 * `.001` rather than 0, so a user who asked for no animation is not made to
 * watch one for three seconds. Using the existing token rather than calling
 * `matchMedia` here means there is one motion setting in the product, not two
 * that can disagree.
 *
 * An empty value means the stylesheet has not been applied — no browser, or a
 * test environment. We cannot ask, so we do not hold: making somebody wait on
 * an assumption is worse than not making them wait.
 */
function welcomeHoldMs() {
  try {
    const ix = getComputedStyle(document.documentElement).getPropertyValue('--ix').trim();
    if (!ix) return 0;
    return parseFloat(ix) < 0.5 ? 0 : WELCOME_HOLD_MS;
  } catch { return 0; }
}

/**
 * The four auth screens — 12-auth-onboarding.md §2.
 *
 *   LoginForm         email · password · remember · forgot
 *   AcceptInviteForm  invited (org known) · expired
 *   ForgotForm        always the same confirmation, regardless of account existence
 *   ResetForm         strength meter · confirm · states its side effects
 *
 * They stay in one module because App.jsx lazy-imports all four names from this
 * path; splitting the file would move the route targets.
 *
 * WHAT CHANGED, and why
 *
 * The palette. AuthShell moved onto tokens in 884e11a but these forms did not:
 * `K.grad` (`linear-gradient(90deg,#0082c6,#03a1b6,#05b7aa)`), `K.blue`
 * (`#0082c6`, the brand blue 00 §9 retires), `K.mid`, and the literals
 * `#0a1628`, `#8aa5be`, `#5a7087`, `#1a2230` were still hard-coded on every
 * heading, link and helper line. None of them could follow the theme, so the
 * shell went dark around text that stayed navy.
 *
 * The fields. 12 §1 specifies an M3 tonal field with a floating label; the
 * `placeholder=" "` on every input is load-bearing, because the label floats off
 * `:not(:placeholder-shown)` and without it a pre-filled field — the
 * accept-invite case, where the email arrives populated — keeps its label
 * sitting on top of the value.
 *
 * The errors. 12: "Errors surface only as toasts — no inline field validation
 * anywhere in the flow. A wrong password produces a toast in the corner while
 * the field that caused it looks fine." Field-level problems now render under
 * their field, a rejected credential renders as a banner above the form with a
 * shake, and the toast is kept for exactly what 12 §5 says to keep it for:
 * network failure, which is not about any field.
 */

/* ── Icons ────────────────────────────────────────────────────────────────── */
const svg = (p) => ({
  width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', ...p,
});
const IconAlert = (p) => (
  <svg {...svg(p)}><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16.5v.01" /></svg>
);
const IconCheck = (p) => (
  <svg {...svg(p)}><path d="M20 6L9 17l-5-5" /></svg>
);
const IconX = (p) => (
  <svg {...svg(p)}><path d="M18 6L6 18M6 6l12 12" /></svg>
);
const IconMail = (p) => (
  <svg {...svg(p)}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 7l10 6 10-6" /></svg>
);
function IconEye({ open }) {
  return open ? (
    <svg {...svg({ width: 17, height: 17, strokeWidth: 1.8 })}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg {...svg({ width: 17, height: 17, strokeWidth: 1.8 })}>
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  );
}

/* ── Password rules (AUTH-SPEC "Password strength") ───────────────────────── */
const RULES = [
  { test: (p) => p.length >= 8, miss: 'use at least 8 characters' },
  { test: (p) => p.length >= 12, miss: 'make it 12 or more' },
  { test: (p) => /[A-Z]/.test(p) && /[a-z]/.test(p), miss: 'mix upper and lower case' },
  { test: (p) => /\d/.test(p) && /[^A-Za-z0-9]/.test(p), miss: 'add a number and a symbol' },
];
export function scorePassword(p) {
  return RULES.reduce((n, r) => n + (r.test(p || '') ? 1 : 0), 0);
}
const S_LABEL = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
/** Submit is gated at 2, not 4. A hard gate at "strong" makes people append `!1`. */
const MIN_SCORE = 2;

/**
 * The label says what is MISSING rather than scoring the user — 12 §1: "add a
 * number" beats "weak". The score still colours the bars, because four filled
 * segments is the part people read at a glance.
 */
function StrengthMeter({ value }) {
  const s = scorePassword(value);
  const next = RULES.find((r) => !r.test(value));
  return (
    <div>
      <div className="stg" role="presentation">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={`stg__b ${n <= s ? 'on' + s : ''}`.trim()} />
        ))}
      </div>
      <div className="stg__t" aria-live="polite">
        {S_LABEL[s]}
        {next && <span className="stg__miss"> · {next.miss}</span>}
      </div>
    </div>
  );
}

/* ── M3 tonal field (12 §1) ───────────────────────────────────────────────── */
function AuField({ id, label, error, hint, className = '', children, ...rest }) {
  return (
    <div className={`aufld ${className}`.trim()}>
      {/* placeholder=" " is required: the label floats off :not(:placeholder-shown) */}
      <input
        id={id}
        className="aufld__i"
        placeholder=" "
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        {...rest}
      />
      <label className="aufld__l" htmlFor={id}>{label}</label>
      {children}
      {error
        ? <div className="aufld__e" id={`${id}-err`} role="alert"><IconAlert width={12} height={12} />{error}</div>
        : hint ? <span className="aufld__hint" id={`${id}-hint`}>{hint}</span> : null}
    </div>
  );
}

function AuPassword({ id, label, value, onChange, error, hint, strength, match, ...rest }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <AuField
        id={id}
        // `aufld--mark` widens the right padding for the confirm tick. It is on
        // the wrapper rather than the input because the rule has to reach a
        // sibling the input cannot select.
        className={match === undefined ? 'aufld--eye' : 'aufld--eye aufld--mark'}
        label={label}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        error={error}
        hint={hint}
        autoComplete={rest.autoComplete || 'new-password'}
        {...rest}
      >
        {match === true && <span className="aufld__mark aufld__mark--ok"><IconCheck /></span>}
        {match === false && <span className="aufld__mark aufld__mark--no"><IconX /></span>}
        {/* No tabIndex={-1}. It was the only way to check a mistyped password
            without a mouse, and taking it out of the tab order made it
            keyboard-unreachable (WCAG 2.1.1). aria-pressed carries the state,
            so the control reports itself without renaming itself — a name that
            changes under the user is the thing 4.1.2 asks you not to do. */}
        <button
          type="button"
          className="aufld__eye"
          onClick={() => setShow((s) => !s)}
          aria-pressed={show}
          aria-label="Show password"
        >
          <IconEye open={show} />
        </button>
      </AuField>
      {strength && value ? <StrengthMeter value={value} /> : null}
    </div>
  );
}

/* ── Shared chrome ────────────────────────────────────────────────────────── */
function Head({ kick, title, accent, hi, lede }) {
  // ONE LABEL SHAPE. `.au__hi` is not in `[data-language="en"]`'s six-name
  // list, and this is the first heading anyone sees.
  const { secondary, script } = useSecondary(hi);
  return (
    <div className="au__h">
      {kick && <div className="au__kick">{kick}</div>}
      <h1 className="au__h1">
        {title}{accent && <> <em className="au__em">{accent}</em></>}
        {secondary && <Secondary className="au__hi" value={secondary} script={script} />}
      </h1>
      {lede && <p className="au__lede">{lede}</p>}
    </div>
  );
}

function Banner({ kind = 'err', children }) {
  return (
    <div className={`au__banner au__banner--${kind}`} role={kind === 'err' ? 'alert' : 'status'}>
      {kind === 'err' ? <IconAlert /> : kind === 'ok' ? <IconCheck /> : <IconMail />}
      <span>{children}</span>
    </div>
  );
}

function AuButton({ loading, children, ...rest }) {
  return (
    <button className="au__btn" disabled={loading} {...rest}>
      {loading && <span className="au__spin" aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/**
 * A rejected request is a banner; a dead network is a toast. `err.response`
 * exists only when the server answered, so its absence is the network case.
 *
 * lib/api.js does not yet distinguish an expired session from bad credentials
 * (12 §5 asks it to); until it does, a 401 here is read as bad credentials,
 * which is the only 401 an unauthenticated form can produce.
 */
const isNetworkError = (err) => !err?.response;
const detailOf = (err) => err?.response?.data?.detail || '';

/**
 * What the user is actually shown for a server rejection.
 *
 * Two statuses never reach the banner as the server phrased them:
 *
 *  - **429.** `login` is `@limiter.limit("5/minute")` and `forgot-password` is
 *    `3/minute`, and slowapi phrases the refusal as
 *    "Rate limit exceeded: 5 per 1 minute". Measured in the browser: that exact
 *    string was rendering in the banner. It is a machine string on the first
 *    screen of the product, and it tells a locked-out user nothing about what to
 *    do next.
 *  - **5xx.** A stack-trace detail or a gateway's HTML is not an error message.
 *
 * The sign-in form additionally never prints `detail` at all — see `submit`.
 */
function authErrorMessage(err, fallback) {
  const s = err?.response?.status;
  if (s === 429) return 'Too many attempts. Wait a minute and try again.';
  if (s >= 500) return 'Something went wrong at our end. Please try again in a moment.';
  return fallback;
}

/** Clear one field's error the moment it is edited. */
function useFieldErrors() {
  const [errs, setErrs] = useState({});
  const clear = (name) => setErrs((p) => (p[name] ? { ...p, [name]: null } : p));
  return [errs, setErrs, clear];
}

/** 420ms per AUTH-SPEC; the flag has to reset or the second failure is silent. */
function useShake() {
  const [shake, setShake] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [shake, () => {
    setShake(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setShake(true);
      timer.current = setTimeout(() => setShake(false), 460);
    }, 20);
  }];
}

const REMEMBER_KEY = 'kv_auth_email';

/**
 * Where to land after signing in. `?from=` is written only by `api.js`'s 401
 * branch, and it is still treated as untrusted input: a same-origin absolute
 * path or nothing. `//evil.example` is a valid pathname-looking string that the
 * browser reads as a protocol-relative URL, which is why the second character
 * is checked too.
 */
function safeReturnTo(raw) {
  if (!raw || raw[0] !== '/' || raw[1] === '/' || raw.startsWith('/login')) return null;
  return raw;
}

// ── Login ──────────────────────────────────────────────────────────────────────
export function LoginPage() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [searchParams] = useSearchParams();
  /**
   * The session-expired state — the one thing 12 §5 asks the login screen to
   * distinguish and it never could, because nothing in the app knew a 401 from
   * a bad password. `api.js` now ends a dead session with `?expired=1` and the
   * path the user was on, so this screen can explain the empty form instead of
   * leaving them to guess what they did.
   *
   * Held in state, not read from the URL on every render: it must survive the
   * user starting to type, and it must clear the moment they submit.
   */
  const [expired, setExpired] = useState(() => searchParams.get('expired') === '1');
  const returnTo = safeReturnTo(searchParams.get('from'));
  const [form, setForm] = useState(() => ({
    email: (typeof localStorage !== 'undefined' && localStorage.getItem(REMEMBER_KEY)) || '',
    password: '',
  }));
  const [remember, setRemember] = useState(() =>
    typeof localStorage !== 'undefined' && !!localStorage.getItem(REMEMBER_KEY));
  /**
   * Where the caret starts. React applies `autoFocus` once, on mount, so this is
   * read once and never re-evaluated — which is correct: focus should not jump
   * because the user cleared the email field. With a remembered address the
   * email field is already right, and landing there makes the first keystroke
   * corrupt it.
   */
  const [emailPrefilled] = useState(() => !!form.email);
  const [loading, setLoading] = useState(false);
  // Held true from the moment the credentials are accepted until the route
  // changes, so the form cannot be seen again behind the mark.
  const [signingIn, setSigningIn] = useState(false);
  const [banner, setBanner] = useState(null);
  const [fieldErr, setFieldErr, clearErr] = useFieldErrors();
  const [shake, fireShake] = useShake();

  const set = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    clearErr(name);
  };

  const submit = async (e) => {
    e.preventDefault();
    // Inline first. A toast in the corner reports the problem somewhere other
    // than where the problem is, and then disappears on a timer.
    const errs = {};
    const email = form.email.trim();
    if (!email) errs.email = 'Enter your email address.';
    else if (!EMAIL_RE.test(email)) errs.email = 'That does not look like an email address.';
    // The password is never trimmed. Leading and trailing spaces are legal
    // characters in a password and stripping them silently changes the secret.
    if (!form.password) errs.password = 'Enter your password.';
    if (Object.keys(errs).length) { setFieldErr(errs); setBanner(null); return; }

    setFieldErr({});
    setBanner(null);
    setExpired(false);
    setLoading(true);
    try {
      // Trimmed, because validation already trimmed. `login` in
      // backend/auth_router.py matches on `WHERE email=$1` with `.lower()` and
      // no trim, so sending the raw value meant a pasted or autofilled address
      // with one leading space passed the inline check and then came back 401
      // "Invalid email or password" — an unfixable error, because the field
      // looks correct.
      const data = await apiLogin(email, form.password);
      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, email);
        else localStorage.removeItem(REMEMBER_KEY);
      } catch { /* private mode — not worth failing a sign-in over */ }
      // Back to where the expiry interrupted them, when there was one and it is
      // theirs to reach. `Protected` re-checks the role on arrival, so a client
      // carrying a staff path still lands in the portal.
      const home = data.user?.role === 'client' ? '/client' : '/dashboard';

      /**
       * A deliberate hold on the mark before the app appears.
       *
       * WHY A DELAY IS HERE ON PURPOSE, which is otherwise indefensible: the
       * lotus draws over 1.3s and holds to 2.3s of its 3.2s cycle
       * (`components.css` `@keyframes lotus-trim`). Every wait in the product is
       * shorter than that, so until now the figure was only ever seen
       * mid-assembly — a fragment, never the flower. Three seconds is one whole
       * draw-and-hold and the shortest window that shows it.
       *
       * It is scoped to a SIGN-IN, which happens once a session. It is not on
       * a refresh, a route change or a token renewal — the boot gate and
       * `PageLoader` cover those and neither is padded.
       */
      const hold = welcomeHoldMs();
      // Started whether or not we hold — a user with motion off should still
      // get the warm chunk, they just do not wait for it.
      preloadHome(data.user?.role === 'client');
      if (hold) {
        setSigningIn(true);
        await new Promise(r => setTimeout(r, hold));
      }
      navigate(returnTo || home, { replace: true });
    } catch (err) {
      if (isNetworkError(err)) {
        pushToast({
          type: 'error',
          title: 'Could not reach the server',
          message: 'Check your connection and try again.',
        });
      } else {
        // DELIBERATELY not `detailOf(err)`. The sign-in form is the one place a
        // server message must never be echoed, because `detail` is exactly where
        // an account-enumeration oracle would appear. Today it cannot:
        // backend/auth_router.py:216-218 answers an unknown email and a wrong
        // password with one branch and one string. But the frontend should not
        // be the component that has to stay correct for that property to hold —
        // a later backend change to "No account with that email" would leak
        // through this line silently. Our own copy is printed instead, so the
        // guarantee lives on both sides.
        setBanner(authErrorMessage(err, 'That email and password do not match an account.'));
        fireShake();
      }
    } finally { setLoading(false); }
  };

  /* The mark takes the whole screen between "accepted" and "arrived". Returned
     before AuthShell rather than layered over it, so there is no form behind
     the lotus to flash back into view if the navigation is slow. */
  if (signingIn) return <BrandLoader full size={196} label="Signing you in" />;

  return (
    <AuthShell shake={shake}>
      <Head
        kick={expired ? 'Session ended' : 'Welcome back'}
        title={expired ? 'Sign in again to' : 'Sign in to'}
        accent="Kartavaya"
        hi="प्रवेश"
        lede={expired ? undefined : 'Pick up where your team left off.'}
      />
      {/* An expired session and a wrong password are different events and now
          say so. The banner is `info`, not `err`: nothing went wrong and the
          user did nothing — a session simply ran out. Suppressed once a real
          rejection arrives, because the newer fact is the useful one. */}
      {expired && !banner && (
        <Banner kind="info">
          Your session expired, so you were signed out.
          {returnTo ? ' Sign in and we will take you back to where you were.' : ' Sign in to carry on.'}
        </Banner>
      )}
      {banner && <Banner kind="err">{banner}</Banner>}
      <form onSubmit={submit} noValidate>
        <div className="au__fields">
          <AuField
            id="au-email"
            name="email"
            type="email"
            label="Email address"
            value={form.email}
            onChange={set}
            error={fieldErr.email}
            autoComplete="username"
            autoFocus={!emailPrefilled}
            required
          />
          <AuPassword
            id="au-password"
            name="password"
            label="Password"
            value={form.password}
            onChange={set}
            error={fieldErr.password}
            autoComplete="current-password"
            autoFocus={emailPrefilled}
            required
          />
        </div>
        <div className="au__row">
          {/* Named for what it actually does. There is no server-side session
              length to hang a "keep me signed in" on, so promising one would be
              a checkbox that lies. */}
          <label className="au__check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span className="au__checkb" aria-hidden="true"><IconCheck width={12} height={12} /></span>
            <span>Remember my email on this device</span>
          </label>
          <button type="button" className="au__link" onClick={() => navigate('/forgot-password')}>
            Forgot password?
          </button>
        </div>
        <div className="au__actions">
          <AuButton type="submit" loading={loading}>{loading ? 'Signing in…' : 'Sign in'}</AuButton>
        </div>
      </form>
      <p className="au__note">
        Kartavaya is invite-only — there is no public sign-up. Ask your admin for an
        invitation, or talk to us about a demo.
      </p>
    </AuthShell>
  );
}

/* ── Accept-invite context panel ───────────────────────────────────────────── */

const ORG_ROLE_LABEL = {
  org_owner: 'Owner',
  org_admin: 'Admin',
  org_member: 'Member',
};
/** Grant levels, as `role_tiers.py` names them. */
const GRANT_LABEL = {
  viewer: 'Viewer', editor: 'Editor', approver: 'Approver', admin: 'Admin',
};

/**
 * "expires in 7 days", the way the reference writes it.
 *
 * Rounded, not floored. An invitation issued seconds ago is 6.99 days from
 * expiring, and flooring that says "6 days" on a screen whose email said seven
 * — a difference of one day in the user's favour is not worth a contradiction
 * between two messages about the same link.
 */
function relativeExpiry(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms >= 36 * 3_600_000) {
    const days = Math.round(ms / 86_400_000);
    return `${days} days`;
  }
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * What you are being asked to accept — `AUTH-SPEC.md` "Accept invite": it must
 * show "org, inviter, role **and the module grants**".
 *
 * Until `GET /auth/invite/:token` landed there was nothing to draw this from,
 * which is why `auth.css` shipped no rules for it and said so. All four fields
 * were already being STORED — `routers/org_invites.create_org_invite` writes
 * org_id, member_role and module_grants, and `accept_invite` applies all
 * three — so the person accepting was the only party who could not see them.
 *
 * A platform-console invite (`POST /api/admin/invites`) carries no org at all,
 * and this renders that difference rather than inventing an organisation:
 * "an account on Kartavaya" is a truthful description of what that link does.
 */
function InviteContext({ invite }) {
  const grants = invite.module_grants || [];
  // Read once — the grants are mapped below, so a hook per tag would change in
  // count with the invitation.
  const lang = useLanguage();
  const expiry = relativeExpiry(invite.expires_at);
  return (
    <div className="auinv">
      <div className="auinv__head">
        <span className="auinv__org">{invite.org_name || 'Kartavaya'}</span>
        {invite.org_name && invite.org_members > 0 && (
          <span className="auinv__meta">
            {invite.org_members} {invite.org_members === 1 ? 'member' : 'members'}
          </span>
        )}
      </div>

      <p className="auinv__by">
        {invite.invited_by_name ? <strong>{invite.invited_by_name}</strong> : 'You were'}
        {invite.invited_by_name ? ' invited you' : ' invited'}
        {invite.org_name ? '' : ' to Kartavaya'}
        {invite.org_role && ORG_ROLE_LABEL[invite.org_role] && (
          <> as <span className="auinv__role">{ORG_ROLE_LABEL[invite.org_role]}</span></>
        )}
        {' · '}<span className="auinv__email">{invite.email}</span>
      </p>

      {/* Grants, not a promise of grants. An empty list is a real answer and is
          said out loud, because "you will get access later" and "you have
          access to nothing yet" are different things to walk into. */}
      {invite.org_name && (
        <div className="auinv__grants">
          {grants.length > 0 ? (
            <>
              <span className="auinv__glabel">With access to</span>
              {grants.map((g) => {
                const m = moduleMeta(g.code);
                // The module id IS the registry key, so the tag gains Gujarati
                // without anyone writing a second `{en, hi, gu}` triple.
                const tag = secondaryOf(g.code, lang);
                return (
                  <span key={g.code} className="auinv__tag" style={{ '--tag-c': m?.color || 'var(--primary)' }}>
                    {tag.secondary && <Secondary className="auinv__tag-hi" value={tag.secondary} script={tag.script} />}
                    <span>{m?.en || g.code}</span>
                    <span className="auinv__tag-lv">{GRANT_LABEL[g.role] || g.role}</span>
                  </span>
                );
              })}
            </>
          ) : (
            <span className="auinv__glabel">
              No module access yet — an admin grants that separately, after you join.
            </span>
          )}
        </div>
      )}

      <p className="auinv__fine">
        {expiry ? `This invitation expires in ${expiry}. ` : ''}
        Only {invite.email} can accept it.
      </p>
    </div>
  );
}

// ── Accept invite ──────────────────────────────────────────────────────────────
export function AcceptInvitePage() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [form, setForm] = useState({ name: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState(null);
  const [fieldErr, setFieldErr, clearErr] = useFieldErrors();
  const [shake, fireShake] = useShake();
  /** `undefined` while loading, `null` once the token is known to be dead. */
  const [invite, setInvite] = useState(undefined);
  const [declined, setDeclined] = useState(false);

  /**
   * Read the invitation before drawing a form for it. The preview is the only
   * thing that can tell a live token from a dead one without creating an
   * account, so the "expired link" case is now a screen rather than a banner
   * the user meets after typing a password.
   */
  useEffect(() => {
    if (!token) return undefined;
    let live = true;
    apiInvitePreview(token)
      .then((d) => { if (live) setInvite(d); })
      .catch((err) => {
        if (!live) return;
        // A dead token is a dead end; anything else is a connection problem and
        // must not be reported as an expired invitation, or the user goes and
        // asks their admin to reissue a link that was fine.
        if (err?.response?.status === 404) setInvite(null);
        else setInvite({ unreachable: true });
      });
    return () => { live = false; };
  }, [token]);

  const set = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    clearErr(name);
    if (name === 'password') clearErr('confirm');
  };

  const decline = async () => {
    setLoading(true);
    try {
      await apiDeclineInvite(token);
      setDeclined(true);
    } catch {
      // Idempotent server-side, and a decline that did not reach the server is
      // still a decline as far as this person is concerned — they are simply
      // not going to accept. Say it worked rather than demand a retry.
      setDeclined(true);
    } finally { setLoading(false); }
  };

  if (!token) return (
    <AuthShell>
      <Head kick="Invitation" title="This link is" accent="incomplete." />
      <Banner kind="err">No invite token was found in the link. Ask your admin to send a new one.</Banner>
      <div className="au__actions">
        <AuButton type="button" onClick={() => navigate('/login')}>Back to sign in</AuButton>
      </div>
    </AuthShell>
  );

  if (invite === undefined) return (
    <AuthShell>
      <Head kick="Invitation" title="Checking your" accent="invitation…" />
    </AuthShell>
  );

  if (invite === null) return (
    <AuthShell>
      <Head kick="Invitation" title="This invitation is no" accent="longer valid." />
      <Banner kind="err">
        It may have expired, already been used, or been withdrawn. Ask whoever
        invited you to send a new one — invitations last seven days.
      </Banner>
      <div className="au__actions">
        <AuButton type="button" onClick={() => navigate('/login')}>Back to sign in</AuButton>
      </div>
    </AuthShell>
  );

  if (invite.unreachable) return (
    <AuthShell>
      <Head kick="Invitation" title="Could not reach" accent="Kartavaya." />
      <Banner kind="err">
        Your invitation is probably fine — we could not read it just now. Try again in a moment.
      </Banner>
      <div className="au__actions">
        <AuButton type="button" onClick={() => window.location.reload()}>Try again</AuButton>
      </div>
    </AuthShell>
  );

  if (declined) return (
    <AuthShell>
      <Head kick="Invitation" title="Invitation" accent="declined." />
      <Banner kind="ok">
        Nothing was created and no account exists for this link.
        {invite.invited_by_name ? ` ${invite.invited_by_name} can send a new one if this was a mistake.` : ''}
      </Banner>
      <div className="au__actions">
        <AuButton type="button" onClick={() => navigate('/login')}>Back to sign in</AuButton>
      </div>
    </AuthShell>
  );

  /**
   * The address already has an account. `accept_invite` answers this 409, so
   * there is no form to draw — the useful move is sign-in, not a password field
   * that will be refused.
   *
   * This is the only reachable half of AUTH-SPEC's existing-user branch. The
   * other half — an org inviting somebody who already has an account — cannot
   * happen: `invite_router.py` and `org_invites.py` both refuse to CREATE such
   * an invite (409, "Add them from the Members tab instead"). What lands here
   * is somebody who signed up during the seven days their invitation was live.
   *
   * ── The lede used to promise something no code does ─────────────────────────
   * It read "Sign in with it and this invitation is applied to the account you
   * already have." NOTHING applies it. `accept_invite` is the only reader of
   * `invites`, and on this branch it 409s before it writes anything;
   * `POST /auth/login` never looks at the table at all. So the person signed in,
   * found the organisation they were invited to nowhere in their switcher, and
   * had no idea what to do next — the screen had told them it was handled.
   *
   * What replaces it is the move that DOES work today: `POST /v1/org/members`
   * adds an address that already has an account, immediately, and the person who
   * invited them is exactly who can press it. Naming the inviter and the tab is
   * the difference between an instruction and a shrug. The invitation itself is
   * left standing rather than declined for them — it costs a seat, but revoking
   * somebody's invitation on their behalf because they happened to open the link
   * is not this screen's decision to make.
   *
   * This is copy only. Carrying the invitation onto an existing account is being
   * built server-side; when it lands, this branch stops being reachable and the
   * words go with it.
   */
  if (invite.account_exists) return (
    <AuthShell>
      <Head
        kick="Invitation"
        title="You already have an"
        accent="account."
        lede="Sign in with the password you already use — this link cannot add the organisation for you."
      />
      <InviteContext invite={invite} />
      <Banner kind="info">
        {invite.invited_by_name ? <><strong>{invite.invited_by_name}</strong> can</> : 'Whoever invited you can'}
        {' '}add you to {invite.org_name || 'the organisation'} in seconds:
        Organisation ▸ Members ▸ <strong>Add or invite a member</strong>, with this
        same address. You will see it in your organisation switcher straight away
        — there is nothing to accept once they have.
      </Banner>
      <div className="au__actions">
        <AuButton type="button" onClick={() => navigate('/login')}>Sign in</AuButton>
        <button type="button" className="au__link au__link--mute" onClick={decline} disabled={loading}>
          Decline this invitation
        </button>
      </div>
    </AuthShell>
  );

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.name.trim()) errs.name = 'Tell us what to call you.';
    if (form.password.length < 8) errs.password = 'At least 8 characters.';
    else if (scorePassword(form.password) < MIN_SCORE) {
      errs.password = `Too easy to guess — ${RULES.find((r) => !r.test(form.password)).miss}.`;
    }
    if (form.password !== form.confirm) errs.confirm = 'Passwords don’t match.';
    if (Object.keys(errs).length) { setFieldErr(errs); setBanner(null); return; }

    setFieldErr({});
    setBanner(null);
    setLoading(true);
    try {
      // Name trimmed for the same reason the login email is; the password is
      // not, because whitespace inside a secret is part of the secret.
      const data = await apiAcceptInvite(token, form.name.trim(), form.password);
      pushToast({ type: 'success', title: 'Welcome to Kartavaya!' });
      navigate(data.user?.role === 'client' ? '/client' : '/dashboard', { replace: true });
    } catch (err) {
      if (isNetworkError(err)) {
        pushToast({ type: 'error', title: 'Could not reach the server', message: 'Check your connection and try again.' });
        return;
      }
      const detail = detailOf(err);
      if (detail.includes('already activated') || detail.includes('already exists')) {
        pushToast({ type: 'error', title: 'Account already active', message: 'Your account is set up. Please sign in.' });
        navigate('/login', { replace: true });
      } else {
        // `detail` IS kept here, unlike on the sign-in form. Holding a valid
        // invite token already implies knowing the address, so there is no
        // enumeration to protect, and the server's wording is the useful one:
        // "Invite link has expired. Ask your admin for a new one."
        setBanner(authErrorMessage(err, detail || 'This invite link may have expired. Ask your admin for a new one.'));
        fireShake();
      }
    } finally { setLoading(false); }
  };

  const match = form.confirm ? form.password === form.confirm : undefined;

  return (
    <AuthShell shake={shake}>
      <Head
        kick="Create your account"
        title="You have been"
        accent="invited."
        hi="स्वागत"
        lede={invite.org_name
          ? `Set a name and a password, and you are in ${invite.org_name}.`
          : 'Set a name and a password to activate your account.'}
      />
      {/* The whole point of the preview: what is being accepted goes ABOVE the
          fields, because the decision comes before the typing. */}
      <InviteContext invite={invite} />
      {banner && <Banner kind="err">{banner}</Banner>}
      <form onSubmit={submit} noValidate>
        <div className="au__fields">
          <AuField
            id="inv-name"
            name="name"
            type="text"
            label="Your full name"
            value={form.name}
            onChange={set}
            error={fieldErr.name}
            autoComplete="name"
            autoFocus
            required
          />
          <AuPassword
            id="inv-password"
            name="password"
            label="Choose a password"
            value={form.password}
            onChange={set}
            error={fieldErr.password}
            strength
            required
          />
          <AuPassword
            id="inv-confirm"
            name="confirm"
            label="Confirm password"
            value={form.confirm}
            onChange={set}
            error={fieldErr.confirm}
            match={match}
            required
          />
        </div>
        <div className="au__actions">
          <AuButton type="submit" loading={loading}>{loading ? 'Activating…' : 'Accept & create account'}</AuButton>
          {/* AUTH-SPEC gives every invite screen a decline, and quieter than
              the accept. It was the one control on this screen with no route
              at all — there was no endpoint until `POST /auth/invite/:token/
              decline`, so someone who did not want the invitation could only
              close the tab and leave a live token in their inbox for a week. */}
          <button type="button" className="au__link au__link--mute" onClick={decline} disabled={loading}>
            Decline this invitation
          </button>
        </div>
      </form>
      <p className="au__note">
        Already have an account?{' '}
        <button type="button" className="au__link" onClick={() => navigate('/login')}>Sign in instead</button>
      </p>
    </AuthShell>
  );
}

// ── Forgot password ────────────────────────────────────────────────────────────
export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [fieldErr, setFieldErr, clearErr] = useFieldErrors();
  const [wait, setWait] = useState(0);

  // 60s resend countdown, per AUTH-SPEC "sent, with a 60s resend countdown".
  useEffect(() => {
    if (!wait) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      setFieldErr({ email: 'Enter the email address on your account.' });
      return;
    }
    setFieldErr({});
    setLoading(true);
    try {
      await apiForgotPassword(email.trim());
      setSent(true);
      setWait(60);
    } catch (err) {
      // The endpoint answers 200 whether or not the account exists (verified in
      // backend/auth_router.py — `forgot_password` returns {"ok": True}
      // unconditionally), so anything that lands here is a transport failure or
      // the 3/minute limiter. Those two need different advice: "try again in a
      // moment" is wrong for a rate limit, where the only thing that helps is
      // waiting, and the raw slowapi string is not something to show a user.
      const rate = err?.response?.status === 429;
      pushToast({
        type: 'error',
        title: isNetworkError(err) ? 'Could not reach the server'
          : rate ? 'Too many requests' : 'Something went wrong',
        message: rate
          ? 'You have asked for several reset links. Wait a minute and try again.'
          : 'Please try again in a moment.',
      });
    } finally { setLoading(false); }
  };

  const submit = (e) => { e.preventDefault(); send(); };

  return (
    <AuthShell>
      <Head
        kick="Password reset"
        title="Forgot your"
        accent="password?"
        hi="कोई बात नहीं"
        lede={sent ? undefined : 'Give us the address on your account and we will send a reset link. It is valid for one hour.'}
      />
      {sent ? (
        <>
          <Banner kind="info">
            If <strong>{email.trim()}</strong> has an account, a reset link is on its way. Check
            your spam folder too — it can take a minute.
          </Banner>
          <div className="au__actions">
            <AuButton type="button" onClick={() => navigate('/login')}>Back to sign in</AuButton>
          </div>
          <div className="au__row">
            <button
              type="button"
              className="au__link au__link--mute"
              onClick={send}
              disabled={wait > 0 || loading}
            >
              {wait > 0 ? `Resend in ${wait}s` : 'Send it again'}
            </button>
            <button type="button" className="au__link" onClick={() => { setSent(false); setWait(0); }}>
              Use a different address
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} noValidate>
          <div className="au__fields">
            <AuField
              id="fp-email"
              name="email"
              type="email"
              label="Email address"
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearErr('email'); }}
              error={fieldErr.email}
              autoComplete="username"
              autoFocus
              required
            />
          </div>
          <div className="au__actions">
            <AuButton type="submit" loading={loading}>{loading ? 'Sending…' : 'Send reset link'}</AuButton>
          </div>
          <div className="au__row">
            <button type="button" className="au__link" onClick={() => navigate('/login')}>Back to sign in</button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}

// ── Reset password ─────────────────────────────────────────────────────────────
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState(null);
  const [fieldErr, setFieldErr, clearErr] = useFieldErrors();
  const [shake, fireShake] = useShake();
  /**
   * `AU_SCREENS` in the reference lists "Expired link" as a SCREEN, not a
   * banner — and the reference's version of it offers the one thing that helps:
   * request a new link. This build already had that screen for a link with no
   * token at all, and answered a link whose token the server REJECTED with a
   * banner over a password form the user had just filled in and could never
   * submit. Same dead end, two shapes; now one.
   */
  const [dead, setDead] = useState(false);

  const set = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    clearErr(name);
    if (name === 'password') clearErr('confirm');
  };

  if (!token || dead) return (
    <AuthShell>
      <Head
        kick="Password reset"
        title={dead ? 'This link has' : 'This link is'}
        accent={dead ? 'expired.' : 'incomplete.'}
      />
      <Banner kind="err">
        {dead
          ? 'Reset links last one hour and work once. Request another and we will send a fresh one.'
          : 'No reset token was found in the link. Reset links expire after an hour.'}
      </Banner>
      <div className="au__actions">
        <AuButton type="button" onClick={() => navigate('/forgot-password')}>Request a new link</AuButton>
        <button type="button" className="au__link au__link--mute" onClick={() => navigate('/login')}>
          Back to sign in
        </button>
      </div>
    </AuthShell>
  );

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (form.password.length < 8) errs.password = 'At least 8 characters.';
    else if (scorePassword(form.password) < MIN_SCORE) {
      errs.password = `Too easy to guess — ${RULES.find((r) => !r.test(form.password)).miss}.`;
    }
    if (form.password !== form.confirm) errs.confirm = 'Passwords don’t match.';
    if (Object.keys(errs).length) { setFieldErr(errs); setBanner(null); return; }

    setFieldErr({});
    setBanner(null);
    setLoading(true);
    try {
      const data = await apiResetPassword(token, form.password);
      pushToast({ type: 'success', title: 'Password updated' });
      navigate(data.user?.role === 'client' ? '/client' : '/dashboard', { replace: true });
    } catch (err) {
      if (isNetworkError(err)) {
        pushToast({ type: 'error', title: 'Could not reach the server', message: 'Check your connection and try again.' });
      } else if (err?.response?.status === 400) {
        // The one status `reset_password` uses for a token it will not accept
        // (`auth_router.py`: "Reset link is invalid or has expired."). A form
        // the user cannot make work is not worth leaving on screen — it becomes
        // the dead-end screen with the route out.
        setDead(true);
      } else {
        setBanner(authErrorMessage(err, detailOf(err) || 'This reset link is invalid or has expired.'));
        fireShake();
      }
    } finally { setLoading(false); }
  };

  const match = form.confirm ? form.password === form.confirm : undefined;

  return (
    <AuthShell shake={shake}>
      <Head
        kick="New password"
        title="Choose a new"
        accent="password."
        hi="नया पासवर्ड"
        lede="You will be signed in on this device as soon as it is saved."
      />
      {banner && <Banner kind="err">{banner}</Banner>}
      <form onSubmit={submit} noValidate>
        <div className="au__fields">
          <AuPassword
            id="rp-password"
            name="password"
            label="New password"
            value={form.password}
            onChange={set}
            error={fieldErr.password}
            strength
            autoFocus
            required
          />
          <AuPassword
            id="rp-confirm"
            name="confirm"
            label="Confirm new password"
            value={form.confirm}
            onChange={set}
            error={fieldErr.confirm}
            match={match}
            required
          />
        </div>
        <div className="au__actions">
          <AuButton type="submit" loading={loading}>{loading ? 'Updating…' : 'Update password'}</AuButton>
        </div>
      </form>
      {/* 12 §4 asks this screen to state that the reset invalidates all other
          sessions. It now does, because the backend now does it: `reset_password`
          in backend/auth_router.py stamps `users.sessions_valid_from` and
          `require_user` refuses any token issued before that instant. If the
          revocation is ever removed, this sentence comes out in the same commit
          — the same rule the reset email template carries. */}
      <p className="au__note">
        Reset links are valid for one hour and can be used once. Setting a new
        password signs you out on every other device.
      </p>
    </AuthShell>
  );
}
