/**
 * ChannelList.jsx — the rail. `messaging.css` §"Rail" and §"Conversation row".
 *
 * ONE ROW TYPE, NOT TWO SECTIONS. `.m2row` is the whole vocabulary for a
 * channel, a private channel and a direct message; what differs is the avatar's
 * SHAPE — `.m2row__av--dm` is `border-radius: 50%` and `.m2row__av--ch` is
 * `var(--r-sm)` — and that is the only structural difference between a person
 * and a room. The build's two `<h2 class="sv__sec">` headings are gone with the
 * split list they labelled.
 *
 * WHY UNIFIED AND NOT SECTIONED, since `messaging.css` ships both.
 * `Messaging v2.html`'s own note: sectioned is "better when the counts matter
 * more than the order; worse when you are triaging, because unread is scattered
 * across two lists instead of sorted into one." §10 picks the rail and this file
 * renders the rail. `.m2--sections` and `.m2r__sec*` stay in the stylesheet as
 * the recorded alternative and appear in check-classes' report-only unused list,
 * which costs nothing.
 *
 * THE FILTER CHIPS ARE WHERE THE ARCHIVED SECTION WENT. `.sv__ltog` was an
 * Active/All toggle beside the title and the archived rows were a third labelled
 * section under the other two. With one list there is nowhere for a section to
 * go, so "Archived" is a fourth `.m2seg` — which is the same control in the
 * shape the new rail has for it. Losing it was not an option: `list_channels`
 * hard-filtered `is_archived = FALSE` until recently and an archived channel
 * with no route back is unreachable in both directions.
 *
 * ── Two facts the row wants and the API does not carry ──────────────────────
 *
 * `.m2row__last` is the last message and its sender in the prototype.
 * `GET /v1/messaging/channels` is `SELECT c.*` plus four computed columns
 * (`member_count`, `my_last_read`, `muted`, `mention_count`, `unread_count`) and
 * NONE of them is a message body or a sender name — there is no last-message
 * column on `samvada_channels` at all. So the slot carries what the row actually
 * knows, which is what this rail has always printed: how many people are in it.
 * Inventing a preview would need a lateral join in `list_channels`; it is
 * reported, not smuggled in.
 *
 * `.m2row__dot` is presence, and a DM row cannot carry one. `/live` returns a
 * presence map keyed by USER id, and a DM channel row has no peer user id on it
 * — `_channel_row` spreads the channel, and the peer is only recoverable through
 * `GET /channels/:id/members`, which is one request per DM row in the rail. The
 * dot is therefore not rendered rather than rendered from a guess.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { Avatar, ErrorState, errorKind, Input, Select, SkeletonList } from '../../components/ui';
import { relTime } from '../../lib/utils';
import { channelIcon, SvIcons } from './icons';
import { toneStyle } from './channelTone';

/**
 * One conversation row.
 *
 * `.m2row__meta` is new and it replaces a piece of machinery rather than only a
 * class name. `sanvaad.css` gave `.ch__mn` and `.ch__badge` each a
 * `margin-left: auto` and then zeroed it on whichever FOLLOWED another, so the
 * order of the three trailing elements was load-bearing: swapping them left a
 * gap. `.m2row__meta` is one flex group with its own gap, so the order is now
 * only an order.
 */
