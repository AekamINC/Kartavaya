/**
 * Sahayak · सहायक — the assistant, on the org's own side of the product.
 *
 * ── The bug this file exists to close ────────────────────────────────────────
 *
 * The chatbot has been built, metered, grounded and billed for months, and NO
 * ORG USER COULD REACH IT. `OrgSahayakPage`'s tab list held six entries and none
 * of them was the assistant; the only screen that rendered a conversation was
 * `pages/hub/ChatTab.jsx`, which is the AGENCY-side per-client view and needs a
 * `hub_clients` row chosen from a directory a client org does not have.
 *
 * ── The route an org user is actually allowed to call ────────────────────────
 *
 * `routers/hub_chat.py` has no `/org/…` route. Three of its five chat endpoints
 * are already org-scoped and need nothing — `GET /chat/sessions/{id}/messages`,
 * `POST /chat/sessions/{id}/send` and `DELETE /chat/sessions/{id}` all match on
 * `hub_chat_sessions WHERE id=$1 AND org_id=$2`. The other two are not: listing
 * and creating a session both take a `client_id` in the path, and
 * `hub_chat_sessions.client_id` is `NOT NULL REFERENCES hub_clients`
 * (migration 017), so a session that belongs to no client cannot exist at all.
 *
 * ASKING no longer uses any of them. `POST /v1/hub/chat` (routers/hub.py) is the
 * route that carries the refusal, the work steps, the figures and the evidence
 * table this screen draws, and it opens the conversation itself — see `send`.
 * `…/messages` and `DELETE …` are still the read and the delete.
 *
 * The join is `GET /v1/hub/org-client` — the org's own INTERNAL client, created
 * on first ask, behind `require_user` + `get_org_id` + the sahayak module gate.
 * So: resolve the internal client, then use the client-scoped list/create and
 * the org-scoped read/send. Every call is one an org member is authorised to
 * make, and no id is guessed.
 *
 * ── What the layout is, and where it came from ───────────────────────────────
 *
 * `design-reference/Kartavaya Redesign/sahayak.css`, which 29-sahayak.md names
 * as the pixel reference. Its shape, and the four things it changes from the
 * previous build:
 *
 *   · `.sh` is a TWO-COLUMN GRID — the thread on a patterned ground, and one
 *     optional panel. There is no in-surface chrome bar (the module header is
 *     the tab shell above `.sh`) and no Focus/Workbench toggle.
 *   · The reply is prose blocks on the canvas, not provenance-coloured cards.
 *     `.sh-ac` and the whole `--mc` family are gone with them.
 *   · The sources panel is PERMANENT rather than behind a button. It is present
 *     when the answer in view cited something and absent — `.sh--wide` — when it
 *     did not. That is the prototype's cited-vs-answer-first distinction, driven
 *     by what the server returned rather than by a mode.
 *   · The lotus is the only waiting state: `BrandLoader` at 30px beside every
 *     reply and 104px in the empty state. There is no second spinner in this
 *     product and the assistant does not get one.
 *
 * ── The one thing here that the prototype does not have ─────────────────────
 *
 * THE CONVERSATION RAIL. The prototype has no route to a past conversation and
 * no way to delete one; the sessions and their messages have been in
 * `hub_chat_sessions` / `hub_chat_messages` the whole time. Dropping both is a
 * product decision rather than a styling consequence, and it is not one taken
 * here — so the rail survives. It shipped CLOSED on first paint; see THE SHELL
 * below for why that changed and for what it is now. It is opened from the
 * composer footer, in the slot
 * the prototype gives `.sh__scope` — a pill that narrates the RBAC filter, which
 * 29 §2 rule 3 says not to do, and asserts a scope no endpoint guarantees.
 *
 * Open, it adds `.sh--rail`: a LEADING GRID TRACK, mirroring the sources panel
 * on the other edge, drawn entirely in rules derived from the prototype's own
 * (see the banner at the foot of `sahayak.css`). It reverts to the overlay it
 * used to be below 1280px, where three tracks do not fit. The class is a
 * modifier rather than a change to `.sh`, so with the rail closed the grid is
 * still byte-identical to the prototype's.
 *
 * The rail is rendered LAST, after `.sh__main` and the sources panel, and is
 * placed into column 1 by CSS. Opening it therefore reorders nothing that was
 * already on screen — neither the DOM nor the tab order moves.
 *
 * ── THE SHELL, 2026-08-06 ───────────────────────────────────────────────────
 *
 * The owner, on a screenshot of this exact surface: "why full page where is the
 * option of switching view? and where the sidemenu to see previous chat?"
 *
 * Both were answerable and neither was answered, which is the honest reading of
 * the note above: the rail EXISTED, opened from a pill in the composer footer,
 * and closed itself again on every single mount. A control that resets is a
 * control nobody finds. Five things changed, and none of them touches the
 * transcribed geometry of the default paint:
 *
 *   1. THE RAIL REMEMBERS, and opens itself on a screen where it is a track
 *      rather than an overlay (≥1280px, the width sahayak.css already draws the
 *      third column at). A stored choice beats that default in both directions.
 *      `assistant/prefs.js` holds all of it in one localStorage record.
 *   2. THE CONVERSATION REMEMBERS. Reopening the newest thread is right for a
 *      first visit and wrong for a reload — it silently moved a reader out of
 *      the thread they were in. The stored id wins while it is still listed.
 *   3. A VIEW SWITCH — Reading (the prototype's measured 760px column) and
 *      Compact (full width, tighter steps, the density of the `.sh-aside`
 *      presentation). `reading` paints NO class, so the untouched surface is
 *      still byte-identical to the prototype.
 *   4. A VERDICT ON EVERY ANSWER, into `.sh__fb` — a selector that had been
 *      declared, styled and held in the orphan baseline with no consumer since
 *      it was transcribed. It posts to `POST /v1/hub/skills/feedback`, which
 *      already exists; see `assistant/feedback.js` for the contract and for why
 *      the message id is checked before anything is sent.
 *   5. THE SOURCES PANEL EXISTS ON A PHONE. It was `display: none` below 768px
 *      — not collapsed, removed — so on the device most of this product's users
 *      hold, no answer could point at where it came from. It is a bottom sheet
 *      now, with the split-evidence switch beside the answer it belongs to.
 *
 * ── IT STREAMS, 2026-08-19 ──────────────────────────────────────────────────
 *
 * Nothing streamed. `POST /v1/hub/chat` (routers/hub.py:3733) returned one
 * finished dict after every ledger read, every web search and every token the
 * model wrote, so this surface showed a lotus and one line — "Reading your
 * records…" — for the whole of it. Worse, the request carried NO TIMEOUT: a
 * backend that accepted the connection and never answered left the composer
 * disabled and the lotus turning for the life of the tab, with no control that
 * could end it. And the composer was cleared BEFORE the post, so a send that
 * failed took the typed question away with it.
 *
 * `POST /v1/hub/chat/stream` answers the same body, same auth, same gates, as
 * `text/event-stream`: `step` (work as it happens), `delta` (answer text as it
 * arrives), `final` (byte for byte the JSON `POST /chat` already returns) and
 * `error`. `POST /chat` is untouched and still here. Four rules this file keeps:
 *
 *   1. WHAT STREAMED IS PROVISIONAL. `final.answer` REPLACES the accumulated
 *      deltas; it is never appended to them. Citation validation
 *      (`strip_invalid_refs`) can only run on the COMPLETE text, so a client
 *      that kept its own accumulation would leave `[3]` markers on screen that
 *      the server had already rejected. The deltas are therefore drawn as plain
 *      paragraphs in the PENDING turn and never stored as a message; the
 *      message is built from `final` alone, through the same `shape()` every
 *      other reply goes through.
 *   2. ONE FALLBACK, AND ONLY WHERE THE ANSWER CANNOT EXIST. The boundary is
 *      NOT "has a frame arrived", which is where this was first drawn and is
 *      one whole request too late. `sahayak_chat_stream` primes its generator
 *      with `__anext__` BEFORE it hands FastAPI a response, and `credits.spend`
 *      runs inside that priming (hub.py, step 5) — so the org is charged before
 *      a single byte can reach this browser. A laptop that loses Wi-Fi between
 *      the request leaving and the head coming back has therefore already paid
 *      for an answer nobody will see, and re-asking bought a SECOND one: a
 *      second debit, a second `hub_ai_logs` row and — with no `session_id` yet
 *      in hand — a second conversation in the rail for one question.
 *      So the fallback is allowed only where the handler PROVABLY never ran:
 *      nothing was sent at all (no backend URL, no `fetch`), or the router
 *      refused before it (401/404/405/501). A network failure, a body that is
 *      not an event stream and a stream that closed empty are all failures of
 *      an answer that may already exist, and they are reported rather than
 *      re-asked. It is the boundary mobile's `StreamUnavailable` draws.
 *   3. STOP IS A DISCONNECT, NOT AN UNDO, AND IT SAYS SO. `AbortController`
 *      closes the reader. The provider has already been called by then and the
 *      server's debit is the server's own decision — `hub_ai_logs` and the
 *      credit row happen once per answer whether or not anybody is still
 *      listening — so what is on screen is marked as a fragment and is never
 *      presented as an answer: no verdict buttons, no sources panel, no cost
 *      line, because there is no stored message to have an opinion about. One
 *      frame of any kind proves the charge went through, so the fragment states
 *      it in words and the credit strip above this tab is re-read.
 *      AND STOP IS ONLY OFFERED WHERE THERE IS SOMETHING TO STOP: on the plain
 *      `POST /chat` fallback, aborting the socket cancels nothing the server is
 *      doing, so a Stop there would draw "nothing arrived" over an answer that
 *      is still being written, charged for and stored.
 *   4. THE COMPOSER IS CLEARED BY THE SERVER, NOT BY THE CLICK. The text stays
 *      in the box until the request is accepted — the first frame on the
 *      stream, the 2xx on the non-streaming route — and is still there,
 *      unchanged, if it never was. Losing what somebody typed is the worst
 *      thing a chat can do to them.
 *
 * ── THE COMPLAINT BECOMES REPRODUCIBLE, 2026-08-19 ──────────────────────────
 *
 * `staging.hub_skill_feedback`: 0 rows. `staging.ai_feedback`: 0 rows. The
 * thumbs have been wired since 2026-08-06 and every feedback table in this
 * product is still empty, which is proposal 69 §3E's whole point — the flywheel
 * everything else in that document feeds on has never turned once.
 *
 * A bare thumbs-down was half the reason. It records that an answer was wrong
 * and not what was wrong with it, so nobody can reproduce it, nobody can write
 * a test from it, and the row teaches nothing to whoever reads the table next.
 * So a down thumb now asks ONE optional question — five concrete reasons and a
 * box for words — and the answer to it lands in `note`, which is a real column
 * on the live database whatever migration 119's header says (`feedback.js`
 * records the probe). Three rules, all of them in `assistant/Verdict.jsx`:
 *
 *   1. THE VERDICT IS POSTED ON THE PRESS, THE REASON IS POSTED SEPARATELY. A
 *      reader who presses the thumb and walks away has still complained, and
 *      the ledger has to hold that. The reason is a second append-only row
 *      against the same `message_id`.
 *   2. THE ROW SAYS WHAT WAS STORED, AND SAYS WHEN NOTHING WAS. A toast is gone
 *      in four seconds; "recorded" and "not recorded" are exactly the two
 *      states a feedback control must never blur, so both are sentences that
 *      stay under the answer they belong to.
 *   3. IT NEVER BLOCKS THE CHAT AND NEVER EATS THE WORDS. The question is a
 *      block under the reply, not a dialog — the composer stays live — and a
 *      refused reason keeps the typed text exactly where it was.
 *
 * ── WHICH LEDGER, AND WHICH HALF OF §3E THIS IS ─────────────────────────────
 *
 * §3E names `staging.ai_feedback` and the record/list/stats endpoints already
 * written against it (`routers/hub.py`, `/v1/hub/ai-feedback`). NOTHING ON THIS
 * SCREEN WRITES THERE, and nothing should: `ai_feedback` is the acceptance
 * ledger for GENERATED CONTENT — `skill_type`, `context_type`, an `action` of
 * accept/edit/reject, the `ai_output` dict a skill produced and the
 * `edited_output` a human replaced it with. It has no `message_id` column, so a
 * row in it cannot be traced back to the answer it was about, and a chat
 * verdict filed there would have to invent a skill type and an output dict to
 * satisfy the model — the same fabrication `feedback.js` refuses for
 * `variables`. The table that CAN hold this is `staging.hub_skill_feedback`,
 * whose ownership check joins `hub_chat_messages` to `hub_chat_sessions WHERE
 * org_id` and whose `note` column takes the reason.
 *
 * So `GET /v1/hub/ai-feedback` and `/ai-feedback/stats` keep answering zero
 * however many thumbs are pressed here, and reading them is not how anybody
 * checks whether this works. The count that moves is
 * `SELECT COUNT(DISTINCT message_id) FROM staging.hub_skill_feedback`.
 *
 * And this file is §3E's CAPTURE half only. Its second clause — every
 * thumbs-down becoming a candidate eval case — is a READER of that table, and
 * no reader exists yet: `golden_evals.load_cases` takes `cases/*.json` off
 * disk, and nothing in `backend/scripts/` imports a complaint. What is settled
 * here is that such a reader CAN be written — the row carries the message id,
 * the chosen reasons and the words, and the question and the answer are both
 * reachable from that id through the session — not that it has been.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api } from '../../lib/api';
import { getActiveOrg } from '../../lib/orgContext';
import { useToast } from '../../components/ui/toast';
import useModuleWrite from '../../hooks/useModuleWrite';
import BrandLoader from '../../components/layout/BrandLoader';
import { Resource, useResource, useList, ErrorNote, errText } from '../hub/_shared';
// The two halves of a provisional draw, both borrowed rather than written
// again: the block split a FINISHED answer gets, and the product's own
// generated-text renderer. See `LiveText`.
import { Markdown } from './_shared';
import AnswerBody, { blocksOf } from './assistant/AnswerBody';
import SourcesPanel from './assistant/SourcesPanel';
import { parseSources } from './assistant/sources';
import { FEEDBACK_PATH, feedbackBody, isServerAnswer } from './assistant/feedback';
import {
  COMPACT, READING, evidenceOf, railDefault, readShell, sessionOf, viewOf, writeShell,
} from './assistant/prefs';
import '../../styles/sahayak.css';
import { Secondary } from '../../components/Bilingual';

/**
 * The openers.
 *
 * The prototype ships four English seeds naming demo orgs; these six are the set
 * the owner approved in `docs/proposals/19-sahayak-final.html`, kept because copy
 * is not a pixel value and because two of them are Devanagari —
 * 24-bilingual-devanagari.md asks for the bilingual pair, and `lang` is what
 * stops a screen reader announcing Hindi with English phonemes. The prototype's
 * grid is `auto-fit minmax(214px, 1fr)`, so it takes any count without a ladder.
 */
