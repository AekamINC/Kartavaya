/**
 * entitySource — what a picker is pointed AT, and the arithmetic around it.
 *
 * Its own module, with no imports and no JSX, for the same reason
 * `offline/deltaCursor.ts` is: this is where a picker fails SILENTLY, and the
 * harness cannot load a `.tsx` file (`src/test/register.mjs` strips types but
 * does not transform JSX). Everything here is therefore exercised by
 * `__tests__/entitySource.test.ts`; `EntityPicker.tsx` is the renderer and holds
 * no rules of its own.
 *
 * ── THE FAILURE THIS EXISTS TO PREVENT ───────────────────────────────────────
 *
 * `GET /v1/graha/contacts` ends `ORDER BY c.created_at DESC LIMIT 200`
 * (`routers/graha.py:369`). Staging holds 292 live contacts. A picker that
 * fetches the list once and filters the array in JavaScript can therefore never
 * offer 92 of them — and it does not look broken from the outside: the search
 * box works, rows appear, and the person being looked for simply is not among
 * them. The user concludes the contact was never created and creates it again.
 *
 * So a source declares whether the SERVER can search it:
 *
 *   · `serverSearch: true`  — the query goes to `?search=` and the LIMIT is
 *     applied AFTER the filter, so the whole table is reachable. Contacts and
 *     clients (`routers/graha.py:404`, `:429`).
 *   · `serverSearch: false` — the endpoint takes no search parameter, AND has
 *     no LIMIT, so one fetch really is the complete set and filtering it here
 *     hides nothing. Products (`routers/ganit.py:360`, no LIMIT clause) and a
 *     project's members (`GET /teams/{id}`, a bare array).
 *
 * The dangerous combination — capped AND unsearchable — is not expressible:
 * there is no third value, and a capped list is only ever offered with
 * `serverSearch: true`. If an endpoint ever grows a LIMIT without a `search`
 * parameter, this file has to grow a way to say so out loud, not a quiet
 * `false`.
 *
 * ── NO UUID MAY REACH THE SCREEN ─────────────────────────────────────────────
 *
 * `toOptions` drops any row whose label resolves to a uuid, rather than
 * rendering it. The web has a ratchet for this
 * (`frontend/scripts/check-rendered-ids.mjs`); mobile has none, so the guard is
 * in the one place every picker's rows pass through. Dropping is silent by
 * itself, which is its own small lie — so the count comes back with the rows and
 * the picker says how many it could not name.
 */

/** The minimum a picker row needs: something to show, something to return. */
export interface PickerOption {
  /** The value handed back to the form. NEVER rendered. */
  id: string;
  /** What the reader sees. */
  label: string;
  /** The second line — a company, an email, a price. Optional. */
  sublabel?: string;
}

/** A row as it arrives from the server, before anything has been assumed. */
export type Row = Record<string, unknown>;

export interface EntitySource<R extends Row = Row> {
  /**
   * The react-query key PREFIX. Chosen to match what the screens already
   * invalidate — `['graha','contacts']`, `['vikray','orders']` — so a delta
   * sync's `invalidateQueries` reaches the picker's cache by prefix without
   * anybody wiring it a second time.
   */
  queryKey: string[];
  /** Path under `/api`. */
  url: string;
  /** See the module docstring. This is the whole safety property. */
  serverSearch: boolean;
  /** Filters that are part of WHICH list this is, not part of the search. */
  staticParams?: Record<string, string | number | boolean>;
  /** Characters before a server search is worth a request. 0 = list on open. */
  minChars: number;
  /** The name. Returning null or a uuid drops the row — see `toOptions`. */
  label: (row: R) => string | null | undefined;
  /** The second line, if there is one. A uuid here is dropped, not the row. */
  sublabel?: (row: R) => string | null | undefined;
  /** The value the form wants back. */
  value: (row: R) => string | null | undefined;
  /**
   * The fields a LOCAL filter may match against — used offline, and for the
   * sources the server cannot search. Deliberately explicit: matching every
   * string field would make a picker find people by their uuid.
   */
  haystack: (row: R) => Array<string | null | undefined>;
  /** Singular/plural for the sentences the picker writes about itself. */
  noun: { one: string; many: string };
  /** Bilingual kicker, the NewTaskSheet field-label idiom. */
  kicker: string;
  /** Placeholder for the search field. */
  placeholder: string;
}

