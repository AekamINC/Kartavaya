import { apiClient } from './client';
// The URL allowlist, borrowed rather than copied. `Linking.openURL('tel:…')`
// places a call and `itms-apps://` opens the store; a model writes the strings
// this file parses. One allowlist, in one place, for both grammars.
import { safeHref } from '../lib/richText';

/**
 * Sahayak · सहायक — the assistant, on the phone.
 *
 * Every endpoint here is REAL and every field was read off
 * `backend/routers/hub_chat.py` and `backend/routers/hub.py` line by line. There
 * is no mock data anywhere in this file or in `screens/SahayakScreen.tsx`. What
 * there IS is a structural gap, and it is stated here rather than papered over,
 * because the previous author of `screens/modules/SahayakContentScreen.tsx` found it,
 * wrote it down and declined to build against it:
 *
 * ── THE GAP: THERE IS NO ORG-LEVEL ASK ENDPOINT ─────────────────────────────
 *
 * Every chat route in `hub_chat.py` is `/clients/{client_id}/chat/sessions…`.
 * The assistant is a per-client retrieval-augmented chatbot: it searches ONE
 * client's knowledge base (`search_hybrid(client_id=…)`), loads ONE client's
 * brand profile, and answers out of that. `19-sahayak-final.html` sketches
 * openers like "What's due this month? · Filing deadlines ACROSS CLIENTS", and
 * that question has no endpoint behind it in this product today.
 *
 * The consequence for this screen, which is a design consequence and not a
 * technical one: the user picks a client before they can ask anything. That is
 * exactly the friction the design was trying to remove, and it is shipped
 * VISIBLY — a picker with a sentence saying which knowledge base is about to be
 * read — rather than hidden behind a silently-defaulted first client, which
 * would answer questions about Sanchay while the user was thinking about
 * Navrang.
 *
 * Closing the gap properly means an org-scoped RAG route on the server. That is
 * a backend change and it is not this agent's to make.
 *
 * ── THE SECOND GAP: EVERY QUESTION SPENDS CREDITS ───────────────────────────
 *
 * `send_chat_message` charges `channel/chatbot_message` in the same transaction
 * that stores the question, BEFORE the model runs. The mobile app is the easiest
 * place in the product to fire one of those by accident. Two things follow, and
 * both are implemented in the screen rather than here:
 *   · the cost is stated on screen after each answer, from `credits_charged`;
 *   · nothing is ever sent without a deliberate tap. The opener cards fill the
 *     composer; they do not send.
 *
 * A 402 is a REAL error and reaches the caller as one — `credits.spend` raises
 * outside the endpoint's try/except precisely so an empty wallet cannot be
 * swallowed into the friendly 200 below.
 *
 * ── THE FRIENDLY 200, WHICH IS THE THING MOST LIKELY TO MISLEAD ─────────────
 *
 * When `generate()` raises — every provider in the chain having failed — the
 * endpoint REFUNDS the credits and returns HTTP 200 with
 * `{"message": "Sorry, I encountered an error: …", "sources": [], "model": ""}`.
 * So a total failure arrives as a successful answer. `looksLikeFailure` below is
 * how the screen tells them apart, and it is a heuristic on a string, which is
 * as good as this shape allows.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Clients
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * One row of `GET /v1/hub/clients`.
 *
 * The query is `SELECT c.*` plus two wallet columns, so the row carries every
 * column of `staging.hub_clients` (011). Only what this screen renders is typed:
 * a `c.*` select will grow, and listing columns nothing reads would be a second
 * schema to maintain against the first.
 *
 * `is_active` is nullable in the schema — `BOOLEAN DEFAULT TRUE` with no NOT
 * NULL — and the endpoint does NOT filter on it, so an archived client is in
 * this list. The screen shows them all rather than guessing: a firm that
 * deactivated a client may still want to ask about last year's filings.
 */
export interface HubClient {
  id:         string;
  name:       string;
  slug?:      string | null;
  industry?:  string | null;
  is_active?: boolean | null;
  /** From the LEFT JOIN on `hub_credit_wallets`. Null when the client has no
   *  wallet row at all, which is different from a balance of zero. */
  credits?:   number | string | null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Sessions and messages
 * ──────────────────────────────────────────────────────────────────────────*/

export interface ChatSession {
  id:            string;
  title:         string;
  session_type:  string;
  created_at:    string;
  /** A COUNT subquery, so it is a number and it is never absent. */
  message_count: number;
}

/** One KB citation. `ref` is the `[n]` the model was told to cite it by. */
export interface KbSource {
  type?:        'web';
  ref?:         number;
  chunk_id?:    string;
  title?:       string;
  source_type?: string;
  similarity?:  number;
  url?:         string;
}

export interface ChatMessageRow {
  id:         string;
  /** 'user' | 'assistant'. Written by the server, never by a client. */
  role:       string;
  content:    string;
  sources:    KbSource[];
  model_used: string | null;
  created_at: string;
  /**
   * The structured half of a stored answer — `hub_chat_messages.answer`.
   *
   * NOT A NESTED OBJECT ON THE WIRE, and reading it as one is why this arrived
   * empty. `hub.sahayak_chat_history` selects the column, POPS it off the row
   * and lifts its keys up beside `content` — the tuple `_ANSWER_READBACK`
   * (`answered`, `work`, `figs`, `evidence`, `refusal`, `refusal_detail`,
   * `read`, `credits`, `credits_charged`, `sections`) — precisely so the blob
   * cannot disagree with the columns it repeats under other names. Its own test
   * asserts `"answer" not in rows[1]`, so a client reading `row.answer` finds
   * `undefined` on every deployment: `server.py` includes `hub_router` before
   * `hub_chat_router` and the first match wins, which makes the flat shape the
   * only one this path can ever serve.
   *
   * So the flattened keys are declared here and `storedAnswerOf` reads them.
   * `answer` stays for the rows that predate the read-back and for the jsonb
   * codec case, and neither is invented: an absent key is "this row carries no
   * structure", never "this answer had no steps".
   */
  answer?:      Partial<SahayakAnswer> | string | null;
  answered?:    boolean;
  work?:        WorkStep[];
  figs?:        Fig[];
  evidence?:    Evidence | null;
  refusal?:     string;
  refusal_detail?: RefusalDetail | null;
  read?:        string[];
  credits?:     number;
  credits_charged?: number;
}

/** One named step the answer took. Free reads, then the paid write. */
export interface WorkStep {
  state: 'done' | 'now' | 'wait';
  ok:    boolean;
  label: string;
  fn:    string;
  note:  string;
  rows:  number;
  src:   string;
}

/** An attributable figure. `src` is the route it came from — no src, no tile. */
export interface Fig {
  label: string;
  value: string;
  sub:   string;
  src:   string;
  unit:  string;
}

/** The rows the answer was computed from. One table, not one per source. */
export interface Evidence {
  cols:      string[];
  rows:      string[][];
  src:       string;
  truncated: boolean;
  total:     number;
}

export interface RefusalDetail {
  kind:             string;
  withheld_labels?: string[];
  unreachable?:     { label: string; reason: string }[];
  can_read?:        { key: string; label: string; route: string }[];
}

/**
 * What `POST /v1/hub/chat` answers with — every key, always present.
 *
 * CHANGED 2026-08-07. This used to be `POST /clients/{id}/chat/sessions/{id}/
 * send`, which returns five keys: message, sources, model, cost_usd,
 * credits_charged. So the phone ran the OLD assistant — ungrounded on a planner
 * miss, no work steps, no figures, no evidence, and no refusal block. Every fix
 * that landed on the web that day was invisible here, including the one that
 * stops it claiming "I don't currently have access to your task records", which
 * is false.
 *
 * `answered` replaces the string heuristic below. The server now says outright
 * whether it answered, so guessing from the prose is over.
 */
export interface SahayakAnswer {
  session_id:      string | null;
  message_id:      string | null;
  answered:        boolean;
  message:         string;
  work:            WorkStep[];
  figs:            Fig[];
  sources:         KbSource[];
  evidence:        Evidence | null;
  refusal:         string;
  refusal_detail:  RefusalDetail | null;
  model:           string;
  credits:         number;
  credits_charged: number;
  cost_usd:        number;
  language:        string;
  read:            string[];
}

/**
 * `sources` may arrive as a JSON STRING rather than an array.
 *
 * The column is jsonb and `db.py` registers json/jsonb text codecs, so it
 * *should* always decode to a list — but that registration is best-effort: it
 * retries three times against PgBouncer, then logs a warning and carries on
 * (`db.py:106`). A string is a state this codebase can actually reach.
 * `api/messages.ts` normalises `reactions` for exactly this reason and says so
 * at length; the same defence, in the same shape, one layer up.
 *
 * Anything that is neither an array nor parseable becomes `[]`. A citation strip
 * that fails to render is a missing affordance; one that throws takes the whole
 * answer down with it.
 */
function normaliseSources(raw: unknown): KbSource[] {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(value) ? (value as KbSource[]) : [];
}

/**
 * The stored `answer` blob, if the row carried one.
 *
 * Same jsonb-may-arrive-as-a-string defence as `normaliseSources`, same reason
 * — `db.py`'s codec registration is best-effort. Anything that is not an object
 * becomes null, which the caller reads as "this row has no structure", not as
 * "this answer had no steps".
 */
function normaliseAnswerBlob(raw: unknown): Partial<SahayakAnswer> | null {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<SahayakAnswer>)
    : null;
}