function ChannelRow({ ch, on, onSelect }) {
  const unread = Number(ch.unread_count) || 0;
  const members = Number(ch.member_count) || 0;
  const name = ch.name || 'Direct message';
  const dm = ch.type === 'dm';

  /**
   * Muting suppresses the COUNT and not the MENTION, which is why there are two
   * badges. The unread count is information and muting a channel says its
   * information can wait; a mention is an obligation and nobody mutes their own
   * name. `.m2row__mn` is `--danger` where `.m2row__badge` is `--primary` for
   * exactly that reason.
   */
  const mentions = Number(ch.mention_count) || 0;
  const muted = !!ch.muted;
  const showUnread = unread > 0 && !muted;

  /**
   * `.m2row.loud` bolds the name, and it should bold it exactly when the row is
   * carrying something the reader still has to deal with. A muted channel with
   * forty unread messages is not that; a muted channel where somebody said your
   * name is. Deriving it from what the row actually SHOWS keeps the weight and
   * the badges from disagreeing — a bold row with no badge on it reads as a
   * rendering fault.
   */
  const loud = mentions > 0 || showUnread;

  /**
   * `.m2row__when` is suppressed under `loud` in the prototype (`Msg2.jsx:83`),
   * and the reason is width rather than taste: the badges and a timestamp both
   * live in `.m2row__meta`, and a row with two badges and a time ellipsises the
   * name it is supposed to be identifying.
   */
  const when = ch.updated_at ? relTime(ch.updated_at) : null;

  return (
    <button
      type="button"
      className={`m2row${on ? ' on' : ''}${loud ? ' loud' : ''}${ch.is_archived ? ' m2row--arch' : ''}`}
      onClick={() => onSelect(ch)}
      aria-current={on ? 'true' : undefined}
      /**
       * The channel's stored identity tone, as an inline custom property the
       * avatar tile reads through `--ch-c`. `undefined` for a DM and for a row
       * with no id, which leaves `.m2row__av--ch`'s own `var(--primary)`
       * fallback in place — see `channelTone.js` for why null is a real answer
       * there rather than missing data.
       *
       * It is NOT in the accessible name. A colour that duplicates the channel
       * name it sits beside carries nothing a screen reader needs — unlike the
       * mute glyph and the two badges, whose only other carrier is an absence.
       */
      style={toneStyle(ch)}
    >
      {dm ? (
        /* A face for a person. `Avatar` draws initials over a derived tint, so
           a DM row is identifiable before the name is read — which is the job
           `.m2row__av--dm`'s circle is doing beside it. */
        <Avatar className="m2row__av m2row__av--dm" name={name} size={34} />
      ) : (
        <span className="m2row__av m2row__av--ch" aria-hidden="true">
          {channelIcon(ch.type)}
        </span>
      )}

      <span className="m2row__txt">
        <span className="m2row__n">
          <b>{name}</b>
          {/* `ScreensSanvaad.jsx:172` — an archived row keeps its own word
              rather than only the dimmed treatment `.m2row--arch` gives it,
              because dimming alone reads as disabled and these are still
              readable. `.m2row__kind` is the prototype's slot for a word in
              this position and it had no renderer in the prototype either. */}
          {ch.is_archived && <span className="m2row__kind">archived</span>}
        </span>
        <span className="m2row__last">
          {members} member{members === 1 ? '' : 's'}
        </span>
      </span>

      <span className="m2row__meta">
        {!loud && when && <span className="m2row__when">{when}</span>}
        {mentions > 0 && (
          <span className="m2row__mn" aria-label={`${mentions} mention${mentions === 1 ? '' : 's'}`}>
            {mentions > 99 ? '99+' : mentions}
          </span>
        )}
        {showUnread && (
          <span className="m2row__badge" aria-label={`${unread} unread`}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
        {/* `role="img"` with a name, not `aria-hidden` — muting is a state whose
            only other carrier is the absence of a badge, and an absence
            announces nothing. */}
        {muted && (
          <span className="m2row__mute" role="img" aria-label="Muted">{SvIcons.bellOff}</span>
        )}
      </span>
    </button>
  );
}

/**
 * The people picker behind "New direct message".
 *
 * Reads `GET /v1/messaging/directory`. The only other user list in the API is
 * `GET /v1/org/members`, gated on `require_org_role("org_admin","org_owner")`,
 * so an ordinary member had no way to name anybody — which is half the reason
 * `POST /v1/messaging/dm` never acquired a caller.
 */
function DmPicker({ onPick, onClose }) {
  const [q, setQ] = useState('');
  // `null` while unknown — never `[]`. "Nobody else is in your organisation
  // yet" is a claim about the firm's headcount, and a rejected directory read
  // used to print it verbatim to someone whose colleagues are all present.
  const [people, setPeople] = useState(null);
  const [dirErr, setDirErr] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let dead = false;
    const t = setTimeout(() => {
      api.get('/v1/messaging/directory', { params: q.trim() ? { q: q.trim() } : undefined })
        .then(r => { if (!dead) { setPeople(Array.isArray(r.data) ? r.data : []); setDirErr(null); } })
        .catch(e => { if (!dead) { setPeople(null); setDirErr(e); } });
    }, 220);
    return () => { dead = true; clearTimeout(t); };
  }, [q]);

  return (
    <div className="sv__lnew">
      <Input
        type="search"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search people"
        aria-label="Search people to message"
        autoFocus
      />
      {dirErr ? (
        <p className="sv__none">
          {errorKind(dirErr) === 'offline'
            ? 'The people list needs a connection. It loads as soon as you have one.'
            : errorKind(dirErr) === 'denied'
              ? 'You do not have access to the people list.'
              : 'The people list did not load, so this is not a list of who is here.'}
        </p>
      ) : people === null ? (
        <p className="sv__none">Searching…</p>
      ) : people.length === 0 ? (
        <p className="sv__none">
          {q.trim() ? `Nobody matches “${q.trim()}”.` : 'Nobody else is in your organisation yet.'}
        </p>
      ) : null}
      {(people || []).map(p => (
        <button
          key={p.user_id}
          type="button"
          className="m2row"
          disabled={busy === p.user_id}
          onClick={async () => {
            setBusy(p.user_id);
            const made = await onPick(p);
            setBusy(null);
            if (made) onClose();
          }}
        >
          <Avatar className="m2row__av m2row__av--dm" name={p.full_name} src={p.avatar_url} size={34} />
          <span className="m2row__txt"><span className="m2row__n"><b>{p.full_name}</b></span></span>
        </button>
      ))}
    </div>
  );
}

