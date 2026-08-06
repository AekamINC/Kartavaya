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
import { fromServer, windowState } from './waWindow';

const POLL_MS = 5000;

export default function WAChat({ conversation, onBack }) {
  const { pushToast } = useToast();
  const [messages, setMessages] = useState([]);
  // `GET /conversations/:id/window` — the authority, because it reads every
  // inbound row rather than the newest page of fifty. Null until it answers and
  // null again if it fails, at which point `windowState` over the loaded page
  // takes over; the composer must never render in an unknown state.
  const [serverWin, setServerWin] = useState(null);
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
    setServerWin(null);

    const load = async () => {
      try {
        // Both in one round of the poll. The window request is a single
        // indexed MAX() over one conversation and is far cheaper than the
        // message page beside it; asking for it separately, or only on mount,
        // is how the composer ends up still offering free text ninety minutes
        // after the window shut.
        //
        // `allSettled`, not `all`: a window request that fails must not blank
        // the message log. Its failure means "fall back to the local
        // derivation", which is what a null `serverWin` says.
        const [msgRes, winRes] = await Promise.allSettled([
          api.get(`/v1/whatsapp/conversations/${convId}/messages`),
          api.get(`/v1/whatsapp/conversations/${convId}/window`),
        ]);
        if (dead) return;

        if (winRes.status === 'fulfilled') setServerWin(winRes.value?.data ?? null);
        else setServerWin(null);

        if (msgRes.status === 'rejected') throw msgRes.reason;
        const page = (Array.isArray(msgRes.value.data) ? msgRes.value.data : [])
          .slice().reverse();
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

  /**
   * The server's answer when there is one, the local derivation otherwise.
   *
   * Not "the more conservative of the two". The server sees every inbound row
   * in the conversation and this page sees fifty messages, so on any
   * disagreement the server is simply right — including the disagreement that
   * matters, where a long outbound run pushes the last inbound message off the
   * page and the local derivation reports a thread that has been open for
   * hours as one the customer never wrote to.
   */
  const win = useMemo(
    () => fromServer(serverWin) || windowState(messages),
    [serverWin, messages]
  );

  /**
   * `MOTION-SPEC.md` §7.1, on the Varta side. The bubble goes up before the
   * request, not after it — `Composer` empties the box on the keystroke, so
   * awaiting the round trip first would show the sender nothing at all, and a
   * WhatsApp send is the slowest one in the product: it is a Meta API call
   * behind our own.
   *
   * `status: 'pending'` is not invented for this. It is already one of the five
   * in `WA_STATUS_LABEL`, and `WaTicks.pending` is already the clock glyph — so
   * the placeholder renders as "Pending" with the accessible name the tick
   * always had, and the real row overwrites it with `sent` a moment later. The
   * `.wa__b--sending` opacity is the same .6 as `.msg--sending`.
   */
  const post = useCallback(async (payload, echo) => {
    const tmpId = `tmp:${Date.now()}`;
    setMessages(prev => mergeById(prev, [{
      id: tmpId,
      direction: 'outbound',
      content: echo,
      type: payload.type,
      status: 'pending',
      created_at: new Date().toISOString(),
      __pending: true,
    }]));
    try {
      const r = await api.post(`/v1/whatsapp/conversations/${convId}/messages`, payload);
      setMessages(prev => mergeById(prev.filter(m => m.id !== tmpId), [r.data]));
    } catch (e) {
      setMessages(prev => prev.filter(m => m.id !== tmpId));
      // The server now refuses a free-form send outside the 24-hour window and
      // says so in `detail`. That refusal reaching a user means this tab's idea
      // of the window was stale, so the state is dropped and the next poll —
      // five seconds away — re-reads it and the composer becomes the template
      // picker it should already have been.
      const detail = e.response?.data?.detail;
      if (e.response?.status === 409) setServerWin(null);
      pushToast({ type: 'error', title: detail || 'Failed to send' });
      throw e;
    }
  }, [convId, pushToast]);

  const sendText = useCallback(
    body => post({ content: body, type: 'text' }, body),
    [post]
  );

  /**
   * A template send now names the template.
   *
   * It used to post `{content: tpl.body, type: 'template'}` — the rendered text
   * under a template label, with no binding to the Meta template at all. Two
   * things were wrong with that and only one was cosmetic. `template_name` and
   * `template_params` are columns on `varta_messages` that stayed empty, so
   * nothing could later say WHICH template a customer received; and because
   * the id never travelled, the server had nothing to check approval against
   * and a `draft` template was indistinguishable from an `approved` one on the
   * wire.
   *
   * `template_id` is what the server resolves, re-reads the body from, and
   * refuses when Meta has not approved it. `TemplatePicker` only offers
   * approved ones, and that is now the second line of defence rather than the
   * only one.
   */
  const sendTemplate = useCallback(
    tpl => post(
      { type: 'template', template_id: tpl.id, template_params: {} },
      tpl.body || tpl.name,
    ),
    [post]
  );

  const name = conversation.contact_name || conversation.phone_number;

  /**
   * The 24-hour window, as the header chip. `.m2win` has THREE states where the
   * build's `.wa__win` had two.
   *
   * `--soon` is the new one and it is under an hour. `formatRemaining` already
   * had the minutes and nothing read them for anything but a sentence, so an
   * operator with eleven minutes left saw the same quiet green strip as one with
   * nineteen hours — and eleven minutes is precisely when the difference between
   * a free-text reply and a template round-trip decides whether the customer
   * hears back today.
   */
  const mins = win.open ? Math.floor(win.remainingMs / 60000) : 0;
  const winState = !win.open ? 'shut' : (mins < 60 ? 'soon' : 'open');
  const winLabel = !win.open
    ? 'closed'
    : (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m left` : `${mins}m left`);

  return (
    /* `position: relative` for `.m2jump`, exactly as the Sanvaad column does. */
    <div className="m2__col m2c" style={{ position: 'relative' }}>
      <header className="m2c__hd">
        {onBack && (
          <button type="button" className="svbtn" onClick={onBack} aria-label="Back to conversations">
            {SvIcons.back}
          </button>
        )}
        <span className="m2c__ic m2row__av--wa" aria-hidden="true">{SvIcons.wa}</span>
        <div className="m2c__id">
          <h2 className="m2c__n">
            {name}
            <span
              className={`m2win m2win--${winState}`}
              title="Time left in the 24-hour reply window"
            >
              {winLabel}
            </span>
          </h2>
          {/* §8 again, on this side: the WhatsApp log is a five-second poll of
              `GET /conversations/:id/messages`, so the sub-line says so rather
              than claiming anything live. */}
          <p className="m2c__sub">
            {conversation.phone_number} · updates every few seconds
          </p>
        </div>
      </header>

      {error ? (
        <div className="sv__blank">
          <ErrorState kind={errorKind(error)} onRetry={() => setAttempt(n => n + 1)} />
        </div>
      ) : (
        <>
          <div className="m2log" ref={logRef}>
            {loading && <SkeletonChat rows={4} />}
            {!loading && messages.length === 0 && (
              <p className="sv__none">No messages in this conversation yet.</p>
            )}
            {!loading && messages.map(m => {
              const out = m.direction === 'outbound';
              const label = WA_STATUS_LABEL[m.status] || m.status;
              return (
                <React.Fragment key={m.id}>
                  {/* A CUSTOMER THREAD USES THE SAME BUBBLE AS A CHANNEL, which
                      is deliberate: the SURFACE is what differs between an
                      internal room and a metered one — the tab, the rail tile,
                      the window chip, the composer that turns into a template
                      picker — and none of that is helped by a second bubble
                      geometry. `.m2m--mine` is the outbound side here, the same
                      asymmetric corner pointing at the speaker.

                      No avatar: `.m2m--run` hides one, and every row in this log
                      is from one of exactly two people whose names are in the
                      header. */}
                  <div
                    className={`m2m m2m--run${out ? ' m2m--mine' : ''}${m.__pending ? ' msg--sending' : ''}`}
                  >
                    <div className="m2m__b">
                      <p className="m2m__t">{m.content}</p>
                      <div className="m2m__hd">
                        <time className="m2m__at" dateTime={m.created_at}>
                          {formatTime(m.created_at)}
                        </time>
                        {/* §5 — DELIVERED AND READ MUST NOT LOOK THE SAME, and
                            the fix is the WORD, not the glyph.

                            The handover claims both states rendered the same
                            '✓✓' string. That is not what was here: `icons.jsx`
                            already draws four distinct glyphs and puts
                            `.wa__tick--read` on `--tick-read`, so the colour
                            distinction shipped. What did not ship is a reading
                            that survives colour — a red/green-blind operator, a
                            greyscale screenshot in a support ticket, or a
                            `--motion-scale: 0` user with a high-contrast theme
                            all see two identical double ticks.

                            So the status is now printed beside the mark, exactly
                            as `Msg2Chat.jsx:116-120` renders it: "Delivered ✓✓"
                            against "Read ✓✓". The tick keeps its colour, and the
                            word is what makes the colour redundant rather than
                            load-bearing. `aria-label` stays on the glyph for the
                            same reason it was there before. */}
                        {out && WaTicks[m.status] && (
                          <span className={`m2tick m2tick--${m.status}`}>
                            {label}
                            <span title={label} aria-label={label}>{WaTicks[m.status]}</span>
                          </span>
                        )}
                      </div>
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
            <button type="button" className="m2jump" onClick={jump}>
              {SvIcons.down}
              Jump to latest
            </button>
          )}
        </>
      )}

      {/* The window banner is `.m2c__banner--warn` when it has closed and a
          quiet strip while it is open — see `WindowBanner`. It sits directly
          above the composer, which is the control it is about. */}
      <WindowBanner state={win} />

      {win.open
        ? <Composer emoji onSend={sendText} disabled={!!error} label="WhatsApp message" placeholder={`Message ${name} on WhatsApp…`} />
        : <div className="m2cp"><TemplatePicker onSend={sendTemplate} disabled={!!error} /></div>}
    </div>
  );
}
