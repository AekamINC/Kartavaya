import { apiClient } from './client';

/**
 * Graha · ग्रह — the CRM surface's own API module.
 *
 * Separate from `api/modules.ts` on purpose. That file is the seven light
 * READING surfaces: one or two GETs each, no writes, and a header that explains
 * the envelope conventions they share. This is the first module that writes,
 * and writing brings a different set of facts with it — which verbs are safe to
 * replay, which are not, and what a 403 means on a POST rather than on a GET.
 * Those belong next to the calls they constrain, not appended to a file about
 * checking views.
 *
 * `Deal`, `PipelineStage`, `num`, `inr` and `inrCompact` still come from
 * `modules.ts`; this file adds only what the write paths need.
 *
 * ── WHICH OF THESE MAY BE QUEUED OFFLINE ─────────────────────────────────────
 *
 * `offline/mutationQueue.ts` replays a failed write up to three times and has
 * NO idempotency key: the server never learns that two arrivals are the same
 * intent. A request that reached Postgres and then timed out on the way back
 * (the axios timeout is 15s, and a rep on a rural cell is exactly who hits it)
 * is indistinguishable from one that never landed, so it is retried.
 *
 * For a PATCH that is harmless — `{stage:'Won'}` applied twice is one move, and
 * the queue's own squash rule already assumes last-write-wins. For a POST it is
 * a second row. There is no way to delete an activity from this app, and a CRM
 * history that shows a call logged twice is wrong for ever.
 *
 * So the split below is by IDEMPOTENCE, not by convenience:
 *
 *   queueable   PATCH /deals/{id}                  stage move, and the edit form
 *               PATCH /contacts/{id}               the edit form
 *               PATCH /follow-ups/{id}/complete    ticking one off
 *   online-only POST  /activities                  logging what happened
 *               POST  /follow-ups                  setting the next thing
 *               POST  /deals                       a new deal
 *               POST  /contacts                    a new person
 *               POST  /clients                     a new company
 *               POST  /contacts/{id}/convert       lead → customer
 *
 * Every create is marked `ONLINE ONLY` here and the sheets that call them say so
 * to the user rather than failing silently. Making them queueable needs a
 * server-side idempotency key on those endpoints — a backend change, and not one
 * this file can fake.
 *
 * `convert` is the odd one and is listed with the creates on purpose. It creates
 * no row, so a replay cannot duplicate anything — but the second arrival hits
 * `if row["contact_type"] == "customer"` and comes back 400, which the queue
 * treats as permanent and discards with an error the user sees minutes after
 * the thing in fact succeeded. Online-only is the honest shape.
 *
 * The two PATCHes send only the fields that CHANGED (`screens/graha/draftRules.ts`),
 * which is what makes them safe to queue at all: the queue squashes PATCHes to
 * one URL by merging their bodies, so a narrow body merges and a wide one
 * re-applies stale columns minutes later over somebody else's desktop edit.
 */

/** Lists in this router are enveloped; `_listed` adds the truncation metadata. */
interface Listed<T> { data: T[]; total: number; limit: number; truncated: boolean }

// ── Deal detail ──────────────────────────────────────────────────────────────

/**
 * `GET /deals/{id}` selects `d.*`, so the row carries every column on the
 * table — including several uuids. Only the fields a phone renders are declared
 * here, and no id among them reaches a screen: `contact_id` exists solely so the
 * detail view can ask for that contact's timeline.
 */
export interface DealDetail {
  id:                  string;
  title:               string;
  value:               number | string | null;
  stage:               string | null;
  probability:         number | null;
  expected_close_date: string | null;
  notes:               string | null;
  created_at:          string;
  updated_at:          string | null;
  contact_id:          string | null;
  contact_name:        string | null;
  contact_company:     string | null;
  contact_email:       string | null;
  /**
   * The company the deal belongs to.
   *
   * There is NO `client_name` beside it: `get_deal` joins `graha_contacts` and
   * not `graha_clients` (graha.py:1069), so this route knows the company's id
   * and not its name. The edit sheet resolves the name from the deals list
   * cache, which does carry it, and says so plainly when it cannot rather than
   * printing the uuid it is holding.
   */
  client_id:           string | null;
}

/** The five kinds the server accepts. Anything else is a 400 from `graha.py`. */
export const ACTIVITY_TYPES = ['call', 'meeting', 'email', 'note', 'task'] as const;
export type ActivityType = typeof ACTIVITY_TYPES[number];

export interface DealActivity {
  id:            string;
  activity_type: string;
  title:         string;
  scheduled_at:  string | null;
  is_completed:  boolean;
  created_at:    string;
}

export interface FollowUp {
  id:           string;
  title:        string;
  description:  string | null;
  due_at:       string | null;
  is_completed: boolean;
  contact_name: string | null;
  deal_title:   string | null;
}

