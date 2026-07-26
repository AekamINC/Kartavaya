/**
 * The landing page's call to action — the one thing on this page that is not
 * decided.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  FILL IN `href` BEFORE THIS PAGE IS MADE PUBLIC.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Why it is stubbed rather than guessed:
 *
 * The product is invite-only. There is no signup route in App.jsx, no signup
 * endpoint in the backend, and LoginPage exports only login, accept-invite,
 * forgot and reset. So "Start free" pointing at /login is the one thing this
 * page must not do — a visitor clicks it, lands on a password field for an
 * account they do not have, and leaves. That is worse than having no landing
 * page at all.
 *
 * "Request a demo" is the honest CTA for a product sold to accounting firms by
 * referral, but it needs somewhere to land, and there is no public lead-capture
 * endpoint. Graha is the obvious home for those leads, but its contacts API is
 * authenticated and org-scoped, so an unauthenticated page cannot post to it.
 *
 * Three ways to resolve this, in increasing order of work:
 *
 *   1. Point `href` at a mailto:, a wa.me link, or an existing form. Works
 *      today, no backend.
 *   2. Add a public POST /v1/leads that writes a Graha contact with
 *      contact_type 'lead' and source 'landing', and fires the existing
 *      lead_created automation. Then `href` becomes '#contact' and this file
 *      grows a form.
 *   3. Open signup: POST /auth/signup, email verification, trial limits. Then
 *      label becomes 'Start free' and href '/signup'.
 *
 * The rest of the page does not depend on which you pick.
 */
export const PRIMARY_CTA = {
  label: 'Request a demo',
  // TODO: a real destination. Deliberately empty — a fabricated address on a
  // public page misdirects real people, and a guessed route 404s.
  href: '',
};

export const SECONDARY_CTA = {
  label: 'Sign in',
  href: '/login',
};

/** True once the primary CTA has somewhere to go. */
export const ctaReady = Boolean(PRIMARY_CTA.href);
