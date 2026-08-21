import { apiClient } from './client';

/**
 * Vikray · विक्रय — Sales.
 *
 * The module had NO mobile presence at all until this file: no screen, no API
 * client, no route, no nav entry. `backend/routers/vikray.py` has nineteen
 * routes and 378 live orders behind them.
 *
 * Separate from `api/modules.ts` for the reason `api/graha.ts` gives in its own
 * header: that file is the seven light READING surfaces and their shared
 * envelope conventions. Sales writes, and a writing module carries facts a
 * reading one does not — which verbs may be replayed, which may not, and what
 * each refusal means. Those belong beside the calls they constrain.
 *
 * `num`, `inr` and `inrCompact` still come from `modules.ts`. There is one
 * money formatter in this app and this is not a second one.
 *
 * ── ENVELOPES, THREE OF THEM, IN ONE ROUTER ─────────────────────────────────
 *
 * `vikray.py` does not answer in one shape, and assuming it does produces
 * `undefined.map` at render time rather than a type error, because axios hands
 * back `any`:
 *
 *   · `GET /orders` and `GET /customers` go through `_listed` — `{data, total,
 *     limit, truncated}`. `truncated` is the one worth reading: both cap at 200
 *     and any client-side total computed over a cut list is wrong.
 *   · `GET /targets`, `GET /targets/leaderboard` and `GET /stock` return a bare
 *     `{"data": [...]}` with no total at all.
 *   · `GET /dashboard`, `GET /orders/{id}` and every write return a bare object.
 *
 * ── WHICH OF THESE WRITES MAY BE QUEUED OFFLINE ─────────────────────────────
 *
 * `offline/mutationQueue.ts` replays a failed write up to three times, has NO
 * idempotency key, and SQUASHES consecutive PATCH/PUTs to the same URL by
 * merging their bodies last-writer-wins. Both properties decide this list:
 *
 *   queueable    POST /orders/from-deal/{deal_id}
 *   online only  PATCH /orders/{id}/status
 *                PATCH /stock/{product_id}
 *                POST  /orders/{id}/invoice
 *
 * The reasoning for each is on the call site, because a rule stated only in a
 * header is a rule nobody reads at the moment they need it. In short:
 * `from-deal` is the one write here the SERVER makes idempotent — it returns
 * the existing order rather than making a second one — and the other three each
 * move inventory, mint a document number, or lose arithmetic to the squash.
 *
 * The three online-only paths do not fail silently: `VIKRAY_OFFLINE_NOTE` is
 * the sentence the screens show instead, and the buttons are disabled rather
 * than armed-and-doomed.
 *
 * ── 403 IS AN ANSWER ────────────────────────────────────────────────────────
 *
 * Every route here mounts `require_module("vikray")`, which raises 403 when the
 * org lacks Sales OR when this user holds no grant for it. `POST
 * /orders/{id}/invoice` mounts `require_module("ganit")` on TOP of it, so a
 * member with Sales but not the books gets a 403 on that one action while the
 * rest of the screen works — which is the intended behaviour, not a bug, and
 * the screen says so rather than reporting a generic failure.
 */

/** `_listed`'s envelope. `truncated` means any total you compute here is wrong. */
export interface Listed<T> { data: T[]; total: number; limit: number; truncated: boolean }

/** The bare `{"data": [...]}` the targets and stock reads use. */
interface Envelope<T> { data: T[] }

// ── The order lifecycle ──────────────────────────────────────────────────────

/**
 * `_VALID_TRANSITIONS` in `vikray.py:139`, mirrored — not re-decided.
 *
 * The server is the authority: it 400s on a transition it does not hold, so a
 * phone offering a wider set would produce a refusal the user cannot act on.
 * Mirroring it here means the picker only ever offers moves that will be
 * accepted, and the copy of the map is small enough to check by eye against the
 * router.
 *
 * `closed` and `cancelled` are terminal and are absent as keys, which is what
 * makes `nextStatuses` return an empty list for them.
 */
export const VALID_TRANSITIONS: Record<string, readonly OrderStatus[]> = {
  draft:      ['confirmed', 'cancelled'],
  confirmed:  ['dispatched', 'cancelled'],
  dispatched: ['delivered'],
  delivered:  ['closed'],
};

export type OrderStatus =
  | 'draft' | 'confirmed' | 'dispatched' | 'delivered' | 'closed' | 'cancelled';