const OPENERS = [
  { q: "What's due this month?", s: 'Filing deadlines across your work' },
  { q: 'किस क्लाइंट का भुगतान बाकी है?', s: 'Outstanding payments', dev: true },
  { q: 'Draft a reply', s: 'To a GST notice' },
  { q: 'Explain a rule', s: 'In plain language' },
  { q: 'Summarise a client', s: 'Position and open points' },
  { q: 'इस हफ़्ते क्या बदला?', s: 'Across everything', dev: true },
];

/**
 * The streaming route. Strictly additive — `POST /v1/hub/chat` is unchanged,
 * still called by mobile and by the fallback below, and still the definition of
 * what a finished answer is.
 */
export const STREAM_PATH = '/v1/hub/chat/stream';

/**
 * How long either route may go without a byte before the question is dropped.
 *
 * `api.post('/v1/hub/chat', …)` carried no timeout at all, and axios's default
 * is 0 — no limit — so a request the backend accepted and never answered held
 * the composer until the tab was closed. This is a BOUND ON THE HANG, not a
 * budget for the answer: two minutes is long enough that a grounded reply doing
 * real work is never cut off, and short enough that a dead connection stops
 * pretending to be a slow one.
 */
export const ASK_TIMEOUT_MS = 120000;

/**
 * The longest question the server will take — `ChatAsk.message` is
 * `Field(min_length=1, max_length=4000)`, and pydantic rejects a longer one
 * with a 422 before the handler ever runs.
 *
 * The composer had no cap at all, so pasting a GST notice into the shipped
 * "Draft a reply" opener produced a 422 whose `detail` is a LIST rather than a
 * sentence — thrown away by every reader of `detail`, leaving "Sahayak did not
 * answer." with no hint that the question was simply too long. Mobile has
 * capped its field at this number since it shipped; this is the same cap, so
 * the two surfaces refuse the same paste at the same character.
 */
export const ASK_MAX_CHARS = 4000;

/**
 * The two headings a fragment can carry, and the line between them.
 *
 * Only the reader's own button press is STOPPED. A provider that died halfway
 * through and a watchdog that dropped a silent connection are INTERRUPTED,
 * because one heading over all three told somebody who had touched nothing that
 * they had cancelled their own answer.
 */
export const STOPPED = 'Stopped';
export const INTERRUPTED = 'Interrupted';

/**
 * The statuses that mean THE HANDLER NEVER RAN, and so the only ones answered
 * by asking `POST /v1/hub/chat` instead. Nothing was read, nothing was written
 * and nothing was charged, so a second ask cannot be a second answer.
 *
 *   · 404 / 405 / 501 — this build's router has no such route.
 *   · 401 — `require_user` refused before the route, AND it is the one status
 *     this surface cannot handle by itself. `lib/api`'s response interceptor is
 *     the only code in the product that ends a session: it clears the token,
 *     the onboarding draft and the export history and sends the reader to
 *     `/login?expired=1`. A raw `fetch` never reaches it, so an expired token
 *     left the page authenticated-looking and every send failing forever with
 *     the server's own "Invalid or expired token" printed as product copy.
 *     Re-asking through axios is not a hope that the second call succeeds — it
 *     will not — it is how the 401 reaches the handler that signs the reader
 *     out.
 *
 * Every other status is a real answer about this question — 402 the wallet, 403
 * the module gate — and asking a second endpoint would only collect the same
 * refusal twice.
 */
const NOTHING_RAN = new Set([401, 404, 405, 501]);

/** An error the caller may answer by falling back to `POST /v1/hub/chat`. */
function cannotStart(why) {
  const e = new Error(`The stream did not start (${why}).`);
  e.noStream = true;
  return e;
}

/**
 * A failure shaped the way `errText` reads one, which is `response.data.detail`
 * first and the status after it. Everything this module throws goes through
 * here so that one sentence is chosen in one place.
 */
function shaped(detail, status = 500, extra = {}) {
  const e = new Error(detail);
  e.response = { status, data: { detail } };
  return Object.assign(e, extra);
}

/**
 * The sentence out of an error body, whichever shape FastAPI wrote it in.
 *
 * A handler's own `raise HTTPException(402, "…")` is a string and is used as
 * it stands — it is the text that says what ran out and what to do next. A body
 * REJECTED BEFORE the handler is a list of `{loc, msg, type}`, and reading only
 * the string form discarded it: the one 422 this composer can produce is a
 * question over `ASK_MAX_CHARS`, and it failed with a sentence naming no cause.
 * Pydantic's own wording ("String should have at most 4000 characters") is not
 * customer copy, so the length case is said in the product's words and anything
 * else falls back to the status.
 */
function detailOf(parsed, status) {
  const d = parsed?.detail;
  if (typeof d === 'string' && d.trim()) return d;
  // ⚠ THE DICT SHAPE, AND IT IS THE ONE THIS COMPOSER MEETS MOST OFTEN.
  //
  // `services/credits.CreditError` writes `detail` as
  // `{"error": code, "message": sentence, …numbers}` — the third FastAPI shape,
  // the one `lib/apiError.js` exists for. It is not a string and not an array,
  // so it fell through both branches and this returned `''`; the caller then
  // threw `status ${res.status}` and the thread read
  //
  //     Not delivered — status 402
  //
  // over a body that said, in full: "This needs 2 credits. Your organisation
  // has 0 (0 allowance + 0 purchased). Allowance resets on 1 September 2026.
  // Contact Aekam to top up." A bare status is the one thing a reader can do
  // nothing with, and the wallet is the most common reason an answer does not
  // arrive. Measured against the deployed service, proposal 93 Suite 14,
  // 2026-08-29.
  //
  // `message` only. The numbers beside it (`needed`, `org_total`,
  // `member_remaining`) are already inside the sentence the server composed,
  // and a screen that re-assembles them is a second opinion about a figure —
  // which is the drift this module has already paid for once on the credit
  // strip.
  if (d && typeof d === 'object' && !Array.isArray(d)
      && typeof d.message === 'string' && d.message.trim()) {
    return d.message.trim();
  }
  if (!Array.isArray(d) || !d.length) return '';
  // Both pydantic vintages: v2 types the rejection `string_too_long`, v1 wrote
  // "ensure this has at most 4000 characters" into `msg`.
  const tooLong = d.some(e => String(e?.type ?? '').includes('too_long')
    || /at most/i.test(String(e?.msg ?? '')));
  if (tooLong) {
    return `That question is longer than Sahayak takes — ${ASK_MAX_CHARS.toLocaleString('en-IN')} characters is the limit. Shorten it and ask again.`;
  }
  // Some other field of the body was refused. Naming WHICH would mean printing
  // `loc: ["body", "session_id"]` at a customer, and guessing "too long" for
  // every 422 would be a confident wrong sentence on the one rejection this
  // screen cannot cause — a question below `min_length`.
  return status === 422 ? 'Sahayak could not read that question.' : '';
}

