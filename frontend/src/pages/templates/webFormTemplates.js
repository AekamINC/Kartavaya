/**
 * webFormTemplates.js — the starting points for a hosted web form.
 *
 * ── WHY A CONSTANT AND NOT A TABLE ─────────────────────────────────────────
 * These are the product's own suggestions, identical for every customer, and
 * they change when we ship rather than when a firm edits something. A table
 * would need a migration, RLS, a seed for every existing org and a way to keep
 * that seed honest — and CLAUDE.md is explicit that a new table without RLS is
 * a silent cross-tenant leak. Nothing here is tenant data. It compiles into the
 * bundle, and "Use this" writes a NORMAL `graha_web_forms` row through the
 * ordinary authenticated endpoint, which is the row that is then the firm's own
 * to rename, edit and delete. A template is a starting point, not a link.
 *
 * ── WHAT A TEMPLATE MAY HONESTLY CHANGE ────────────────────────────────────
 * ⚠ NOT THE FIELD LIST. `submit_web_form` reads exactly five keys — name,
 * email, phone, company, message — and ignores the form's stored `fields`. A
 * template that promised a "PAN" box would draw one the server discards, and
 * the visitor would have typed into it for nothing. So a template varies:
 *
 *   · the heading a visitor reads          (`name`, used by the hosted page)
 *   · the wording of the five fields       (`settings.presentation.labels`)
 *   · which of the four optional ones show (`settings.presentation.hide`)
 *   · the sentence under the heading       (`settings.presentation.intro`)
 *   · the tag that lands on the lead       (`auto_source`)
 *   · WHICH MODULE IT LANDS IN             (`destination`)
 *
 * The last one is the reason this file earns its place. `destination` shipped
 * with migration 251 and `submit_web_form` has dispatched on it since, but
 * `WebFormCreate` carried no such field — so every form the product could
 * create took the default. Measured 2026-09-01: two forms, both `crm_contact`,
 * 24 submissions, zero of anything else. The job-application handler was
 * written, reviewed and tested against a value no customer could store.
 */

/** Destinations these templates use. The server holds the real allowlist. */
export const DEST_LABELS = {
  crm_contact: 'CRM — a contact and a lead',
  hr_application: 'Hiring — a candidate against a job opening',
};

/**
 * `needs` names extra input the template cannot supply itself. Only
 * `job_opening_id` today, and the server refuses an `hr_application` form
 * without one at CREATE rather than letting the firm find out when the first
 * applicant is turned away.
 */
export const WEB_FORM_TEMPLATES = [
  {
    id: 'contact-us',
    name: 'Contact us',
    hi: 'संपर्क',
    kicker: 'GENERAL',
    slug: 'contact-us',
    destination: 'crm_contact',
    auto_source: 'website',
    summary: 'The general enquiry form for your website footer or contact page.',
    detail: 'Asks for all five fields. Every submission raises a lead tagged "website".',
    settings: {
      presentation: {
        intro: 'Leave your details and somebody will come back to you. Only your name is needed.',
      },
    },
  },
  {
    id: 'callback',
    name: 'Request a callback',
    hi: 'कॉल',
    kicker: 'PHONE',
    slug: 'request-a-callback',
    destination: 'crm_contact',
    auto_source: 'callback',
    summary: 'Shortest possible form — a name and a number, nothing else.',
    detail: 'Company is hidden and the message box asks for a time. Use it where a visitor is on a phone and will not type a paragraph.',
    settings: {
      presentation: {
        intro: 'Tell us when to call and we will.',
        labels: { phone: 'Phone number', message: 'Best time to call' },
        hide: ['company'],
      },
    },
  },
  {
    id: 'service-enquiry',
    name: 'Service enquiry',
    hi: 'सेवा',
    kicker: 'PRACTICE',
    slug: 'service-enquiry',
    destination: 'crm_contact',
    auto_source: 'service-enquiry',
    summary: 'For a specific engagement — GST registration, ITR, audit, ROC filing.',
    detail: 'The message box asks which service, so the lead arrives already qualified.',
    settings: {
      presentation: {
        intro: 'Tell us what you need and we will come back with a scope and a fee.',
        labels: {
          company: 'Business name',
          message: 'Which service do you need? (GST, ITR, audit, ROC...)',
        },
      },
    },
  },
  {
    id: 'job-application',
    name: 'Job application',
    hi: 'भर्ती',
    kicker: 'HIRING',
    slug: 'apply',
    destination: 'hr_application',
    auto_source: 'careers',
    needs: ['job_opening_id'],
    summary: 'Lands a candidate against one open role — not a CRM lead.',
    detail: 'Requires the Hiring module and an open role. The applicant never sees which opening they are filed against; it is read from the form, never from what they send.',
    settings: {
      presentation: {
        intro: 'Apply for this role. We read every application ourselves.',
        labels: {
          name: 'Your full name',
          message: 'Tell us about yourself',
        },
        hide: ['company'],
      },
    },
  },
  {
    id: 'newsletter',
    name: 'Updates and circulars',
    hi: 'सूचना',
    kicker: 'MAILING',
    slug: 'updates',
    destination: 'crm_contact',
    auto_source: 'newsletter',
    summary: 'A name and an email, for firms that circulate statutory updates.',
    detail: 'Phone, company and message are hidden. Consent to receive circulars is yours to obtain and record — this captures a contact, it does not prove they opted in.',
    settings: {
      presentation: {
        intro: 'Get our circulars on due dates and rate changes.',
        hide: ['phone', 'company', 'message'],
      },
    },
  },
  {
    id: 'vendor',
    name: 'Vendor empanelment',
    hi: 'विक्रेता',
    kicker: 'PROCUREMENT',
    slug: 'vendor-empanelment',
    destination: 'crm_contact',
    auto_source: 'vendor',
    summary: 'For suppliers asking to be added to your panel.',
    detail: 'Lands in the CRM tagged "vendor" so it does not pollute your sales pipeline reporting.',
    settings: {
      presentation: {
        intro: 'Tell us what you supply and we will be in touch if there is a fit.',
        labels: {
          company: 'Firm name',
          message: 'What do you supply?',
        },
      },
    },
  },
];
