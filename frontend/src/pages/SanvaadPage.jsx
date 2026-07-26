/**
 * SanvaadPage.jsx — Sanvaad · संवाद (Messaging)
 * Internal channels + DMs with realtime updates.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { PageHeader } from '../components/editorial';
import { useToast } from '../components/ui/toast';
import { relTime } from '../lib/utils';

const TABS = ['channels', 'whatsapp'];

export default function SanvaadPage() {
  const [tab, setTab] = useState('channels');

  return (
    <div style={{ padding: '0 var(--page-x, 32px)' }}>
      <PageHeader title="Messages" sanskrit="संवाद" lede="Internal messaging & WhatsApp" />

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1.5px solid var(--border)', marginBottom: 20 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="k-btn k-btn--ghost"
            style={{
              borderBottom: tab === t ? '2px solid var(--k-deep)' : '2px solid transparent',
              borderRadius: 0, fontWeight: tab === t ? 700 : 500,
              textTransform: 'capitalize', fontSize: 13, padding: '8px 18px',
            }}>
            {t === 'channels' ? 'Channels · चैनल' : 'WhatsApp · वार्ता'}
          </button>
        ))}
      </div>

      {tab === 'channels' && <ChannelsTab />}
      {tab === 'whatsapp' && <WhatsAppTab />}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// Channels Tab — Internal Messaging
// ═══════════════════════════════════════════════════════════════

function ChannelsTab() {
  const { pushToast } = useToast();
  const [channels, setChannels] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('public');

  const loadChannels = useCallback(() => {
    api.get('/messaging/channels')
      .then(r => setChannels(Array.isArray(r.data) ? r.data : []))
      .catch(() => setChannels([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadChannels(); }, [loadChannels]);

  const createChannel = async () => {
    if (!newName.trim()) return;
    try {
      const r = await api.post('/messaging/channels', { name: newName.trim(), type: newType });
      setChannels(prev => [r.data, ...prev]);
      setNewName('');
      setShowCreate(false);
      setSelected(r.data);
      pushToast({ type: 'success', title: 'Channel created' });
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to create channel' });
    }
  };

  return (
    <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 200px)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      {/* Channel list */}
      <div style={{ width: 280, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg-soft)' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Channels</span>
          <button className="k-btn k-btn--ghost" style={{ fontSize: 18, padding: '2px 8px' }}
            onClick={() => setShowCreate(!showCreate)}>+</button>
        </div>

        {showCreate && (
          <div style={{ padding: 10, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input className="k-input" placeholder="Channel name" value={newName}
              onChange={e => setNewName(e.target.value)} style={{ fontSize: 12 }}
              onKeyDown={e => e.key === 'Enter' && createChannel()} />
            <div style={{ display: 'flex', gap: 6 }}>
              <select className="k-input" value={newType} onChange={e => setNewType(e.target.value)}
                style={{ fontSize: 11, flex: 1 }}>
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
              <button className="k-btn k-btn--primary" style={{ fontSize: 11 }} onClick={createChannel}>Create</button>
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && <p style={{ padding: 14, color: 'var(--ink-3)', fontSize: 12 }}>Loading...</p>}
          {channels.map(ch => (
            <div key={ch.id} onClick={() => setSelected(ch)}
              style={{
                padding: '10px 14px', cursor: 'pointer',
                background: selected?.id === ch.id ? 'var(--k-deep-bg, color-mix(in srgb, var(--k-deep) 8%, transparent))' : 'transparent',
                borderLeft: selected?.id === ch.id ? '3px solid var(--k-deep)' : '3px solid transparent',
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {ch.type === 'dm' ? '💬' : ch.type === 'private' ? '🔒' : '#'} {ch.name || 'Direct Message'}
                </span>
                {ch.unread_count > 0 && (
                  <span style={{
                    background: 'var(--k-deep)', color: '#fff', borderRadius: 99,
                    fontSize: 'var(--t-label-sm)', fontWeight: 700, padding: '1px 7px', minWidth: 18, textAlign: 'center',
                  }}>{ch.unread_count}</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                {ch.member_count} member{ch.member_count !== 1 ? 's' : ''}
              </div>
            </div>
          ))}
          {!loading && channels.length === 0 && (
            <p style={{ padding: 14, color: 'var(--ink-3)', fontSize: 12 }}>No channels yet. Create one to start messaging.</p>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {selected ? (
          <ChatView channel={selected} onRefreshChannels={loadChannels} />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>💬</div>
              <p style={{ fontSize: 14 }}>Select a channel to start messaging</p>
              <p style={{ fontSize: 12, color: 'var(--ink-4)' }}>संवाद शुरू करने के लिए एक चैनल चुनें</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function ChatView({ channel, onRefreshChannels }) {
  const { pushToast } = useToast();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const [threadMsg, setThreadMsg] = useState(null);

  const loadMessages = useCallback(() => {
    setLoading(true);
    api.get(`/messaging/channels/${channel.id}/messages`)
      .then(r => setMessages((Array.isArray(r.data) ? r.data : []).reverse()))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [channel.id]);

  useEffect(() => {
    loadMessages();
    api.post(`/messaging/channels/${channel.id}/read`).catch(() => {});
  }, [channel.id, loadMessages]);

  // Was an unconditional scrollIntoView on every `messages` change. Combined
  // with the 5s poll below — which replaces the whole array — scrolling up to
  // read history yanked you back to the bottom within five seconds, every time.
  // Only follow the conversation if the reader is already at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Poll for new messages every 5s (Realtime can be wired later)
  useEffect(() => {
    const iv = setInterval(loadMessages, 5000);
    return () => clearInterval(iv);
  }, [loadMessages]);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const r = await api.post(`/messaging/channels/${channel.id}/messages`, {
        content: text.trim(),
        parent_message_id: threadMsg?.id || null,
      });
      setMessages(prev => [...prev, r.data]);
      setText('');
      setThreadMsg(null);
      onRefreshChannels();
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to send' });
    } finally {
      setSending(false);
    }
  };

  const react = async (msgId, emoji) => {
    try {
      await api.post(`/messaging/messages/${msgId}/reactions?emoji=${encodeURIComponent(emoji)}`);
      loadMessages();
    } catch { /* ignore */ }
  };

  return (
    <>
      {/* Header */}
      <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
        {channel.type === 'dm' ? '💬 Direct Message' : `# ${channel.name}`}
        {channel.description && <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--ink-3)', marginLeft: 10 }}>{channel.description}</span>}
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
        {loading && <p style={{ color: 'var(--ink-3)', fontSize: 12 }}>Loading messages...</p>}
        {!loading && messages.length === 0 && (
          <p style={{ color: 'var(--ink-3)', fontSize: 12, textAlign: 'center', marginTop: 40 }}>
            No messages yet. Start the conversation!
          </p>
        )}
        {messages.map(m => (
          <div key={m.id} style={{ marginBottom: 14, display: 'flex', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 99, background: 'var(--k-deep)',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 700, flexShrink: 0,
            }}>
              {(m.sender_name || '?')[0].toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{m.sender_name || 'Unknown'}</span>
                <span style={{ fontSize: 'var(--t-label-sm)', color: 'var(--ink-4)' }}>{relTime(m.created_at)}</span>
                {m.is_edited && <span style={{ fontSize: 'var(--t-label-sm)', color: 'var(--ink-4)' }}>(edited)</span>}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 2, whiteSpace: 'pre-wrap' }}>
                {m.is_deleted ? <em style={{ color: 'var(--ink-4)' }}>Message deleted</em> : m.content}
              </div>

              {/* Reactions */}
              {m.reactions && (() => {
                let parsed = m.reactions;
                if (typeof parsed === 'string') try { parsed = JSON.parse(parsed); } catch { parsed = []; }
                if (!Array.isArray(parsed) || parsed.length === 0) return null;
                const grouped = {};
                parsed.forEach(r => { grouped[r.emoji] = (grouped[r.emoji] || 0) + 1; });
                return (
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    {Object.entries(grouped).map(([emoji, count]) => (
                      <button key={emoji} className="k-btn k-btn--ghost"
                        onClick={() => react(m.id, emoji)}
                        style={{ fontSize: 12, padding: '1px 6px', borderRadius: 99, background: 'var(--bg-soft)' }}>
                        {emoji} {count}
                      </button>
                    ))}
                  </div>
                );
              })()}

              {/* Thread + quick reactions */}
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                {m.thread_count > 0 && (
                  <button className="k-btn k-btn--ghost" style={{ fontSize: 11, color: 'var(--k-deep)' }}
                    onClick={() => setThreadMsg(m)}>
                    💬 {m.thread_count} {m.thread_count === 1 ? 'reply' : 'replies'}
                  </button>
                )}
                {['👍', '✅', '👀', '❤️', '😂'].map(e => (
                  <button key={e} className="k-btn k-btn--ghost"
                    onClick={() => react(m.id, e)}
                    style={{ fontSize: 12, padding: '0 3px', opacity: 0.4 }}
                    onMouseEnter={ev => ev.target.style.opacity = 1}
                    onMouseLeave={ev => ev.target.style.opacity = 0.4}>
                    {e}
                  </button>
                ))}
                <button className="k-btn k-btn--ghost" style={{ fontSize: 11, opacity: 0.4 }}
                  onClick={() => setThreadMsg(m)}
                  onMouseEnter={ev => ev.target.style.opacity = 1}
                  onMouseLeave={ev => ev.target.style.opacity = 0.4}>
                  Reply
                </button>
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Thread reply indicator */}
      {threadMsg && (
        <div style={{ padding: '6px 18px', background: 'var(--bg-soft)', borderTop: '1px solid var(--border)', fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
          <span>Replying to <strong>{threadMsg.sender_name}</strong>: {threadMsg.content?.slice(0, 60)}...</span>
          <button className="k-btn k-btn--ghost" style={{ fontSize: 11 }} onClick={() => setThreadMsg(null)}>✕</button>
        </div>
      )}

      {/* Composer */}
      <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        {/* Was an <input> with a `!e.shiftKey` guard — a guard against a newline
            an <input> can never produce. Shift+Enter did nothing at all: no
            send, no newline. A textarea makes the guard mean what it says, and
            messages can be more than one line. */}
        <textarea className="k-input" rows={1} style={{ flex: 1, fontSize: 13, resize: 'none', lineHeight: 1.5, maxHeight: 120 }}
          placeholder="Type a message... (संदेश लिखें)"
          value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())} />
        <button className="k-btn k-btn--primary" onClick={send} disabled={sending || !text.trim()}
          style={{ fontSize: 13 }}>
          {sending ? '...' : 'Send'}
        </button>
      </div>
    </>
  );
}


// ═══════════════════════════════════════════════════════════════
// WhatsApp Tab — Varta
// ═══════════════════════════════════════════════════════════════

function WhatsAppTab() {
  const [subTab, setSubTab] = useState('conversations');
  const [conversations, setConversations] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [autoReplies, setAutoReplies] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedConv, setSelectedConv] = useState(null);

  useEffect(() => {
    setLoading(true);
    const load = subTab === 'conversations'
      ? api.get('/whatsapp/conversations').then(r => setConversations(Array.isArray(r.data) ? r.data : []))
      : subTab === 'templates'
      ? api.get('/whatsapp/templates').then(r => setTemplates(Array.isArray(r.data) ? r.data : []))
      : subTab === 'auto-replies'
      ? api.get('/whatsapp/auto-replies').then(r => setAutoReplies(Array.isArray(r.data) ? r.data : []))
      : api.get('/whatsapp/accounts').then(r => setAccounts(Array.isArray(r.data) ? r.data : []));
    load.catch(() => {}).finally(() => setLoading(false));
  }, [subTab]);

  const SUB_TABS = ['conversations', 'templates', 'auto-replies', 'accounts'];

  return (
    <div>
      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {SUB_TABS.map(t => (
          <button key={t} className={`k-btn ${subTab === t ? 'k-btn--primary' : 'k-btn--ghost'}`}
            onClick={() => { setSubTab(t); setSelectedConv(null); }}
            style={{ fontSize: 12, textTransform: 'capitalize' }}>
            {t.replace('-', ' ')}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: 'var(--ink-3)', fontSize: 12 }}>Loading...</p>}

      {/* Conversations */}
      {subTab === 'conversations' && !loading && (
        <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 300px)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ width: 300, borderRight: '1px solid var(--border)', overflowY: 'auto', background: 'var(--bg-soft)' }}>
            {conversations.length === 0 && (
              <p style={{ padding: 14, color: 'var(--ink-3)', fontSize: 12 }}>No conversations yet. Conversations appear when customers message your WhatsApp number.</p>
            )}
            {conversations.map(c => (
              <div key={c.id} onClick={() => setSelectedConv(c)}
                style={{
                  padding: '10px 14px', cursor: 'pointer',
                  background: selectedConv?.id === c.id ? 'color-mix(in srgb, var(--k-deep) 8%, transparent)' : 'transparent',
                  borderBottom: '1px solid var(--border)',
                }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{c.contact_name || c.phone_number}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{c.phone_number}</div>
                {c.last_message && (
                  <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.last_message.slice(0, 80)}
                  </div>
                )}
                <StatusBadge status={c.status} />
              </div>
            ))}
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)' }}>
            {selectedConv ? (
              <WAChat conversation={selectedConv} />
            ) : (
              <p style={{ fontSize: 13 }}>Select a conversation</p>
            )}
          </div>
        </div>
      )}

      {/* Templates */}
      {subTab === 'templates' && !loading && (
        <div>
          {templates.length === 0 && <p style={{ color: 'var(--ink-3)', fontSize: 12 }}>No templates yet.</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {templates.map(t => (
              <div key={t.id} className="k-card" style={{ padding: 16, borderRadius: 10, border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{t.name}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>{t.language} · {t.category}</div>
                <div style={{ fontSize: 12, marginTop: 8, whiteSpace: 'pre-wrap', color: 'var(--ink-2)' }}>{t.body}</div>
                <StatusBadge status={t.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Auto-replies */}
      {subTab === 'auto-replies' && !loading && (
        <div>
          {autoReplies.length === 0 && <p style={{ color: 'var(--ink-3)', fontSize: 12 }}>No auto-reply rules configured.</p>}
          {autoReplies.map(r => (
            <div key={r.id} style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{r.trigger_type}: </span>
                <span style={{ fontSize: 13 }}>{r.trigger_value || '(any)'}</span>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>→ {r.response_content.slice(0, 100)}</div>
              </div>
              <span style={{
                fontSize: 'var(--t-label-sm)', fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                background: r.is_active ? 'color-mix(in srgb, var(--ok) 14%, transparent)' : 'var(--bg-soft)',
                color: r.is_active ? 'var(--ok)' : 'var(--ink-4)',
              }}>
                {r.is_active ? 'ACTIVE' : 'INACTIVE'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Accounts */}
      {subTab === 'accounts' && !loading && (
        <div>
          {accounts.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-3)' }}>
              <p style={{ fontSize: 14 }}>No WhatsApp Business accounts connected.</p>
              <p style={{ fontSize: 12, marginTop: 4 }}>Connect your Meta Business Account to start using WhatsApp.</p>
            </div>
          )}
          {accounts.map(a => (
            <div key={a.id} style={{ padding: 14, borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{a.display_name}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{a.phone_number} · WABA: {a.waba_id}</div>
              <StatusBadge status={a.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function WAChat({ conversation }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const { pushToast } = useToast();
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    api.get(`/whatsapp/conversations/${conversation.id}/messages`)
      .then(r => setMessages((Array.isArray(r.data) ? r.data : []).reverse()))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [conversation.id]);

  // Was an unconditional scrollIntoView on every `messages` change. Combined
  // with the 5s poll below — which replaces the whole array — scrolling up to
  // read history yanked you back to the bottom within five seconds, every time.
  // Only follow the conversation if the reader is already at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const r = await api.post(`/whatsapp/conversations/${conversation.id}/messages`, { content: text.trim() });
      setMessages(prev => [...prev, r.data]);
      setText('');
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to send' });
    } finally {
      setSending(false);
    }
  };

  // delivered and read were BOTH '✓✓', so the read receipt — the entire point
  // of the second tick — carried no information. WhatsApp distinguishes them by
  // COLOUR, not glyph, which is why --tick-read (#4FC3F7, WhatsApp's own blue)
  // exists in the token set: users read it from muscle memory.
  const STATUS_ICONS = {
    pending:   { glyph: '·',  color: 'inherit' },
    sent:      { glyph: '✓',  color: 'inherit' },
    delivered: { glyph: '✓✓', color: 'inherit' },
    read:      { glyph: '✓✓', color: 'var(--tick-read)' },
    failed:    { glyph: '✕',  color: 'var(--danger)' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
        {conversation.contact_name || conversation.phone_number}
        <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 8 }}>{conversation.phone_number}</span>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
        {loading && <p style={{ color: 'var(--ink-3)', fontSize: 12 }}>Loading...</p>}
        {messages.map(m => (
          <div key={m.id} style={{
            marginBottom: 10, display: 'flex',
            justifyContent: m.direction === 'outbound' ? 'flex-end' : 'flex-start',
          }}>
            <div style={{
              maxWidth: '70%', padding: '8px 14px', borderRadius: 12,
              background: m.direction === 'outbound' ? 'var(--k-deep)' : 'var(--bg-soft)',
              color: m.direction === 'outbound' ? '#fff' : 'var(--ink)',
            }}>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{m.content}</div>
              <div style={{ fontSize: 'var(--t-label-sm)', marginTop: 4, opacity: 0.85, textAlign: 'right' }}>
                {relTime(m.created_at)}{' '}
                {m.direction === 'outbound' && STATUS_ICONS[m.status] && (
                  <span style={{ color: STATUS_ICONS[m.status].color }} title={m.status}>
                    {STATUS_ICONS[m.status].glyph}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        <input className="k-input" style={{ flex: 1, fontSize: 13 }}
          placeholder="Type a message..."
          value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), send())} />
        <button className="k-btn k-btn--primary" onClick={send} disabled={sending || !text.trim()}>
          {sending ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}


function StatusBadge({ status }) {
  const colors = {
    open: 'var(--ok)', pending: 'var(--warn)', resolved: 'var(--ink-4)',
    active: 'var(--ok)', suspended: 'var(--err)', draft: 'var(--ink-3)',
    approved: 'var(--ok)', rejected: 'var(--err)',
  };
  const c = colors[status] || 'var(--ink-4)';
  return (
    <span style={{
      fontSize: 'var(--t-label-sm)', fontWeight: 700, textTransform: 'uppercase',
      padding: '2px 8px', borderRadius: 99, marginTop: 6, display: 'inline-block',
      background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c,
    }}>
      {status}
    </span>
  );
}
