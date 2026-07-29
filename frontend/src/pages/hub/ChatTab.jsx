// Hub → Chat. The client's own assistant, grounded in their knowledge base.
//
// Three defects the split makes visible and this file fixes:
//
//  · The session list rendered "No sessions yet" after a failed fetch, so a
//    person whose sessions had not loaded was invited to start over on top of
//    conversations that still existed.
//  · A failed send left the optimistic user bubble sitting in the thread with
//    no reply and no explanation — the message looked sent. It is now marked as
//    undelivered, in the thread, where the person is looking.
//  · Deleting a session had no confirmation and no undo. It now asks.
import React, { useState, useRef, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Resource, useList, errText } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';

export default function ChatTab({ clientId }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change Srijan content' });
  const { pushToast } = useToast();
  const sessions = useList(clientId ? `/v1/hub/clients/${clientId}/chat/sessions` : null, [clientId]);
  const [active, setActive] = useState(null);
  const [thread, setThread] = useState({ loading: false, error: '', messages: [] });
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const endRef = useRef(null);

  // Follow the conversation. Without this the newest reply lands below the fold
  // on any thread longer than the panel.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [thread.messages, sending]);

  async function openSession(id) {
    setActive(id);
    setThread({ loading: true, error: '', messages: [] });
    try {
      const r = await api.get(`/v1/hub/chat/sessions/${id}/messages`);
      setThread({ loading: false, error: '', messages: r.data?.data || [] });
    } catch (err) {
      setThread({ loading: false, error: errText(err, 'Could not load this conversation.'), messages: [] });
    }
  }

  async function createSession() {
    try {
      const r = await api.post(`/v1/hub/clients/${clientId}/chat/sessions`, { title: 'New chat' });
      sessions.reload();
      openSession(r.data.id);
    } catch (err) {
      pushToast({ title: errText(err, 'Could not start a chat.'), type: 'error' });
    }
  }

  async function send(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || !active) return;
    const localId = `local-${Date.now()}`;
    setInput('');
    setThread(t => ({ ...t, messages: [...t.messages, { id: localId, role: 'user', content: text }] }));
    setSending(true);
    try {
      const r = await api.post(`/v1/hub/chat/sessions/${active}/send`, { message: text });
      setThread(t => ({
        ...t,
        messages: [...t.messages, {
          id: `reply-${Date.now()}`, role: 'assistant',
          content: r.data.message, sources: r.data.sources, model: r.data.model,
        }],
      }));
      sessions.reload();
    } catch (err) {
      // Mark the message that did not get through, in place. A toast alone
      // leaves a bubble that looks delivered.
      const why = errText(err, 'The assistant did not answer.');
      setThread(t => ({
        ...t,
        messages: t.messages.map(m => (m.id === localId ? { ...m, failed: why } : m)),
      }));
    } finally {
      setSending(false);
    }
  }

  async function removeSession(id) {
    try {
      await api.delete(`/v1/hub/chat/sessions/${id}`);
      setConfirmDel(null);
      if (active === id) { setActive(null); setThread({ loading: false, error: '', messages: [] }); }
      sessions.reload();
      pushToast({ title: 'Conversation deleted', type: 'success' });
    } catch (err) {
      pushToast({ title: errText(err, 'Could not delete it.'), type: 'error' });
    }
  }

  return (
    <div className="hb-chat">
      <aside className="hb-card hb-chat__side">
        <button type="button" className="k-btn k-btn--primary hb-btn--block" onClick={createSession}
          disabled={!canWrite} title={denial || undefined}>
          New chat
        </button>
        <Resource
          state={sessions}
          what="Your conversations"
          skeleton={<p className="hb-cap hb-chat__msg">Loading…</p>}
          empty={<p className="hb-cap hb-chat__msg">No conversations yet.</p>}
        >
          <ul className="hb-chat__list">
            {sessions.items?.map(s => (
              <li key={s.id}>
                <div className={`hb-chat__row${active === s.id ? ' on' : ''}`}>
                  <button type="button" className="hb-chat__pick"
                    aria-current={active === s.id ? 'true' : undefined}
                    onClick={() => openSession(s.id)}>
                    <span className="hb-chat__title">{s.title || 'Untitled'}</span>
                    {s.message_count != null && <span className="hb-chat__n">{s.message_count}</span>}
                  </button>
                  <button type="button" className="hb-chat__del" aria-label={`Delete ${s.title || 'conversation'}`}
                    onClick={() => setConfirmDel(s.id)}>&times;</button>
                </div>
                {confirmDel === s.id && (
                  /* Deleting a conversation destroys the answers as well as the
                     questions, and nothing here restores them. */
                  <div className="hb-chat__confirm" role="group">
                    <span className="hb-cap">Delete this conversation permanently?</span>
                    <span className="hb-chat__confirm-act">
                      <button type="button" className="k-btn k-btn--ghost hb-btn--sm" onClick={() => setConfirmDel(null)}>Keep</button>
                      <button type="button" className="k-btn k-btn--ghost hb-btn--sm hb-btn--danger" onClick={() => removeSession(s.id)}
          disabled={!canWrite} title={denial || undefined}>Delete</button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Resource>
      </aside>

      <section className="hb-card hb-chat__main">
        {!active ? (
          <div className="hb-chat__blank">
            <p className="hb-chat__blank-t">Pick a conversation, or start one.</p>
            <p className="hb-cap">
              Answers are drawn from this client&rsquo;s knowledge base only. Add documents on the
              Knowledge tab to widen what it can answer.
            </p>
          </div>
        ) : (
          <>
            <div className="hb-chat__thread">
              {thread.loading && <p className="hb-cap hb-chat__msg">Loading the conversation…</p>}
              {thread.error && (
                <div className="note note--warn hb-err" role="status">
                  <b>This conversation did not load.</b> {thread.error}
                  <button type="button" className="k-btn k-btn--ghost hb-err__go" onClick={() => openSession(active)}>Try again</button>
                </div>
              )}
              {!thread.loading && !thread.error && thread.messages.length === 0 && (
                <p className="hb-cap hb-chat__msg">No messages yet. Ask something below.</p>
              )}

              {thread.messages.map(m => (
                <div key={m.id} className={`hb-msg hb-msg--${m.role === 'user' ? 'me' : 'ai'}${m.failed ? ' hb-msg--failed' : ''}`}>
                  <div className="hb-msg__b">
                    {m.content}
                    {m.sources?.length > 0 && (
                      <div className="hb-msg__src">
                        <span className="hb-msg__src-l">Sources</span>
                        {m.sources.map((s, i) => (
                          <span className="hb-msg__cite" key={i}>
                            {s.title}
                            {s.similarity != null && <span className="hb-mono"> {Math.round(s.similarity * 100)}%</span>}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {m.failed && <div className="hb-msg__fail" role="status">Not delivered — {m.failed}</div>}
                </div>
              ))}

              {sending && (
                <div className="hb-msg hb-msg--ai">
                  <div className="hb-msg__b hb-msg__b--wait">Thinking…</div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <form className="hb-chat__compose" onSubmit={send}>
              <input className="k-input hb-chat__in" placeholder="Ask about this client…"
                value={input} onChange={e => setInput(e.target.value)} disabled={sending} />
              <button type="submit" className="k-btn k-btn--primary" disabled={sending || !input.trim() || !canWrite} title={denial || undefined}>Send</button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
