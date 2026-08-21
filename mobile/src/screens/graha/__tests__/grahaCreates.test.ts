/**
 * The CRM CREATE and EDIT paths.
 *
 * Same split as `grahaWrites.test.ts`, and for the same reason: `draftRules.ts`
 * has no JSX so `node --test` can load and CALL it, while the five `.tsx` sheets
 * cannot be imported at all and are reached by reading their source.
 *
 * The assertions that matter here are the ones about what goes ON THE WIRE. A
 * date that is one day early, a PATCH that carries a column nobody touched, and
 * a create that is queued offline are all invisible from the phone and all
 * permanent in a database production shares with staging.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readCode } from '../../../test/source.ts';
import { writeErrorMessage } from '../../../api/graha.ts';
import {
  toDateParam, fromDateParam, parseAmount,
  dealCreateBody, contactCreateBody, clientCreateBody,
  dealPatch, contactPatch,
  dealError, contactError, clientError, isEmptyPatch,
  EMPTY_DEAL, EMPTY_CONTACT, EMPTY_CLIENT, CONTACT_TYPES, DEFAULT_CONTACT_TYPE,
  type DealForm, type ContactForm,
} from '../draftRules.ts';

const deal = (over: Partial<DealForm> = {}): DealForm => ({ ...EMPTY_DEAL, title: 'Retainer', ...over });
const contact = (over: Partial<ContactForm> = {}): ContactForm => ({ ...EMPTY_CONTACT, name: 'Priya', ...over });

// ── The date, which is the one that silently loses a day ─────────────────────

test('a close date is the LOCAL calendar day, not the UTC one', () => {
  // The defect this exists for: in IST (UTC+5:30) `new Date(2026,7,21).toISOString()`
  // is 2026-08-20T18:30:00Z, so slicing ten characters off it yields the 20th.
  // Every date set before 05:30 local would land a day early, and a deal whose
  // expected close is yesterday is counted as slipping by the screen that
  // opened the form.
  const midnight = new Date(2026, 7, 21, 0, 0, 0);
  assert.equal(toDateParam(midnight), '2026-08-21');
  assert.equal(toDateParam(new Date(2026, 7, 21, 23, 59, 59)), '2026-08-21');
  assert.equal(toDateParam(new Date(2026, 0, 1)), '2026-01-01');
});

test('the month and day are zero-padded — Postgres will not take 2026-8-1', () => {
  assert.equal(toDateParam(new Date(2026, 0, 5)), '2026-01-05');
});

test('a date read back from the server round-trips to the same day', () => {
  // Parsed at local NOON rather than midnight: a midnight Date shifted by a DST
  // change reads back as the day before, and the app is not pinned to IST.
  const back = fromDateParam('2026-08-21');
  assert.ok(back);
  assert.equal(toDateParam(back as Date), '2026-08-21');
  assert.equal((back as Date).getHours(), 12);
});

test('a null or unparseable date is null, never an Invalid Date', () => {
  assert.equal(fromDateParam(null), null);
  assert.equal(fromDateParam(''), null);
  assert.equal(fromDateParam(undefined), null);
});

test('a full timestamp from the server keeps its date half', () => {
  const back = fromDateParam('2026-08-21T00:00:00+05:30');
  assert.equal(toDateParam(back as Date), '2026-08-21');
});

// ── Amounts ──────────────────────────────────────────────────────────────────

test('an amount typed the Indian way parses', () => {
  assert.equal(parseAmount('12,50,000'), 1250000);
  assert.equal(parseAmount('₹250000'), 250000);
  assert.equal(parseAmount(' 2500.50 '), 2500.5);
});

test('an empty box is zero — which is what DealCreate.value defaults to', () => {
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('   '), 0);
});

test('junk is null, NOT NaN', () => {
  // NaN serialises to `null` in JSON, and a null `value` on a PATCH would blank
  // a real figure. Null here means the form refuses instead.
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('1.2.3'), null);
  assert.equal(parseAmount('12k'), null);
});

// ── Create bodies ────────────────────────────────────────────────────────────

test('a deal with no contact and no company sends EMPTY STRINGS, not nulls', () => {
  // `create_deal` casts both through `NULLIF($n,'')::uuid`. A null fails that
  // cast; an empty string is how the phone says "none".
  const body = dealCreateBody(deal());
  assert.equal(body.contact_id, '');
  assert.equal(body.client_id, '');
  assert.equal(body.expected_close_date, '');
});

test('a deal create never sends a pipeline_id', () => {
  // `create_deal` resolves the org default and bootstraps one if there is none,
  // so a fresh org gets a working board from the first deal made on a phone.
  assert.equal('pipeline_id' in dealCreateBody(deal()), false);
});

test('a deal with no stage falls back to New rather than sending nothing', () => {
  assert.equal(dealCreateBody(deal()).stage, 'New');
  assert.equal(dealCreateBody(deal({ stage: 'Negotiation' })).stage, 'Negotiation');
});

test('a contact created from a phone is a CUSTOMER, and it is always stated', () => {
  // `ContactCreate.contact_type` defaults to 'lead' server-side. A lead that is
  // really a customer does not derive into the sales customer list.
  assert.equal(DEFAULT_CONTACT_TYPE, 'customer');
  assert.equal(EMPTY_CONTACT.contactType, 'customer');
  const body = contactCreateBody(contact());
  assert.equal(body.contact_type, 'customer');
  assert.equal('contact_type' in body, true, 'the key must be present, never inherited');
});

test('the four contact types are exactly the four the server accepts', () => {
  // `create_contact` 400s on anything else (graha.py:446).
  assert.deepEqual([...CONTACT_TYPES].sort(), ['customer', 'lead', 'partner', 'vendor']);
});

test('a contact never writes the free-text company column', () => {
  // The employer is the joined graha_clients row alone — the server says so on
  // `get_contact`. Writing both puts the two back out of step.
  const body = contactCreateBody(contact({ clientId: 'c1' }));
  assert.equal('company' in body, false);
  assert.equal(body.client_id, 'c1');
});

test('a contact with no company sends an empty string', () => {
  assert.equal(contactCreateBody(contact()).client_id, '');
});

test('a company can be created with a name and nothing else', () => {
  const body = clientCreateBody({ ...EMPTY_CLIENT, name: 'Nair Textiles' });
  assert.equal(body.name, 'Nair Textiles');
  assert.equal(body.gstin, '');
});

test('every text field is trimmed on the way out', () => {
  assert.equal(dealCreateBody(deal({ title: '  Retainer  ' })).title, 'Retainer');
  assert.equal(contactCreateBody(contact({ name: ' Priya ' })).name, 'Priya');
});

// ── The PATCH bodies — the ones that can clobber somebody's desktop edit ─────

test('an untouched form produces an EMPTY patch', () => {
  const before = deal({ value: '100', notes: 'x' });
  assert.deepEqual(dealPatch(before, { ...before }), {});
  assert.equal(isEmptyPatch(dealPatch(before, { ...before })), true);
});

test('only the field that moved is sent', () => {
  // `update_deal` writes every key it receives. Somebody may be editing the
  // value of this same deal at a desk right now, and the offline queue replays
  // minutes later — a wide body reverts their work twice.
  const before = deal({ title: 'Retainer', value: '100000', notes: 'old' });
  const after  = { ...before, notes: 'new' };
  assert.deepEqual(dealPatch(before, after), { notes: 'new' });
});

test('a close date that was CLEARED is dropped, not sent empty', () => {
  // `expected_close_date=$n::date` has no NULLIF in this endpoint. An empty
  // string is a parse error, which PgBouncer returns as an instant 500.
  const before = deal({ closeDate: new Date(2026, 7, 21) });
  const after  = { ...before, closeDate: null };
  assert.deepEqual(dealPatch(before, after), {});
});

test('a company that was CLEARED on a DEAL is dropped', () => {
  // Same reason: `client_id=$n` against a uuid column, no NULLIF.
  const before = deal({ clientId: 'c1' });
  assert.deepEqual(dealPatch(before, { ...before, clientId: null }), {});
});

test('a company that was CLEARED on a CONTACT is SENT as an empty string', () => {
  // The asymmetry is the server's, not a preference: `update_contact` writes
  // `client_id=NULLIF($n,'')::uuid`, so '' really does detach them.
  const before = contact({ clientId: 'c1' });
  assert.deepEqual(contactPatch(before, { ...before, clientId: null }), { client_id: '' });
});

test('a stage cannot be blanked to nothing', () => {
  const before = deal({ stage: 'Negotiation' });
  assert.deepEqual(dealPatch(before, { ...before, stage: '' }), {});
});

test('a name cannot be blanked on a contact', () => {
  const before = contact({ name: 'Priya' });
  assert.deepEqual(contactPatch(before, { ...before, name: '   ' }), {});
});

test('a value edited to junk is not sent — a null would blank the real figure', () => {
  const before = deal({ value: '100000' });
  assert.deepEqual(dealPatch(before, { ...before, value: '12k' }), {});
});

test('a value edited to zero IS sent — nil is a legitimate answer', () => {
  const before = deal({ value: '100000' });
  assert.deepEqual(dealPatch(before, { ...before, value: '0' }), { value: 0 });
});

test('re-typing the same amount with commas is not a change', () => {
  const before = deal({ value: '1250000' });
  assert.deepEqual(dealPatch(before, { ...before, value: '12,50,000' }), {});
});

test('a deal PATCH can never carry contact_id — DealUpdate has no such field', () => {
  // `_DEAL_COLS` lists the column but the pydantic model does not carry it
  // (graha.py:132), so a key sent here is silently dropped rather than applied.
  const before = deal({ contactId: 'a' });
  const patch = dealPatch(before, { ...before, contactId: 'b' });
  assert.equal('contact_id' in patch, false);
});

test('a contact PATCH never carries contact_type — that is what convert is for', () => {
  // Setting the column by hand would change the row and emit no `lead.converted`,
  // so every rule built on the conversion would stay silent.
  const before = contact({ contactType: 'lead' });
  const patch = contactPatch(before, { ...before, contactType: 'customer' });
  assert.equal('contact_type' in patch, false);
});

test('emptying an optional contact field IS allowed', () => {
  // Unlike the two cast columns on a deal, these are plain text.
  const before = contact({ email: 'a@b.com', phone: '99', designation: 'CFO' });
  assert.deepEqual(
    contactPatch(before, { ...before, email: '', phone: '', designation: '' }),
    { email: '', phone: '', designation: '' },
  );
});

// ── What refuses a submit ────────────────────────────────────────────────────

test('the only thing that blocks a create is a missing name', () => {
  assert.ok(dealError(deal({ title: '' })));
  assert.equal(dealError(deal()), null);
  assert.ok(contactError(contact({ name: '' })));
  assert.equal(contactError(contact()), null);
  assert.ok(clientError({ ...EMPTY_CLIENT, name: '' }));
  assert.equal(clientError({ ...EMPTY_CLIENT, name: 'Nair Textiles' }), null);
});

test('GSTIN BLOCKS NOTHING — a company saves with none, or with junk', () => {
  // A standing product rule that has drifted back more than once. GSTIN, PAN and
  // TAN are non-mandatory across this product and must block no form.
  assert.equal(clientError({ ...EMPTY_CLIENT, name: 'X' }), null);
  assert.equal(clientError({ ...EMPTY_CLIENT, name: 'X', gstin: 'not-a-gstin' }), null);
  assert.equal(clientCreateBody({ ...EMPTY_CLIENT, name: 'X', gstin: 'not-a-gstin' }).gstin, 'not-a-gstin');
});

test('a bad amount blocks a deal, because it cannot be sent as a number', () => {
  assert.ok(dealError(deal({ value: '12k' })));
  assert.equal(dealError(deal({ value: '' })), null);
});

// ── The refusal copy ─────────────────────────────────────────────────────────

test('a 400 shows the SERVER’s reason, which is the only useful one', () => {
  // "Contact is already a customer" tells a rep somebody else converted the
  // lead. "That did not save" does not.
  const err = { response: { status: 400, data: { detail: 'Contact is already a customer' } } };
  assert.equal(writeErrorMessage(err), 'Contact is already a customer');
});

test('a 422 validation LIST is not rendered at a user', () => {
  // FastAPI puts an array of error objects in the same `detail` key, and
  // printing it gives "[object Object]".
  const err = { response: { status: 400, data: { detail: [{ loc: ['body'], msg: 'bad' }] } } };
  assert.equal(writeErrorMessage(err), 'The server refused that. Nothing was saved.');
});

test('a 404 names the thing that vanished', () => {
  assert.match(writeErrorMessage({ response: { status: 404 } }, { noun: 'contact' }), /contact no longer exists/);
  assert.match(writeErrorMessage({ response: { status: 404 } }), /deal no longer exists/);
});

// ── Source contracts: the sheets ─────────────────────────────────────────────
//
// Weak instruments, used only because JSX cannot be imported here. Each pins one
// decision so that removing it turns the suite red.

const CREATE_SHEETS = ['NewDealSheet', 'NewClientSheet'] as const;

for (const name of CREATE_SHEETS) {
  test(`${name} disables its button when the device is offline`, () => {
    // The rule from `api/graha.ts`: the queue replays with no idempotency key,
    // so a create whose response was lost arrives twice.
    const code = readCode(`screens/graha/${name}.tsx`);
    assert.match(code, /canSubmit=\{online &&/,
      `${name} no longer requires a connection to submit`);
  });

  test(`${name} says WHY it is refusing, rather than failing silently`, () => {
    const code = readCode(`screens/graha/${name}.tsx`);
    assert.match(code, /!online && \(\s*<InfoNote/,
      `${name} dropped the offline explanation`);
  });

  test(`${name} never enqueues — no create goes through the offline queue`, () => {
    const code = readCode(`screens/graha/${name}.tsx`);
    assert.doesNotMatch(code, /useOfflineMutation/,
      `${name} is queueing a POST; it will duplicate on replay`);
  });
}

test('ContactSheet queues its EDIT and refuses to queue its CREATE', () => {
  const code = readCode('screens/graha/ContactSheet.tsx');
  // The PATCH is queueable — applied twice it is one change.
  assert.match(code, /useOfflineMutation/, 'the contact edit stopped being queueable');
  // The POST is not: it is awaited directly against the API module.
  assert.match(code, /grahaWriteApi\.createContact\(/, 'the create no longer calls the API directly');
  assert.match(code, /editing \|\| online/, 'the create no longer requires a connection');
});

test('converting a lead is online-only and is NOT a PATCH of contact_type', () => {
  const code = readCode('screens/graha/ContactSheet.tsx');
  assert.match(code, /grahaWriteApi\.convertLead\(/, 'convert no longer uses its own endpoint');
  assert.match(code, /disabled=\{!online \|\| converting\}/, 'convert can now be tapped offline');
});

test('EditDealSheet sends the DIFF, never the whole form', () => {
  // The failure it prevents: a phone that PUT back the object it fetched two
  // minutes ago reverts an edit somebody is making at a desk right now.
  const code = readCode('screens/graha/EditDealSheet.tsx');
  assert.match(code, /dealPatch\(before, form\)/, 'the edit sheet stopped diffing');
  assert.doesNotMatch(code, /bodyBuilder: v => v\.form/, 'the edit sheet is sending a form object');
});

test('EditDealSheet sets no optimisticId, so queued edits MERGE', () => {
  // With one, a second save REPLACES the queued body and the first edit's
  // fields are lost. Without one the queue falls through to its PATCH squash,
  // which merges bodies for the same URL.
  const code = readCode('screens/graha/EditDealSheet.tsx');
  assert.doesNotMatch(code, /optimisticId:/, 'an optimisticId is back on the deal edit');
});

test('EditDealSheet offers no clear on the two columns that cannot be cleared', () => {
  const code = readCode('screens/graha/EditDealSheet.tsx');
  // The company field takes no `onClear` — the endpoint has no NULLIF on it.
  const companyField = code.slice(code.indexOf('source={clients}'), code.indexOf('EXPECTED CLOSE'));
  assert.doesNotMatch(companyField, /onClear=/, 'the deal edit offers a clear that does nothing');
});

test('every new sheet uses the ONE picker, not a second list of contacts', () => {
  // `EntityPicker` handles server-side search, which is what stops the
  // 92-contacts-behind-a-LIMIT-of-200 failure its own module documents. A form
  // that renders its own list reintroduces it silently.
  for (const name of ['NewDealSheet', 'EditDealSheet', 'ContactSheet']) {
    const code = readCode(`screens/graha/${name}.tsx`);
    assert.match(code, /PickerField/, `${name} is not using the shared picker`);
    assert.doesNotMatch(code, /\/v1\/graha\/(contacts|clients)['"`]/,
      `${name} is fetching a chooser list of its own`);
  }
});

test('no new sheet renders an id', () => {
  // Names, never ids. `selectedId` is passed INTO the picker to tick a row and
  // is never drawn; anything else printing `.id` in JSX is the defect.
  for (const name of ['NewDealSheet', 'EditDealSheet', 'ContactSheet', 'NewClientSheet', 'CreateBar']) {
    const code = readCode(`screens/graha/${name}.tsx`);
    assert.doesNotMatch(code, /<Text[^>]*>\s*\{[^}]*\.id\b/,
      `${name} renders an id`);
  }
});

test('the CRM screen no longer claims creating is desktop work', () => {
  const code = readCode('screens/modules/GrahaScreen.tsx');
  assert.doesNotMatch(code, /Creating a deal, editing a contact/,
    'the boundary note still says creates are desktop-only');
  assert.match(code, /CreateBar/, 'the create surface is not mounted');
});

test('the CRM screen no longer resolves an empty state that would hide the ADD bar', () => {
  // `ModuleShell` swaps its children for the empty card, which would hide the
  // only way to create the first deal from exactly the org that has none.
  const code = readCode('screens/modules/GrahaScreen.tsx');
  assert.doesNotMatch(code, /isEmpty:/, 'the empty state is back and hides the create bar');
  assert.match(code, /isError:/, 'isError must stay — a failure may never read as empty');
});
