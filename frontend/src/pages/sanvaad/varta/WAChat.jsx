/**
 * WAChat.jsx — one WhatsApp conversation.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { ErrorState, errorKind, SkeletonChat, useToast } from '../../../components/ui';
import { formatTime } from '../../../lib/timeFormat';
import Composer from '../Composer';
import { SvIcons, WA_STATUS_LABEL, WaTicks } from '../icons';
import useStickyScroll from '../useStickyScroll';
import { mergeById } from '../messageUtils';
import WindowBanner from './WindowBanner';
import TemplatePicker from './TemplatePicker';
import { windowState } from './waWindow';

const POLL_MS = 5000;

export default function WAChat({ conversation, onBack }) {
  const { pushToast } = useToast();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Bumped by the error state's Retry, which re-runs the effect below rather
  // than reloading the whole document and losing the rest of the page.
  const [attempt, setAttempt] = useState(0);

  const sig = `${messages.length}:${messages[messages.length - 1]?.id || ''}`;
  const { logRef, pinned, jump } = useStickyScroll(sig);

  const convId = conversation.id;

  useEffect(() => {
    let dead = false;
    let first = true;
    setLoading(true);
    setError(null);
    setMessages([]);

    const load = async () => {
      try {
        const r = await api.get(`/whatsapp/conversations/${convId}/messages`);
        if (dead) return;
        const page = (Array.isArray(r.data) ? r.data : []).slice().reverse();
        setMessages(prev => mergeById(prev, page));
        setError(null);
      } catch (e) {
        if (!dead && first) setError(e);
      } finally {
        if (!dead && first) { first = false; setLoading(false); }
      }
    };

    load();
    const tick = () => { if (!document.hidden) load(); };
    const iv = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      dead = true;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [convId, attempt]);

  const win = useMemo(() => windowState(messages), [messages]);

  const post = useCallback(async (content, type) => {
    try {
      const r = await api.post(`/whatsapp/conversations/${convId}/messages`, { content, type });
      setMessages(prev => mergeById(prev, [r.data]));
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to send' });
      throw e;
    }
  }, [convId, pushToast]);

  const sendText = useCallback(body => post(body, 'text'), [post]);

  /**
   * `06` §4 asks for `POST /whatsapp/conversations/:id/template`. It does not
   * exist, and the backend is not this module's to add it to — so the template
   * goes through the existing send with `type: 'template'`, which the
   * `varta_messages.type` CHECK already allows. What is lost is
   * `template_name` / `template_params`: the body is stored, the binding to the
   * Meta template is not. That endpoint is the real fix and is reported.
   */
  const sendTemplate = useCallback(tpl => post(tpl.body || tpl.name, 'template'), [post]);

  const name = conversation.contact_name || conversation.phone_number;

  return (
    <div className="wa">
      <header className="sv__hd">
        {onBack && (
          <button type="button" className="svbtn" onClick={onBack} aria-label="Back to conversations">
            {SvIcons.back}
          </button>
        )}
        <h2 className="sv__hd-n">{name}</h2>
        <p className="sv__hd-d">{conversation.phone_number}</p>
      </header>

      {error ? (
        <div className="sv__blank">
          <ErrorState kind={errorKind(error)} onRetry={() => setAttempt(n => n + 1)} />
        </div>
      ) : (
        <div className="sv__logwrap">
          <div className="wa__log" ref={logRef}>
            {loading && <SkeletonChat rows={4} />}
            {!loading && messages.length === 0 && (
              <p className="wa__none">No messages in this conversation yet.</p>
            )}
            {!loading && messages.map(m => {
              const out = m.direction === 'outbound';
              const label = WA_STATUS_LABEL[m.status] || m.status;
              return (
                <React.Fragment key={m.id}>
                  <div className={`wa__b ${out ? 'wa__b--out' : 'wa__b--in'}`}>
                    {m.content}
                    <div className="wa__m">
                      <time dateTime={m.created_at}>{formatTime(m.created_at)}</time>
                      {out && WaTicks[m.status] && (
                        /* The glyph is identical for delivered and read; the
                           colour is the whole distinction (06 §3, 00 §9). The
                           status is therefore also in the accessible name —
                           a colour cannot be the only carrier of meaning. */
                        <span title={label} aria-label={label}>{WaTicks[m.status]}</span>
                      )}
                    </div>
                  </div>
                  {out && m.status === 'failed' && (
                    /* `varta_messages.error_code` comes back on the row and was
                       being dropped. 131047 (re-engagement) and 131026
                       (undeliverable) are the two a sender acts on differently,
                       and "Failed" alone does not distinguish them. */
                    <p className="wa__err">
                      {SvIcons.alert}
                      {m.error_code ? `Not delivered · ${m.error_code}` : 'Not delivered'}
                    </p>
                  )}
                </React.Fragment>
              );
            })}
          </div>
          {!loading && !pinned && messages.length > 0 && (
            <button type="button" className="sv__jump" onClick={jump}>
              {SvIcons.down}
              Jump to latest
            </button>
          )}
        </div>
      )}

      <WindowBanner state={win} />

      {win.open
        ? <Composer emoji onSend={sendText} disabled={!!error} label="WhatsApp message" placeholder="Write a message…" />
        : <TemplatePicker onSend={sendTemplate} disabled={!!error} />}
    </div>
  );
}
