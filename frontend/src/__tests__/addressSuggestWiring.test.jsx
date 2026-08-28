/**
 * 7.6 is wired to a screen — the difference between code and a feature.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * `AddressSuggest` shipped tested and mounted nowhere, which by this repo's own
 * rule is 🟡 and not ✅: code-without-data is not done, and a component no page
 * renders cannot be completed by any customer. §7.6's acceptance is
 * "autosuggest live on vendors and employees", so these are the two.
 *
 * ── And what the wiring must not do ─────────────────────────────────────────
 *
 * 1. THE SUGGESTION FILLS THE FIELDS, IT DOES NOT REPLACE THEM. A supplier's
 *    premises and a person's home address are exactly the fields the operator
 *    is most likely to have to correct, and a vendor's blank must never erase
 *    something somebody typed.
 *
 * 2. THE SEARCH FRAGMENT IS NOT PART OF THE RECORD. `address_query` is what a
 *    person typed WHILE LOOKING, which is a different thing from the address
 *    they settled on. It must not reach a request body.
 *
 * 3. NOTHING IS SUBMITTED BY OPENING A RECORD. Content sent to Mappls carries a
 *    perpetual, sub-licensable licence back to them. `AddressSuggest` has no
 *    `useEffect` on its value for that reason, and its own suite covers it;
 *    what THIS file adds is that neither form re-introduces the effect by
 *    seeding the box from a saved address.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(HERE, '..', p), 'utf8');

const VENDOR = read('components/VendorForm.jsx');
const EMPLOYEE = read('pages/manav/EmployeesTab.jsx');

describe('§7.6 · autosuggest is live on the two screens the plan names', () => {
  it('the vendor form mounts it', () => {
    expect(VENDOR).toMatch(/import AddressSuggest from/);
    expect(VENDOR).toMatch(/<AddressSuggest/);
  });

  it('the employee form mounts it', () => {
    expect(EMPLOYEE).toMatch(/import AddressSuggest from/);
    expect(EMPLOYEE).toMatch(/<AddressSuggest/);
  });
});

describe('the suggestion FILLS the record and never replaces it', () => {
  // Applied as `...(sug.city ? { city: sug.city } : {})` — a key the suggestion
  // did not carry is not written, so a blank cannot erase a typed value. A
  // plain `city: sug.city` would blank the field on every partial match.
  it.each([['VendorForm', VENDOR], ['EmployeesTab', EMPLOYEE]])(
    '%s spreads only the keys a suggestion actually carried', (_name, src) => {
      for (const key of ['line1', 'city', 'state', 'pincode']) {
        const guarded = new RegExp(
          `\\.\\.\\.\\((s|sug)\\.${key}\\s*\\?\\s*\\{\\s*${key}:`);
        expect(src, `${key} is written unguarded — a blank suggestion would erase it`)
          .toMatch(guarded);
      }
    });

  it('both keep the hand-editable boxes as the record', () => {
    // The suggest box is an aid. If the six boxes ever disappear, a row the
    // vendor cannot describe becomes a row nobody can enter.
    expect(VENDOR).toMatch(/form\.address\[key\]/);
    expect(EMPLOYEE).toMatch(/form\.address\[k\]/);
  });
});

describe('the search fragment never reaches a request body', () => {
  it('the employee payload strips address_query explicitly', () => {
    // `EmployeeCreate` would drop an unknown key anyway — but sending it would
    // still put a search fragment in a body this product has no reason to
    // carry, and "pydantic drops it" is a guarantee about the server, not
    // about what left the browser.
    expect(EMPLOYEE).toMatch(/address_query:\s*_q,\s*\.\.\.payload\s*\}\s*=\s*form/);
    expect(EMPLOYEE).toMatch(/api\.post\('\/v1\/manav\/employees',\s*payload\)/);
    expect(EMPLOYEE, 'the whole form object is posted again')
      .not.toMatch(/api\.post\('\/v1\/manav\/employees',\s*form\)/);
  });

  it('the vendor payload is a whitelist, so it cannot leak', () => {
    // A different mechanism, and a stronger one: `vendorPayload` names every
    // key it sends, so a field added to the form is not sent by default.
    /* NORMALISED FIRST. The working copies here are CRLF, so a `'\n}\n'`
       boundary never matches and `slice(0, -1)` silently runs to end of file —
       which made this assertion scan the JSX below and fail on the very
       `address_query` it exists to prove is absent from the payload. The two
       length assertions are what turn that from a confusing failure into a
       named one. */
    const lf = VENDOR.replace(/\r\n/g, '\n');
    const fn = lf.slice(lf.indexOf('export function vendorPayload'));
    const end = fn.indexOf('\n}\n');
    expect(end, 'the end of vendorPayload was not found').toBeGreaterThan(0);
    const fnBody = fn.slice(0, end);
    expect(fnBody.length, 'the slice ran past the function').toBeLessThan(fn.length);
    expect(fnBody).not.toMatch(/address_query/);
    expect(fnBody).toMatch(/const p = \{/);
  });
});

describe('opening a saved record submits nothing', () => {
  it.each([['VendorForm', VENDOR], ['EmployeesTab', EMPLOYEE]])(
    '%s never seeds the suggest box from the stored address', (_name, src) => {
      /* THE FAILURE THIS PREVENTS. Seeding `value` from the saved address
         looks helpful and is the one thing that must not happen: the component
         searches from `onChange`, but a form that wrote a stored address into
         that box on open would put every existing customer's premises one
         keystroke away from being submitted to a third party under a perpetual
         licence — and it would look like the feature working. */
      const seeded = /value=\{[^}]*\.address\.(line1|city|state|pincode)/;
      expect(src, 'the suggest box is seeded from a stored address')
        .not.toMatch(seeded);
    });
});
