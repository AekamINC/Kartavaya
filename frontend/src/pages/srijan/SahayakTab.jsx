/**
 * Sahayak · सहायक — the assistant, on the org's own side of the product.
 *
 * ── The bug this file exists to close ────────────────────────────────────────
 *
 * The chatbot has been built, metered, grounded and billed for months, and NO
 * ORG USER COULD REACH IT. `OrgSrijanPage`'s tab list held six entries and none
 * of them was the assistant; the only screen that rendered a conversation was
 * `pages/hub/ChatTab.jsx`, which is the AGENCY-side per-client view and needs a
 * `hub_clients` row chosen from a directory a client org does not have. A
 * backend and a screen, both finished, with nothing joining them.
 *
 * ── The route an org user is actually allowed to call ────────────────────────
 *
 * `routers/hub_chat.py` has no `/org/…` route. Three of its five chat endpoints
 * are already org-scoped and need nothing — `GET /chat/sessions/{id}/messages`,
 * `POST /chat/sessions/{id}/send` and `DELETE /chat/sessions/{id}` all match on
 * `hub_chat_sessions WHERE id=$1 AND org_id=$2`. The other two are not:
 * listing and creating a session both take a `client_id` in the path, and
 * `hub_chat_sessions.client_id` is `NOT NULL REFERENCES hub_clients` (migration
 * 017), so a session that belongs to no client cannot exist at all.
 *
 * The join is `GET /v1/hub/org-client`, and it is not a workaround — it is the
 * route the org side was built on. It returns the org's own INTERNAL client
 * (`hub_clients.is_internal = TRUE`), creating it on first ask, and it is
 * `require_user` + `get_org_id` + the srijan module gate, so any member of the
 * org may call it. The same row is what `GET /org/brand` falls back to
 * (hub.py:2731), what the org skill runner reads its brand profile from, and
 * what `services/skills/context.py:112` searches the knowledge base against
 * for an org-level skill. Its docstring says the purpose out loud: "lets
 * admin/members access Srijan features without manually creating a client."
 *
 * So: resolve the internal client, then use the client-scoped list/create and
 * the org-scoped read/send. Every call is one an org member is authorised to
 * make, and no id is guessed. What is NOT closed is that a GET provisions on
 * first call — reported, not papered over.
 *
 * ── What the layout is, and where it came from ───────────────────────────────
 *
 * `docs/proposals/19-sahayak-final.html`, approved. Its four settled decisions:
 *
 *   · Focus / Workbench is a USER TOGGLE in the header, not a fork in the
 *     design. Workbench is the conversation rail and nothing else. There WAS a
 *     "what I can see" capability panel in an earlier draft and the owner
 *     removed it — the RBAC filter still runs server-side, it is simply not
 *     narrated. Do not put it back.
 *   · Answer cards sit INSIDE the reply, coloured by provenance. One ships;
 *     see `sahayak/AnswerCards.jsx` for why, and for why the second and third
 *     need no rewrite.
 *   · Sources collapse behind ONE button and open a split panel; an inline [1]
 *     opens it with that source highlighted.
 *   · The thinking state is the lotus — `BrandLoader`, the product's waiting
 *     state everywhere, not a second spinner drawn for this screen.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import useModuleWrite from '../../hooks/useModuleWrite';
import BrandLoader from '../../components/layout/BrandLoader';
import { Resource, useResource, useList, ErrorNote, errText } from '../hub/_shared';
import AnswerCards from './sahayak/AnswerCards';
import SourcesPanel from './sahayak/SourcesPanel';
import { parseSources } from './sahayak/sources';
import '../../styles/sahayak.css';

/**
 * The opener cards, verbatim from the approved design, in its order.
 *
 * Six on a wide screen, four on a laptop, two on a phone — a COUNT, and the
 * grid in `sahayak.css` hides the tail rather than reflowing it, so the order
 * here decides what survives onto a phone. The design leads with a deadline
 * question and a Hindi payments question, which is the bilingual pair worth
 * keeping when only two are left.
 *
 * `dev` marks the two written in Devanagari so the label can carry
 * `--font-indic` and `lang="hi"`; 24-bilingual-devanagari.md asks for both, and
 * `lang` is what stops a screen reader announcing Hindi with English phonemes.
 */