/**
 * The line the order travels, from `_PIPELINE_STAGES` (`vikray.py:1037`).
 *
 * `cancelled` is deliberately off it: a cancelled order is money sitting
 * nowhere, so it is neither a stage nor part of any total. It still appears as
 * a STATUS on a row — 6 of the 378 live orders are cancelled — it just has no
 * position on the line.
 */
export const ORDER_FLOW: readonly OrderStatus[] =
  ['draft', 'confirmed', 'dispatched', 'delivered', 'closed'];

/** What a status is called on screen. The table stores the lower-case token. */
export const ORDER_STATUS_LABEL: Record<string, string> = {
  draft:      'Draft',
  confirmed:  'Confirmed',
  dispatched: 'Dispatched',
  delivered:  'Delivered',
  closed:     'Closed',
  cancelled:  'Cancelled',
};

/**
 * What moving to this status DOES beyond changing a word, in one line.
 *
 * Shown on the confirm step. Three of these five have a side effect the user
 * cannot see and cannot undo from a phone, and a status picker that presents
 * them as five equivalent words is how stock gets deducted by somebody who was
 * only trying to tidy a list.
 */
export const ORDER_STATUS_EFFECT: Record<string, string> = {
  confirmed:  'Deducts stock for every catalogued product on this order.',
  dispatched: 'Records that the goods have left. Stock is already deducted.',
  delivered:  'Closes fulfilment. Anything set to run on a delivered order fires now.',
  closed:     'Ends the ledger line. If this order came from a deal, that deal is marked Won.',
  cancelled:  'Puts any stock this order deducted back. This cannot be undone from the phone.',
};

/** The moves the server will accept from here. Empty on a terminal status. */
export function nextStatuses(status: string | null | undefined): readonly OrderStatus[] {
  return VALID_TRANSITIONS[(status ?? '').toLowerCase()] ?? [];
}

// ── Shapes ───────────────────────────────────────────────────────────────────

/**
 * One line on an order. `line_items` is jsonb, written by `OrderLineItem` in
 * `vikray.py:60`, so every field has a server-side default and any of them can
 * be missing on a row written before the model gained it.
 *
 * `product_id` is here because `_apply_stock_moves` keys on it — a line WITHOUT
 * one moves no stock — and the detail view says so. It is never rendered.
 */
export interface OrderLine {
  product_id?:   string;
  description?:  string;
  hsn_code?:     string;
  quantity?:     number | string;
  unit?:         string;
  rate?:         number | string;
  gst_rate?:     number | string;
  discount_pct?: number | string;
}

/**
 * A row from `GET /orders`, which is `SELECT o.*` plus the contact join.
 *
 * `SELECT o.*` means the row carries `contact_id`, `client_id`, `deal_id` and
 * `invoice_id`. NONE of them is rendered — the names-not-IDs rule, and the
 * `frontend/scripts/check-rendered-ids.mjs` ratchet on the web. They are
 * declared because the screen reads their PRESENCE ("this order has an
 * invoice") and because `deal_id` is what a conversion is keyed on.
 *
 * ── THE PARTY NAME, AND THE TEN ORDERS THAT HAVE NONE ───────────────────────
 *
 * The list joins `graha_contacts` ONLY — not `graha_clients` — so the company
 * name arrives as `contact_company`, off the contact, rather than off the
 * company row that migration 136 made canonical. Measured on the live database:
 * of 378 orders, 368 carry a contact and 329 carry a client; ZERO have a client
 * with no contact. So the join covers every order that names anybody, and the
 * remaining 10 name nobody at all.
 *
 * That is why this file does NOT fetch `/customers` to resolve names. It would
 * be one more request on the busiest screen to recover ten rows that have no
 * name to recover. `orderParty` returns null for them and the row says so.
 */
export interface Order {
  id:               string;
  order_number:     string;
  order_date:       string | null;
  expected_delivery: string | null;
  status:           OrderStatus | string;
  total:            number | string;
  subtotal:         number | string;
  cgst:             number | string;
  sgst:             number | string;
  igst:             number | string;
  discount:         number | string;
  is_igst:          boolean | null;
  line_items:       OrderLine[] | string | null;
  notes:            string | null;
  is_active:        boolean | null;
  created_at:       string;
  updated_at:       string | null;
  /** Presence only — never rendered. */
  deal_id:          string | null;
  invoice_id:       string | null;
  contact_company:  string | null;
  contact_name:     string | null;
}

