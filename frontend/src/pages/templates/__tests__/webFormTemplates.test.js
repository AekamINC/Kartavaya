/**
 * webFormTemplates.test.js — the catalogue against the server's real contract.
 *
 * ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
 * Every template here is a promise about what a stranger will see on a page
 * this firm links from their website. The two ways to break that promise are
 * both silent:
 *
 *  1. A label or a hidden field naming a key the server does not read. The
 *     hosted page draws exactly five boxes and `submit_web_form` reads exactly
 *     five keys; a label for `pan` is dropped by `_presentation()` server-side
 *     and by `fieldsFor()` client-side, so the template simply does less than
 *     it says and NOTHING reports it.
 *  2. A destination the dispatcher cannot serve. `handler_for()` raises a 500
 *     for one, which the visitor reads as "this form is misconfigured" — after
 *     they have typed their details in.
 *
 * Neither is visible in review, because both look like ordinary data.
 *
 * ⚠ THE FIVE KEYS ARE DUPLICATED HERE ON PURPOSE and that is the whole point.
 * This file asserts the catalogue against an INDEPENDENTLY WRITTEN copy of the
 * contract, taken from `submit_web_form`. Importing the app's own list would
 * make the test agree with whatever the app currently believes — the shape of
 * assertion this codebase keeps finding, green over exactly the defect it was
 * written to catch. If the server ever reads a sixth key, this list is meant
 * to be the thing somebody has to come and change.
 */
import { describe, it, expect } from 'vitest';
import { WEB_FORM_TEMPLATES, DEST_LABELS } from '../webFormTemplates';

/** From `routers/graha.py` — `submit_web_form` reads these and nothing else. */
const SERVER_READS = ['name', 'email', 'phone', 'company', 'message'];

/** From `services/webforms/destinations.py` — DESTINATIONS plus the inline one. */
const SERVER_SERVES = ['crm_contact', 'hr_application'];

describe('web form template catalogue', () => {
  it('offers something to choose from', () => {
    expect(WEB_FORM_TEMPLATES.length).toBeGreaterThan(0);
  });

  it('has unique ids and unique suggested slugs', () => {
    const ids = WEB_FORM_TEMPLATES.map((t) => t.id);
    const slugs = WEB_FORM_TEMPLATES.map((t) => t.slug);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('suggests only slugs the server will accept unchanged', () => {
    // `create_web_form` strips everything outside [a-z0-9-]. A suggested slug
    // that needed stripping would publish at an address different from the one
    // the hint promised the customer one line above the button.
    for (const t of WEB_FORM_TEMPLATES) {
      expect(t.slug, t.id).toBe(t.slug.replace(/[^a-z0-9-]/g, ''));
      expect(t.slug.length, t.id).toBeGreaterThan(0);
    }
  });

  it('routes every template to a destination the dispatcher serves', () => {
    for (const t of WEB_FORM_TEMPLATES) {
      expect(SERVER_SERVES, t.id).toContain(t.destination);
    }
  });

  it('labels every destination it uses', () => {
    // An unlabelled destination renders an empty line on the card, which reads
    // as "this form goes nowhere".
    for (const t of WEB_FORM_TEMPLATES) {
      expect(DEST_LABELS[t.destination], t.id).toBeTruthy();
    }
  });

  it('never relabels a field the server discards', () => {
    for (const t of WEB_FORM_TEMPLATES) {
      const labels = t.settings?.presentation?.labels || {};
      for (const key of Object.keys(labels)) {
        expect(SERVER_READS, `${t.id} relabels "${key}"`).toContain(key);
        expect(String(labels[key]).trim().length, `${t.id}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('never hides a field the server discards, and never hides the name', () => {
    for (const t of WEB_FORM_TEMPLATES) {
      const hide = t.settings?.presentation?.hide || [];
      for (const key of hide) {
        expect(SERVER_READS, `${t.id} hides "${key}"`).toContain(key);
        // The submit button is disabled without a name, so a form hiding it
        // could never be sent by anyone.
        expect(key, `${t.id} hides the name box`).not.toBe('name');
      }
    }
  });

  it('declares the extra input a destination cannot supply itself', () => {
    // `validate_destination` refuses an hr_application form with no
    // job_opening_id. A template that did not declare the need would render a
    // publish button that always 400s.
    for (const t of WEB_FORM_TEMPLATES) {
      if (t.destination === 'hr_application') {
        expect(t.needs || [], t.id).toContain('job_opening_id');
      }
    }
  });

  it('gives a human something to read on every card', () => {
    for (const t of WEB_FORM_TEMPLATES) {
      expect(t.name?.trim(), t.id).toBeTruthy();
      expect(t.summary?.trim(), t.id).toBeTruthy();
      expect(t.detail?.trim(), t.id).toBeTruthy();
      expect(t.auto_source?.trim(), t.id).toBeTruthy();
    }
  });

  it('still routes somewhere other than the CRM', () => {
    // The anti-vacuity floor. Every assertion above passes over a catalogue of
    // six identical contact forms — which is exactly the state the product was
    // in before this tab existed, and the state a well-meaning simplification
    // would put it back into. `destination` was unreachable for a reason
    // nobody noticed; this is the line that notices.
    const nonCrm = WEB_FORM_TEMPLATES.filter((t) => t.destination !== 'crm_contact');
    expect(nonCrm.length).toBeGreaterThan(0);
  });
});