const OPENERS = [
  { q: "What's due this month?", s: 'Filing deadlines across your work' },
  { q: 'किस क्लाइंट का भुगतान बाकी है?', s: 'Outstanding payments', dev: true },
  { q: 'Draft a reply', s: 'To a GST notice' },
  { q: 'Explain a rule', s: 'In plain language' },
  { q: 'Summarise a client', s: 'Position and open points' },
  { q: 'इस हफ़्ते क्या बदला?', s: 'Across everything', dev: true },
];

const MODE_KEY = 'k_sahayak_mode';

/**
 * localStorage throws in private mode and in a sandboxed frame.
 *
 * The default is NOT 'work'. Below 860px the rail stops being a column and
 * becomes an absolutely-positioned drawer with a scrim over the whole panel
 * (sahayak.css), so opening in Workbench put that drawer on top of the
 * composer and every opener card on first paint — measured on a 390x844
 * phone, `elementFromPoint` at the textarea, the Send button and the first
 * opener all returned `.sh__rail`. Sahayak is the default tab of /hub/org, so
 * that was the first thing a phone user met. A stored choice still wins in
 * both directions; only the unset case is viewport-aware.
 */
function storedMode() {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === 'focus' || saved === 'work') return saved;
  } catch { /* private mode — fall through to the viewport default */ }
  try {
    return window.matchMedia('(max-width: 860px)').matches ? 'focus' : 'work';
  } catch { return 'work'; }
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

/**
 * A stored message → what this screen renders.
 *
 * `sources` is the only field that needs work and it needs it in both
 * directions: `GET …/messages` hands back the jsonb column (which may arrive as
 * a string — see sources.js), while `POST …/send` returns a list built in
 * Python. `model_used` and `model` are the same fact under the two names the
 * two endpoints use.
 */
function shape(m, i) {
  return {
    id: m.id ?? `m${i}`,
    role: m.role === 'user' ? 'user' : 'assistant',
    content: String(m.content ?? ''),
    sources: parseSources(m.sources),
    model: String(m.model_used ?? m.model ?? ''),
    credits: m.credits ?? m.credits_charged ?? null,
    // The forward contract for structured sections. Nothing sets it yet; see
    // AnswerCards.toCards, which is where the second and third card arrive.
    sections: Array.isArray(m.sections) ? m.sections : null,
  };
}