/** `GET /today` — five lists, each already capped and already phone-sized. */
export interface CrmToday {
  overdue_followups: Array<{ id: string; title: string; due_at: string | null; contact_name: string | null }>;
  stale_deals:       Array<{ id: string; title: string; value: number | string | null; stage: string | null; updated_at: string | null; contact_name: string | null }>;
  new_leads:         Array<{ id: string; name: string; company: string | null; source: string | null; created_at: string }>;
  todays_activities: Array<{ id: string; activity_type: string; title: string; scheduled_at: string | null; is_completed: boolean; contact_name: string | null }>;
  recent_closures:   Array<{ id: string; title: string; value: number | string | null; stage: string | null; contact_name: string | null }>;
}

/**
 * One row of a contact's history.
 *
 * `type` is the source table and `subtype` is whatever that table calls its
 * kind — `activity_type` for an activity, `payment_status` for an invoice, null
 * for a follow-up. The server unions four SELECTs into this shape, so the
 * nullable columns are nullable because three of the four have nothing to put
 * there, not because the data is missing.
 */
export interface TimelineEntry {
  id:      string;
  type:    'activity' | 'followup' | 'invoice' | 'deal';
  title:   string | null;
  subtype: string | null;
  ts:      string | null;
  amount:  number | string | null;
  stage:   string | null;
}

export interface Pipeline {
  id:         string;
  name:       string;
  /** The stage names, in board order. jsonb on the server, so an array here. */
  stages:     string[] | null;
  is_default: boolean;
}

export interface ActivityDraft {
  deal_id?:      string;
  contact_id?:   string;
  activity_type: ActivityType;
  title:         string;
  description?:  string;
  /** ISO 8601. The server casts through `NULLIF($7,'')::timestamptz`. */
  scheduled_at?: string;
}

export interface FollowUpDraft {
  title:        string;
  description?: string;
  /** ISO 8601 and REQUIRED — `FollowUpCreate.due_at` has no default. */
  due_at:       string;
  deal_id?:     string;
  contact_id?:  string;
}

/**
 * A contact as `GET /contacts/{id}` returns it, narrowed to what a phone edits.
 *
 * The route selects `c.*` plus the joined `client_name`, so the row carries
 * everything including `client_id` — declared here because the edit form has to
 * seed its company picker with it, and NOT rendered: `client_name` is what goes
 * on screen. `company` is the legacy free-text employer; it is read so an old
 * row's value can be shown as context, never written.
 */
export interface ContactDetail {
  id:           string;
  name:         string;
  email:        string | null;
  phone:        string | null;
  company:      string | null;
  designation:  string | null;
  notes:        string | null;
  contact_type: string | null;
  client_id:    string | null;
  client_name:  string | null;
  created_at:   string;
}

// ─────────────────────────────────────────────────────────────────────────────