/** `GET /orders/{id}` adds the contact's email and phone to the same row. */
export interface OrderDetail extends Order {
  contact_email: string | null;
  contact_phone: string | null;
}

/** `GET /dashboard` — one call, and the only aggregate over ALL orders. */
export interface VikrayDashboard {
  total_orders:      number | string;
  draft_orders:      number | string;
  confirmed_orders:  number | string;
  dispatched_orders: number | string;
  delivered_orders:  number | string;
  order_value:       number | string;
  pipeline_value:    number | string;
  open_deals:        number | string;
  total_revenue:     number | string;
  collected:         number | string;
}

/**
 * A row from `GET /stock`.
 *
 * Driven by `ganit_products`, not by the stock table: the LEFT JOIN means a
 * product nobody has ever counted still appears, with zero on hand and a zero
 * threshold. That is deliberate on the server and it matters here — the list is
 * the catalogue, so an empty stock table renders 34 products at zero rather
 * than an empty screen.
 */
export interface StockRow {
  product_id:          string;
  name:                string;
  unit:                string | null;
  quantity_on_hand:    number | string;
  low_stock_threshold: number | string;
}

/**
 * A row from `GET /targets`.
 *
 * `actual_amount` is attainment, computed server-side off `graha_deals`
 * `assigned_to` — NOT off orders or invoices, neither of which carries an
 * owner. `unattributed_amount` is the money won in the period that belongs to
 * NOBODY's target, and it is shown rather than hidden: a leaderboard that
 * silently drops unowned revenue reports a smaller quarter than the one that
 * happened.
 *
 * `salesperson_name` is `COALESCE(full_name, name, email)`. There is no
 * salesperson id on this shape on purpose.
 */
export interface Target {
  id:                  string;
  period_start:        string;
  period_end:          string;
  target_amount:       number | string;
  target_deals:        number | string;
  notes:               string | null;
  salesperson_name:    string | null;
  actual_amount:       number | string;
  actual_deals:        number | string;
  unattributed_amount: number | string;
  unattributed_deals:  number | string;
}