/**
 * The structure a history row carries, from wherever the row carries it.
 *
 * The server sends it FLAT — `hub.sahayak_chat_history` pops the `answer`
 * column and lifts `_ANSWER_READBACK` onto the row beside `content`, and its
 * own test asserts the blob is not echoed back under `answer` as well. So the
 * row is read first and the nested blob second; reading only the blob is how
 * the phone reopened a conversation with its steps, figures and evidence
 * stripped while the browser showed all three off the same response.
 *
 * A key present on the row wins over the same key inside a blob, for the reason
 * the server flattens in the first place: the columns are what the database can
 * be queried on, and two versions of one fact disagree eventually.
 *
 * Every field is copied only when the row actually has it. Writing `undefined`
 * over a blob's value would turn "the server sent no such key" into "the server
 * said there were none", which are different answers on screen.
 */
function storedAnswerOf(m: ChatMessageRow): Partial<SahayakAnswer> | null {
  const blob = normaliseAnswerBlob(m.answer);
  const flat: Partial<SahayakAnswer> = {};
  if (Array.isArray(m.work)) flat.work = m.work;
  if (Array.isArray(m.figs)) flat.figs = m.figs;
  if (m.evidence !== undefined) flat.evidence = m.evidence;
  if (typeof m.refusal === 'string') flat.refusal = m.refusal;
  if (m.refusal_detail !== undefined) flat.refusal_detail = m.refusal_detail;
  if (typeof m.answered === 'boolean') flat.answered = m.answered;
  if (Array.isArray(m.read)) flat.read = m.read;
  if (typeof m.credits === 'number') flat.credits = m.credits;
  if (typeof m.credits_charged === 'number') flat.credits_charged = m.credits_charged;

  const merged = { ...(blob ?? {}), ...flat };
  return Object.keys(merged).length ? merged : null;
}

function cleanRow(m: ChatMessageRow & { sources?: unknown }): ChatMessageRow {
  return { ...m, sources: normaliseSources(m.sources), answer: storedAnswerOf(m) };
}

/**
 * Does this answer look like the friendly 200 that means everything failed?
 *
 * ONLY FOR STORED HISTORY NOW. The live send goes through `POST /v1/hub/chat`,
 * which returns `answered: false` and a real refusal — so nothing has to be
 * guessed from prose any more. `GET …/messages` still replays rows written by
 * the older route, and those apologies are still in the table, so this stays.
 *
 * A STRING HEURISTIC, and it is one because the endpoint gives nothing else to
 * go on: same status, same shape, same keys. The three signals together are
 * what make it usable — the sentence is a fixed prefix written in one place in
 * `hub_chat.py`, and a genuine answer that happened to begin with those words
 * would still have a model name on it, because `model_used` is filled from the
 * provider that answered and the failure path sets it to `""`.
 *
 * Deliberately conservative. A false positive marks a real answer as failed,
 * which is worse than a false negative — so both conditions must hold.
 */
export function looksLikeFailure(a: { message: string; model: string }): boolean {
  return !a.model && a.message.startsWith('Sorry, I encountered an error');
}

export const sahayakApi = {
  /**
   * Every client in the org. `{ data: [...] }`, not a bare array — this router
   * envelopes and `messaging.py` does not, and reading `.data` off the wrong one
   * is a silent empty screen.
   *
   * Ordered by name server-side (`ORDER BY c.name`), so the picker does not
   * re-sort and the phone matches the web.
   */
  clients: () =>
    apiClient.get<{ data: HubClient[] }>('/v1/hub/clients').then(r => r.data.data ?? []),

  /** This client's conversations, newest activity first (`ORDER BY s.updated_at DESC`). */
  sessions: (clientId: string) =>
    apiClient.get<{ data: ChatSession[] }>(`/v1/hub/clients/${clientId}/chat/sessions`)
      .then(r => r.data.data ?? []),

  /**
   * Start a conversation. Returns `{ id, title }` ONLY — a bare `RETURNING id,
   * title`, not a full session row, so there is no `message_count` and no
   * `created_at` to render from it.
   *
   * `session_type` defaults to `'internal'` server-side and this passes it
   * explicitly. The column also takes `'client'` for the portal-facing bot, and
   * an omitted value silently taking a default is how a phone conversation would
   * one day end up in the wrong bucket without anything changing here.
   *
   * 404 "Client not found" when the client is not in the caller's org. That
   * check is at creation on purpose: `send_chat_message` reads `client_id` back
   * OFF the session and hands it to the retriever, so a session pointed at
   * another org's client would make the assistant read their knowledge base.
   */
  createSession: (clientId: string, title = 'New chat') =>
    apiClient.post<{ id: string; title: string }>(
      `/v1/hub/clients/${clientId}/chat/sessions`,
      { title, session_type: 'internal' },
    ).then(r => r.data),

  /** The whole conversation, OLDEST FIRST (`ORDER BY created_at`) and unpaged. */
  messages: (sessionId: string) =>
    apiClient.get<{ data: ChatMessageRow[] }>(`/v1/hub/chat/sessions/${sessionId}/messages`)
      .then(r => (r.data.data ?? []).map(cleanRow)),

  /**
   * Ask. THIS SPENDS CREDITS AND CALLS A MODEL — see the header.
   *
   * No client-side timeout override, and that is a decision rather than an
   * oversight: `apiClient` is configured at 15 seconds, and a RAG answer is an
   * embedding call plus an optional re-rank plus a completion. A slow one WILL
   * exceed that and surface as "Can't reach the server", while the server
   * carries on, stores the answer and keeps the charge. The screen recovers by
   * re-reading the session — the answer is in `hub_chat_messages` either way —
   * which is why it refetches on a failed send instead of only apologising.
   *
   * Raising the timeout on the shared instance would slow down every other
   * failure in the app; raising it here alone is one line and belongs to
   * whoever decides what a phone should wait for an AI answer.
   *
   * NO SESSION IS CREATED FIRST. `POST /v1/hub/chat` opens the conversation
   * itself, and only AFTER the permission check — so a question the caller may
   * not ask leaves no empty "New chat" behind in the customer's org, which the
   * old create-then-send order did on every refusal. Pass `client_id` and the
   * server picks or opens; pass `session_id` to continue one. The id it used
   * comes back on `session_id`.
   */
  ask: (message: string, opts: { sessionId?: string | null; clientId?: string | null }) =>
    apiClient.post<SahayakAnswer & { sources?: unknown }>(
      '/v1/hub/chat',
      {
        message,
        session_id: opts.sessionId ?? null,
        client_id:  opts.clientId ?? null,
      },
    ).then(r => ({
      ...r.data,
      sources:  normaliseSources(r.data.sources),
      work:     Array.isArray(r.data.work) ? r.data.work : [],
      figs:     Array.isArray(r.data.figs) ? r.data.figs : [],
      read:     Array.isArray(r.data.read) ? r.data.read : [],
      evidence: r.data.evidence ?? null,
    })),

  /** Soft delete — the row stays and `is_active` goes false. */
  removeSession: (sessionId: string) =>
    apiClient.delete(`/v1/hub/chat/sessions/${sessionId}`).then(r => r.data),
};

