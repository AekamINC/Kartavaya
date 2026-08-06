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
 * here — so the rail survives as an overlay that is CLOSED on first paint, which
 * leaves the default surface exactly as drawn. It is opened from the composer
 * footer, in the slot the prototype gives `.sh__scope` — a pill that narrates the
 * RBAC filter, which 29 §2 rule 3 says not to do, and asserts a scope no endpoint
 * guarantees.
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
import '../../styles/sahayak.css';

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
    // The forward contract for structured sections, work steps and figures.
    // Nothing sets any of them yet; see AnswerBody, which renders nothing for
    // each rather than inventing one.
    sections: Array.isArray(m.sections) ? m.sections : null,
    work: Array.isArray(m.work) ? m.work : null,
    figs: Array.isArray(m.figs) ? m.figs : null,
    refusal: m.refusal ?? null,
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
  const [railOpen, setRailOpen] = useState(false);
  // Which answer the panel is showing, and which source inside it an inline
  // marker asked for. Null `msg` means "whichever answer last cited something",
  // which is what the prototype's permanent panel shows.
  const [panel, setPanel] = useState({ msg: null, hot: null });

  const scrollRef = useRef(null);
  const autoOpened = useRef(false);

  /**
   * Escape closes the rail. It is an overlay with a scrim, and the scrim is
   * `aria-hidden` with `tabIndex={-1}` — correct, since it is decorative — but
   * that left pointer input as the only way out.
   */
  useEffect(() => {
    if (!railOpen) return undefined;
    function onKey(e) { if (e.key === 'Escape') setRailOpen(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [railOpen]);

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
    setActive(id);
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
  }, []);

  /**
   * IT HOLDS THE PREVIOUS CONVERSATION RATHER THAN STARTING COLD.
   *
   * The list comes back `ORDER BY updated_at DESC`, so the head is where the
   * person left off, and opening it is the difference between an assistant that
   * remembers and a text box. Once only, and only while nothing else is open.
   */
  useEffect(() => {
    if (autoOpened.current || active) return;
    const first = sessions.items?.[0];
    if (!first?.id) return;
    autoOpened.current = true;
    openSession(first.id);
  }, [sessions.items, active, openSession]);

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
      setRailOpen(false);
      if (id) openSession(id);
    } catch (err) {
      pushToast({ title: errText(err, 'Could not start a conversation.'), type: 'error' });
    }
  }

  /**
   * Send, creating the conversation on the way if there is not one yet.
   *
   * The welcome screen is reachable with no session at all — a first-time org
   * has none — and making the person press "New chat" before they may type is a
   * step that exists only because of how the table is keyed.
   */
  async function send(text) {
    const body = String(text ?? '').trim();
    if (!body || sending || !clientId || !canWrite) return;

    let sid = active;
    setInput('');
    setSending(true);

    // The bubble goes in BEFORE the session is created, not after. The input has
    // already been cleared by this point, so if `createSession` rejects there is
    // otherwise nothing on screen to mark and the person's typed question has
    // simply vanished. Optimistic first means every failure from here on has
    // somewhere to land.
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
      if (!sid) {
        sid = await createSession();
        if (!sid) {
          // The POST answered and returned no id. That is a broken contract
          // rather than a failed request, so `errText` is the wrong voice for
          // it — its no-`response` branch would say the server never replied,
          // which is the opposite of what happened.
          markFailed('The conversation could not be started. Try again.');
          return;
        }
        setActive(sid);
        autoOpened.current = true;
      }

      const r = await api.post(`/v1/hub/chat/sessions/${sid}/send`, { message: body });
      setThread(t => ({
        ...t,
        messages: [...t.messages, shape({
          ...r.data,
          id: `reply-${Date.now()}`,
          role: 'assistant',
          content: r.data?.message,
          created_at: new Date().toISOString(),
        }, 0)],
      }));
      sessions.reload();
      // The answer was charged as `channel/chatbot_message` in the same
      // transaction that stored the question, so the credit strip at the top of
      // the page is stale from this moment unless it is asked again. Called only
      // on the path that produced an answer: a send that threw was refunded
      // server-side or never charged, and re-fetching on failure would show a
      // balance flickering back to where it started.
      onSpent?.();
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
        setActive(null);
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
   * Which answer the permanent panel is showing.
   *
   * With no marker clicked it is the most recent reply that cited anything —
   * the panel is a property of the conversation's current state, not something
   * the reader opened. A `panel.msg` pointing at a message that is no longer in
   * the thread (a session was switched under it) falls back rather than emptying
   * the column.
   */
  const cited = useMemo(() => {
    const withSrc = thread.messages.filter(m => m.role === 'assistant' && m.sources.length > 0);
    const picked = panel.msg ? withSrc.find(m => m.id === panel.msg) : null;
    return picked || withSrc[withSrc.length - 1] || null;
  }, [thread.messages, panel.msg]);

  const hot = cited && panel.msg === cited.id ? panel.hot : null;

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
  const sessionCount = sessions.items?.length || 0;

  return (
    <div className={`sh${cited ? '' : ' sh--wide'}`}>
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
              <p className="sh__hero-hi" lang="hi">सहायक</p>
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
                    <b lang={o.dev ? 'hi' : undefined}>{o.q}</b>
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
                  onClick={() => setRailOpen(v => !v)}
                >
                  Conversations <b>{sessionCount}</b>
                </button>
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

      {cited && <SourcesPanel sources={cited.sources} hot={hot} />}

      {railOpen && (
        <>
          <nav className="sh__rail" aria-label="Conversations">
            <div className="sh__rail-h">
              Conversations
              <button
                type="button"
                className="sh__rail-x"
                onClick={() => setRailOpen(false)}
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
                  {sessions.items?.map(s => (
                    <li key={s.id}>
                      <div className={`sh__row${active === s.id ? ' on' : ''}`}>
                        <button
                          type="button"
                          className="sh-si"
                          aria-current={active === s.id ? 'true' : undefined}
                          onClick={() => {
                            autoOpened.current = true;
                            setRailOpen(false);
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
          <button
            type="button"
            className="sh__scrim"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setRailOpen(false)}
          />
        </>
      )}
    </div>
  );
}