/**
 * Where the stream lives, or `''` when there is nowhere to ask.
 *
 * `api` is the axios instance and `api.defaults.baseURL` is
 * `${VITE_BACKEND_URL}/api` — the one place this app knows the backend's
 * origin. `fetch` has to be told it, because `EventSource` cannot be used here
 * at all: it is GET-only and carries no `Authorization` header, and this route
 * is a POST behind `require_user`.
 *
 * With no baseURL there is nothing to fetch. A relative `/api/…` would go to
 * whatever origin served the SPA — Vercel — which answers an unknown path with
 * `index.html`: a 200 of HTML that is not a stream and never will be. So an
 * absent baseURL is not "try anyway", it is "there is no stream here".
 */
export function streamUrl() {
  const base = String(api?.defaults?.baseURL || '').replace(/\/+$/, '');
  return base ? `${base}${STREAM_PATH}` : '';
}

/**
 * The two headers `lib/api`'s request interceptor adds, which `fetch` does not
 * get for free. Same keys, read from the same places — a divergence here would
 * point the stream at a different tenant from every other call on the page.
 */
function streamHeaders() {
  const h = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  let token = null;
  try { token = window.localStorage.getItem('auth_token'); } catch { token = null; }
  if (token) h.Authorization = `Bearer ${token}`;
  const org = getActiveOrg();
  if (org) h['X-Org-Id'] = org;
  return h;
}

/**
 * An SSE buffer → the frames it completed, and the tail that is still partial.
 *
 * The caller keeps `rest` and feeds it back with the next chunk, so the buffer
 * never grows past one frame no matter how long the answer is.
 *
 * A frame ends at a BLANK LINE, and a chunk boundary falls wherever the network
 * put it — including between the `\r` and the `\n` of one CRLF. Line endings are
 * normalised before the split for exactly that reason: cutting there yields the
 * completed frame one byte early and a leading blank line on the next chunk,
 * which is skipped, rather than a frame that never closes. A `data:` field may
 * legally repeat, in which case the values join with a newline.
 */