/* ────────────────────────────────────────────────────────────────────────────
 * THE ANSWER'S MARKDOWN — and why the app now has two grammars
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * COMMONMARK WON. This is the assistant's grammar, and it is the WEB'S.
 *
 * ── The divergence, stated exactly ──────────────────────────────────────────
 *
 * Until now the phone rendered an answer through `lib/richText.ts`, which is a
 * faithful port of Slack's subset: ONE asterisk means bold, `_x_` means italic,
 * there are no headings, no `[text](url)` and no tables. The web's assistant
 * (`frontend/src/pages/sahayak/assistant/AnswerBody.jsx`) reads `**x**` as bold
 * and `*x*` as ITALIC.
 *
 * So the same answer, byte for byte, read differently on the two surfaces:
 *
 *   `*urgent*`   → BOLD on the phone, ITALIC on the web.
 *   `**Total**`  → bold on the web; on the phone the literal characters
 *                  `**Total**`, because a rule whose opener is a single `*`
 *                  cannot open on a `*` and the guard rejects the pair.
 *   `## Summary` → a heading on the web; the literal `## Summary` on the phone.
 *
 * ── Why CommonMark, and not the other way round ─────────────────────────────
 *
 * Because of WHO IS WRITING. Slack's `*bold*` is a convention for a human
 * typing into a composer; nothing generates it. This text is written by a
 * language model, and every provider in `_select_providers()` emits CommonMark
 * — `**bold**`, `## heading`, `- item`, `| a | b |`. Under the Slack subset the
 * phone was rendering the model's single most common marker as punctuation and
 * inverting the meaning of the second most common one. Moving the web to Slack
 * would have fixed the divergence by making both surfaces wrong about the text
 * they actually receive.
 *
 * ── Sanvaad is NOT changed, and that is not an inconsistency ────────────────
 *
 * `lib/richText.ts` and `frontend/src/pages/sanvaad/messageUtils.js` already
 * agree with each other byte for byte, and there the author IS a colleague
 * typing. The rule is per AUTHOR, not per app: a person's message is Slack, a
 * model's answer is CommonMark. Two authors, two grammars, and each one is the
 * same on both surfaces — which is the property that was actually broken.
 *
 * That is why nothing in `lib/` is edited here. `safeHref` IS imported from it
 * rather than re-derived: it is the allowlist standing between a model-written
 * string and `Linking.openURL('tel:…')` placing a call, and a second copy of a
 * security check is a second copy to forget.
 *
 * ── Why the grammar lives in this file ──────────────────────────────────────
 *
 * `node --test` cannot link a `.tsx` — Node strips types but does not transform
 * JSX — so anything inside the screen is reachable only by reading its source
 * as text. Grammar here, renderer in `screens/SahayakScreen.tsx`: the same split
 * `lib/richText.ts` and `components/RichText.tsx` already use, for the same
 * reason.
 *
 * ── The grammar is exactly the web's, and no larger ─────────────────────────
 *
 * Inline:  `**bold**`  `*italic*`  `` `code` ``  `[label](url)`  `[n]`
 * Block:   ``` fences, `| a | b |` tables with their `|---|` rule row,
 *          `#`…`######` headings in three sizes, `---` rules, `-`/`*` bullets,
 *          `1.` ordered items, and paragraphs.
 *
 * That list is not CommonMark's — it is `AnswerBody.jsx`'s, read line by line.
 * `_italic_`, `~~strike~~`, `> quotes` and bare-URL autolinking are all
 * CommonMark or GFM and all deliberately ABSENT, because the web does not draw
 * them and a superset is a divergence too: `_x_` italic on a phone and literal
 * underscores in a browser is the same defect as `*x*` meaning two things,
 * only quieter. If the web adds one, this adds it the same day.
 *
 * Anything outside that list renders as the literal characters the model typed,
 * which is the only rule a reader can predict without being told.
 *
 * Also not supported, on both surfaces: nested emphasis of the same kind, HTML,
 * images, footnotes, reference links, setext headings, lazy continuation. Every
 * rule below is a negated character class under a single quantifier — never a
 * lazy dot — so a four-thousand character answer is a linear parse.
 */

/** One inline run of an answer. A bare `string` is ordinary text. */
export type AnsLeaf =
  | string
  | { k: 'code'; text: string }
  | { k: 'b' | 'i'; kids: AnsLeaf[] }
  | { k: 'a'; href: string; text: string }
  /** `[3]` where source 3 exists. A marker with no source stays literal text. */
  | { k: 'cite'; n: number };

/** One block of an answer. */
export type AnsBlock =
  | { k: 'p';     kids: AnsLeaf[] }
  | { k: 'h';     level: 1 | 2 | 3; kids: AnsLeaf[] }
  | { k: 'pre';   lang: string | null; text: string }
  | { k: 'ul';    items: AnsLeaf[][] }
  /** Each item keeps the number the model wrote. `1. / 1. / 1.` renders 1, 1, 1
   *  on both surfaces; renumbering it here would be a silent disagreement with
   *  a browser showing the same answer. */
  | { k: 'ol';    items: { num: number; kids: AnsLeaf[] }[] }
  | { k: 'table'; head: AnsLeaf[][]; rows: AnsLeaf[][][] }
  | { k: 'hr' };

/* ── Block openers. Each one is `AnswerBody.jsx`'s, transcribed. ───────────── */