/**
 * A uuid, as Postgres prints one. Same expression as `api/messages.ts`'s
 * `UUID_RE`, deliberately NOT imported from it: that module is the Sanvaad chat
 * network surface, and a CRM picker acquiring a dependency on the chat API to
 * borrow a regex is the kind of edge that makes a module impossible to move
 * later. Six lines of duplication against that trade is the cheaper side.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeId(v: unknown): boolean {
  return typeof v === 'string' && UUID_RE.test(v.trim());
}

/* ── Response shapes ───────────────────────────────────────────────────────── */

/**
 * The rows, whatever envelope they arrived in.
 *
 * Three shapes are live in this product and a picker meets all three:
 *
 *   `{ data, total, limit, truncated }`  — `_listed`, every graha/vikray list
 *   `{ data: [...] }`                    — `/v1/ganit/products`, no metadata
 *   `{ members: [...] }`                 — `GET /teams/{id}`
 *   `[...]`                              — `GET /teams`
 *
 * Anything else yields an empty list rather than a throw: a picker that renders
 * nothing is recoverable, a picker that crashes the form it is inside is not.
 */
export function unwrapRows(body: unknown): Row[] {
  if (Array.isArray(body)) return body.filter(isRow);
  if (!body || typeof body !== 'object') return [];
  const o = body as Record<string, unknown>;
  if (Array.isArray(o.data)) return o.data.filter(isRow);
  if (Array.isArray(o.members)) return o.members.filter(isRow);
  return [];
}

function isRow(v: unknown): v is Row {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export interface ListMeta {
  /** How many rows the filter selected server-side, or null when unstated. */
  total: number | null;
  /** The server's cap, or null when the endpoint has none. */
  limit: number | null;
  /** `total > limit` — the server said so; never inferred from the page size. */
  truncated: boolean;
}

/**
 * What the server said about completeness.
 *
 * `truncated` is READ, never derived from `rows.length === limit`: a list of
 * exactly 200 rows out of exactly 200 is complete, and guessing would put a
 * permanent "there are more" note on it. `_listed` computes the flag from a
 * `COUNT(*) OVER()` in the same query, which is the only place it can be right.
 */
export function listMeta(body: unknown): ListMeta {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { total: null, limit: null, truncated: false };
  }
  const o = body as Record<string, unknown>;
  return {
    total:     typeof o.total === 'number' ? o.total : null,
    limit:     typeof o.limit === 'number' ? o.limit : null,
    truncated: o.truncated === true,
  };
}

/* ── Requests ──────────────────────────────────────────────────────────────── */

/**
 * The params for one request. `search` is OMITTED when empty rather than sent
 * blank — FastAPI would bind `search=""`, which is falsy in the router and
 * behaves identically, but an empty query string in the URL makes two identical
 * requests look different in a log and in a cache key.
 */
export function requestParams(
  source: EntitySource,
  query: string,
): Record<string, string | number | boolean> {
  const params = { ...(source.staticParams ?? {}) };
  const q = query.trim();
  if (source.serverSearch && q.length >= source.minChars && q.length > 0) {
    params.search = q;
  }
  return params;
}

/**
 * Whether a server round-trip is worth making for this query.
 *
 * False for a source the server cannot search — one fetch already holds
 * everything — and false below `minChars`, so a picker on a large table does
 * not ask 200 questions while somebody types a name.
 */
export function shouldAskServer(source: EntitySource, query: string): boolean {
  if (!source.serverSearch) return false;
  const q = query.trim();
  return q.length > 0 && q.length >= source.minChars;
}

/**
 * A stable string for the static filters, for the cache key.
 *
 * Sorted, because `{a,b}` and `{b,a}` are the same request and must not mint two
 * cache entries — `JSON.stringify` alone preserves insertion order and would.
 */
export function paramSignature(source: EntitySource): string {
  const p = source.staticParams ?? {};
  const keys = Object.keys(p).sort();
  return keys.map(k => `${k}=${String(p[k])}`).join('&');
}

/* ── Rows → options ────────────────────────────────────────────────────────── */

export interface Normalised {
  options: PickerOption[];
  /**
   * Rows that had no renderable name — dropped, and COUNTED, because dropping
   * in silence is how a picker convinces someone a record does not exist.
   */
  unnamed: number;
}

/**
 * Rows to rows-that-may-be-drawn.
 *
 * Three things happen, and each is a rule rather than tidying:
 *
 *  1. A row with no `value` is dropped. There is nothing to hand back.
 *  2. A row whose label is empty, or is a uuid, is dropped and counted. Never
 *     rendered — `decision_names_not_ids`, and the id would be meaningless to
 *     the reader anyway.
 *  3. A SUBLABEL that is a uuid is dropped on its own, leaving the row. The
 *     second line is decoration; losing the whole contact because their
 *     `client_name` came back as a raw id would be the worse trade.
 */