export const grahaWriteApi = {
  /** GET /api/v1/graha/deals/{id} — the deal plus its 30 newest activities. */
  deal: (dealId: string) =>
    apiClient
      .get<{ deal: DealDetail; activities: DealActivity[] }>(`/v1/graha/deals/${dealId}`)
      .then(r => r.data),

  /**
   * PATCH /api/v1/graha/deals/{id} — the STAGE and nothing else.
   *
   * `DealUpdate` is a partial model and `update_deal` builds its SET list from
   * `exclude_unset`, so sending one key writes one column. That is the whole
   * point: someone on the desktop may be editing the value or the close date of
   * this same deal right now, and a phone that PUT the object it fetched two
   * minutes ago would silently revert their work. The queue is last-write-wins
   * with no version check, which makes a wide body worse still — a squashed
   * replay would re-apply stale fields minutes later.
   *
   * `won_at`, `lost_at` and `probability` are set by the SERVER when the stage
   * becomes Won or Lost (`graha.py`), so the phone must not send its own guess.
   */
  moveStage: (dealId: string, stage: string) =>
    apiClient.patch(`/v1/graha/deals/${dealId}`, { stage }).then(r => r.data),

  /**
   * ONLINE ONLY — POST /api/v1/graha/deals. See the header.
   *
   * No `pipeline_id`: `create_deal` resolves the org default and BOOTSTRAPS one
   * if there is none (graha.py:940), so this works on an org that has never
   * opened the web CRM — which is the org whose rep is most likely to be
   * creating their first deal from a phone.
   */
  createDeal: (body: Record<string, unknown>) =>
    apiClient.post<{ status: string; id: string; title: string; stage: string }>(
      '/v1/graha/deals', body,
    ).then(r => r.data),

  /**
   * PATCH /api/v1/graha/deals/{id} — the edit form, changed fields only.
   *
   * Separate from `moveStage` even though they are the same request, because
   * they are not the same DECISION: `moveStage` is a one-key body by contract
   * and must stay that way, and collapsing them would make it possible to widen
   * the stage move by editing this line.
   */
  updateDeal: (dealId: string, patch: Record<string, unknown>) =>
    apiClient.patch(`/v1/graha/deals/${dealId}`, patch).then(r => r.data),

  /** ONLINE ONLY — POST /api/v1/graha/contacts. `contact_type` is always sent. */
  createContact: (body: Record<string, unknown>) =>
    apiClient.post<{ status: string; id: string; name: string; contact_type: string }>(
      '/v1/graha/contacts', body,
    ).then(r => r.data),

  /** PATCH /api/v1/graha/contacts/{id} — changed fields only. Queueable. */
  updateContact: (contactId: string, patch: Record<string, unknown>) =>
    apiClient.patch(`/v1/graha/contacts/${contactId}`, patch).then(r => r.data),

  /** ONLINE ONLY — POST /api/v1/graha/clients. The COMPANY, not a person. */
  createClient: (body: Record<string, unknown>) =>
    apiClient.post<{ status: string; id: string; name: string; ref_no: string | null }>(
      '/v1/graha/clients', body,
    ).then(r => r.data),

  /**
   * ONLINE ONLY — POST /api/v1/graha/contacts/{id}/convert.
   *
   * Not a PATCH of `contact_type`, which is what it looks like: the endpoint
   * also stamps `converted_at` and emits `lead.converted` inside the same
   * transaction, so setting the column by hand would change the row and fire no
   * rule. See the header for why it is not queued.
   */
  convertLead: (contactId: string) =>
    apiClient.post<{ status: string; contact: ContactDetail }>(
      `/v1/graha/contacts/${contactId}/convert`,
    ).then(r => r.data),

  /**
   * GET /api/v1/graha/contacts/{id} — the row the edit form seeds itself from.
   *
   * The response also carries the contact's deals, activities, follow-ups and
   * labels; only `contact` is taken. The rest is four more lists on a sheet that
   * already has the timeline behind it, and the deal sheet is where history
   * belongs.
   */
  contact: (contactId: string) =>
    apiClient.get<{ contact: ContactDetail }>(`/v1/graha/contacts/${contactId}`)
      .then(r => r.data?.contact),

  /** ONLINE ONLY — POST /api/v1/graha/activities. See the header. */
  logActivity: (draft: ActivityDraft) =>
    apiClient.post<{ status: string; id: string }>('/v1/graha/activities', draft).then(r => r.data),

  /** ONLINE ONLY — POST /api/v1/graha/follow-ups. See the header. */
  createFollowUp: (draft: FollowUpDraft) =>
    apiClient.post<{ status: string; id: string; title: string }>('/v1/graha/follow-ups', draft)
      .then(r => r.data),

  /**
   * PATCH /api/v1/graha/follow-ups/{id}/complete — queueable.
   *
   * The endpoint takes no body at all; it is a bare UPDATE to `is_completed`.
   * Replaying it sets a true value to true, which is why it can go in the queue
   * where a create cannot.
   */
  completeFollowUp: (followUpId: string) =>
    apiClient.patch(`/v1/graha/follow-ups/${followUpId}/complete`).then(r => r.data),

  /**
   * GET /api/v1/graha/follow-ups — open ones only unless asked otherwise.
   *
   * `is_completed` is left off deliberately: without it the server applies its
   * own `is_completed=FALSE`, and a follow-up list on a phone is a to-do list.
   */
  followUps: (params?: { deal_id?: string }) =>
    apiClient.get<Listed<FollowUp>>('/v1/graha/follow-ups', { params })
      .then(r => r.data?.data ?? []),

  /** GET /api/v1/graha/today — the daily action view, already server-scoped. */
  today: () =>
    apiClient.get<CrmToday>('/v1/graha/today').then(r => r.data),

  /**
   * GET /api/v1/graha/contacts/{id}/timeline — everything, in one column.
   *
   * A UNION over activities, follow-ups, invoices and deals for one contact,
   * newest first. It is the answer to "what is the history with these people",
   * which on a phone is the question asked in the lift on the way up — and it
   * is the only place in the product where a rep sees that the customer has an
   * unpaid invoice before walking into a pricing conversation.
   *
   * Cursor-paginated on `ts`; the phone takes the first page and stops. Anyone
   * who needs the twelfth page is at a desk.
   */
  contactTimeline: (contactId: string, limit = 20) =>
    apiClient
      .get<{ data: TimelineEntry[]; next_cursor: string | null }>(
        `/v1/graha/contacts/${contactId}/timeline`, { params: { limit } },
      )
      .then(r => r.data?.data ?? []),

  /**
   * GET /api/v1/graha/pipelines — where the stage names come from.
   *
   * Read rather than hardcoded. `PipelineCreate` only DEFAULTS to New/Qualified/
   * Proposal/Negotiation/Won/Lost; an org may have renamed or added stages, and
   * a phone offering six fixed chips would let a rep move a deal into a stage
   * that does not exist in their board.
   */
  pipelines: () =>
    apiClient.get<{ data: Pipeline[] }>('/v1/graha/pipelines').then(r => r.data?.data ?? []),
};