/** What `POST /orders/from-deal/{id}` answers with. */
export interface FromDealResult {
  /** `created` on the first conversion, `exists` on every one after it. */
  status:       'created' | 'exists' | string;
  order_id?:    string;
  order_number: string;
  id?:          string;
  total?:       number | string;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export const vikrayApi = {
  /**
   * GET /api/v1/vikray/dashboard — order counts, order value, pipeline, revenue.
   *
   * The figures on this screen come from HERE and not from the orders list,
   * because the list caps at 200 and there are 378 orders. Summing the page
   * would report a little over half the money as the whole of it — the exact
   * defect `_listed`'s `truncated` flag exists to make visible.
   */
  dashboard: () =>
    apiClient.get<VikrayDashboard>('/v1/vikray/dashboard').then(r => r.data),

  /**
   * GET /api/v1/vikray/orders — newest 200, active only.
   *
   * No `?since=`. The delta path exists (`services/delta_sync`) and nine other
   * lists use it, but it returns an envelope with a cursor the caller has to
   * persist and merge, and a half-built delta that drops the `is_active=false`
   * tombstones leaves cancelled orders live on the phone for ever. A full page
   * of 200 is correct today; wiring the delta is a separate, testable change.
   */
  orders: (params?: { status?: string }) =>
    apiClient.get<Listed<Order>>('/v1/vikray/orders', { params })
      .then(r => r.data ?? { data: [], total: 0, limit: 200, truncated: false }),

  /** GET /api/v1/vikray/orders/{id} — the row plus the contact's email/phone. */
  order: (orderId: string) =>
    apiClient.get<OrderDetail>(`/v1/vikray/orders/${orderId}`).then(r => r.data),

  /**
   * GET /api/v1/vikray/stock — the whole catalogue, low-stock rows included.
   *
   * `low_stock=true` is NOT passed. The server's filter is
   * `quantity_on_hand <= low_stock_threshold`, and a threshold left at the
   * default 0 makes every uncounted product "low" — so the filtered list on a
   * fresh org is the same list, and on a configured one it hides everything the
   * user came to check. The screen sorts the genuinely-low rows to the top
   * instead, which is the same information without the cliff.
   */
  stock: () =>
    apiClient.get<Envelope<StockRow>>('/v1/vikray/stock').then(r => r.data?.data ?? []),

  /** GET /api/v1/vikray/targets — every period, newest first, with attainment. */
  targets: () =>
    apiClient.get<Envelope<Target>>('/v1/vikray/targets').then(r => r.data?.data ?? []),
};

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * The sentence shown wherever an online-only action is offered with no
 * connection. One string, so the three places that need it cannot drift into
 * three different explanations of the same rule.
 */
export const VIKRAY_OFFLINE_NOTE =
  'This needs a connection. It moves stock or mints a document number, so it is '
  + 'never queued — a change replayed an hour later would act on a state that no '
  + 'longer exists.';

export const vikrayWriteApi = {
  /**
   * POST /api/v1/vikray/orders/from-deal/{deal_id} — QUEUEABLE.
   *
   * The one create in this module that may be replayed, and it is safe for a
   * reason that lives on the SERVER rather than in a convention here:
   * `create_order_from_deal` looks for an existing active order on the same
   * deal before it writes, and returns `{"status": "exists", …}` if it finds
   * one. A double-tap, a retry after a 15-second axios timeout, and a queue
   * flush hours later all converge on the same single order.
   *
   * THE ONE WINDOW WHERE THAT IS NOT TRUE, stated rather than papered over: the
   * existence check filters `is_active=TRUE`, and `DELETE /orders/{id}` sets
   * that column false. So if the order is cancelled between the enqueue and the
   * flush, the replay makes a second one. That needs a cancellation on another
   * device inside the offline window; it is narrow, it is not zero, and the
   * fix is a server-side idempotency key rather than anything this file can do.
   *
   * The server also refuses any deal that is not `Won` — an open deal is a
   * forecast, and converting one books revenue against work nobody has agreed
   * to. The sheet therefore only ever offers won deals, so that 400 is a
   * backstop rather than a path a user can walk into.
   */
  createOrderFromDeal: (dealId: string) =>
    apiClient.post<FromDealResult>(`/v1/vikray/orders/from-deal/${dealId}`)
      .then(r => r.data),

  /**
   * PATCH /api/v1/vikray/orders/{id}/status — ONLINE ONLY. Do not queue.
   *
   * Three independent reasons, any one of which is sufficient:
   *
   * 1. IT MOVES INVENTORY. `_apply_stock_moves` (`vikray.py:151`) runs on the
   *    way into `confirmed` (deduct) and on the way out to `cancelled`
   *    (restock). A replay hours later moves stock against a count that has
   *    changed underneath it, and stock is the number a warehouse acts on.
   *
   * 2. THE SERVER GUARDS ON THE PRE-READ STATUS. The UPDATE carries
   *    `AND status=$4` — the value read before the transaction — so a request
   *    built against a status that has since moved matches zero rows and 409s.
   *    A queued write is stale BY CONSTRUCTION, so it would almost always 409.
   *
   * 3. AND THE QUEUE WOULD SWALLOW THAT 409. `flushQueue` treats any 4xx other
   *    than 429 as permanent and DISCARDS the item. So the user would see the
   *    move applied optimistically, the replay would be refused, and nothing
   *    would ever tell them — the exact "never lie about state" failure the
   *    queue's own entity-id tracking exists to prevent.
   *
   * This follows the precedent at `api/modules.ts:213`, where approving leave
   * deliberately bypasses the queue for the same class of reason.
   */
  setOrderStatus: (orderId: string, status: OrderStatus) =>
    apiClient.patch<Order>(`/v1/vikray/orders/${orderId}/status`, { status })
      .then(r => r.data),

  /**
   * PATCH /api/v1/vikray/stock/{product_id} — ONLINE ONLY. Do not queue.
   *
   * THE SQUASH WOULD SILENTLY LOSE UNITS, and this is the concrete case rather
   * than a precaution. `enqueueMutation` merges consecutive PATCHes to the same
   * URL last-writer-wins:
   *
   *     {quantity_delta: 5}  then  {quantity_delta: 3}   →  {quantity_delta: 3}
   *
   * `quantity_delta` is RELATIVE — the server does `quantity_on_hand + $1` —
   * so two counts of +5 and +3 must apply as +8. Squashed, five units vanish,
   * the stock ledger records one move instead of two, and nothing anywhere
   * reports an error. A last-write-wins merge is correct for absolute fields
   * and wrong for every relative one; this endpoint has both on the same body.
   *
   * `low_stock_threshold` alone WOULD be safe to queue — it is absolute — but
   * splitting one endpoint across two policies by which key is present is a
   * rule nobody would remember at the call site.
   */
  adjustStock: (
    productId: string,
    body: { quantity_delta?: number; low_stock_threshold?: number; reason?: string },
  ) =>
    apiClient.patch<{ quantity_on_hand: number | string }>(
      `/v1/vikray/stock/${productId}`, body,
    ).then(r => r.data),

  /**
   * POST /api/v1/vikray/orders/{id}/invoice — ONLINE ONLY. Do not queue.
   *
   * It DRAWS A SERIAL. `next_doc_number` mints the next invoice number in the
   * org's sequence, and a tax auditor asks about gaps in that sequence. A
   * replay is guarded — the route 400s when `invoice_id` is already set — but a
   * 400 out of the queue is discarded permanently and silently, so the user
   * would be told an invoice was raised and never learn which outcome happened.
   *
   * Also the one route here behind TWO module gates: `require_module("vikray")`
   * and `require_module("ganit")`. A member granted Sales but not the books
   * gets a 403 on this action alone while the rest of the screen works. That is
   * the intent of the stacked gate (`vikray.py:23`), so the screen reports it
   * as a permissions answer rather than as a failure.
   *
   * MOBILE INVOICES ARE READ-ONLY — settled, and unaffected by this. Generating
   * one from an order is a sales action on a sales document; the invoice it
   * produces is not editable here and this file offers no way to edit it.
   */
  generateInvoice: (orderId: string) =>
    apiClient.post<{ ok: boolean; invoice_id: string; invoice_number: string }>(
      `/v1/vikray/orders/${orderId}/invoice`,
    ).then(r => r.data),
};

// ── Reading a row ────────────────────────────────────────────────────────────

/**
 * `line_items` as an array, whatever it arrived as.
 *
 * asyncpg hands jsonb back as a parsed list on most paths and as a STRING on
 * some — `_apply_stock_moves` re-parses it defensively for exactly this reason
 * — so a screen that calls `.map` on it directly crashes on the rows where it
 * did not. Handled once, here.
 */
export function orderLines(order: Pick<Order, 'line_items'> | undefined): OrderLine[] {
  const raw = order?.line_items;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as OrderLine[]) : [];
    } catch { return []; }
  }
  return [];
}

