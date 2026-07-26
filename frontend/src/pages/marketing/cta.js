/**
 * The landing page's call to action — the one thing on this page that is not
 * decided.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  SET `VITE_LEAD_CTA_HREF` BEFORE THIS PAGE IS ADVERTISED ANYWHERE.
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
 * endpoint. Checked rather than assumed: the only inbound path that exists is
 * `POST /api/v1/graha/inbound-leads`, and it is an HMAC-signed webhook keyed on
 * `INBOUND_WEBHOOK_SECRET` that resolves the destination org from
 * `settings.lead_capture_email`. A browser cannot call it — the secret would
 * have to ship in the bundle — so it is a mail-provider hook, not a form
 * target.
 *
 * That same webhook is, however, the cheapest route to a real destination: give
 * Aekam's own org a `lead_capture_email`, point this at `mailto:` that address,
 * and demo requests land in Graha as contacts with no new backend at all.
 *
 * Three ways to resolve it, in increasing order of work:
 *
 *   1. Set `VITE_LEAD_CTA_HREF` to a `mailto:` (see above), a `wa.me` link, or
 *      an existing form. No code change, no backend, no redeploy of this file.
 *   2. Add a public `POST /v1/leads` that writes a Graha contact with
 *      contact_type 'lead' and source 'landing', and fires the existing
 *      lead_created automation. Then the href becomes '#contact' and this file
 *      grows a form.
 *   3. Open signup: POST /auth/signup, email verification, trial limits. That
 *      reverses a settled decision — see CLAUDE-CODE-START-HERE.md §Decisions.
 *
 * No address is hardcoded here. A guessed one on a public page misdirects real
 * people, and it would be read as verified by everyone downstream of this file.
 * The rest of the page does not depend on which option is picked.
 */

/** Trimmed, because an env var set to a stray space is not a destination. */
const configured = (import.meta.env.VITE_LEAD_CTA_HREF || '').trim();

export const PRIMARY_CTA = {
  label: 'Request a demo',
  href: configured,
};

export const SECONDARY_CTA = {
  label: 'Sign in',
  href: '/login',
};

/** True once the primary CTA has somewhere to go. */
export const ctaReady = Boolean(PRIMARY_CTA.href);

/**
 * Shown in place of the CTA when there is no destination. Visitor-facing, and
 * deliberately so: the previous version put "see pages/marketing/cta.js" in a
 * `title` tooltip, which is a note to a developer rendered on a public page,
 * invisible on touch, and unreadable by the people it was aimed at anyway.
 */
export const CTA_PENDING_NOTE =
  'Invite-only — your firm’s admin adds you, and there is no public sign-up. ' +
  'We are not taking demo requests through this page yet; if someone referred ' +
  'you, ask them to introduce you.';
