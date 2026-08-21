/**
 * What a CRM form SENDS — the part of it that is arithmetic rather than JSX.
 *
 * A separate module from the four sheets for the reason `dueDate.ts` already
 * gives: Node's type-stripping does not transform JSX, so nothing declared in a
 * `.tsx` file can be imported by `node --test`. The rules below are the ones
 * that are wrong silently — a date that lands a day early, a PATCH that clobbers
 * a column nobody touched — so they live where they can be exercised for real.
 *
 * ── THE TWO TRAPS IN `PATCH /deals/{id}` ─────────────────────────────────────
 *
 * `update_deal` (backend/routers/graha.py:1088) builds its SET list from
 * `body.dict(exclude_unset=True)` and then drops every key whose value is
 * `None`. Two consequences that a naive "send the whole form" edit sheet walks
 * straight into:
 *
 *  1. **A field cannot be cleared.** `None` is filtered out, so sending null
 *     changes nothing. Sending `''` is worse than nothing for the two columns
 *     that are cast: `expected_close_date=$n::date` and `client_id=$n` against a
 *     uuid column both raise on an empty string, and PgBouncer returns that as
 *     an instant 500. So `dealPatch` OMITS those two when they have gone empty,
 *     and the sheet says clearing them is desktop work rather than pretending.
 *
 *  2. **Every key sent is a column written.** Somebody at a desk may be editing
 *     the value of this same deal right now, and a phone that PUTs back the
 *     object it fetched two minutes ago silently reverts their work. Worse with
 *     the offline queue, which is last-write-wins with no version check and
 *     replays minutes later. So `dealPatch` sends the fields that CHANGED and
 *     nothing else — the same discipline `moveStage` already keeps by sending
 *     one key.
 *
 * `PATCH /contacts/{id}` differs on point 1 and the difference is deliberate,
 * not an oversight: `update_contact` writes `client_id=NULLIF($n,'')::uuid`, so
 * an empty string there really does clear the company. `contactPatch` therefore
 * DOES send it. The two are tested against each other.
 */

// ── The form shapes ──────────────────────────────────────────────────────────

/**
 * A deal, as the two deal sheets hold it.
 *
 * `value` is the string that was typed, not a number: a controlled numeric input
 * that parses on every keystroke cannot hold "12," or "1.", so the field would
 * fight the user halfway through a lakh. It is parsed once, on submit.
 *
 * `contactId` is on the CREATE form only. `DealUpdate` has no `contact_id`
 * field at all (graha.py:132) — `_DEAL_COLS` lists the column but the model
 * cannot carry it — so the person on a deal is fixed at creation as far as this
 * app is concerned.
 */
export interface DealForm {
  title:     string;
  contactId: string | null;
  clientId:  string | null;
  value:     string;
  stage:     string;
  closeDate: Date | null;
  notes:     string;
}

/** A person. `company` is not here on purpose — see `contactCreateBody`. */
export interface ContactForm {
  name:        string;
  email:       string;
  phone:       string;
  designation: string;
  clientId:    string | null;
  notes:       string;
  contactType: ContactType;
}

/** The company — the customer itself. */
export interface ClientForm {
  name:    string;
  refNo:   string;
  gstin:   string;
  website: string;
  notes:   string;
}

/** The four `create_contact` accepts. Anything else is a 400 (graha.py:446). */
export const CONTACT_TYPES = ['customer', 'lead', 'vendor', 'partner'] as const;
export type ContactType = typeof CONTACT_TYPES[number];

/**
 * What a contact created FROM A PHONE is, unless told otherwise.
 *
 * `ContactCreate.contact_type` defaults to `'lead'` on the server, which is the
 * right default for a web form fed by an inbound-lead inbox and the wrong one
 * here: a rep adding somebody on a phone has just met them at a customer site.
 * A lead that is really a customer is invisible to `graha_clients` reporting
 * and to the sales customer derivation, so this is stated explicitly at every
 * call site rather than inherited.
 */
export const DEFAULT_CONTACT_TYPE: ContactType = 'customer';

export const EMPTY_DEAL: DealForm = {
  title: '', contactId: null, clientId: null, value: '', stage: '', closeDate: null, notes: '',
};