// ── Stage helpers ────────────────────────────────────────────────────────────

/**
 * The fallback stage list, used ONLY when `/pipelines` returns nothing usable.
 *
 * Matched to `PipelineCreate.stages` in `backend/routers/graha.py` so a fresh
 * org — which has no pipeline row until the first deal creates one — still gets
 * a working stage picker instead of an empty sheet.
 */
export const DEFAULT_STAGES = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];

/**
 * The stage names to offer, from whichever pipeline is the default.
 *
 * `stages` is jsonb, so it arrives as an array on the happy path and as null on
 * a row written before the column had a value. Both are handled here rather
 * than at the call site, because a screen that has to ask "did this come back
 * as an array?" ends up not asking.
 */
export function stagesOf(pipelines: Pipeline[] | undefined): string[] {
  const list = pipelines ?? [];
  const chosen = list.find(p => p.is_default) ?? list[0];
  const stages = chosen?.stages;
  if (Array.isArray(stages) && stages.length > 0) {
    return stages.filter((s): s is string => typeof s === 'string' && s.length > 0);
  }
  return DEFAULT_STAGES;
}

/** Won and Lost are terminal. Kept here so the detail view and the list agree. */
export const CLOSED_STAGES = new Set(['won', 'lost', 'closed won', 'closed lost']);

export function isOpenStage(stage: string | null | undefined): boolean {
  return !CLOSED_STAGES.has((stage ?? '').toLowerCase());
}

// ── What a failed WRITE says ─────────────────────────────────────────────────

/**
 * The sentence to show when a CRM write is refused.
 *
 * `api/client.ts` already writes a `friendlyMessage` onto every axios error,
 * and for most statuses it is the right sentence. Two are not, and both are
 * about this screen specifically:
 *
 * **403.** The interceptor says "You don't have permission to do that", and
 * `ScreenState`'s `forbidden` copy explains a 403 on a READ — the org lacks the
 * module, or you hold no grant. Neither fits a refused WRITE, which the mobile
 * app had never produced before this screen existed: the module IS granted (the
 * deal is on screen, so the GET passed the same gate), and what the user needs
 * to know is that their grant is read-level and where that gets changed.
 *
 * **No response at all.** For a create this is the dangerous case rather than
 * the annoying one: the request may have reached Postgres and lost its answer
 * on the way back, so "try again" is advice that can produce a duplicate. The
 * copy says to check before retrying, which is the honest instruction while
 * these endpoints carry no idempotency key.
 *
 * Pure, and exported, so it can be tested without a renderer.
 */
export function writeErrorMessage(
  err: unknown,
  opts?: {
    creating?: boolean;
    /** What the 404 is about. Defaults to the deal, this file's first caller. */
    noun?: string;
  },
): string {
  const e = err as {
    response?: { status?: number; data?: { detail?: unknown } };
    friendlyMessage?: string;
    message?: string;
  } | undefined;
  const status = e?.response?.status;

  if (status === 403) {
    return 'Your CRM access here is read-only. Nothing was saved. An admin can grant you edit access from the web app.';
  }
  if (status === 401) {
    return 'Your session expired, so nothing was saved. Sign in again and retry.';
  }
  if (status === 404) {
    return `This ${opts?.noun ?? 'deal'} no longer exists — someone may have deleted it. Nothing was saved.`;
  }
  /**
   * A 400 from this router is a REFUSAL WITH A REASON, and the reason is worth
   * more than any sentence written here: "Contact is already a customer" tells
   * a rep that somebody else converted the lead, which "that did not save" does
   * not. `detail` is the server's own string on every raise in `graha.py`.
   *
   * Guarded on it being a string: FastAPI's validation errors put a LIST of
   * error objects in the same key, and rendering `[object Object]` at a user is
   * worse than the generic sentence.
   */
  if (status === 400) {
    const detail = e?.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    return 'The server refused that. Nothing was saved.';
  }
  if (status === 429) {
    return 'Too many requests just now. Wait a moment and try again.';
  }
  if (status === undefined) {
    return opts?.creating
      ? "The server didn't answer, so this may or may not have saved. Check the deal before adding it again."
      : "Can't reach the server. Nothing was saved.";
  }
  return e?.friendlyMessage ?? e?.message ?? 'That did not save. Try again.';
}