/**
 * Who the order is for, by NAME, or null when the row names nobody.
 *
 * Company first, person second: a CRM client is the COMPANY — the customer —
 * and contacts are people who come and go while the customer stays. Ten of the
 * 378 live orders carry neither, and null is the honest answer for them. It is
 * never an id: `contact_id` and `client_id` are on the row and neither is a
 * fallback here.
 */
export function orderParty(order: Pick<Order, 'contact_company' | 'contact_name'>): string | null {
  return order.contact_company?.trim() || order.contact_name?.trim() || null;
}

/** Where on the five-stage line this order sits, or -1 for `cancelled`. */
export function flowIndex(status: string | null | undefined): number {
  return ORDER_FLOW.indexOf((status ?? '').toLowerCase() as OrderStatus);
}

/**
 * The sentence to show when a Sales write is refused.
 *
 * `api/client.ts` already puts the server's own `detail` on the error as
 * `friendlyMessage`, and `vikray.py`'s refusals are written for a person —
 * "Only a Won deal becomes a sales order", "Confirm the order before generating
 * an invoice", "The order changed while you were looking at it." Those are
 * better than anything invented here, so this only fills the gaps.
 *
 * 409 is called out separately because it is the one a user can actually
 * resolve, and the generic "this already exists" from the interceptor is wrong
 * for it: nothing was duplicated, somebody else moved the order first.
 */
export function vikrayWriteError(err: unknown): string {
  const e = err as {
    response?: { status?: number };
    friendlyMessage?: string;
    message?: string;
  } | undefined;
  const status = e?.response?.status;

  if (status === 409) {
    return 'Somebody moved this order while you had it open. Pull down to reload, '
      + 'then try again.';
  }
  if (status === 403) {
    return 'You do not have access to that. Generating an invoice needs the '
      + 'Invoicing module as well as Sales — an admin can grant it from the web app.';
  }
  if (!e?.response) {
    return 'Could not reach the server. Nothing was changed.';
  }
  return e?.friendlyMessage ?? e?.message ?? 'That did not go through. Nothing was changed.';
}