/**
 * All / Unread / Mentions / Archived.
 *
 * `Msg2.jsx:126-128` gives the Messages rail three chips and the WhatsApp rail
 * four different ones; the counts beside them are of the WHOLE list, not of the
 * filtered one, because a chip that reports its own result is a chip that always
 * reads as the number of rows you are already looking at.
 *
 * Archived carries no count. The archived list is a second request made only
 * when the chip is chosen (`list_channels?archived=true` returns the archived
 * set INSTEAD of the live one), so before the chip is pressed there is no honest
 * number to put on it.
 */
const SEGS = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['mentions', 'Mentions'],
  ['arch', 'Archived'],
];

export default function ChannelList({
  channels, archived = [], showAll, onToggleAll, loading, selectedId,
  onSelect, onCreate, onOpenDm, canPost = true, creating, error = null, onRetry,
  /**
   * The poll has stopped answering and every number in this rail is older than
   * it looks. A node rather than a boolean, because the sentence is the shell's
   * to write — it is about `/live`, which this file has never heard of.
   */
  notice = null,
  /**
   * The mentions FEED, which is not the Mentions CHIP.
   *
   * The chip filters this rail down to the conversations where somebody said
   * your name; the feed is a panel listing the messages themselves, across every
   * channel, with a mark-read contract of its own. They answer different
   * questions — "which room" versus "what was said" — and the second is the one
   * a reader opens when they have been away.
   *
   * It sits above the list rather than in the chat header because it is
   * org-wide: the reader who most needs it is the one who does not have a
   * channel open yet.
   */
  onOpenMentions, mentionsOpen = false, mentionUnread = 0,
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('public');
  /**
   * The active chip.
   *
   * `showAll` is still the shell's state and still what fires the archived
   * fetch, so the chip and the toggle are one control: choosing Archived calls
   * `onToggleAll` when it is off, and leaving Archived calls it when it is on.
   * Keeping the fetch upstairs is deliberate — `ChannelsTab.jumpTo` needs the
   * archived rows returned to it in the same tick to resolve a search hit into a
   * channel that is not on the rail.
   */
  const [seg, setSeg] = useState('all');
  const pickSeg = (next) => {
    setSeg(next);
    if ((next === 'arch') !== !!showAll) onToggleAll?.();
  };

  const { shown, counts } = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = c => !needle || (c.name || 'direct message').toLowerCase().includes(needle);
    const live = channels.filter(match);
    const by = {
      all: () => true,
      unread: c => (Number(c.unread_count) || 0) > 0 && !c.muted,
      mentions: c => (Number(c.mention_count) || 0) > 0,
      arch: () => true,
    };
    return {
      shown: seg === 'arch' ? archived.filter(match) : live.filter(by[seg] || by.all),
      counts: {
        unread: live.filter(by.unread).length,
        mentions: live.filter(by.mentions).length,
      },
    };
  }, [channels, archived, q, seg]);

  const submit = async () => {
    const n = name.trim();
    if (!n) return;
    const made = await onCreate(n, type);
    if (made) { setName(''); setOpen(false); }
  };

  /**
   * What an empty list means, which is four different sentences.
   *
   * A filter that matched nothing is not the same statement as a firm with no
   * channels in it, and neither is the same as a search with no hits. The one
   * that used to be wrong most often is the last: `canPost` gates the `+` that
   * creates a channel, so offering "Create one to start messaging" to a viewer
   * invites an action the product does not give them.
   */
  const emptyLine = q.trim()
    ? `Nothing matches “${q.trim()}”.`
    : seg === 'unread' ? 'Everything is read.'
      : seg === 'mentions' ? 'Nobody has mentioned you.'
        : seg === 'arch' ? 'No archived conversations.'
          : canPost
            ? 'No conversations yet. Create a channel or open a direct message to start.'
            : 'You are not in any channels yet.';

  return (
    <div className="m2__col m2r">
      <div className="m2r__hd">
        <span className="m2r__t">
          Messages<span className="m2r__t-hi" lang="hi">संवाद</span>
        </span>
        <span className="m2r__sp" />
        {canPost && onOpenDm && (
          <button
            type="button"
            className="svbtn"
            onClick={() => { setDmOpen(o => !o); setOpen(false); }}
            aria-label="New direct message"
            aria-expanded={dmOpen}
          >
            {SvIcons.chat}
          </button>
        )}
        {canPost && (
          <button
            type="button"
            className="svbtn"
            onClick={() => { setOpen(o => !o); setDmOpen(false); }}
            aria-label="New channel"
            aria-expanded={open}
          >
            {SvIcons.plus}
          </button>
        )}
      </div>

      {notice}

      {/* Hidden while the rail is failing, not disabled. The whole panel reads
          `/v1/messaging/mentions` behind the same `_gate` that has just refused
          `/channels`, so the count would be zero and the panel would open onto
          the same 403 the rail is already explaining beside it — two panes of
          one screen reporting one failure twice. */}
      {onOpenMentions && !error && (
        <button
          type="button"
          className="sv__mnb"
          onClick={onOpenMentions}
          aria-expanded={mentionsOpen}
        >
          <span className="ch__ic" aria-hidden="true">{SvIcons.at}</span>
          <span className="sv__mnb-t">
            Mentions
            <span className="sv__hi" lang="hi">उल्लेख</span>
          </span>
          {/* `.m2row__mn` and not a badge of its own. This is the same fact the
              rail's per-row `@3` carries — "somebody said your name" — and it is
              `--danger` where the unread count is `--primary` for the same
              reason. A second mention badge in a second shape, eight pixels
              above the first, would read as two different things. */}
          {mentionUnread > 0 && (
            <span
              className="m2row__mn"
              aria-label={`${mentionUnread} unread mention${mentionUnread === 1 ? '' : 's'}`}
            >
              {mentionUnread > 99 ? '99+' : mentionUnread}
            </span>
          )}
        </button>
      )}

      {/* A `<label>`, so the glyph is part of the field's hit area rather than
          decoration beside it. `.m2r__search input` strips the browser chrome;
          `ui/Input` would bring its own border inside this pill. */}
      <label className="m2r__search">
        {SvIcons.search}
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search conversations"
          aria-label="Search conversations"
        />
      </label>

      <div className="m2r__segs" role="group" aria-label="Filter conversations">
        {SEGS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`m2seg${seg === k ? ' on' : ''}${k === 'mentions' ? ' m2seg--alert' : ''}`}
            aria-pressed={seg === k}
            onClick={() => pickSeg(k)}
          >
            {label}
            {counts[k] != null && <span className="m2seg__n">{counts[k]}</span>}
          </button>
        ))}
      </div>

      {open && (
        <div className="sv__lnew">
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            placeholder="Channel name"
            aria-label="Channel name"
            autoFocus
          />
          <div className="sv__lnew-row">
            <Select value={type} onChange={e => setType(e.target.value)} aria-label="Channel visibility">
              <option value="public">Public</option>
              <option value="private">Private</option>
            </Select>
            <button type="button" className="btn btn--fill btn--sm" onClick={submit} disabled={creating || !name.trim()}>
              Create
            </button>
          </div>
        </div>
      )}

      {dmOpen && <DmPicker onPick={onOpenDm} onClose={() => setDmOpen(false)} />}

      <div className="m2r__scroll">
        {loading && <SkeletonList rows={6} showAvatar={false} />}

        {/* A failed list is not an empty one. Every sentence above makes a claim
            about this person's membership, and none of them is knowable from a
            request that did not answer. */}
        {!loading && error && (
          <ErrorState
            kind={errorKind(error)}
            /* The headline, too — not only the sentence under it. With the
               server's own detail in place this read "You don't have access to
               this" above "Module 'sanvaad' is not active", naming a cause the
               server had just contradicted. */
            title={errorKind(error) === 'denied' ? 'Messages can’t be opened' : undefined}
            /* The SERVER'S sentence wins when it has one. Measured live as an
               org_admin: Sanvaad is not an active module for the org, and the
               API says exactly that. This screen threw that away and showed
               "You don't have access to this", which named the wrong cause
               (activation, not access) and sent the reader to ask for a grant
               that would not have helped. */
            detail={errorKind(error) === 'offline'
              ? 'Your channels need a connection to load. Nothing has been lost — messages sent while you were away are waiting.'
              : (error?.response?.data?.detail
                || 'Your channel list did not load. This is a read failure; no channel or message was removed.')}
            onRetry={onRetry}
          />
        )}

        {!loading && !error && shown.map(c => (
          <ChannelRow
            key={c.id}
            ch={c}
            on={String(c.id) === String(selectedId)}
            onSelect={onSelect}
          />
        ))}

        {!loading && !error && shown.length === 0 && !dmOpen && (
          <p className="sv__none">{emptyLine}</p>
        )}
      </div>
    </div>
  );
}