const MD_FENCE   = /^\s*(?:`{3,}|~{3,})\s*([^\s`]*)\s*$/;
const MD_HEAD    = /^(#{1,6})\s+(.*)$/;
/** `---` and nothing else. `***` and `___` are CommonMark rules and are NOT
 *  drawn on the web, so they are a paragraph here too. */
const MD_HR      = /^-{3,}/;
/** The space after the bullet is required — it is what keeps a line that is
 *  nothing but `*emphasis*` from being read as a one-item list. */
const MD_UL      = /^\s*[-*]\s+(.+)$/;
const MD_OL      = /^\s*(\d+)\.\s+(.+)$/;
/** A GFM delimiter row: `|---|:--:|`. It is what makes the line above a header
 *  rather than a sentence with pipes in it, and `includes('|')` is what keeps a
 *  bare `---` — the horizontal rule — out of the table branch. */
const MD_TABLE_D = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const MD_HAS_PIPE = /\|/;

const mdIsRuleRow = (l: string | undefined): boolean =>
  typeof l === 'string' && MD_HAS_PIPE.test(l) && MD_TABLE_D.test(l);

const mdIsBlockStart = (l: string): boolean =>
  MD_FENCE.test(l) || MD_HEAD.test(l) || MD_HR.test(l) || MD_UL.test(l) || MD_OL.test(l);

/* ── Inline ────────────────────────────────────────────────────────────────── */

/**
 * ONE alternation, scanned once, LEFTMOST MATCH WINS — which is the shape of
 * `inline()` in `AnswerBody.jsx`, and is now the shape here because anything
 * else is a second grammar wearing the first one's rules.
 *
 * It was five ordered passes over the whole string: code, links, citations,
 * `**`, `*`. Every rule was the web's and every rule fired in a defensible
 * order, and the output still disagreed with the browser on ordinary answers —
 * because the web decides by POSITION and a pass decides by RULE. ``**`code`**``
 * is bold text carrying two literal backticks in a browser and was a code span
 * flanked by stray asterisks here; `**[1]**` was a live citation chip between
 * two pairs of asterisks against the web's bold `[1]`. A model bolding a field
 * name or a citation is ordinary output, so nothing adversarial was needed to
 * reach it.
 *
 * Branch order is only a tie-break between two rules that can open on the same
 * character, and it carries one decision: `**` BEFORE `*`, or `**x**` reads as
 * an italic `*x*` wrapped in stray asterisks — the single most common thing a
 * model writes. Everything else falls out of leftmost: `` `**not bold**` ``
 * stays verbatim because the span starts first, and `[see](https://x)` is a
 * link rather than a bracket that failed to be a number for the same reason.
 *
 * NO FLANKING GUARD, and its absence is deliberate. CommonMark says an opener
 * may not be followed by a space — the rule that makes `2 * 3 * 4` arithmetic —
 * and `AnswerBody.jsx` does not implement it, so a browser renders that line
 * with ` 3 ` in italics. Enforcing it here made one multiplication render two
 * ways on two screens. What this grammar promises is the WEB'S reading, not
 * CommonMark's; where they differ the web is the one both surfaces must agree
 * with, and the web is not this agent's file to change.
 *
 * A bare URL is not a branch, because it is not a rule on the web either: text
 * that is a link on one surface and characters on the other is the divergence
 * this grammar exists to end.
 *
 * `[^*\n]` and ``[^`\n]`` where the web writes `[^*]` and ``[^`]``: `inline()`
 * is handed ONE LINE at a time and this is handed a whole paragraph with its
 * newlines kept, so the exclusions are what stop a marker on one line pairing
 * with one on the next — a span the web cannot express in the first place.
 */
const MD_INLINE =
  /\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|\[\d{1,3}\]/g;

function mdInline(text: string, citable: Set<number>): AnsLeaf[] {
  if (!text) return [];
  // A fresh RegExp per call. The module-level literal carries `lastIndex`
  // across calls otherwise, and a shared cursor over different strings drops
  // tokens in a way that only shows up on the second answer of a session.
  const re = new RegExp(MD_INLINE.source, 'g');
  const out: AnsLeaf[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const tok = m[0];
    let leaf: AnsLeaf | null;

    if (tok.startsWith('**')) {
      // THE CONTENTS ARE NOT RE-READ. `inline()` pushes these characters into a
      // `<b>` as text, so a marker nested inside emphasis is literal on both
      // surfaces or on neither.
      leaf = { k: 'b', kids: [tok.slice(2, -2)] };
    } else if (tok.startsWith('*')) {
      leaf = { k: 'i', kids: [tok.slice(1, -1)] };
    } else if (tok.startsWith('`')) {
      leaf = { k: 'code', text: tok.slice(1, -1) };
    } else if (tok.includes('](')) {
      // The LAST `](`, as on the web: the label cannot contain a `]`, so the two
      // agree, and reading it the same way is one fewer thing to keep in step.
      const cut = tok.lastIndexOf('](');
      const href = safeHref(tok.slice(cut + 2, -1));
      // A link whose target is not http(s) stays as the characters the model
      // typed. `Linking.openURL` places calls and opens the store; the label is
      // the model's text and can claim anything at all about where it goes.
      leaf = href ? { k: 'a', href, text: tok.slice(1, cut) || href } : null;
    } else {
      const n = Number(tok.slice(1, -1));
      // A marker with no source behind it is TEXT, exactly as on the web. The
      // server strips invalid refs from what it stores, but only from the
      // message it is storing — every answer written before that guard is still
      // in the table, and a chip that opens nothing is worse than the bracket
      // it replaced. During a stream `citable` is empty on purpose: the text so
      // far has not been through `strip_invalid_refs` and is provisional.
      leaf = citable.has(n) ? { k: 'cite', n } : null;
    }

    if (!leaf) {
      // Not a token. Resume ONE character on rather than past the whole failed
      // match, so a rejected closer can still open a real pair.
      re.lastIndex = m.index + 1;
      continue;
    }
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(leaf);
    last = m.index + tok.length;
    re.lastIndex = last;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** `| a | b |` → the cells, with the outer pipes dropped. */
function mdCells(line: string, citable: Set<number>): AnsLeaf[][] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => mdInline(c.trim(), citable));
}

/**
 * An answer body → block tokens.
 *
 * `citable` is the set of `[n]` markers that have a source behind them. Pass an
 * EMPTY set for text that is still streaming: nothing has validated those
 * markers yet, and a chip drawn on a provisional number is a promise the final
 * frame may not keep.
 */
export function parseAnswer(body: string | null | undefined, citable?: Set<number>): AnsBlock[] {
  const src = body == null ? '' : String(body);
  if (!src) return [];
  const cites = citable ?? new Set<number>();
  const lines = src.split('\n');
  const blocks: AnsBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // The order below is `lines()` in `AnswerBody.jsx`, and the order is part
    // of the grammar: the table check runs before the heading check so a `---`
    // delimiter row is never mistaken for a rule, and the rule check runs
    // before the bullet check for the same reason in reverse.
    const fence = MD_FENCE.exec(line);
    if (fence) {
      const lang = fence[1] || null;
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !MD_FENCE.test(lines[i])) { buf.push(lines[i]); i += 1; }
      // An unclosed fence runs to the end. A model that opens a block and gets
      // cut off should leave a code block, not three backticks and a wall of
      // unwrapped text that reads as a broken parser — and mid-stream EVERY
      // fence is unclosed for as long as the block is arriving.
      if (i < lines.length) i += 1;
      blocks.push({ k: 'pre', lang, text: buf.join('\n') });
      continue;
    }

    // A table is the ONLY block that needs the next line to decide. Without the
    // delimiter row a line with pipes in it is a sentence with pipes in it.
    if (MD_HAS_PIPE.test(line) && mdIsRuleRow(lines[i + 1])) {
      const head = mdCells(line, cites);
      i += 2;
      const rows: AnsLeaf[][][] = [];
      while (i < lines.length && MD_HAS_PIPE.test(lines[i])) {
        rows.push(mdCells(lines[i], cites));
        i += 1;
      }
      blocks.push({ k: 'table', head, rows });
      continue;
    }

    const head = MD_HEAD.exec(line);
    if (head) {
      // Three sizes for six levels, which is the web's mapping: `####` and
      // deeper share the smallest. A heading that is too small is still a
      // heading; a line reading `#### Totals` is not.
      const level = Math.min(head[1].length, 3) as 1 | 2 | 3;
      blocks.push({ k: 'h', level, kids: mdInline(head[2], cites) });
      i += 1;
      continue;
    }

    if (MD_HR.test(line)) { blocks.push({ k: 'hr' }); i += 1; continue; }

    if (MD_UL.test(line)) {
      const items: AnsLeaf[][] = [];
      while (i < lines.length && MD_UL.test(lines[i])) {
        items.push(mdInline(MD_UL.exec(lines[i])![1], cites));
        i += 1;
      }
      blocks.push({ k: 'ul', items });
      continue;
    }

    if (MD_OL.test(line)) {
      const items: { num: number; kids: AnsLeaf[] }[] = [];
      while (i < lines.length && MD_OL.test(lines[i])) {
        const m = MD_OL.exec(lines[i])!;
        // The number the model WROTE, per item. A list typed `1. / 1. / 1.`
        // reads 1, 1, 1 in a browser; renumbering it here would make the phone
        // and the web disagree about the same answer.
        items.push({ num: Number(m[1]), kids: mdInline(m[2], cites) });
        i += 1;
      }
      blocks.push({ k: 'ol', items });
      continue;
    }

    if (!line.trim()) { i += 1; continue; }

    // A paragraph runs to the next block opener or the next blank line. Its own
    // newlines are KEPT: React Native lays a `\n` out inside a `<Text>`, which
    // is the platform's version of the `white-space: pre-wrap` the web relies
    // on, and a model that wrote two lines meant two lines.
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !mdIsBlockStart(lines[i])) {
      // A table header only opens a table when its delimiter row follows.
      if (MD_HAS_PIPE.test(lines[i]) && mdIsRuleRow(lines[i + 1])) break;
      buf.push(lines[i]);
      i += 1;
    }
    if (buf.length) blocks.push({ k: 'p', kids: mdInline(buf.join('\n'), cites) });
    else i += 1; // A line that opened nothing and joined nothing: do not spin.
  }

  return blocks;
}