export function toOptions<R extends Row>(rows: R[], source: EntitySource<R>): Normalised {
  const options: PickerOption[] = [];
  let unnamed = 0;

  for (const row of rows) {
    const value = source.value(row);
    if (typeof value !== 'string' || !value.trim()) continue;

    const label = source.label(row);
    const clean = typeof label === 'string' ? label.trim() : '';
    if (!clean || looksLikeId(clean)) { unnamed += 1; continue; }

    const sub = source.sublabel?.(row);
    const subClean = typeof sub === 'string' ? sub.trim() : '';

    options.push({
      id: value,
      label: clean,
      ...(subClean && !looksLikeId(subClean) ? { sublabel: subClean } : {}),
    });
  }

  return { options, unnamed };
}

/* ── Local filtering ───────────────────────────────────────────────────────── */

/**
 * The local match, used for sources the server cannot search AND as the offline
 * fallback for the ones it can.
 *
 * Every whitespace-separated token must appear somewhere in the haystack —
 * `"acme mum"` finds `Acme Traders / Mumbai`, which a single-substring match
 * cannot. Case-folded with `toLowerCase` rather than `localeCompare`: the data
 * is Latin and Devanagari, neither of which has a case mapping this could get
 * wrong, and `localeCompare` on every row of a 200-row list on every keystroke
 * is a measurable cost on a low-end Android.
 */
export function localMatch(haystack: Array<string | null | undefined>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = haystack
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(' ')
    .toLowerCase();
  return q.split(/\s+/).every(tok => hay.includes(tok));
}

/** `localMatch` over rows, keeping the source's declared haystack. */
export function localFilter<R extends Row>(rows: R[], source: EntitySource<R>, query: string): R[] {
  if (!query.trim()) return rows;
  return rows.filter(r => localMatch(source.haystack(r), query));
}

/* ── The sentences the picker writes about itself ──────────────────────────── */

export interface PickerNotice {
  /** What the reader is told, or null when there is nothing worth saying. */
  text: string | null;
  /** `warn` is drawn in the error colour: the list is INCOMPLETE. */
  tone: 'info' | 'warn';
}

/**
 * Whether this list is hiding anything, said plainly.
 *
 * The three cases that matter, in the order they are decided:
 *
 *  · OFFLINE with a query typed. The server was asked and could not answer, so
 *    what is on screen is the last page that reached this device, filtered
 *    locally. That page was capped at 200 by the same LIMIT this module exists
 *    to work around, so the honest sentence says the search is partial. This is
 *    first because it is true regardless of what the cached page's own metadata
 *    said.
 *  · TRUNCATED with no query. The server holds more than it sent. "Showing 200
 *    of 292" plus what to do about it, which is to type.
 *  · TRUNCATED with a query. Rarer — 200 matches for a typed string — but the
 *    same rule: the answer on screen is not the whole answer.
 */
