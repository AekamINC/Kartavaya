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
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import useModuleWrite from '../../hooks/useModuleWrite';
import BrandLoader from '../../components/layout/BrandLoader';
import { Resource, useResource, useList, ErrorNote, errText } from '../hub/_shared';
import AnswerBody from './assistant/AnswerBody';
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
  // messageId → 'up' | 'down', recorded only once the endpoint answered.
  const [verdicts, setVerdicts] = useState({});

  const scrollRef = useRef(null);
  const autoOpened = useRef(false);

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
  }, [thread.messages, sending]);

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
   */
  async function send(text) {
    const body = String(text ?? '').trim();
    if (!body || sending || !clientId || !canWrite) return;

    const sid = active;
    setInput('');
    setSending(true);

    // The bubble goes in BEFORE the request, not after. The input has already
    // been cleared by this point, so if the post rejects there is otherwise
    // nothing on screen to mark and the person's typed question has simply
    // vanished. Optimistic first means every failure from here on has somewhere
    // to land.
    const localId = `local-${Date.now()}`;
    setThread(t => ({
      ...t,
      messages: [
        ...t.messages,
        shape({ id: localId, role: 'user', content: body, created_at: new Date().toISOString() }, 0),
      ],
    }));

    /** Mark the question that did not get through, in place. */
    const markFailed = why => setThread(t => ({
      ...t,
      messages: t.messages.map(m => (m.id === localId ? { ...m, failed: why } : m)),
    }));

    try {
      // `session_id` when there is one, `client_id` when there is not: the route
      // scopes the knowledge base to the workspace it verifies, and naming the
      // session is what proves the caller owns it.
      const r = await api.post('/v1/hub/chat', {
        message: body,
        ...(sid ? { session_id: sid } : { client_id: clientId }),
      });
      const reply = r.data || {};

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
          content: reply.message,
          created_at: new Date().toISOString(),
        }, 0)],
      }));
      sessions.reload();
      // The answer was charged as `channel/chatbot_message` in the same
      // transaction that stored the question, so the credit strip at the top of
      // the page is stale from this moment unless it is asked again. Called only
      // where something was actually SPENT: a refusal is a 200 carrying
      // `credits: 0`, and re-fetching for it would flicker the balance for no
      // change. A send that threw was refunded server-side or never charged.
      if (Number(reply.credits ?? reply.credits_charged) > 0) onSpent?.();
    } catch (err) {
      // A toast alone is gone in four seconds and leaves a bubble that looks
      // delivered — and a 402 here is the sentence that says the wallet is
      // empty, which is the one thing worth keeping on screen.
      markFailed(errText(err, 'Sahayak did not answer.'));
    } finally {
      setSending(false);
    }
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
   * the module gate and a 500 from the unapplied half of migration 119 — so an
   * optimistic fill would be wrong often enough to matter.
   *
   * Pressing the same thumb twice is a no-op rather than a second row. Changing
   * one's mind posts again, which is correct: `hub_skill_feedback` is an
   * append-only log and the later row is the later opinion.
   */
  const rate = useCallback(async (messageId, verdict) => {
    if (!isServerAnswer(messageId)) return;
    if (verdicts[messageId] === verdict) return;
    try {
      await api.post(FEEDBACK_PATH, feedbackBody(messageId, verdict));
      setVerdicts(v => ({ ...v, [messageId]: verdict }));
      pushToast({
        title: verdict === 'up' ? 'Noted — thank you.' : 'Noted. Marked as wrong.',
        type: 'success',
      });
    } catch (err) {
      pushToast({ title: errText(err, 'Could not record that.'), type: 'error' });
    }
  }, [verdicts, pushToast]);

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
      send(input);
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
                        ? <span className="sh__fail" role="status">Not delivered — {t.q.failed}</span>
                        : t.q.at ? <span className="sh__me-l">{t.q.at}</span> : null}
                    </>
                  )}
                  {t.answers.map(a => (
                    <div className="sh__a" key={a.id}>
                      <span className="sh__a-av sh__a-av--mark">
                        <BrandLoader size={30} label="Sahayak" />
                      </span>
                      <div className="sh__a-b">
                        <AnswerBody
                          message={a}
                          hot={cited && cited.id === a.id ? hot : null}
                          onCite={ref => onCite(a.id, ref)}
                          hasEvidence={!!a.evidence}
                          evidenceOpen={cited?.id === a.id && evidenceOpen}
                          onEvidence={() => toggleEvidence(a.id)}
                          verdict={verdicts[a.id] || null}
                          /* F32 — a feedback row is a write, so it takes the
                             same gate asking does. A reader who may not write
                             gets no buttons rather than buttons that 403. */
                          onFeedback={canWrite ? (v => rate(a.id, v)) : null}
                        />
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
                      {/* 29 §2 rule 4 asks for the named work steps here. The
                          send endpoint returns no step list, so what is shown is
                          the lotus and one honest line — not a fabricated one. */}
                      <div className="sh__wait">Reading your records…</div>
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
                rows={1}
                placeholder="Ask about invoices, tasks, people, attendance…"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={sending || !canWrite}
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
                <button
                  type="button"
                  className="btn btn--fill btn--sm"
                  onClick={() => send(input)}
                  disabled={sending || !input.trim() || !canWrite}
                  title={denial || undefined}
                >
                  Ask
                </button>
              </div>
            </div>
          </div>
        </div>
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