export const EMPTY_CONTACT: ContactForm = {
  name: '', email: '', phone: '', designation: '', clientId: null, notes: '',
  contactType: DEFAULT_CONTACT_TYPE,
};

export const EMPTY_CLIENT: ClientForm = {
  name: '', refNo: '', gstin: '', website: '', notes: '',
};

// ── Scalars ──────────────────────────────────────────────────────────────────

/**
 * A `date` column's parameter — the LOCAL calendar day, never `toISOString()`.
 *
 * India is UTC+5:30, so `new Date(2026, 7, 21).toISOString()` is
 * `2026-08-20T18:30:00Z` and taking the first ten characters of it yields the
 * TWENTIETH. Every close date set between midnight and half past five in the
 * morning would land a day early, and a deal whose expected close is yesterday
 * shows up under "Past close date" on the screen that opened the form.
 *
 * `expected_close_date` is cast `::date` server-side, so the day is the whole of
 * what is being sent; there is no time component to preserve.
 */
export function toDateParam(d: Date): string {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** The reverse, for loading a `YYYY-MM-DD` back into the picker at local noon. */
export function fromDateParam(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) {
    const loose = new Date(s);
    return Number.isNaN(loose.getTime()) ? null : loose;
  }
  // Noon, not midnight: a midnight local Date shifted by a DST change (the app
  // is not pinned to IST) reads back as the previous day.
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

/**
 * What was typed, as a number the server will accept — or null if it is not one.
 *
 * Indian users type `12,50,000` and `₹12.5L` is a thing people say but not a
 * thing anyone types into a field, so grouping separators and the symbol are
 * stripped and nothing else is guessed. An empty box is zero, which is what
 * `DealCreate.value` defaults to and a legitimate answer for a deal whose size
 * is not known yet. Junk returns null so the caller can refuse rather than send
 * `NaN`, which serialises to `null` in JSON and would blank a real value on a
 * PATCH.
 */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[₹,\s]/g, '');
  if (cleaned === '') return 0;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Trim, then treat whitespace-only as absent. Used on every text field. */
function s(v: string | null | undefined): string {
  return (v ?? '').trim();
}

// ── Create bodies ────────────────────────────────────────────────────────────

/**
 * `POST /v1/graha/deals`.
 *
 * Empty strings rather than omitted keys for the two uuids and the date: the
 * INSERT casts them through `NULLIF($n,'')::uuid` and `NULLIF($n,'')::date`
 * (graha.py:970), so `''` is how a phone says "none" — and `null` would fail
 * that cast, not satisfy it.
 *
 * `pipeline_id` is deliberately not sent. `create_deal` reads the org's default
 * and, finding none, writes one — so a fresh org gets a working board from the
 * first deal a rep creates on a phone, and this form never has to show a
 * pipeline chooser for the one pipeline nearly every org has.
 */
export function dealCreateBody(f: DealForm): Record<string, unknown> {
  return {
    title:               s(f.title),
    contact_id:          f.contactId ?? '',
    client_id:           f.clientId ?? '',
    value:               parseAmount(f.value) ?? 0,
    stage:               s(f.stage) || 'New',
    expected_close_date: f.closeDate ? toDateParam(f.closeDate) : '',
    notes:               s(f.notes),
  };
}

/**
 * `POST /v1/graha/contacts`.
 *
 * `company` — the free-text employer box — is NOT sent. The server's own note on
 * `get_contact` (graha.py:653) records that the field is gone from both web
 * forms and the employer is the joined `graha_clients` row alone; a phone that
 * kept writing the free-text column would reintroduce the two-sources-of-truth
 * problem that was just removed.
 *
 * `gstin` and `pan` are not offered by the form at all and are therefore absent
 * here — non-mandatory, and a phone is not where a registration number gets
 * typed correctly.
 */
export function contactCreateBody(f: ContactForm): Record<string, unknown> {
  return {
    name:         s(f.name),
    email:        s(f.email),
    phone:        s(f.phone),
    designation:  s(f.designation),
    client_id:    f.clientId ?? '',
    notes:        s(f.notes),
    // Explicit, always. See DEFAULT_CONTACT_TYPE.
    contact_type: f.contactType,
  };
}

/**
 * `POST /v1/graha/clients`.
 *
 * GSTIN rides along unvalidated and unrequired. That is the product rule, and it
 * has drifted back more than once: a GSTIN must block nothing.
 */
