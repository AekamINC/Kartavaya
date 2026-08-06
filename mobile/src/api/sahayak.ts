import { apiClient } from './client';

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
}

/** What `POST /send` answers with. NOT a message row — no id, no created_at. */
export interface ChatAnswer {
  message:          string;
  sources:          KbSource[];
  model:            string;
  cost_usd:         number;
  credits_charged:  number;
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

function cleanRow(m: ChatMessageRow & { sources?: unknown }): ChatMessageRow {
  return { ...m, sources: normaliseSources(m.sources) };
}

/**
 * Does this answer look like the friendly 200 that means everything failed?
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
export function looksLikeFailure(a: Pick<ChatAnswer, 'message' | 'model'>): boolean {
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
   */
  send: (sessionId: string, message: string) =>
    apiClient.post<ChatAnswer & { sources?: unknown }>(
      `/v1/hub/chat/sessions/${sessionId}/send`,
      { message },
    ).then(r => ({ ...r.data, sources: normaliseSources(r.data.sources) })),

  /** Soft delete — the row stays and `is_active` goes false. */
  removeSession: (sessionId: string) =>
    apiClient.delete(`/v1/hub/chat/sessions/${sessionId}`).then(r => r.data),
};
