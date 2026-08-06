/**
 * MessagingTabs.jsx — the module shell. `28-messaging-v2.md` §1.
 *
 * ONE MODULE, TWO TABS, AND THE SEPARATION IS A SAFETY BOUNDARY.
 * `messaging.css:8-15` states it and the reason is not filing: an internal
 * channel and a customer's WhatsApp thread look alike in a rail and behave
 * nothing alike — one is a colleague, the other is a person outside the firm on
 * a metered channel with a 24-hour window and Meta-approved templates. A shared
 * list makes sending the wrong thing to the wrong audience a one-click mistake.
 * That is why `.m2row__av--wa` exists as a row VARIANT and is still never
 * rendered in the Messages rail.
 *
 * WHAT THIS REPLACES. `SanvaadPage` rendered `components/ui`'s generic `Tabs`,
 * whose strip is `.tabs__b` and carries no per-tab count and no room for the
 * connected number. `.m2tabs` is a different strip with two things the generic
 * one cannot hold:
 *
 *   · `.m2tabs__n` — the unread weight of the tab you are NOT looking at, which
 *     is the whole reason to glance at a tab strip in a chat product;
 *   · `.m2tabs__meta` — which business number is connected, on the WhatsApp tab
 *     only, because "who will the customer see this from" is the first question
 *     anybody asks before typing into a metered channel.
 *
 * THE MESSAGES COUNT IS REAL AND THE WHATSAPP COUNT IS NOT RENDERED.
 * `GET /v1/messaging/unread` answers `{channel_id: n}` for every channel with
 * anything unread, so the Messages badge is a sum of a live server number.
 * `varta_conversations` (058_sanvaad_messaging.sql:116-124) has SIX columns and
 * none of them is an unread count, and `list_conversations` selects `c.*` plus a
 * `last_message` string — there is no per-conversation unread anywhere in the
 * WhatsApp schema. So the WhatsApp tab gets NO badge rather than a
 * plausible-looking zero. A badge that is always absent is a missing feature; a
 * badge that reads 0 while three customers are waiting is a lie.
 *
 * ONE TAB AT A TIME, WHICH IS THE PROTOTYPE'S OWN SEMANTICS. `Messaging
 * v2.html`'s `go(k)` resets the segment, the selection and the open pane on
 * every tab change, so nothing here is being thrown away that the prototype
 * keeps. The two panels are therefore mounted exclusively rather than hidden,
 * which also means the inactive tab's controls cannot be reached by Tab.
 *
 * `role="tabpanel"` IS NOT SET HERE. It belongs on the element that IS the
 * panel, and that element is `.m2` inside each tab — a wrapper of my own around
 * it would need a class with no rule in `messaging.css`, and an unclassed
 * wrapper between `.m2mod` (a flex column) and `.m2` (`flex: 1; min-height: 0`)
 * would swallow the flex relationship and collapse the grid to its content
 * height. Each tab spells its own two attributes; there are exactly two.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { SvIcons } from './icons';
import ChannelsTab from './ChannelsTab';
import WhatsAppTab from './varta/WhatsAppTab';
import { Secondary } from '../../components/Bilingual';

/**
 * How often the tab badge re-reads the unread map.
 *
 * Deliberately slower than `/live`'s four seconds. `usePresence` inside
 * `ChannelsTab` is the authority on per-channel counts and repaints the rail;
 * this is a summary sitting above it, and a strip that flickers a digit every
 * four seconds draws the eye away from the conversation. Twenty seconds is well
 * inside the span where the number is still worth trusting.
 */
const UNREAD_POLL_MS = 20000;

export default function MessagingTabs() {
  const [tab, setTab] = useState('msg');
  const [unread, setUnread] = useState(0);
  /**
   * The connected WhatsApp business number, or null.
   *
   * `GET /v1/whatsapp/accounts` returns every account for the org with a
   * `status` of `pending | active | suspended`. Only an ACTIVE one can send —
   * `record_inbound` joins `varta_business_accounts` on `status = 'active'` — so
   * a pending account is not a connected number and must not be reported as one
   * beside a green dot.
   */
  const [account, setAccount] = useState(null);

  const loadUnread = useCallback(async () => {
    try {
      const r = await api.get('/v1/messaging/unread');
      const map = r.data && typeof r.data === 'object' ? r.data : {};
      setUnread(Object.values(map).reduce((n, v) => n + (Number(v) || 0), 0));
    } catch {
      // Keep the last good number. Blanking the badge on one timeout tells the
      // reader their unread messages have been read by somebody — the same
      // bargain `usePresence` strikes for the per-channel counts.
    }
  }, []);

  useEffect(() => {
    loadUnread();
    const tick = () => { if (!document.hidden) loadUnread(); };
    const iv = setInterval(tick, UNREAD_POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [loadUnread]);

  /**
   * Fetched on the first visit to the WhatsApp tab rather than on mount: a
   * reader who never opens that tab never pays for it, and the answer does not
   * change while a tab is open. `asked` is a state flag rather than a ref so the
   * effect re-runs exactly once and never again.
   */
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (tab !== 'wa' || asked) return undefined;
    setAsked(true);
    let dead = false;
    api.get('/v1/whatsapp/accounts')
      .then((r) => {
        if (dead) return;
        const rows = Array.isArray(r.data) ? r.data : [];
        setAccount(rows.find(a => a.status === 'active') || null);
      })
      .catch(() => { /* no number reported rather than a wrong one */ });
    return () => { dead = true; };
  }, [tab, asked]);

  const TABS = [
    { id: 'msg', label: 'Messages', hi: 'संवाद', n: unread },
    { id: 'wa', label: 'WhatsApp', hi: 'वार्ता', n: 0 },
  ];

  return (
    <div className="m2mod">
      <div className="m2tabs" role="tablist" aria-label="Messaging">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`m2tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`m2panel-${t.id}`}
            className={tab === t.id ? 'on' : undefined}
            onClick={() => setTab(t.id)}
          >
            {/* The brand mark on the WhatsApp tab only — the one label on this
                strip a reader recognises before they read it, and the whole
                point of the boundary is that they notice which side of it they
                are on. Unwrapped: `.m2tabs button` is already a flex row with a
                7px gap, so a span would only be somewhere to hang a colour, and
                the prototype hangs `#0B6B33` there. A literal is not ours to
                paste and `--wa-ink` is the stylesheet's to declare, so the glyph
                takes the button's own colour and moves with its state. */}
            {t.id === 'wa' && SvIcons.wa}
            {t.label}
            <Secondary className="hi" value={t.hi} />
            {t.n > 0 && (
              <span className="m2tabs__n" aria-label={`${t.n} unread`}>
                {t.n > 99 ? '99+' : t.n}
              </span>
            )}
          </button>
        ))}
        <span className="m2tabs__sp" />
        {/* Only when a number is genuinely connected AND active. `i` is the dot
            and carries no text, so the sentence beside it is the accessible
            carrier and the dot is decoration. */}
        {tab === 'wa' && account && (
          <span className="m2tabs__meta">
            <i aria-hidden="true" />
            Business number connected · {account.phone_number}
          </span>
        )}
      </div>

      {tab === 'msg' ? <ChannelsTab /> : <WhatsAppTab />}
    </div>
  );
}