export function clientCreateBody(f: ClientForm): Record<string, unknown> {
  return {
    name:    s(f.name),
    ref_no:  s(f.refNo),
    gstin:   s(f.gstin),
    website: s(f.website),
    notes:   s(f.notes),
  };
}

// ── Patch bodies ─────────────────────────────────────────────────────────────

/**
 * `PATCH /v1/graha/deals/{id}` — only what MOVED, and never an empty cast.
 *
 * Returns `{}` when nothing changed, which the sheet treats as "close, send
 * nothing": the endpoint answers a bodyless update with a 400, and showing a
 * red note because somebody opened a form and closed it is a lie about a
 * failure.
 *
 * See the module header for why `expected_close_date` and `client_id` are
 * dropped rather than emptied.
 */
export function dealPatch(before: DealForm, after: DealForm): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (s(after.title) !== s(before.title)) out.title = s(after.title);
  if (s(after.stage) !== s(before.stage) && s(after.stage)) out.stage = s(after.stage);
  if (s(after.notes) !== s(before.notes)) out.notes = s(after.notes);

  const nextValue = parseAmount(after.value);
  const prevValue = parseAmount(before.value);
  if (nextValue !== null && nextValue !== prevValue) out.value = nextValue;

  const nextDate = after.closeDate ? toDateParam(after.closeDate) : '';
  const prevDate = before.closeDate ? toDateParam(before.closeDate) : '';
  // Emptied, not changed — the ::date cast would 500 on ''. Left alone.
  if (nextDate !== prevDate && nextDate) out.expected_close_date = nextDate;

  const nextClient = after.clientId ?? '';
  const prevClient = before.clientId ?? '';
  // Same: the deal PATCH has no NULLIF around client_id, unlike the contact one.
  if (nextClient !== prevClient && nextClient) out.client_id = nextClient;

  return out;
}

/**
 * `PATCH /v1/graha/contacts/{id}` — only what moved, and clearing IS possible.
 *
 * `update_contact` casts `client_id=NULLIF($n,'')::uuid` (graha.py:723), so an
 * empty string detaches the contact from its company. That is the one asymmetry
 * with `dealPatch` and it is a server difference, not a preference.
 *
 * `contact_type` is not offered here even though the model accepts it: turning a
 * lead into a customer has its own endpoint that stamps `converted_at` and
 * emits `lead.converted`, and doing it with a PATCH instead would set the column
 * and fire nothing.
 */
export function contactPatch(before: ContactForm, after: ContactForm): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (s(after.name) !== s(before.name) && s(after.name)) out.name = s(after.name);
  if (s(after.email) !== s(before.email)) out.email = s(after.email);
  if (s(after.phone) !== s(before.phone)) out.phone = s(after.phone);
  if (s(after.designation) !== s(before.designation)) out.designation = s(after.designation);
  if (s(after.notes) !== s(before.notes)) out.notes = s(after.notes);

  const nextClient = after.clientId ?? '';
  const prevClient = before.clientId ?? '';
  if (nextClient !== prevClient) out.client_id = nextClient;

  return out;
}

// ── What stops a submit ──────────────────────────────────────────────────────

/**
 * The one field each form cannot do without.
 *
 * Deliberately short. `create_contact` will accept a row with nothing but a
 * name, `create_client` the same, and `create_deal` will take a title and
 * default the rest — so anything else this refused would be a rule invented on
 * the phone and enforced nowhere else in the product. GSTIN, PAN and TAN in
 * particular block NOTHING; that is a standing product rule.
 *
 * Returns the sentence to show, or null.
 */
export function dealError(f: DealForm): string | null {
  if (!s(f.title)) return 'Give the deal a name — it is what the list shows.';
  if (parseAmount(f.value) === null) return 'The value should be a number, like 250000.';
  return null;
}

export function contactError(f: ContactForm): string | null {
  if (!s(f.name)) return 'A contact needs a name.';
  return null;
}

export function clientError(f: ClientForm): string | null {
  if (!s(f.name)) return 'A company needs a name.';
  return null;
}

/** Nothing was typed. Used to skip a PATCH rather than send an empty one. */
export function isEmptyPatch(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).length === 0;
}