export function truncationNotice(opts: {
  meta: ListMeta;
  shown: number;
  query: string;
  offline: boolean;
  noun: { one: string; many: string };
}): PickerNotice {
  const { meta, shown, query, offline, noun } = opts;
  const typed = query.trim().length > 0;

  if (offline) {
    return {
      tone: 'warn',
      text: `Offline — searching ${shown} saved ${shown === 1 ? noun.one : noun.many}. `
          + 'Some may be missing until you reconnect.',
    };
  }

  if (!meta.truncated) return { text: null, tone: 'info' };

  const of = meta.total !== null ? ` of ${meta.total}` : '';
  if (!typed) {
    return {
      tone: 'info',
      text: `Showing ${shown}${of} ${noun.many} — type to search all of them.`,
    };
  }
  return {
    tone: 'warn',
    text: `Showing the first ${shown}${of} matches — narrow the search to see the rest.`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * The four sources
 *
 * Factories rather than constants: two of them take a scope (a team, a contact
 * type), and a picker whose URL is fixed at module load cannot express "the
 * members of THIS project".
 * ════════════════════════════════════════════════════════════════════════════*/

/**
 * A person at a company. 292 of them on staging behind a LIMIT of 200 — the
 * case in the module docstring.
 *
 * The label is `name` alone. `company` goes on the second line rather than into
 * the name, because two people at the same firm are told apart by the firm and
 * the search matches both halves anyway.
 */
export function contactSource(opts?: { contactType?: string }): EntitySource {
  return {
    queryKey: ['graha', 'contacts'],
    url: '/v1/graha/contacts',
    // `?search=` runs INSIDE the query, before `LIMIT 200`. routers/graha.py:404.
    serverSearch: true,
    ...(opts?.contactType ? { staticParams: { contact_type: opts.contactType } } : {}),
    minChars: 1,
    label: r => str(r.name),
    // `company` is the contact's own free-text employer; `client_name` is the
    // joined company record. Prefer the joined one — it is the entity the CRM
    // actually knows, and the free-text field is what somebody typed once.
    sublabel: r => str(r.client_name) ?? str(r.company) ?? str(r.email),
    value: r => str(r.id),
    haystack: r => [str(r.name), str(r.company), str(r.client_name), str(r.email), str(r.phone)],
    noun: { one: 'contact', many: 'contacts' },
    kicker: 'CONTACT · संपर्क',
    placeholder: 'Search contacts…',
  };
}

/**
 * The COMPANY — the customer. Not a contact.
 *
 * `crm_client_is_the_company`: contacts come and go, the customer stays, so a
 * form asking "whose is this?" wants this source and not `contactSource`.
 * `ref_no` rides on the second line because two companies genuinely do share a
 * name and the reference is how the practice tells them apart. GSTIN is
 * searchable server-side (`routers/graha.py:429`) but is NOT put on screen —
 * it is a registration number, not a name, and the row already has one.
 */
export function clientSource(): EntitySource {
  return {
    queryKey: ['graha', 'clients'],
    serverSearch: true,
    url: '/v1/graha/clients',
    minChars: 1,
    label: r => str(r.name),
    sublabel: r => str(r.ref_no),
    value: r => str(r.id),
    haystack: r => [str(r.name), str(r.ref_no), str(r.gstin)],
    noun: { one: 'client', many: 'clients' },
    kicker: 'CLIENT · ग्राहक',
    placeholder: 'Search companies…',
  };
}

/**
 * A product or service line.
 *
 * `serverSearch: false` and that is SAFE here, unlike everywhere else in this
 * file: `GET /v1/ganit/products` has no `search` parameter AND no LIMIT
 * (`routers/ganit.py:360`), so the one fetch is the complete active catalogue
 * and a local filter cannot hide a row. If a LIMIT is ever added to that query
 * this source becomes the exact bug the module docstring describes.
 */
export function productSource(): EntitySource {
  return {
    queryKey: ['ganit', 'products'],
    url: '/v1/ganit/products',
    serverSearch: false,
    minChars: 0,
    label: r => str(r.name),
    // The unit, not the price: a picker row is an identification, and money on
    // it invites reading a stale catalogue figure as the line total.
    sublabel: r => str(r.unit) ?? (r.is_service === true ? 'Service' : null),
    value: r => str(r.id),
    haystack: r => [str(r.name), str(r.hsn_code), str(r.sac_code), str(r.description)],
    noun: { one: 'product', many: 'products' },
    kicker: 'ITEM · वस्तु',
    placeholder: 'Search products and services…',
  };
}

/**
 * Somebody on a project, to assign work to.
 *
 * Scoped to the project deliberately. `NewTaskSheet` reads the same endpoint and
 * offers the same set, and an org-wide list would let a form assign a task to
 * somebody who cannot open the board it is on.
 *
 * `GET /teams/{id}` returns `{members:[…]}` unfiltered and uncapped, so the
 * local filter is complete — see `productSource` for the same reasoning.
 *
 * The name falls through four columns because all four are populated in
 * different rows of `TeamMember`, and an email is a worse name than a name but
 * an infinitely better one than a uuid.
 */
export function assigneeSource(teamId: string): EntitySource {
  return {
    queryKey: ['members', teamId],
    url: `/teams/${teamId}`,
    serverSearch: false,
    minChars: 0,
    label: r => str(r.display_name) ?? str(r.full_name) ?? str(r.name) ?? str(r.email),
    // Only when it is NOT already the label — otherwise a member with no name
    // gets their email printed twice, once above the other.
    sublabel: r => {
      const named = str(r.display_name) ?? str(r.full_name) ?? str(r.name);
      return named ? str(r.position) ?? str(r.email) : null;
    },
    // `user_id` is the id the task API wants; `member_id` is the fallback for
    // rows that predate it — the same pair `NewTaskSheet` picks between.
    value: r => str(r.user_id) ?? str(r.member_id),
    haystack: r => [
      str(r.display_name), str(r.full_name), str(r.name), str(r.email), str(r.position),
    ],
    noun: { one: 'person', many: 'people' },
    kicker: 'ASSIGNEE · नियुक्त',
    placeholder: 'Search people…',
  };
}

/** A trimmed string, or null — never `''`, never a number that stringifies. */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