export default function SahayakTab({ onSpent }) {
  // F32 — the module is read from the route, never named here. Asking a
  // question spends credits and writes two rows, so it is a write.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'ask Sahayak' });
  const { pushToast } = useToast();

  // The org's own internal client. Everything below waits on it.
  const boot = useResource('/v1/hub/org-client', []);
  const clientId = boot.data?.client?.id || null;
  const orgName = boot.data?.client?.name || '';

  const sessions = useList(
    clientId ? `/v1/hub/clients/${clientId}/chat/sessions` : null,
    [clientId],
  );

  const [active, setActive] = useState(null);
  const [thread, setThread] = useState({ loading: false, error: '', messages: [] });
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [mode, setMode] = useState(storedMode);
  // Which reply's sources are open, and which one of them an inline [n] asked
  // for. `msg` null means the panel is closed — one piece of state, so the
  // panel cannot be open with nothing in it.
  const [panel, setPanel] = useState({ msg: null, hot: null });

  const scrollRef = useRef(null);
  const autoOpened = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* private mode */ }
  }, [mode]);

  /**
   * Escape dismisses whatever is overlaying the conversation on a narrow
   * screen. The scrim is `aria-hidden` with `tabIndex={-1}` — correct, since
   * it is decorative and duplicates controls that already exist in the header
   * — but that left pointer input as the ONLY way out of the drawer. Escape is
   * the keyboard's answer to the same question.
   *
   * Sources close before the rail: they are the shallower of the two, and
   * closing both on one keypress would be a surprise. Above 860px neither is
   * an overlay, so this only ever runs where something is covering something.
   */
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      let narrow = true;
      try { narrow = window.matchMedia('(max-width: 860px)').matches; } catch { /* jsdom */ }
      if (!narrow) return;
      if (panel.msg) setPanel({ msg: null, hot: null });
      else if (mode === 'work') setMode('focus');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, panel.msg]);

  /**
   * Follow the conversation. Without this the newest reply lands below the fold
   * on any thread longer than the panel.
   *
   * The scroll CONTAINER is moved, not `endRef.scrollIntoView()`, which is what
   * the agency-side chat does and what this file did first. `scrollIntoView`
   * scrolls every scrollable ancestor, and this panel is not the page — it sits
   * under a module header, a four-figure credit strip and a tab bar, all of
   * which scroll. Asking a sentinel to come into view therefore drags the whole
   * document down to the composer on every single reply. Setting `scrollTop` on
   * the one element that should move affects nothing above it.
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
   * The sessions and the messages have been in `hub_chat_sessions` /
   * `hub_chat_messages` the whole time; nothing on the org side ever read them.
   * The list comes back `ORDER BY updated_at DESC`, so the head is where the
   * person left off, and opening it is the difference between an assistant that
   * remembers and a text box.
   *
   * Once only, and only while nothing else is open: a reload of the session
   * list after a send must not yank the reader back to the top of the rail.
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

    // The bubble goes in BEFORE the session is created, not after.
    //
    // It was the other way round first, and that is a silent failure: the input
    // has already been cleared by this point, so if `createSession` rejects
    // there is nothing on screen to mark — the `catch` below looks for a
    // message id that was never added, finds none, and the person's typed
    // question has simply vanished. Optimistic first means every failure from
    // here on has somewhere to land.
    const localId = `local-${Date.now()}`;
    setThread(t => ({
      ...t,
      messages: [...t.messages, shape({ id: localId, role: 'user', content: body }, 0)],
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
        messages: [...t.messages, shape({ ...r.data, id: `reply-${Date.now()}`, role: 'assistant', content: r.data?.message }, 0)],
      }));
      sessions.reload();
      // The answer was charged as `channel/chatbot_message` in the same
      // transaction that stored the question, so the credit strip at the top of
      // the page is stale from this moment unless it is asked again. Called
      // only on the path that actually produced an answer: a send that threw
      // was refunded server-side (hub_chat.py's `refund_standalone`) or never
      // charged at all, and re-fetching on failure would show a balance
      // flickering back to where it started.
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

  const openPanel = useCallback((msgId, ref = null) => {
    setPanel({ msg: msgId, hot: ref });
  }, []);
  const closePanel = useCallback(() => setPanel({ msg: null, hot: null }), []);

  const panelSources = useMemo(() => {
    if (!panel.msg) return null;
    return thread.messages.find(m => m.id === panel.msg)?.sources || [];
  }, [panel.msg, thread.messages]);

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

  const srcOpen = panel.msg != null;

  return (
    <div className="sh k-surface-theme">
      <div className="sh__chrome">
        <span className="sh__nm">
          Sahayak <span className="sh__nm-hi" lang="hi">सहायक</span>
          {orgName && <span className="sh__who"> — {orgName}</span>}
        </span>
        <span className="sh__modes" role="group" aria-label="Layout">
          <button
            type="button"
            className={`sh__mode${mode === 'work' ? ' on' : ''}`}
            aria-pressed={mode === 'work'}
            onClick={() => setMode('work')}
          >
            Workbench
          </button>
          <button
            type="button"
            className={`sh__mode${mode === 'focus' ? ' on' : ''}`}
            aria-pressed={mode === 'focus'}
            onClick={() => setMode('focus')}
          >
            Focus
          </button>
        </span>
      </div>

      <div className="sh__body" data-mode={mode} data-src={srcOpen ? '1' : '0'}>
        {mode === 'work' && (
          <nav className="sh__rail" aria-label="Conversations">
            <div className="sh__rail-h">Conversations</div>
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
              skeleton={<p className="hb-cap sh__rail-h">Loading…</p>}
              empty={<p className="hb-cap sh__rail-h">No conversations yet.</p>}
            >
              <ul className="sh__list">
                {sessions.items?.map(s => (
                  <li key={s.id}>
                    <div className={`sh__row${active === s.id ? ' on' : ''}`}>
                      <button
                        type="button"
                        className="sh-si"
                        aria-current={active === s.id ? 'true' : undefined}
                        onClick={() => { autoOpened.current = true; openSession(s.id); }}
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
                        <span className="hb-cap">Delete this conversation permanently?</span>
                        <span className="sh__confirm-act">
                          <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                            onClick={() => setConfirmDel(null)}>Keep</button>
                          <button type="button" className="k-btn k-btn--ghost k-btn--sm k-btn--reject"
                            onClick={() => removeSession(s.id)}
                            disabled={!canWrite} title={denial || undefined}>Delete</button>
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Resource>
          </nav>
        )}

        <div className="sh__mid">
          <div className="sh__scroll" ref={scrollRef}>
            <div className="sh__inner">
              {thread.loading && <BrandLoader label="Loading this conversation" size={90} />}

              {thread.error && (
                <ErrorNote
                  what="This conversation"
                  error={thread.error}
                  onRetry={() => openSession(active)}
                />
              )}

              {empty && (
                <div className="sh-hero">
                  {/* The lotus, at rest. Same component as the thinking state,
                      so the waiting state and the brand are one thing. */}
                  <div className="sh-hero__mark"><BrandLoader label="Sahayak" size={78} /></div>
                  <p className="sh-hero__t">
                    Sahayak <span className="sh-hero__dev" lang="hi">सहायक</span>
                  </p>
                  <p className="sh-hero__s" lang="hi">आपका सहायक — आपके काम का साथी</p>
                  <div className="sh-op">
                    {OPENERS.map(o => (
                      <button
                        type="button"
                        className="sh-op__b"
                        key={o.q}
                        onClick={() => send(o.q)}
                        disabled={!canWrite || sending}
                        title={denial || undefined}
                      >
                        <span
                          className={`sh-op__t${o.dev ? ' sh-op__t--dev' : ''}`}
                          lang={o.dev ? 'hi' : undefined}
                        >
                          {o.q}
                        </span>
                        <span className="sh-op__s">{o.s}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {thread.messages.map(m => (m.role === 'user' ? (
                <div className={`sh-q${m.failed ? ' sh-q--failed' : ''}`} key={m.id}>
                  <div className="sh-q__b">{m.content}</div>
                  {m.failed && (
                    <div className="sh-q__fail" role="status">Not delivered — {m.failed}</div>
                  )}
                </div>
              ) : (
                <div className="sh-a" key={m.id}>
                  <div className="sh-a__mark"><BrandLoader label="Sahayak" size={30} /></div>
                  <div className="sh-a__c">
                    <AnswerCards message={m} onCite={ref => openPanel(m.id, ref)} />
                    {m.sources.length > 0 && (
                      <div className="sh-foot">
                        <button
                          type="button"
                          className="sh-foot__b sh-foot__b--src"
                          aria-expanded={panel.msg === m.id}
                          onClick={() => (panel.msg === m.id ? closePanel() : openPanel(m.id))}
                        >
                          Sources · {m.sources.length}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )))}

              {sending && (
                <div className="sh-a">
                  <div className="sh-a__mark"><BrandLoader label="Sahayak is thinking" size={30} /></div>
                  <div className="sh-a__c sh-wait">Thinking…</div>
                </div>
              )}

            </div>
          </div>

          <div className="sh__comp">
            <div className="sh__comp-w">
              <label className="sr-only" htmlFor="sh-ask">Ask Sahayak</label>
              <textarea
                id="sh-ask"
                className="sh__ta"
                rows={2}
                placeholder="Ask anything — English, हिन्दी or ગુજરાતી…"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={sending || !canWrite}
                title={denial || undefined}
              />
              <div className="sh__comp-r">
                <span className="sh__comp-h">
                  {canWrite ? 'Enter to send · Shift+Enter for a new line' : denial}
                </span>
                <button
                  type="button"
                  className="sh__go"
                  onClick={() => send(input)}
                  disabled={sending || !input.trim() || !canWrite}
                  title={denial || undefined}
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>

        {srcOpen && (
          <SourcesPanel sources={panelSources} hot={panel.hot} onClose={closePanel} />
        )}

        {/* Narrow screens only — see the media query in sahayak.css. Above
            860px this is display:none and cannot be clicked. */}
        {(mode === 'work' || srcOpen) && (
          <button
            type="button"
            className="sh__scrim"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => { closePanel(); setMode('focus'); }}
          />
        )}
      </div>
    </div>
  );
}