/**
 * The host a link would actually open, for showing beside its label.
 *
 * A `[label](url)` in an answer is written by a MODEL, and the model repeats
 * whatever the web search returned — so the label is attacker-choosable text
 * and "the Income Tax portal" can point anywhere `safeHref` allows. A browser
 * gives the reader the status bar and then the address bar; `Linking.openURL`
 * gives them neither, because the tap hands off to another app and the first
 * thing they see is the page itself. So the destination is drawn next to the
 * label, and this is where it is derived.
 *
 * USERINFO IS STRIPPED FIRST, and that is the whole reason this is not one
 * `split('/')`. `https://incometax.gov.in@evil.tld/` is a URL whose host is
 * `evil.tld`, and a naive read of the characters after `//` prints the part
 * before the `@` — which would make this function argue FOR the link it exists
 * to expose. The port goes too: `:8443` is not part of the identity a reader is
 * checking, and it pushes the real host out of a narrow row.
 *
 * A BACKSLASH ENDS THE AUTHORITY, exactly as a slash does, and leaving it out
 * of that class turned this function into the spoof it was written to prevent.
 * `\` is not an ordinary host character: for a special scheme the WHATWG parser
 * — which is what Chrome runs on the `ACTION_VIEW` intent `Linking.openURL`
 * hands it — treats it as a separator, so `https://evil.tld\@incometax.gov.in/`
 * opens `evil.tld` and everything from the `\` on is the path. Read as one more
 * authority character it looked like userinfo, and ` (incometax.gov.in)` was
 * drawn beside the label — and spoken to a screen reader — for a tap that went
 * somewhere else entirely. That is strictly worse than showing nothing.
 *
 * Returns `''` for anything that is not http(s), so a caller that somehow holds
 * an unallowlisted href renders no destination rather than a misleading one.
 * Homographs are NOT solved here — `аpple.com` in Cyrillic still reads as
 * `apple.com` — and no client-side check can solve them; showing the host is
 * strictly more than the reader had before.
 */