export function parseFrames(buf) {
  const text = String(buf ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = text.split('\n\n');
  const rest = blocks.pop() ?? '';
  const frames = [];
  for (const block of blocks) {
    let event = '';
    const data = [];
    for (const line of block.split('\n')) {
      // A line starting with `:` is a comment — heartbeats arrive as `: ping`
      // and must not be mistaken for a nameless frame.
      if (!line || line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const field = i === -1 ? line : line.slice(0, i);
      let value = i === -1 ? '' : line.slice(i + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (!event && !data.length) continue;
    frames.push({ event, data: data.join('\n') });
  }
  return { frames, rest };
}

/**
 * Drive one streamed answer, and resolve with the `final` payload — which is
 * the body `POST /v1/hub/chat` returns today, so everything downstream of this
 * function is the code that already existed.
 *
 * ── The one distinction that matters ────────────────────────────────────────
 *
 * `err.noStream` means THE HANDLER NEVER RAN and the question may safely be
 * asked again on the non-streaming route. It is set for exactly four things:
 * no URL, no `fetch`, a 404/405/501 (this build has no such route) and a 401
 * (`require_user` refused ahead of it — see `NOTHING_RAN` for why that one is
 * re-asked at all). Nothing else qualifies, and the reason is a line of
 * `hub.py` rather than a preference: `sahayak_chat_stream` primes its generator
 * before returning a response, `credits.spend` runs inside that priming, and so
 * an org can be charged for an answer whose FIRST BYTE never left the server.
 * A network failure with nothing read is therefore not proof that nothing
 * happened — it is the case that quietly billed twice.
 *
 * `err.sent` marks that one: the request left, and what became of it is not
 * knowable from here. The caller says so rather than saying "not delivered".
 *
 * An `AbortError` is re-thrown untouched: a stop is the reader's decision, not
 * a reason to ask again somewhere else.
 */
export async function askStream({ url, body, signal, onHead, onOpen, onStep, onDelta }) {
  if (!url) throw cannotStart('no backend URL');
  if (typeof fetch !== 'function' || typeof TextDecoder !== 'function') {
    throw cannotStart('this browser cannot read a stream');
  }

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: streamHeaders(),
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    /**
     * THE REQUEST LEFT AND NOTHING CAME BACK, which is not the same as "the
     * request failed". The server may have read the org's ledger, called the
     * provider, charged for the answer and stored it, all before the head this
     * browser never received. This used to fall back, and that is the double
     * charge: same question, second debit, second conversation. It is reported
     * instead, and the sentence sends the reader to look before they re-ask.
     */
    throw shaped(
      'The connection dropped before Sahayak answered. It may still have run, '
      + 'so open your conversations before asking again — a second ask pays for '
      + 'a second answer.',
      0,
      { sent: true },
    );
  }

  if (!res.ok) {
    if (NOTHING_RAN.has(res.status)) throw cannotStart(`status ${res.status}`);
    // Shaped like an axios error on purpose: `errText` is the one place this
    // module turns a failure into a sentence, and it reads `response.data.detail`.
    let detail = '';
    try {
      const raw = await res.text();
      detail = detailOf(raw ? JSON.parse(raw) : null, res.status);
    } catch { detail = ''; }
    // No `sent`. A status with a body is the server ANSWERING this question —
    // 402 the wallet, 403 the gate, 422 the length — and every one of them is
    // raised before an answer exists. "Not delivered" is exactly true of them.
    throw shaped(detail || `status ${res.status}`, res.status);
  }

  /**
   * A 2xx that is not an event stream is a proxy holding — or rewriting — a
   * response the route DID produce: the status line is spent by then, the
   * answer was written, and `_sahayak_store_answer` has already run. So this is
   * a delivery failure, never a reason to ask again.
   */
  const ctype = String(res.headers?.get?.('content-type') || '');
  const undelivered = 'Sahayak answered, but not as a stream this browser could '
    + 'read. Open the conversation again before asking — a second ask pays for a '
    + 'second answer.';
  if (!ctype.includes('text/event-stream')) throw shaped(undelivered, 200, { sent: true });
  const reader = res.body?.getReader?.();
  if (!reader) throw shaped(undelivered, 200, { sent: true });

  /**
   * THE HEAD, WHICH IS WHERE THE MONEY IS DECIDED — and it is not the first
   * frame. `sahayak_chat_stream` returns its `StreamingResponse` only after
   * `__anext__` has run the pipeline through `credits.spend`, so a 200
   * `text/event-stream` arriving here is proof the org has been charged, even
   * if not one byte of answer ever follows. The caller needs that separately
   * from `onOpen`: someone who presses Stop two seconds in, before any frame,
   * has still paid for the answer.
   */
  onHead?.();

  const dec = new TextDecoder();
  let rest = '';
  let final = null;
  let opened = false;
  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { value, done } = await reader.read();
      if (done) break;
      const parsed = parseFrames(rest + dec.decode(value, { stream: true }));
      rest = parsed.rest;
      for (const f of parsed.frames) {
        if (!opened) { opened = true; onOpen?.(); }
        let payload = null;
        try { payload = f.data ? JSON.parse(f.data) : null; } catch { payload = null; }
        if (f.event === 'step') onStep?.(String(payload?.label ?? ''));
        else if (f.event === 'delta') onDelta?.(String(payload?.text ?? ''));
        else if (f.event === 'final') final = payload ?? {};
        else if (f.event === 'error') {
          // Shaped for `errText`, which reads `response.data.detail` first and
          // otherwise falls back on the status — and its 500 sentence ends
          // "Nothing was changed", which is exactly the wrong thing to say
          // about an answer that was half written. The detail is never left
          // undefined for that reason.
          throw shaped(String(payload?.detail || 'Sahayak stopped mid-answer.'), 500,
            { sent: true });
        }
      }
    }
  } finally {
    // Let go of the connection on every exit, including the thrown ones. A
    // reader left open holds a socket for the life of the tab.
    try { await reader.cancel(); } catch { /* already closed */ }
  }

  if (final) return final;
  /**
   * A stream that closed having produced NOTHING is still not a stream that
   * never started. The head was a 200 `text/event-stream`, which the route only
   * reaches once `__anext__` has returned — and `credits.spend` is inside that.
   * So the answer was paid for whether or not a frame followed, and re-asking
   * here was the same double charge by a quieter route.
   */
  if (!opened) {
    throw shaped(
      'Sahayak opened an answer and then sent nothing. Open the conversation '
      + 'again before asking — a second ask pays for a second answer.',
      500,
      { sent: true },
    );
  }
  throw shaped('The answer ended before it was finished.', 500, { sent: true });
}

/**
 * Text that is still being written, drawn the way the finished answer will be.
 *
 * This was a deliberately dumb blank-line split, on the argument that the
 * difference between the provisional draw and the final one ought to be
 * visible. What it made visible was `## Overdue invoices` and `**Total:**` —
 * the literal markers this whole change exists to stop printing — for the
 * entire duration of every answer, while the phone rendered the same bytes as a
 * heading and as bold text. One stream, two products.
 *
 * Neither half of it is written a second time. `blocksOf` is the split
 * `AnswerBody` gives a FINISHED reply, so the blocks do not jump when `final`
 * replaces them, and `Markdown` is the generated-text renderer the rest of this
 * product already draws model output with. The two constructs only
 * `AnswerBody`'s own grammar carries — tables and fenced code — stay literal
 * until `final`, which is also the first moment either of them is complete
 * enough to draw. (`.sr-md` brings its own body size, which Compact overrides
 * on `.sh__p` and cannot reach through a child, so provisional text is one step
 * larger in that view until the answer lands.)
 *
 * It is never handed the citable set. A `[3]` in provisional text may not
 * survive `strip_invalid_refs`, so a marker drawn as a link here would point at
 * a source the finished answer never cited.
 */
export function LiveText({ text }) {
  const blocks = blocksOf({ content: text });
  if (!blocks.length) return null;
  return blocks.map(b => (
    <div className="sh__p" key={b.key}><Markdown text={b.body} /></div>
  ));
}

/**
 * When a conversation was last touched, as a number, for ordering.
 *
 * `GET /clients/{id}/chat/sessions` already answers `ORDER BY s.updated_at DESC`
 * (hub_chat.py:224), so this changes nothing today. It exists because "newest
 * first" is a property of the RAIL that a reader can see is broken, and leaving
 * it to a router that could be paginated, cached or unioned later means the
 * screen has no opinion about its own ordering. An unparseable or absent
 * timestamp sorts last rather than throwing the whole list into random order.
 */
export function lastTouched(s) {
  const t = Date.parse(s?.updated_at || s?.created_at || '');
  return Number.isFinite(t) ? t : 0;
}

/** Newest first, without mutating what the resource hook is holding. */
export function newestFirst(rows) {
  return [...(rows || [])].sort((a, b) => lastTouched(b) - lastTouched(a));
}

/** `4 messages · today`. Relative, because the rail is scanned, not read. */
function railMeta(s) {
  const n = Number(s?.message_count);
  const count = Number.isFinite(n) ? `${n} message${n === 1 ? '' : 's'}` : null;
  const when = ago(s?.updated_at || s?.created_at);
  return [count, when].filter(Boolean).join(' · ');
}

function ago(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/** `.sh__me-l` — the time under the question. `created_at` is returned by
 *  `GET …/messages` and was being dropped; `POST …/send` does not return one,
 *  so a message sent in this session is stamped locally at the moment it left. */
export function atLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

/**
 * A stored message → what this screen renders.
 *
 * `sources` needs work in both directions: `GET …/messages` hands back the jsonb
 * column (which may arrive as a string — see sources.js), while `POST …/send`
 * returns a list built in Python. `model_used` and `model` are the same fact
 * under the two names the two endpoints use.
 */
function shape(m, i) {
  return {
    id: m.id ?? `m${i}`,
    role: m.role === 'user' ? 'user' : 'assistant',
    content: String(m.content ?? ''),
    sources: parseSources(m.sources),
    model: String(m.model_used ?? m.model ?? ''),
    credits: m.credits ?? m.credits_charged ?? null,
    at: atLabel(m.created_at ?? m.at ?? null),
    // `POST /v1/hub/chat` returns every one of these on every reply — see
    // `hub._sahayak_payload`, where nothing is conditional because an absent key
    // and an empty one are different bugs on screen and this function cannot
    // tell them apart. `GET …/messages` returns none of them until migration 119
    // adds `hub_chat_messages.answer`, so a RELOADED conversation still renders
    // the prose and drops the structure — which is why each falls back to null
    // rather than to an empty array that would read as "the server said none".
    sections: Array.isArray(m.sections) ? m.sections : null,
    work: Array.isArray(m.work) ? m.work : null,
    figs: Array.isArray(m.figs) ? m.figs : null,
    refusal: m.refusal ?? null,
    refusalDetail: m.refusal_detail ?? null,
    // The rows the answer was computed from, and the source keys the planner
    // decided to read. `evidence` is null when no source returned rows, which is
    // the ordinary case for a question that needed no ledger at all.
    evidence: m.evidence ?? null,
    read: Array.isArray(m.read) ? m.read : null,
    answered: m.answered !== undefined ? Boolean(m.answered) : null,
    // Why it stopped, in one sentence, when there is a reason worth printing.
    // A reader who pressed Stop knows why; a stream that died does not.
    stopNote: String(m.stopNote ?? ''),
    // WHAT ENDED IT, as the heading over the fragment. One heading — "Stopped"
    // — was drawn over all three causes, so a provider that died mid-answer and
    // a watchdog that dropped a silent connection both told the reader they had
    // cancelled something they had not touched.
    stopTitle: String(m.stopTitle ?? STOPPED),
    // Whether the org was charged for the fragment above. KNOWN, not guessed:
    // the server writes its first frame only after `credits.spend` returns, so
    // one frame of any kind settles it. False therefore means "not established"
    // as well as "no", and nothing is claimed either way when it is false.
    charged: m.charged === true,
    // A fragment the reader stopped, kept where it happened. It is NOT an
    // answer: it goes nowhere near `AnswerBody`, carries no verdict and can
    // never be `cited`, because there is no stored message behind it. Only this
    // screen ever sets it — nothing on the wire does.
    stopped: m.stopped === true,
  };
}

/**
 * A flat message list → the prototype's `.sh__turn` pairs.
 *
 * The API stores questions and answers as siblings; the prototype wraps each
 * question with the reply it produced, which is what the 22px gap between turns
 * and the 10px gap inside one are measuring. An assistant message with no
 * question before it — the first message of an imported thread — still gets a
 * turn of its own rather than being dropped.
 */
export function toTurns(messages) {
  const turns = [];
  for (const m of messages) {
    const last = turns[turns.length - 1];
    if (m.role === 'user' || !last) {
      turns.push({ key: m.id, q: m.role === 'user' ? m : null, answers: [] });
      if (m.role === 'assistant') turns[turns.length - 1].answers.push(m);
    } else {
      last.answers.push(m);
    }
  }
  return turns;
}

export default function SahayakTab({ onSpent }) {
  // F32 — the module is read from the route, never named here. Asking a
  // question spends credits and writes two rows, so it is a write.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'ask Sahayak' });
  const { pushToast } = useToast();

  // The org's own internal client. Everything below waits on it.
  const boot = useResource('/v1/hub/org-client', []);
  const clientId = boot.data?.client?.id || null;

  const sessions = useList(
    clientId ? `/v1/hub/clients/${clientId}/chat/sessions` : null,
    [clientId],
  );

  const [active, setActive] = useState(null);
  const [thread, setThread] = useState({ loading: false, error: '', messages: [] });
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  /**
   * WHETHER THERE IS ANYTHING TO STOP, which is not the same as "is a request
   * open". True only while the STREAMED attempt is live.
   *
   * On the plain `POST /chat` fallback an abort closes this browser's socket
   * and nothing else: uvicorn does not cancel a non-streaming handler when the
   * client disconnects, so `_sahayak_answer` runs to `_sahayak_store_answer`
   * and the finished answer is charged for and stored — while the screen would
   * be drawing "Nothing had arrived when this stopped" over it, and the reader
   * would find the whole answer sitting there on the next visit. Mobile has
   * never offered a Stop on that path (`SahayakScreen`, `ask.isPending &&
   * streaming`); this is the same rule on this side.
   */
  const [stoppable, setStoppable] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  // Which answer the panel is showing, and which source inside it an inline
  // marker asked for. Null `msg` means "whichever answer last cited something",
  // which is what the prototype's permanent panel shows.
  const [panel, setPanel] = useState({ msg: null, hot: null });

  /**
   * THE FOUR THINGS THE SHELL REMEMBERS, read ONCE at mount.
   *
   * `useState(fn)` rather than `useState(readShell())`: the second form calls
   * localStorage on every render and throws the result away, and on a surface
   * that re-renders per keystroke in the composer that is a synchronous storage
   * read per character. The lazy initialiser runs once.
   *
   * The stored record is also kept in a ref, because the session to reopen is
   * needed later — after the session list has arrived — and by then `stored`
   * would have been overwritten by this screen's own writes.
   */
  const [shell] = useState(readShell);
  const wantSession = useRef(sessionOf(shell));
  const [railOpen, setRailOpen] = useState(() => railDefault(shell));
  const [view, setView] = useState(() => viewOf(shell));
  const [evidenceOpen, setEvidenceOpen] = useState(() => evidenceOf(shell));
  // The mobile sources sheet is NOT remembered. A sheet is a momentary answer to
  // "where did this come from"; restoring one over the thread on the next visit
  // would be a modal nobody opened.
  const [sheetOpen, setSheetOpen] = useState(false);
  /**
   * messageId → what the FEEDBACK LEDGER holds for that answer, and nothing
   * else: `{ verdict, note, error, busy }`.
   *
   * `verdict` and `note` are written only once the endpoint answered 201, so
   * every one of them is a claim about a row that exists. `error` is the last
   * refusal, kept per answer rather than shown once in a toast and lost —
   * "recorded" and "not recorded" are the two states this control must never
   * confuse, and only one of them survives four seconds in a toast.
   */
  const [fb, setFb] = useState({});
  /** The one answer whose "what was wrong with it?" is open. One at a time. */
  const [asking, setAsking] = useState(null);

  /**
   * WHAT IS ARRIVING RIGHT NOW — the named steps the server has reported and the
   * answer text so far. Null between questions.
   *
   * It is deliberately NOT a message. Rule 1 in the header: the deltas are
   * provisional until `final` validates the citations against the complete
   * text, so they live in the pending turn and are thrown away when `final`
   * replaces them. Anything that put them in `thread.messages` would be storing
   * a half-answer as if it were one.
   */
  const [live, setLive] = useState(null);
  /** Which answer was just copied. One at a time, cleared by a timer. */
  const [copied, setCopied] = useState(null);
  /**
   * The polite live region, changed ONLY at phase boundaries — asked, ready,
   * stopped. A region driven by the delta text would announce every token, and
   * a screen reader given a hundred interruptions announces nothing.
   */
  const [announce, setAnnounce] = useState('');

  const scrollRef = useRef(null);
  const autoOpened = useRef(false);
  /** The answer in flight, and why it was aborted if it was. */
  const askRef = useRef(null);
  const stopKind = useRef(null);
  /** The no-progress watchdog, and the "Copied" reset. */
  const idleRef = useRef(null);
  const copyTimer = useRef(null);
  /** The two controls that trade places while an answer is in flight. */
  const boxRef = useRef(null);
  const stopBtnRef = useRef(null);
  const hasSent = useRef(false);

  /**
   * EVERY WRITE IS A DELIBERATE ACT, and none of them is an effect.
   *
   * The obvious shape — `useEffect(() => writeShell({rail}), [rail])` — is wrong
   * in a way that only shows up on the second device. It runs on MOUNT as well,
   * so the viewport-derived default (`railDefault`) would be stored as though
   * the reader had chosen it: open Sahayak once on a laptop and the rail would
   * be pinned closed for ever on the 27-inch monitor, because a phone-shaped
   * first visit wrote `rail: false`. A default that records itself stops being a
   * default. So the store is only ever touched from a handler.
   */
  const chooseRail = useCallback((next) => {
    setRailOpen(next);
    writeShell({ rail: next });
  }, []);
  const chooseView = useCallback((next) => {
    setView(next);
    writeShell({ view: next });
  }, []);
  const chooseEvidence = useCallback((next) => {
    setEvidenceOpen(next);
    writeShell({ evidence: next });
  }, []);
  /** Which conversation is open, and the note of it that survives the tab.
   *  `null` on delete, so the next visit does not ask for a row that is gone. */
  const goSession = useCallback((id) => {
    setActive(id);
    writeShell({ session: id || null });
  }, []);

  /**
   * Escape closes the rail. Below 1280px it is an overlay with a scrim, and the
   * scrim is `aria-hidden` with `tabIndex={-1}` — correct, since it is
   * decorative — but that left pointer input as the only way out. Above it the
   * rail is a track and the scrim never paints, so `.sh__rail-x` and this are
   * the two ways to close it.
   */
  useEffect(() => {
    if (!railOpen && !sheetOpen) return undefined;
    function onKey(e) {
      if (e.key !== 'Escape') return;
      // The sheet is the thing on top when both are open, so it goes first.
      if (sheetOpen) setSheetOpen(false);
      else chooseRail(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [railOpen, sheetOpen, chooseRail]);

  /**
   * Follow the conversation. Without this the newest reply lands below the fold
   * on any thread longer than the panel.
   *
   * The scroll CONTAINER is moved, not `endRef.scrollIntoView()`. `scrollIntoView`
   * scrolls every scrollable ancestor, and this panel is not the page — it sits
   * under a module header, a credit strip and a tab bar, all of which scroll.
   * Asking a sentinel to come into view therefore drags the whole document down
   * to the composer on every single reply.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.messages, sending, live?.text, live?.steps?.length]);

  /**
   * NOTHING OUTLIVES THE TAB. An open reader holds a socket, and both timers
   * call `setState` on a tree that is no longer mounted. The abort also ends the
   * request itself, which is the only correct thing to do with an answer whose
   * reader has navigated away.
   */
  useEffect(() => () => {
    try { askRef.current?.abort(); } catch { /* already closed */ }
    clearTimeout(idleRef.current);
    clearTimeout(copyTimer.current);
  }, []);

  /**
   * FOCUS SURVIVES THE SWAP, or there is no keyboard route to Stop at all.
   *
   * Asking disables the textarea and puts Stop where Ask was, so whichever of
   * the two held focus is inert or unmounted a tick later and the browser drops
   * focus to `body` — from which Tab restarts at the top of the document, past
   * the whole page, nowhere near the control that ends the answer. The same
   * thing happens in reverse when the answer lands and Stop disappears.
   *
   * Only focus THIS PAGE TOOK AWAY is moved: if the reader has clicked into the
   * rail or the sources panel meanwhile, they are left where they are. And
   * nothing is focused on first paint — a tab that grabs the caret as it opens
   * is a tab that scrolls the page out from under whoever opened it.
   *
   * There is one window this cannot cover: the non-streaming fallback, where
   * `stoppable` goes false and Stop unmounts mid-send. Nothing in the footer is
   * focusable then — the box is disabled and Ask is disabled — and inventing a
   * live control for a request that cannot be stopped is the exact lie
   * `stoppable` exists to remove. The answer lands and the box takes focus back.
   */
  useEffect(() => {
    if (sending) hasSent.current = true;
    else if (!hasSent.current) return;
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if (active && active !== document.body && active !== boxRef.current) return;
    const el = sending ? stopBtnRef.current : boxRef.current;
    try { el?.focus?.(); } catch { /* not focusable in this environment */ }
  }, [sending]);

  /**
   * Restart the no-progress watchdog.
   *
   * Anything that arrives is progress — the response head, a step, a token — so
   * a long answer that is still writing is never cut off. Silence for
   * `ASK_TIMEOUT_MS` is not progress, and that is the case this exists for: a
   * stream that opened and then stopped producing looks identical to one that
   * is thinking, for ever.
   *
   * It stays armed across the fallback, so the whole attempt — stream then
   * `POST /chat` — shares one budget rather than being able to spend two.
   * Axios's own `timeout` covers the same ground from the other side; whichever
   * fires first, the outcome is the one sentence below.
   */
  const beat = useCallback(() => {
    clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => {
      stopKind.current = 'timeout';
      try { askRef.current?.abort(); } catch { /* already closed */ }
    }, ASK_TIMEOUT_MS);
  }, []);

  /**
   * Stop the answer in flight.
   *
   * This is a DISCONNECT. The provider was called before the first token and
   * the server's debit is the server's own — the credit row and the
   * `hub_ai_logs` row happen once per answer whether or not anybody is still
   * reading — so nothing here claims the question was undone or refunded. What
   * it does guarantee is that the fragment on screen is never dressed up as an
   * answer.
   */
  const stop = useCallback(() => {
    if (!askRef.current) return;
    stopKind.current = 'user';
    clearTimeout(idleRef.current);
    try { askRef.current.abort(); } catch { /* already closed */ }
  }, []);

  /**
   * An answer on the clipboard.
   *
   * The plain text of the reply, which is what someone pasting into an email or
   * a filing note wants — not the markup this screen drew around it. The state
   * change is on the control itself (`Copy` → `Copied`) rather than in a toast,
   * because a toast four seconds later does not answer "did that work".
   */
  const copyAnswer = useCallback(async (m) => {
    const body = String(m?.content ?? '');
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(m.id);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 2400);
    } catch {
      // A permissions policy, an insecure origin, or Firefox on a non-user
      // gesture. There is nothing to retry and nothing to fix from here.
      pushToast({ title: 'The browser would not give Sahayak the clipboard.', type: 'error' });
    }
  }, [pushToast]);

  const openSession = useCallback(async (id) => {
    goSession(id);
    setPanel({ msg: null, hot: null });
    setThread({ loading: true, error: '', messages: [] });
    try {
      const r = await api.get(`/v1/hub/chat/sessions/${id}/messages`);
      setThread({ loading: false, error: '', messages: (r.data?.data || []).map(shape) });
    } catch (err) {
      setThread({
        loading: false,
        error: errText(err, 'Could not load this conversation.'),
        messages: [],
      });
    }
  }, [goSession]);

  /** The rail's own order, and the order everything else here reads. */
  const chats = useMemo(() => newestFirst(sessions.items), [sessions.items]);

  /**
   * IT HOLDS THE PREVIOUS CONVERSATION RATHER THAN STARTING COLD.
   *
   * THE ONE THAT WAS BEING READ, not merely the newest. Reopening the head of
   * the list is right for a first visit and wrong for a reload: someone who
   * scrolled the rail back to a thread from last week, refreshed, and landed in
   * a different conversation has been told the rail does not hold. So the stored
   * id wins WHEN IT IS STILL IN THE LIST — a conversation deleted from another
   * tab must not leave this one requesting a 404 forever — and the newest is the
   * fallback, which is what a first visit gets.
   *
   * Once only, and only while nothing else is open.
   */
  useEffect(() => {
    if (autoOpened.current || active) return;
    if (!chats.length) return;
    const want = wantSession.current;
    const held = want ? chats.find(c => String(c.id) === want) : null;
    const pick = held || chats[0];
    if (!pick?.id) return;
    autoOpened.current = true;
    openSession(pick.id);
  }, [chats, active, openSession]);

  async function createSession() {
    const r = await api.post(`/v1/hub/clients/${clientId}/chat/sessions`, {
      title: 'New chat',
      session_type: 'internal',
    });
    sessions.reload();
    return r.data?.id || null;
  }

  async function newChat() {
    try {
      const id = await createSession();
      autoOpened.current = true;
      chooseRail(false);
      if (id) openSession(id);
    } catch (err) {
      pushToast({ title: errText(err, 'Could not start a conversation.'), type: 'error' });
    }
  }

  /**
   * Send, and let the ANSWER route open the conversation.
   *
   * ── Which endpoint, and why it changed ──────────────────────────────────────
   *
   * This posted to `POST /v1/hub/chat/sessions/{id}/send`, which returns
   * `{message, sources, model, cost_usd, credits_charged}` and nothing else. So
   * `AnswerBody` read `message.refusal`, `message.work` and `message.figs` from
   * a response that has never carried any of them, and `SourcesPanel` had no
   * evidence to draw — the refusal block, the work steps, the figures and the
   * `.sh-ev` table existed in markup and in CSS and rendered on no screen.
   *
   * `POST /v1/hub/chat` is the route that carries them (`hub._sahayak_payload`).
   * It also refuses BEFORE it reads and before it charges, which is the whole
   * point of the block: a caller who may not see Finance gets the refusal rather
   * than an answer written around the hole.
   *
   * ── And why `createSession` is no longer called first ───────────────────────
   *
   * The answer route opens the conversation itself and returns `session_id`,
   * and it does that AFTER deciding whether the caller may have the answer — so
   * a refused question leaves no empty conversation behind. Creating it here
   * first would put that row back and undo the tenancy fix on the server.
   * `newChat()` still uses `createSession`; an explicitly requested empty
   * conversation is a different thing from one manufactured by a refusal.
   *
   * ── Two routes, one of which is the other's fallback ────────────────────────
   *
   * `POST /v1/hub/chat/stream` first, `POST /v1/hub/chat` when it cannot start.
   * They take the same body and answer the same thing; the stream answers it in
   * pieces. See rules 1–4 at the top of this file for what is provisional, when
   * the fallback is allowed, what a stop means, and when the composer empties.
   */
  async function send(text, opts = {}) {
    const body = String(text ?? '').trim();
    if (!body || sending || !clientId || !canWrite) return;

    const sid = active;
    /**
     * WHETHER THIS CAME OUT OF THE COMPOSER, and therefore whether emptying it
     * is this send's business at all. A seed and a retry both put text on the
     * wire without the box holding any, and clearing it for them would delete
     * something nobody sent.
     */
    const fromBox = opts.fromBox === true;
    /**
     * Whether a stream is possible AT ALL, decided before anything is sent so
     * that Stop never flashes into the footer on a build that was always going
     * to use `POST /chat` — the same three conditions `askStream` opens with,
     * read here because the footer has to be right on the first paint.
     */
    const url = streamUrl();
    const canStream = !!url
      && typeof fetch === 'function' && typeof TextDecoder === 'function';
    const ctl = new AbortController();
    askRef.current = ctl;
    stopKind.current = null;
    setSending(true);
    setStoppable(canStream);
    setLive({ steps: [], text: '' });
    setAnnounce('Sahayak is working on your answer.');

    // The bubble goes in BEFORE the request, not after: if the post rejects
    // there has to be something on screen to mark, or the failure lands
    // nowhere. Optimistic first means every failure from here on has somewhere
    // to go.
    const localId = `local-${Date.now()}`;
    setThread(t => ({
      ...t,
      messages: [
        ...t.messages,
        shape({ id: localId, role: 'user', content: body, created_at: new Date().toISOString() }, 0),
      ],
    }));

    /**
     * Mark the question that did not get through, in place.
     *
     * `lead` is the two words above the sentence, and it is a parameter because
     * one of them is a claim this screen cannot always make. "Not delivered" is
     * true of a 402 and of a route that does not exist; it is a guess about a
     * connection that dropped after the request left, where the server may have
     * answered, charged and stored — so that case says so instead.
     */
    const markFailed = (why, lead = 'Not delivered') => setThread(t => ({
      ...t,
      messages: t.messages.map(m => (m.id === localId ? { ...m, failed: why, failLead: lead } : m)),
    }));

    /**
     * THE ACCUMULATION LIVES HERE, not in state. The catch below needs the text
     * that had arrived when a stop landed, and reading `live` from this closure
     * would give the value from the render that STARTED the send — empty, every
     * time, so a stopped answer would always look as though nothing came.
     */
    const steps = [];
    let acc = '';
    /**
     * Whether the stream's HEAD came back, which is the only thing on this
     * screen that knows the org has been charged. See `onHead`.
     */
    let headArrived = false;

    // `session_id` when there is one, `client_id` when there is not: both routes
    // scope the knowledge base to the workspace they verify, and naming the
    // session is what proves the caller owns it.
    const payload = { message: body, ...(sid ? { session_id: sid } : { client_id: clientId }) };

    /** The server has the question. Only now may the box be emptied. */
    const accept = () => { if (fromBox) setInput(''); };

    /** Keep what arrived, as the fragment it is — never as an answer. */
    const keepPartial = (title, note, charged) => setThread(t => ({
      ...t,
      messages: [...t.messages, shape({
        id: `stopped-${Date.now()}`,
        role: 'assistant',
        content: acc,
        created_at: new Date().toISOString(),
        stopped: true,
        stopTitle: title,
        stopNote: note,
        charged,
      }, 0)],
    }));

    try {
      let reply;
      try {
        beat();
        reply = await askStream({
          url,
          body: payload,
          signal: ctl.signal,
          onHead: () => { headArrived = true; beat(); },
          onOpen: () => { beat(); accept(); },
          onStep: (label) => {
            beat();
            if (!label) return;
            steps.push(label);
            setLive({ steps: [...steps], text: acc });
          },
          onDelta: (chunk) => {
            beat();
            if (!chunk) return;
            acc += chunk;
            setLive({ steps: [...steps], text: acc });
          },
        });
      } catch (err) {
        // Rule 2. Only a request the handler never saw may be asked again —
        // anything else has already been answered, charged, and possibly read.
        if (!err?.noStream) throw err;
        // And from here there is nothing left to stop: see `stoppable`.
        setStoppable(false);
        const r = await api.post('/v1/hub/chat', payload, {
          // The timeout this route never had. Without it a connection the
          // backend accepts and never answers holds the composer for ever.
          timeout: ASK_TIMEOUT_MS,
          signal: ctl.signal,
        });
        reply = r.data || {};
        accept();
      } finally {
        clearTimeout(idleRef.current);
      }

      // The conversation the server opened, adopted so the next question lands
      // in the same thread and the rail can show it.
      const opened = reply.session_id ? String(reply.session_id) : null;
      if (!sid && opened) {
        goSession(opened);
        autoOpened.current = true;
      }

      setThread(t => ({
        ...t,
        messages: [...t.messages, shape({
          ...reply,
          id: reply.message_id ? String(reply.message_id) : `reply-${Date.now()}`,
          role: 'assistant',
          /**
           * `final` REPLACES the deltas; `acc` is discarded unread. The server
           * validates citations against the COMPLETE text (`strip_invalid_refs`)
           * and cannot do it a token at a time, so the streamed copy may carry
           * `[n]` markers the finished answer does not. `message` is the key
           * `POST /v1/hub/chat` uses and `answer` is the name the stream
           * contract gives the same field; either is the whole answer, and
           * neither is ever concatenated with what streamed.
           */
          content: reply.message ?? reply.answer,
          created_at: new Date().toISOString(),
        }, 0)],
      }));
      setAnnounce('Answer ready.');
      sessions.reload();
      // The answer was charged as `channel/chatbot_message` in the same
      // transaction that stored the question, so the credit strip at the top of
      // the page is stale from this moment unless it is asked again. Called only
      // where something was actually SPENT: a refusal is a 200 carrying
      // `credits: 0`, and re-fetching for it would flicker the balance for no
      // change. A send that threw was refunded server-side or never charged.
      if (Number(reply.credits ?? reply.credits_charged) > 0) onSpent?.();
    } catch (err) {
      /**
       * WHETHER ANYTHING REACHED THE SERVER DECIDES WHICH FAILURE THIS IS.
       *
       * With nothing having come back, the question itself is what failed and
       * the bubble carries the reason — a toast alone is gone in four seconds
       * and leaves a bubble that looks delivered, and a 402 here is the sentence
       * that says the wallet is empty.
       *
       * But once the server has answered anything at all, "Not delivered" is a
       * false statement: it WAS delivered, and worked on as far as it got. So
       * that case keeps the fragment and says what it is instead of blaming the
       * send.
       */
      const stopped = stopKind.current === 'user';
      /**
       * WHAT IT COST IS KNOWN THE MOMENT THE HEAD COMES BACK, and not before.
       * `sahayak_chat_stream` hands FastAPI a response only after `__anext__`
       * has carried the pipeline through `credits.spend` (hub.py step 5), so a
       * `text/event-stream` head is proof of the debit even when no frame ever
       * follows it — and `ai_router._record_abandoned` is the decision not to
       * give it back when the reader walks out. Nothing here estimates:
       * `charged` is false when the answer is "not established", and the
       * fragment then says nothing about money at all.
       */
      const charged = headArrived;
      /**
       * THREE CAUSES, TWO HEADINGS, AND NEITHER OF THEM BLAMES THE READER FOR
       * SOMETHING THEY DID NOT DO. See `STOPPED` / `INTERRUPTED`.
       */
      const title = stopped ? STOPPED : INTERRUPTED;
      const note = stopped
        ? ''
        : stopKind.current === 'timeout'
          ? 'Sahayak went quiet, so the request was dropped.'
          : errText(err, 'Sahayak did not answer.');
      /**
       * A CHARGED QUESTION WAS DELIVERED, whether or not a frame followed. The
       * head only comes back once the route has run the ledger reads and the
       * spend, so "Not delivered" is a false statement about every one of these
       * — and a frame arriving implies the head arrived, which is why one test
       * covers both. What is kept is a fragment; only a send that never reached
       * anything is marked against the question itself.
       */
      if (stopped || charged) keepPartial(title, note, charged);
      // `err.sent` is the request that left with nothing coming back. The lead
      // says what is actually known — the alternative, "Not delivered", is a
      // statement about the server that this browser is in no position to make.
      else markFailed(note, err?.sent ? 'Sent, but no answer came back' : 'Not delivered');
      /**
       * THE STRIP ABOVE THIS TAB IS STALE ON EVERY ONE OF THESE PATHS, exactly
       * as it is on the success path — the debit is the server's and it is not
       * refunded. It was only ever re-read after an answer that finished, so a
       * reader who pressed Stop watched the same balance sit there while the
       * wallet had already moved. `err.sent` gets the same re-read for the
       * opposite reason: nobody here knows whether it was charged, and a fresh
       * read is the only thing that does.
       */
      if (charged || err?.sent) {
        onSpent?.();
        // And the conversation the server may have opened for a question this
        // browser never saw the answer to — the rail is how the reader finds it.
        sessions.reload();
      }
      setAnnounce(stopped ? 'Answer stopped.' : '');
    } finally {
      setSending(false);
      setStoppable(false);
      setLive(null);
      askRef.current = null;
    }
  }

  /**
   * Ask the same question again.
   *
   * It appends a NEW turn rather than replacing the answer above it, because
   * there is no regenerate endpoint and there should not be one: every ask is
   * stored, so a reply that vanished from this screen would still be in
   * `hub_chat_messages` and would come back on the next reload. What the reader
   * sees is what the conversation holds.
   *
   * Offered on the LAST turn only. The new answer arrives at the bottom, so a
   * button on an older turn would produce a reply nowhere near the question it
   * was pressed beside.
   */
  function askAgain(question) {
    send(question);
  }

  /**
   * A question that never reached the server, sent again in its own place.
   *
   * This one DOES remove the bubble it retries: a failed send stored nothing, so
   * the failure exists only on this screen, and leaving it behind would show a
   * record the conversation does not contain.
   */
  function retryFailed(q) {
    setThread(t => ({ ...t, messages: t.messages.filter(m => m.id !== q.id) }));
    send(q.content);
  }

  async function removeSession(id) {
    try {
      await api.delete(`/v1/hub/chat/sessions/${id}`);
      setConfirmDel(null);
      if (active === id) {
        goSession(null);
        setThread({ loading: false, error: '', messages: [] });
        setPanel({ msg: null, hot: null });
      }
      sessions.reload();
      pushToast({ title: 'Conversation deleted', type: 'success' });
    } catch (err) {
      pushToast({ title: errText(err, 'Could not delete it.'), type: 'error' });
    }
  }

  const onCite = useCallback((msgId, ref) => setPanel({ msg: msgId, hot: ref }), []);

  /**
   * A verdict on one answer.
   *
   * The state is written AFTER the 201, never before. An optimistic thumb here
   * would be a claim about what the server holds, and the endpoint has four ways
   * to refuse — a 400 with no id, a 404 on another tenant's message, a 403 from
   * the module gate and a 500 — so an optimistic fill would be wrong often
   * enough to matter. A refusal leaves the thumb unpressed AND leaves the
   * sentence saying so in the row, because that is where the reader is looking.
   *
   * Pressing the same thumb twice is a no-op rather than a second row. Changing
   * one's mind posts again, which is correct: `hub_skill_feedback` is an
   * append-only log and the later row is the later opinion.
   *
   * A thumbs-down opens the one question. It opens it AFTER the 201, not on the
   * click, so nobody is ever asked why an answer was wrong by a screen that has
   * not managed to record that it was wrong.
   */
  const rate = useCallback(async (messageId, verdict) => {
    if (!isServerAnswer(messageId)) return;
    const held = fb[messageId];
    if (held?.busy) return;
    if (held?.verdict === verdict && !held?.error) {
      // Not a second row — but a down thumb that was already recorded is the
      // obvious place to press when you have decided to say why after all.
      if (verdict === 'down' && !held.note) setAsking(messageId);
      return;
    }
    setFb(f => ({ ...f, [messageId]: { ...(f[messageId] || {}), busy: true, error: '' } }));
    try {
      await api.post(FEEDBACK_PATH, feedbackBody(messageId, verdict));
      setFb(f => ({ ...f, [messageId]: { verdict, note: '', error: '', busy: false } }));
      setAsking(verdict === 'down' ? messageId : null);
    } catch (err) {
      const why = errText(err, 'The server refused it.');
      setFb(f => ({ ...f, [messageId]: { ...(f[messageId] || {}), busy: false, error: why } }));
      pushToast({ title: `Not recorded — ${why}`, type: 'error' });
    }
  }, [fb, pushToast]);

  /**
   * WHY it was wrong — the whole point of the exercise.
   *
   * A second row against the same `message_id`, carrying the same
   * `accepted: false` and the reason in `note`. There is no PATCH on an
   * append-only table and the verdict is already on the server by the time this
   * runs, so the alternatives were a second row or no reason at all; see the
   * header of `assistant/feedback.js` for how the table is read back.
   *
   * A refusal here keeps the question open with the words still in it. Losing
   * what somebody typed is the worst thing this screen can do to them, and it
   * is no less true of a complaint than of a question.
   */
  const explain = useCallback(async (messageId, note) => {
    if (!isServerAnswer(messageId) || !String(note || '').trim()) return;
    if (fb[messageId]?.busy) return;
    setFb(f => ({ ...f, [messageId]: { ...(f[messageId] || {}), busy: true, error: '' } }));
    try {
      await api.post(FEEDBACK_PATH, feedbackBody(messageId, 'down', note));
      setFb(f => ({
        ...f,
        [messageId]: { ...(f[messageId] || {}), verdict: 'down', note, error: '', busy: false },
      }));
      setAsking(null);
    } catch (err) {
      const why = errText(err, 'The server refused it.');
      setFb(f => ({ ...f, [messageId]: { ...(f[messageId] || {}), busy: false, error: why } }));
      pushToast({ title: `Not recorded — ${why}`, type: 'error' });
    }
  }, [fb, pushToast]);

  /**
   * Which answer the permanent panel is showing.
   *
   * With no marker clicked it is the most recent reply that cited anything —
   * the panel is a property of the conversation's current state, not something
   * the reader opened. A `panel.msg` pointing at a message that is no longer in
   * the thread (a session was switched under it) falls back rather than emptying
   * the column.
   *
   * An answer with EVIDENCE and no cited sources counts. The evidence table is
   * the rows the figures were computed from, which is the strongest thing this
   * panel can show; requiring a `[n]` marker alongside it would leave the column
   * closed on exactly the questions the ledger answered.
   */
  const cited = useMemo(() => {
    const withSrc = thread.messages.filter(
      m => m.role === 'assistant' && (m.sources.length > 0 || m.evidence),
    );
    const picked = panel.msg ? withSrc.find(m => m.id === panel.msg) : null;
    return picked || withSrc[withSrc.length - 1] || null;
  }, [thread.messages, panel.msg]);

  const hot = cited && panel.msg === cited.id ? panel.hot : null;

  /**
   * The split-evidence switch, from the answer it belongs to.
   *
   * It does two things at once and both are wanted: it points the panel at THIS
   * answer, and it opens the pane. Only the pair is coherent — a switch that
   * opened the pane on somebody else's rows would be worse than no switch. So
   * pressing it on an answer the panel is not currently showing always OPENS,
   * and only pressing it on the one already showing closes.
   */
  const toggleEvidence = useCallback((msgId) => {
    const showing = cited?.id === msgId && evidenceOpen;
    setPanel({ msg: msgId, hot: null });
    chooseEvidence(!showing);
  }, [cited, evidenceOpen, chooseEvidence]);

  // The welcome screen is the empty state of the CONVERSATION, not of the
  // module: a person with twelve past chats still sees it on a new one.
  const empty = !thread.loading && !thread.error && thread.messages.length === 0;

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input, { fromBox: true });
    }
  }

  if (boot.loading) return <BrandLoader label="Opening Sahayak" size={120} />;
  if (boot.error) {
    return <ErrorNote what="Sahayak" error={boot.error} onRetry={boot.reload} />;
  }
  if (!clientId) {
    return (
      <div className="note note--warn" role="status">
        <b>Sahayak has no workspace to answer from yet.</b>{' '}
        The server did not return this organisation&rsquo;s workspace, so there is
        nothing to hold a conversation against. Try again, or ask an org admin to
        open Sahayak once.
      </div>
    );
  }

  const turns = toTurns(thread.messages);
  const sessionCount = chats.length;
  /** Only the last turn may be asked again — see `askAgain` for why. */
  const lastTurn = turns.length ? turns[turns.length - 1].key : null;
  // The sheet is a mobile presentation of the sources panel, so it cannot be
  // open when there is no panel — `.sh--wide` is the layout with nothing to
  // show, and a sheet holding an empty column is a bug that looks like a design.
  const sheet = sheetOpen && !!cited;

  return (
    <div className={
      `sh${cited ? '' : ' sh--wide'}${railOpen ? ' sh--rail' : ''}`
      + `${view === COMPACT ? ' sh--compact' : ''}${sheet ? ' sh--sheet' : ''}`
    }>
      <div className="sh__main">
        <div className="sh__thread" ref={scrollRef}>
          {thread.loading && <BrandLoader label="Loading this conversation" size={90} />}

          {thread.error && (
            <div className="sh__wrap">
              <ErrorNote
                what="This conversation"
                error={thread.error}
                onRetry={() => openSession(active)}
              />
            </div>
          )}

          {empty && (
            <div className="sh__hero">
              {/* The lotus, at rest. Same component as the thinking state, so the
                  waiting state and the brand are one thing. 29 §6: 104px here. */}
              <div className="sh__hero-mark"><BrandLoader label="Sahayak" size={104} /></div>
              <Secondary className="sh__hero-hi" as="p" value="सहायक" />
              <h1 className="sh__hero-t">Ask about your own books.</h1>
              <p className="sh__hero-d">
                Sahayak reads what is already in Kartavaya — invoices, tasks,
                attendance, messages, files — and answers with the records it
                used. It will not answer from general knowledge, and it will not
                answer at all where the data does not support one.
              </p>
              <div className="sh__seeds">
                {OPENERS.map(o => (
                  <button
                    type="button"
                    className={`sh__seed${o.dev ? ' sh__seed--dev' : ''}`}
                    key={o.q}
                    onClick={() => send(o.q)}
                    disabled={!canWrite || sending}
                    title={denial || undefined}
                  >
                    <Secondary as="b" value={o.q} />
                    <span>{o.s}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.length > 0 && (
            <div className="sh__wrap">
              {turns.map(t => (
                <div className="sh__turn" key={t.key}>
                  {t.q && (
                    <>
                      <div className={`sh__you${t.q.failed ? ' sh__you--failed' : ''}`}>
                        {t.q.content}
                      </div>
                      {t.q.failed
                        ? (
                          <span className="sh__fail" role="status">
                            {t.q.failLead || 'Not delivered'} — {t.q.failed}{' '}
                            {/* The question is still here because nothing on the
                                server ever took it. One press sends the same
                                text again and takes this bubble away with it. */}
                            <button
                              type="button"
                              className="sh__act"
                              onClick={() => retryFailed(t.q)}
                              disabled={sending || !canWrite}
                              title={denial || undefined}
                            >
                              Send it again
                            </button>
                          </span>
                        )
                        : t.q.at ? <span className="sh__me-l">{t.q.at}</span> : null}
                    </>
                  )}
                  {t.answers.map(a => (
                    <div className="sh__a" key={a.id}>
                      <span className="sh__a-av sh__a-av--mark">
                        <BrandLoader size={30} label="Sahayak" />
                      </span>
                      <div className="sh__a-b">
                        {a.stopped ? (
                          /**
                           * A STOPPED FRAGMENT IS NOT AN ANSWER, and is drawn so
                           * that it cannot be read as one. It goes nowhere near
                           * `AnswerBody`: no model line, no cost, no sources, no
                           * verdict buttons — there is no stored message for any
                           * of those to be about. `.sh-none` is the prototype's
                           * dashed block for "what it would not tell you", which
                           * is exactly what the rest of this answer is.
                           */
                          <>
                            <LiveText text={a.content} />
                            <div className="sh-none">
                              <b>{a.stopTitle}</b>
                              <p>
                                {a.content
                                  ? 'What is above is part of an answer, not a finished one.'
                                  : a.stopTitle === STOPPED
                                    ? 'Nothing had arrived when this stopped.'
                                    : 'None of the answer arrived.'}
                                {a.stopNote ? ` ${a.stopNote}` : ''}
                                {/* THE CHARGE, SAID OUT LOUD. The org had paid
                                    before this browser saw anything, and a stop
                                    closes a socket rather than undoing it. The
                                    phone has always said so; the browser said
                                    nothing and left the reader to find it in the
                                    wallet a week later. No figure: `credits`
                                    rides on `final`, which a fragment never
                                    receives, and 29 §8 does not allow a number
                                    the server did not return. */}
                                {a.charged
                                  ? ' It was charged for — Sahayak bills when it starts an answer, not when it finishes.'
                                  : ''}
                              </p>
                            </div>
                          </>
                        ) : (
                          <AnswerBody
                            message={a}
                            hot={cited && cited.id === a.id ? hot : null}
                            onCite={ref => onCite(a.id, ref)}
                            hasEvidence={!!a.evidence}
                            evidenceOpen={cited?.id === a.id && evidenceOpen}
                            onEvidence={() => toggleEvidence(a.id)}
                            verdict={fb[a.id]?.verdict || null}
                            verdictNote={fb[a.id]?.note || ''}
                            verdictError={fb[a.id]?.error || ''}
                            verdictBusy={!!fb[a.id]?.busy}
                            asking={asking === a.id}
                            /* F32 — a feedback row is a write, so it takes the
                               same gate asking does. A reader who may not write
                               gets no buttons rather than buttons that 403. */
                            onFeedback={canWrite ? (v => rate(a.id, v)) : null}
                            onExplain={n => explain(a.id, n)}
                            onAsk={open => setAsking(open ? a.id : null)}
                          />
                        )}
                        {/* The row AnswerBody's own `.sh__acts` does not carry,
                            and cannot: copy is about the text this screen is
                            holding, and asking again is a send. Second in the
                            column so the evidence switch and the verdict stay
                            the first controls under a reply. */}
                        <div className="sh__acts">
                          {a.content && (
                            <button
                              type="button"
                              className="sh__act"
                              onClick={() => copyAnswer(a)}
                              aria-label={copied === a.id
                                ? 'Copied to the clipboard'
                                : 'Copy this answer to the clipboard'}
                            >
                              {copied === a.id ? 'Copied' : 'Copy'}
                            </button>
                          )}
                          {t.q?.content && t.key === lastTurn && (
                            <button
                              type="button"
                              className="sh__act"
                              onClick={() => askAgain(t.q.content)}
                              disabled={sending || !canWrite}
                              title={denial || undefined}
                              aria-label="Ask this question again"
                            >
                              Try again
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}

              {sending && (
                <div className="sh__turn">
                  <div className="sh__a">
                    <span className="sh__a-av sh__a-av--mark">
                      <BrandLoader size={30} label="Sahayak is thinking" />
                    </span>
                    <div className="sh__a-b">
                      {/* 29 §2 rule 4 asks for the named work steps here, and the
                          stream is what finally supplies them: one `step` frame
                          per thing the server actually did. Nothing is invented
                          — with no frames there are no rows, and the honest one
                          line below is what is left. */}
                      {live?.steps?.length > 0 && (
                        <div className="sh__work">
                          {live.steps.map((label, i) => (
                            <div
                              key={`${i}-${label}`}
                              className={`sh__work-r${
                                i < live.steps.length - 1 || live.text ? ' done' : ' now'}`}
                            >
                              <i />
                              {label}
                            </div>
                          ))}
                        </div>
                      )}
                      {/* The answer as it is written, in the grammar it will
                          still be in when it lands — see `LiveText`. Trimmed
                          rather than merely truthy: a first delta of one
                          newline would otherwise replace the waiting line with
                          nothing at all. */}
                      {String(live?.text ?? '').trim()
                        ? <LiveText text={live.text} />
                        : (
                          <div className="sh__wait">
                            {live?.steps?.length ? 'Writing the answer…' : 'Reading your records…'}
                          </div>
                        )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="sh__cp">
          <div className="sh__cp-w">
            <div className="sh__cp-box">
              <label className="sr-only" htmlFor="sh-ask">Ask Sahayak</label>
              <textarea
                id="sh-ask"
                ref={boxRef}
                rows={1}
                placeholder="Ask about invoices, tasks, people, attendance…"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={sending || !canWrite}
                /* The server's own limit, enforced where the paste happens.
                   Without it a GST notice pasted into the "Draft a reply"
                   opener was refused by pydantic, and a 422's list-shaped
                   `detail` reached the reader as a sentence naming no cause.
                   The browser stops the paste at 4,000 characters instead, and
                   `detailOf` covers the one that still gets through. */
                maxLength={ASK_MAX_CHARS}
                title={denial || undefined}
              />
              <div className="sh__cp-foot">
                {/* The prototype's `.sh__scope` pill sits here and narrates the
                    RBAC filter, which 29 §2 rule 3 says not to do. This takes its
                    slot and its geometry and answers for something real. */}
                <button
                  type="button"
                  className="sh__hist"
                  aria-expanded={railOpen}
                  onClick={() => chooseRail(!railOpen)}
                >
                  Conversations <b>{sessionCount}</b>
                </button>
                {/* THE VIEW SWITCH.
                    It is in the composer footer and not in a bar of its own
                    because this surface HAS no chrome bar — 29-sahayak.md's
                    frame is the tab shell above `.sh`, and the test that guards
                    it asserts there is no in-surface toolbar. The footer is the
                    one strip the prototype gives this panel, and the switch is
                    the second thing in it. */}
                <div className="sh__view" role="group" aria-label="Reading view">
                  <button
                    type="button"
                    className={`sh__view-b${view === READING ? ' on' : ''}`}
                    aria-pressed={view === READING}
                    onClick={() => chooseView(READING)}
                  >
                    Reading
                  </button>
                  <button
                    type="button"
                    className={`sh__view-b${view === COMPACT ? ' on' : ''}`}
                    aria-pressed={view === COMPACT}
                    onClick={() => chooseView(COMPACT)}
                  >
                    Compact
                  </button>
                </div>
                {/* The sheet's only opener. `display: none` above 767px, where
                    the panel is a permanent column and there is nothing to
                    open — see the mobile block in sahayak.css. */}
                {cited && (
                  <button
                    type="button"
                    className="sh__srcs"
                    aria-expanded={sheet}
                    onClick={() => setSheetOpen(v => !v)}
                  >
                    Sources <b>{cited.sources.length}</b>
                  </button>
                )}
                <span className="sp" />
                <span className="sh__cost">
                  {canWrite ? 'Enter to send · Shift+Enter for a new line' : denial}
                </span>
                {/* STOP TAKES ASK'S PLACE while an answer is in flight rather
                    than sitting beside it: the two are the same decision at two
                    moments, and a disabled Ask next to a live Stop is a footer
                    with a dead control in it. It is a real button in the same
                    tab position, so the keyboard route to ending an answer is
                    the keyboard route that started it. */}
                {/* THE KEYS ARE LOAD-BEARING. Both branches are a `<button>` in
                    the same position, so without them React keeps ONE DOM node
                    and edits its props — and a node is never unmounted, so the
                    focus that was on Stop stays on the element that has just
                    become a disabled Ask. Distinct keys make the swap a real
                    unmount, which is what the focus effect above is written
                    against. */}
                {/* AND ONLY WHILE THERE IS SOMETHING TO STOP. `sending` alone
                    put Stop in the footer during the non-streaming fallback
                    too, where pressing it aborts this browser's socket and
                    nothing else — the server finishes, charges and stores the
                    answer, while the screen draws a stopped fragment over it.
                    On that path the footer holds a disabled Ask instead, which
                    is what it held before any of this streamed. Nothing in it
                    can take focus for those few seconds; that is the honest
                    shape, because there is no action to offer. */}
                {sending && stoppable ? (
                  <button
                    key="stop"
                    type="button"
                    ref={stopBtnRef}
                    className="btn btn--out btn--sm"
                    onClick={stop}
                    aria-label="Stop this answer"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    key="ask"
                    type="button"
                    className="btn btn--fill btn--sm"
                    onClick={() => send(input, { fromBox: true })}
                    disabled={sending || !input.trim() || !canWrite}
                    title={denial || undefined}
                  >
                    Ask
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* THE ONE ANNOUNCEMENT PER PHASE.
            `role="status"` is polite by definition, so it never interrupts, and
            it only speaks when the string CHANGES — which is why the delta text
            is not in here. A region fed by the tokens would try to announce a
            four-hundred-word answer one word at a time and a screen reader would
            queue, drop, or talk over all of it. Asked, ready, stopped: three
            strings, and the answer itself is read from the thread where it is. */}
        <p className="sr-only" role="status">{announce}</p>
      </div>

      {cited && (
        <SourcesPanel
          sources={cited.sources}
          hot={hot}
          evidence={cited.evidence}
          evidenceOpen={evidenceOpen}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {railOpen && (
        <>
          <nav className="sh__rail" aria-label="Conversations">
            <div className="sh__rail-h">
              Conversations
              <button
                type="button"
                className="sh__rail-x"
                onClick={() => chooseRail(false)}
                aria-label="Close conversations"
              >
                &times;
              </button>
            </div>
            <div className="sh__rail-b">
              <button
                type="button"
                className="sh__new"
                onClick={newChat}
                disabled={!canWrite}
                title={denial || undefined}
              >
                + New chat
              </button>
              <Resource
                state={sessions}
                what="Your conversations"
                skeleton={<p className="sh-si__m">Loading…</p>}
                empty={<p className="sh-si__m">No conversations yet.</p>}
              >
                <ul className="sh__list">
                  {chats.map(s => (
                    <li key={s.id}>
                      <div className={`sh__row${active === s.id ? ' on' : ''}`}>
                        <button
                          type="button"
                          className="sh-si"
                          aria-current={active === s.id ? 'true' : undefined}
                          onClick={() => {
                            autoOpened.current = true;
                            chooseRail(false);
                            openSession(s.id);
                          }}
                        >
                          <span className="sh-si__t">{s.title || 'Untitled'}</span>
                          <span className="sh-si__m">{railMeta(s)}</span>
                        </button>
                        <button
                          type="button"
                          className="sh-si__x"
                          aria-label={`Delete ${s.title || 'conversation'}`}
                          onClick={() => setConfirmDel(s.id)}
                        >
                          &times;
                        </button>
                      </div>
                      {confirmDel === s.id && (
                        /* Deleting a conversation destroys the answers as well as
                           the questions, and nothing here restores them. */
                        <div className="sh__confirm" role="group">
                          <span>Delete this conversation permanently?</span>
                          <span className="sh__confirm-act">
                            <button type="button" className="btn btn--out btn--sm"
                              onClick={() => setConfirmDel(null)}>Keep</button>
                            <button type="button" className="btn btn--danger btn--sm"
                              onClick={() => removeSession(s.id)}
                              disabled={!canWrite} title={denial || undefined}>Delete</button>
                          </span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </Resource>
            </div>
          </nav>
        </>
      )}

      {/* ONE scrim for both overlays.
          It was inside the rail's fragment and closed only the rail; the sources
          sheet needs the same dismissal, and two scrims stacked would make the
          lower one unreachable and the upper one close the wrong thing. It is
          `aria-hidden` with `tabIndex={-1}` because it is decorative — Escape
          and each panel's own close control are the accessible routes out. */}
      {(railOpen || sheet) && (
        <button
          type="button"
          className="sh__scrim"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => { if (sheet) setSheetOpen(false); else chooseRail(false); }}
        />
      )}
    </div>
  );
}