export function hrefHost(href: string): string {
  const m = /^https?:\/\/([^/?#\\]*)/i.exec(String(href ?? '').trim());
  if (!m) return '';
  const authority = m[1];
  // Everything up to the LAST `@` is userinfo. Last, not first: a password may
  // itself contain an `@`, and the browser splits on the last one.
  const at = authority.lastIndexOf('@');
  const hostPort = at === -1 ? authority : authority.slice(at + 1);
  // An IPv6 literal keeps its brackets and only the port after them is cut.
  const host = hostPort.startsWith('[')
    ? hostPort.slice(0, hostPort.indexOf(']') + 1) || hostPort
    : hostPort.replace(/:\d*$/, '');
  return host.replace(/\.+$/, '').toLowerCase();
}

/** The `[n]` markers a set of sources can actually answer for. */
export function citableRefs(sources: KbSource[] | undefined | null): Set<number> {
  const out = new Set<number>();
  for (const s of sources ?? []) {
    // The ref arrives as a STRING on stored web sources — 75 of the 77 in the
    // table carry the CHARACTERS of the number, not the number. `Number()`
    // rather than a typeof test, so both spellings light the same chip.
    const n = Number(s?.ref);
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * What only the phone knows
 *
 * Two helpers the SCREEN uses and neither endpoint returns. They live in this
 * `.ts` file for the reason `parseAnswer` does: `node --test` cannot load a
 * `.tsx` at all — type stripping does not transform JSX — so logic left in a
 * component body can only ever be read, never executed.
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * The title `_sahayak_answer` gives a conversation when it opens one.
 *
 * THE ONLY HANDLE THIS CLIENT HAS ON A SESSION IT WAS NEVER TOLD THE ID OF. The
 * server opens the session and stores the question well before the first delta,
 * but `session_id` rides on the `final` frame alone — so a stopped or cut first
 * answer leaves the phone holding a conversation the server has and it does
 * not. Sending the follow-up with `session_id: null` opens a SECOND
 * conversation and hands the model none of the thread the reader can see, so
 * the screen finds the first one again by its title.
 *
 * `hub.py` step 2b: `question[:60] + ("…" if len(question) > 60 else "")` over
 * `body.message.strip()`. `Array.from` rather than `slice`, because Python
 * counts CODE POINTS and `String.prototype.slice` counts UTF-16 units — the two
 * agree across Devanagari and Gujarati and part company on the first emoji.
 */
export function sessionTitleFor(question: string): string {
  const chars = Array.from(String(question ?? '').trim());
  return chars.length > 60 ? `${chars.slice(0, 60).join('')}…` : chars.join('');
}

/** The shape `withKeptPartials` needs of a turn, and no more of it. */
interface MergeableTurn { role: 'user' | 'assistant'; partial?: unknown }

/**
 * Stored rows, with the partial answers the server does not have put back.
 *
 * THE RECOVERY USED TO DELETE TEXT THE READER HAD ALREADY READ. When a send
 * fails, the screen re-reads `GET /chat/sessions/{id}/messages` — a timeout is
 * not a failure, the answer may be stored and paid for — and replacing the
 * thread with what came back is right for everything the server holds. It does
 * not hold a stopped or cut answer: a client that disconnects runs
 * `ai_router._record_abandoned`, which writes no assistant row at all. So one
 * later failure silently swallowed the partial text the previous turn had been
 * kept on screen for, which is exactly the "it appeared, it was read, then it
 * vanished" behaviour that turn exists to end.
 *
 * Position is counted in QUESTIONS, not in rows: the stored list has no row for
 * the partial itself, so a row index would slide by one for every one of them.
 * Every question above a partial reached the server — text arrived, so it was
 * asked and stored — which is what makes the count line up on both sides.
 *
 * A slot the server DID answer drops its partial rather than duplicating it. A
 * cut stream can have finished server-side, and showing the fragment above the
 * whole answer would read as the model saying it twice.
 */
export function withKeptPartials<T extends MergeableTurn>(stored: T[], local: T[]): T[] {
  const kept: { after: number; turn: T }[] = [];
  let asked = 0;
  for (const t of local) {
    if (t.role === 'user') asked += 1;
    else if (t.partial) kept.push({ after: asked, turn: t });
  }
  if (!kept.length) return stored;

  const out: T[] = [];
  let seen = 0;
  let answered = false;
  const flush = () => {
    if (answered) return;
    for (const k of kept) if (k.after === seen) out.push(k.turn);
  };
  for (const row of stored) {
    if (row.role === 'user') { flush(); seen += 1; answered = false; }
    else answered = true;
    out.push(row);
  }
  flush();
  // A partial whose question the server has no row for at all — nothing to
  // anchor it to, and dropping read text is the one outcome this rules out.
  for (const k of kept) if (k.after > seen) out.push(k.turn);
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * STREAMING — what this app can actually do, and the evidence
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * THE PHONE CAN STREAM. Not through `fetch`, and not through axios.
 *
 * ── What does NOT work, and why ─────────────────────────────────────────────
 *
 * · `axios` on React Native runs on `XMLHttpRequest`. It resolves once, with a
 *   finished body. There is no partial-response callback on the axios surface
 *   at all, so the whole of `api/client.ts` — interceptors, friendly messages,
 *   the 15-second timeout — is unusable for a stream.
 * · Global `fetch` in React Native 0.81 is the `whatwg-fetch` polyfill over the
 *   same XHR. `Response.body` is `undefined`: there is no `ReadableStream` in
 *   the polyfill and none in `@react-native/js-polyfills` (its `index.js`
 *   exports exactly `console.js` and `error-guard.js`). `res.body.getReader()`
 *   on the global fetch is a TypeError, not a slow path.
 *
 * ── What DOES work ──────────────────────────────────────────────────────────
 *
 * `expo/fetch` — a second, native fetch that Expo ships specifically for this.
 * The evidence is in this repository's own `node_modules`, at Expo 54.0.36:
 *
 * · `expo/src/winter/fetch/FetchResponse.ts` — `get body()` builds a real
 *   `ReadableStream` whose controller is fed from the native events
 *   `didReceiveResponseData` / `didComplete` / `didFailWithError`. Chunks reach
 *   JS as they arrive off the socket.
 * · `expo/android/src/main/java/expo/modules/fetch/` (OkHttp, `ResponseSink`)
 *   and `expo/ios/Fetch/ExpoURLSessionTask.swift`
 *   (`urlSession(_:dataTask:didReceive data:)`) are the two native halves. Both
 *   are compiled into the app because `expo` is itself a native module — which
 *   is also why this is one more thing Expo Go could never run.
 * · AUTH SURVIVES THE MOVE, which was the part most likely to break. This app
 *   authenticates with an httpOnly cookie (`withCredentials: true`), and
 *   `expo/fetch` defaults `credentials` to `'include'`. On Android
 *   `ExpoFetchModule.kt` installs `JavaNetCookieJar(ForwardingCookieHandler)` —
 *   React Native's OWN cookie store, the one axios is already using. On iOS
 *   `ExpoURLSessionTask.swift` reads `HTTPCookieStorage.shared`. Same jar, same
 *   session, no token plumbing.
 * · `TextDecoder` is installed as a global by `expo/src/winter/runtime.native.ts`,
 *   so the bytes can be decoded without a dependency.
 *
 * ── The one thing that is NOT proven from this workstation ──────────────────
 *
 * `ReadableStream` is not in `@react-native/js-polyfills` and is not in any
 * package in this tree; Expo's own comment says "ReadableStream is injected by
 * Metro as a global". That is a claim about the bundler, and it cannot be
 * verified by reading `node_modules` — it needs a cold start on a device, which
 * this machine has no image for. So the reader below TOUCHES `res.body` inside
 * a try, treats a throw or a missing `getReader` as "this build cannot stream",
 * and the caller falls back to the ordinary `POST /chat`. If the global is
 * absent the app is exactly as fast as it is today and loses nothing.
 *
 * NOTHING HERE FAKES A STREAM. When the fallback runs, the answer appears whole,
 * because it arrived whole. A progressive reveal of text the client already
 * holds would be a lie about what the system is doing, and it would lie fastest
 * on the slowest connection, where the reader most needs to know.
 */

/**
 * How long a stream may deliver NOTHING before it is given up on.
 *
 * A stream had no deadline of any kind: `expo/fetch` was called with no timeout
 * and nothing aborted a socket that stopped producing bytes, so a stalled
 * proxy or a provider that hung mid-answer left a native task open, the
 * composer disabled and the lotus spinning until the app was killed. `axios` is
 * capped at 15 seconds for everything else in this app; this path could not use
 * that number at all, which is how it ended up with none.
 *
 * IDLE, NOT TOTAL, and the distinction is the whole design. A long answer is
 * not a broken one: the server flushes its held steps, then reads the brand
 * row, ten rows of history and — for a question that is not about the org's own
 * books — waits on Serper, all before the first token. A wall-clock cap would
 * cut off exactly the thorough answers people wait for. What no healthy stream
 * ever does is go quiet: bytes arrive, and this timer is restarted by every
 * chunk, including the `: keep-alive` comments a proxy relays.
 *
 * 60 seconds rather than something tighter because the fallback transport reads
 * the WHOLE body before it yields anything — when `ReadableStream` is not a
 * global, the first chunk IS the finished answer — so a window shorter than a
 * complete answer would abort the very build that cannot stream.
 *
 * Reaching it is `StreamFailed`, never `StreamUnavailable`: the request was
 * accepted, so an answer may already have been generated and charged for, and
 * re-asking on `POST /chat` would pay for it a second time.
 */
export const STREAM_STALL_MS = 60_000;

/**
 * The three sentences FastAPI's ROUTER writes when it refuses a request before
 * any handler runs, and the only 404/405/501 bodies that mean "this deployment
 * does not have the route".
 *
 * Anchored, so a handler that happens to begin with those words — "Not found in
 * this client's knowledge base" — is not mistaken for the router.
 */
const ROUTE_REFUSAL = /^(?:not found|method not allowed|not implemented)$/i;

/** The non-streaming route. Named so the streaming one cannot drift from it. */
export const CHAT_PATH = '/v1/hub/chat';
/** `POST /api/v1/hub/chat/stream` — same body, same auth, same gates. */
export const CHAT_STREAM_PATH = `${CHAT_PATH}/stream`;

/** One server-sent frame: the `event:` name and the raw `data:` payload. */
export interface SseFrame { event: string; data: string }

/**
 * An incremental SSE splitter.
 *
 * A chunk boundary can land anywhere — mid-word, mid-JSON, between the `data:`
 * line and its terminator — so the carry has to be a partial LINE, not a
 * partial frame. `push` returns only frames that are complete.
 *
 * `end()` flushes a frame whose blank-line terminator never arrived, and only
 * that: a partial line is dropped rather than parsed. A `final` frame cut in
 * half must fail to parse and be reported as a cut-off stream, never stored as
 * if it were the whole answer.
 */
export function createSseReader(): { push(text: string): SseFrame[]; end(): SseFrame[] } {
  let carry = '';
  let event = '';
  let data: string[] = [];
  let open = false;

  /**
   * A frame needs BOTH a name and at least one complete `data:` line.
   *
   * The `data.length` half is not pedantry: a stream cut between `event: final`
   * and its payload otherwise dispatches `{event:'final', data:''}`, which is a
   * `final` frame carrying no answer — invariant 4 defeated by a missing
   * newline. Requiring the line means a truncated stream reports itself as
   * truncated instead.
   */
  const take = (): SseFrame | null => {
    const frame = open && event && data.length > 0 ? { event, data: data.join('\n') } : null;
    event = '';
    data = [];
    open = false;
    return frame;
  };

  const line = (raw: string, out: SseFrame[]) => {
    // `\r\n` and bare `\n` both terminate a line; a proxy may rewrite either.
    const l = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (l === '') { const f = take(); if (f) out.push(f); return; }
    // A comment line. Servers send `: keep-alive` through an idle proxy; it is
    // not a field and must not open a frame.
    if (l.startsWith(':')) return;
    const colon = l.indexOf(':');
    const field = colon === -1 ? l : l.slice(0, colon);
    const value = colon === -1 ? '' : l.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') { event = value; open = true; }
    else if (field === 'data') { data.push(value); open = true; }
    // `id` and `retry` are in the protocol and are not in this contract.
  };

  return {
    push(text: string): SseFrame[] {
      const out: SseFrame[] = [];
      carry += text;
      let nl = carry.indexOf('\n');
      while (nl !== -1) {
        line(carry.slice(0, nl), out);
        carry = carry.slice(nl + 1);
        nl = carry.indexOf('\n');
      }
      return out;
    },
    end(): SseFrame[] {
      // `carry` is an unterminated line and is DISCARDED. Half a JSON payload
      // is not a frame.
      carry = '';
      const f = take();
      return f ? [f] : [];
    },
  };
}

/**
 * The stream was not reached, and NO ANSWER WAS GENERATED.
 *
 * This is the only class of failure the caller may retry on `POST /chat`, and
 * the boundary is drawn at "could the server have produced — and charged for —
 * an answer". Exactly two things qualify: the build could not open the
 * transport (nothing was sent at all), and the route replied 404 / 405 / 501
 * (FastAPI's router refused the request before any handler ran). Everything
 * else is `StreamFailed`, because a second ask would spend a second charge for
 * an answer the server may already hold.
 */
export class StreamUnavailable extends Error {}

/** The stream started and then failed. NOT retryable — see `StreamUnavailable`. */
export class StreamFailed extends Error {
  /** True once a `delta` has been shown. Text on screen must not be rewritten. */
  readonly sawDelta: boolean;
  constructor(message: string, sawDelta: boolean) {
    super(message);
    this.sawDelta = sawDelta;
  }
}

/** What a transport hands back. Deliberately not a `Response`. */
export interface StreamOpened {
  status:      number;
  contentType: string;
  chunks:      AsyncIterable<string>;
}

export type OpenStream = (
  url: string,
  init: { headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<StreamOpened>;

/**
 * The default transport. `expo/fetch`, `require`d LAZILY.
 *
 * A top-level `import` of it would make this whole module unloadable by
 * `node --test`: `expo/fetch` reaches a native module the moment it is linked,
 * which is the same reason `src/test/register.mjs` stubs `react-native-mmkv`
 * and `expo-crypto`. Inside the function it is never reached by the suite,
 * which injects its own transport — `lib/crashRecorder.ts` uses the same shape
 * for the same reason.
 */
const openWithExpoFetch: OpenStream = async (url, init) => {
  // Everything up to the call to `nativeFetch` runs BEFORE anything is sent, so
  // a failure here is `StreamUnavailable` — no request, no answer, no charge.
  let nativeFetch: (u: string, i: Record<string, unknown>) => Promise<any>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    nativeFetch = require('expo/fetch').fetch;
  } catch {
    throw new StreamUnavailable('This build has no streaming transport.');
  }
  if (typeof nativeFetch !== 'function') {
    throw new StreamUnavailable('This build has no streaming transport.');
  }

  const res = await nativeFetch(url, {
    method:  'POST',
    headers: init.headers,
    body:    init.body,
    signal:  init.signal,
    // Explicit rather than defaulted. This is the line the cookie depends on.
    credentials: 'include',
  });

  const contentType = String(res.headers?.get?.('content-type') ?? '');
  const status = Number(res.status ?? 0);

  let body: any = null;
  try {
    // The getter CONSTRUCTS a ReadableStream. If Metro did not inject the
    // global, this THROWS rather than returning null — which is why it is read
    // inside a try and not tested with a truthiness check.
    body = res.body;
  } catch {
    body = null;
  }

  /**
   * THE WHOLE BODY, when the stream cannot be read incrementally.
   *
   * This is the one degradation on this path, and it is deliberately not an
   * error: the request has already been sent and the server is already
   * generating, so throwing here would charge the org for an answer it never
   * saw, and re-asking on `POST /chat` would charge it twice. Reading the body
   * to completion gets the SAME frames — `final` included — a moment later.
   *
   * The answer then appears whole, because it arrived whole. `onDelta` fires
   * for every delta in one burst and React composes a single frame from it;
   * nothing is paced, timed or revealed. A simulated reveal would be a lie
   * about what the system is doing, and it would lie hardest on the slow
   * connections where the reader most needs to know.
   */
  if (!body || typeof body.getReader !== 'function') {
    const whole = String(await res.text());
    return { status, contentType, chunks: (async function* () { yield whole; })() };
  }

  async function* chunks(): AsyncIterable<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        // `stream: true` holds a multi-byte character that straddles a chunk
        // boundary. Without it a Devanagari answer breaks into replacement
        // characters at every boundary that lands mid-glyph, which is often.
        if (value) yield decoder.decode(value, { stream: true });
      }
      const tail = decoder.decode();
      if (tail) yield tail;
    } finally {
      // Releases the native task. Without it a cancelled read leaves the socket
      // open and the provider still writing into it.
      try { reader.releaseLock?.(); } catch { /* already released */ }
    }
  }

  return { status, contentType, chunks: chunks() };
};

/** Where the stream lives, derived from the axios instance so there is one
 *  base URL in the app rather than two that agree until one is edited. */
function streamUrl(): string {
  const base = String((apiClient as { defaults?: { baseURL?: string } }).defaults?.baseURL ?? '');
  if (!base) throw new StreamUnavailable('No API base URL is configured.');
  return `${base.replace(/\/+$/, '')}${CHAT_STREAM_PATH}`;
}

export interface StreamHandlers {
  /** A named step, as it happens. Free reads, then the paid write. */
  onStep?:  (label: string) => void;
  /** Answer text as it arrives. PROVISIONAL — see the invariant below. */
  onDelta?: (text: string) => void;
}

export interface StreamOutcome {
  /** The `final` frame: exactly the body `POST /chat` returns. AUTHORITATIVE. */
  answer:  SahayakAnswer;
  /** How many `delta` frames reached the reader. */
  deltas:  number;
}

/**
 * Ask, and read the answer as it is written.
 *
 * ── The four invariants, and which half of each is this file's ──────────────
 *
 * 1. THE FINAL FRAME WINS. `onDelta` text is provisional: citation validation
 *    (`strip_invalid_refs`) can only run on the COMPLETE text, so a `[7]` that
 *    streamed may not survive into `final.message`. This function therefore
 *    returns the final frame and never an accumulation, and it has no accessor
 *    for what it accumulated — a client that keeps its own copy would show
 *    citations the server rejected. The screen renders the deltas with an EMPTY
 *    citable set for the same reason.
 * 2. NO RETRY ONCE THE SERVER HAS RUN. Provider fallback is the server's, and
 *    only before the first delta. The client's half is stricter: it re-asks on
 *    the plain `POST /chat` ONLY for `StreamUnavailable`, which is defined as
 *    the two cases where no answer can have been generated. A `StreamFailed`
 *    ends the turn — retrying it would spend a second charge, and once
 *    `sawDelta` is true it would also replace text the reader has already read
 *    with different text, which is the exact thing a mid-answer provider switch
 *    is forbidden for.
 * 3. ONE DEBIT PER ANSWER. The charge and the `hub_ai_logs` row are the
 *    server's, and they happen once whether or not this reader is still
 *    listening. WHEN THE USER TAPS STOP the request is aborted and the socket
 *    closes — the provider has already been billed for the tokens it generated,
 *    so the org is charged for an answer nobody read. That is the honest cost of
 *    a stop button and the screen SAYS SO rather than implying a cancel is free.
 *    It cannot state the number: `credits_charged` rides on the `final` frame,
 *    which a stopped stream never receives, and printing a figure the server did
 *    not return is the one thing this product does not do.
 * 4. A HALF ANSWER IS NEVER A WHOLE ONE. A stream that ends without `final`
 *    throws. Nothing partial is returned through the success path, so nothing
 *    partial can be stored, re-sent as history, or counted as answered.
 *
 * ── And it always ends ──────────────────────────────────────────────────────
 *
 * Every path out of here is bounded by `STREAM_STALL_MS`, including the wait
 * for the response itself. See that constant for why the deadline is an idle
 * one and not a total one.
 */
export async function askStreaming(
  message: string,
  opts: { sessionId?: string | null; clientId?: string | null },
  handlers: StreamHandlers = {},
  ctl: { signal?: AbortSignal; open?: OpenStream; stallMs?: number } = {},
): Promise<StreamOutcome> {
  const open = ctl.open ?? openWithExpoFetch;
  const url = streamUrl();

  /**
   * The watchdog's own controller, chained to the caller's.
   *
   * A second controller rather than reusing the caller's, because the two stops
   * mean different things to the screen: the reader's abort is a deliberate
   * stop and keeps what arrived under its own note, while this one is a
   * failure and says so. Aborting the caller's signal here would make a stall
   * indistinguishable from a tap on Stop — and the screen would then tell
   * somebody they had stopped an answer they were still waiting for.
   *
   * `addEventListener` where the runtime has it, `onabort` where it does not:
   * React Native's `AbortSignal` comes from the `abort-controller` polyfill and
   * Node's is an `EventTarget`, and this module runs on both.
   */
  const watchdog = new AbortController();
  const outer = ctl.signal;
  if (outer) {
    if (outer.aborted) watchdog.abort();
    else if (typeof outer.addEventListener === 'function') {
      outer.addEventListener('abort', () => watchdog.abort(), { once: true });
    } else {
      (outer as { onabort?: (() => void) | null }).onabort = () => watchdog.abort();
    }
  }

  const stallMs = ctl.stallMs ?? STREAM_STALL_MS;
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Declared out here so the stall below can report whether text was read.
   *  Text on screen must never be rewritten, whatever ended the stream. */
  let deltas = 0;
  /** Restarted by every chunk. The clock measures SILENCE, not duration. */
  const bump = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { stalled = true; watchdog.abort(); }, stallMs);
  };
  const disarm = () => { if (timer) { clearTimeout(timer); timer = null; } };

  // Armed BEFORE the request, so a server that accepts the connection and then
  // never answers is bounded too — that is the stall this path is most likely
  // to meet, and awaiting `open()` with no clock is where it used to hang.
  bump();
  try {
    return await readStream();
  } catch (e: unknown) {
    if (stalled) {
      // Whatever the abort surfaced as — `AbortError`, a closed reader, a
      // rejected read — the cause is this timer, and the reader is told the one
      // fact they can act on. NOT retryable: the route ran.
      const secs = Math.max(1, Math.round(stallMs / 1000));
      throw new StreamFailed(
        `The assistant stopped sending after ${secs} second${secs === 1 ? '' : 's'}.`,
        deltas > 0,
      );
    }
    throw e;
  } finally {
    disarm();
  }

  async function readStream(): Promise<StreamOutcome> {
    const opened = await open(url, {
      headers: {
        'Content-Type': 'application/json',
        Accept:         'text/event-stream',
        // No `X-App-Version`. The Pulse row is written at login and on the sync
        // path — `api/client.ts` says nothing per-request is stored — so a stream
        // without it loses no adoption data, and inventing a second place that
        // spells the header would be a second place to get it wrong.
      },
      body: JSON.stringify({
        message,
        session_id: opts.sessionId ?? null,
        client_id:  opts.clientId ?? null,
      }),
      // The WATCHDOG's signal, not the caller's, so the stall deadline reaches
      // the socket as well. It fires when the caller aborts too — it is chained
      // to that signal above — so the stop button loses nothing.
      signal: watchdog.signal,
    });

    /**
     * The error body, up to a sentence's worth of it.
     *
     * Shared by both branches below because the status alone stopped being
     * enough to tell them apart — see the 404 branch. `bump()` per chunk for
     * the same reason it is called in the frame loop: an error body arriving
     * slowly is still a live socket.
     */
    const errorDetail = async (): Promise<string> => {
      let body = '';
      for await (const chunk of opened.chunks) {
        bump();
        body += chunk;
        // An error body is a sentence. Anything longer is an HTML page from a
        // proxy, and reading all of it into memory helps nobody.
        if (body.length > 8192) break;
      }
      try { return String((JSON.parse(body) as { detail?: unknown })?.detail ?? '').trim(); }
      catch { return ''; /* Not JSON. The status is all there is. */ }
    };

    /**
     * A 404 IS NOT ALWAYS A MISSING ROUTE, and reading it as one latched this
     * client into the slow path for the life of the screen.
     *
     * `_sahayak_answer` raises 404 twice from inside the handler: "Session not
     * found" for a session id that is no longer an active row in the caller's
     * org, and "Client not found" from `_verify_client_access`. Those reach the
     * caller as real HTTP statuses because `sahayak_chat_stream` primes the
     * generator OUTSIDE the response body on purpose. Both were being read as
     * "this deployment has no streaming endpoint", so one conversation deleted
     * from the web — or one client removed from the org — turned streaming off
     * permanently: no steps, no deltas and no stop button on every later
     * question, with nothing on screen to explain it, while the fallback `POST
     * /chat` 404'd for exactly the same reason.
     *
     * The sentence is what separates them. FastAPI's own router writes "Not
     * Found" / "Method Not Allowed" / "Not Implemented" and nothing else, and a
     * proxy's HTML 404 parses to no detail at all; anything else came from a
     * handler that ran, which makes it a failure to report rather than a route
     * to give up on. Retrying THAT on `POST /chat` would only buy a second copy
     * of the same error, and where the handler had got further it would buy a
     * second charge.
     */
    if (opened.status === 404 || opened.status === 405 || opened.status === 501) {
      const detail = await errorDetail();
      if (detail && !ROUTE_REFUSAL.test(detail)) throw new StreamFailed(detail, false);
      // No route, no handler, no answer, no charge. The only retryable class.
      throw new StreamUnavailable(`The streaming route answered ${opened.status}.`);
    }
    if (!/text\/event-stream/i.test(opened.contentType)) {
      /**
       * Not a stream. Almost always a real HTTP error with a real sentence in it.
       *
       * The route raises before it yields anything, on purpose: an SSE response
       * has already sent `200 OK` by the time its first frame is written, so a
       * 402 carrying the price of the answer and the wallet balance has to come
       * out HERE or not at all. `detail` is that sentence and it is what the
       * reader needs — "you did not get a stream" is not something anyone can act
       * on, and "top up" is.
       *
       * NOT `StreamUnavailable` in any case: the route exists and ran, so the
       * answer may already have been generated and charged for, and re-asking
       * would pay for it a second time.
       */
      const detail = await errorDetail();
      throw new StreamFailed(
        detail
          || (opened.status >= 400
            ? `The assistant could not answer (${opened.status}).`
            : 'The server did not answer with a stream.'),
        false,
      );
    }

    const reader = createSseReader();
    let answer: SahayakAnswer | null = null;

    const handle = (frame: SseFrame): void => {
      let payload: any;
      try { payload = JSON.parse(frame.data); } catch { return; }
      if (frame.event === 'step') {
        const label = String(payload?.label ?? '').trim();
        if (label) handlers.onStep?.(label);
      } else if (frame.event === 'delta') {
        const text = typeof payload?.text === 'string' ? payload.text : '';
        if (text) { deltas += 1; handlers.onDelta?.(text); }
      } else if (frame.event === 'error') {
        throw new StreamFailed(
          String(payload?.detail ?? '').trim() || 'The assistant stopped part way through.',
          deltas > 0,
        );
      } else if (frame.event === 'final') {
        // The contract calls the prose `answer`; the body `POST /chat` actually
        // returns calls it `message` (`hub._sahayak_payload`). Both are read, in
        // that order, so whichever name the route ships with, the AUTHORITATIVE
        // text replaces what streamed rather than the accumulation surviving by
        // accident.
        const prose = typeof payload?.message === 'string' && payload.message
          ? payload.message
          : String(payload?.answer ?? '');
        answer = {
          ...(payload as SahayakAnswer),
          message:  prose,
          sources:  normaliseSources(payload?.sources),
          work:     Array.isArray(payload?.work) ? payload.work : [],
          figs:     Array.isArray(payload?.figs) ? payload.figs : [],
          read:     Array.isArray(payload?.read) ? payload.read : [],
          evidence: payload?.evidence ?? null,
        };
      }
    };

    for await (const chunk of opened.chunks) {
      // Bytes arrived, so the stream is alive — even when the chunk is a
      // `: keep-alive` comment that produces no frame at all.
      bump();
      for (const frame of reader.push(chunk)) handle(frame);
    }
    for (const frame of reader.end()) handle(frame);

    if (opened.status >= 400) {
      throw new StreamFailed(`The assistant could not answer (${opened.status}).`, deltas > 0);
    }
    if (!answer) {
      // Invariant 4. Everything read so far is discarded rather than returned.
      throw new StreamFailed('The answer was cut off before it finished.', deltas > 0);
    }
    return { answer, deltas };
  }
}
