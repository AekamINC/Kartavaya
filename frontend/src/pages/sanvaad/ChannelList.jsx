/**
 * ChannelList.jsx — search, create, and the two sections (channels · DMs).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { Avatar, ErrorState, errorKind, Input, Select, SkeletonList } from '../../components/ui';
import { relTime } from '../../lib/utils';
import { channelIcon, SvIcons } from './icons';

function ChannelRow({ ch, on, onSelect }) {
  const unread = Number(ch.unread_count) || 0;
  const members = Number(ch.member_count) || 0;
  const name = ch.name || 'Direct message';

  return (
    <button
      type="button"
      className={`ch${on ? ' on' : ''}${unread > 0 ? ' unread' : ''}${ch.is_archived ? ' arch' : ''}`}
      onClick={() => onSelect(ch)}
      aria-current={on ? 'true' : undefined}
    >
      <span className="ch__ic" aria-hidden="true">{channelIcon(ch.type)}</span>
      <span className="ch__txt">
        <span className="ch__n">{name}</span>
        <span className="ch__last">
          {ch.updated_at
            ? `${members} member${members === 1 ? '' : 's'} · ${relTime(ch.updated_at)}`
            : `${members} member${members === 1 ? '' : 's'}`}
        </span>
      </span>
      {/* `ScreensSanvaad.jsx:172` — an archived row keeps its own word rather
          than only a dimmed treatment, because dimming alone reads as disabled
          and these are still readable. */}
      {ch.is_archived && <span className="ch__arch">archived</span>}
      {unread > 0 && (
        <span className="ch__badge" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>
      )}
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
          className="ch"
          disabled={busy === p.user_id}
          onClick={async () => {
            setBusy(p.user_id);
            const made = await onPick(p);
            setBusy(null);
            if (made) onClose();
          }}
        >
          <Avatar name={p.full_name} src={p.avatar_url} size={24} />
          <span className="ch__txt"><span className="ch__n">{p.full_name}</span></span>
        </button>
      ))}
    </div>
  );
}

export default function ChannelList({
  channels, archived = [], showAll, onToggleAll, loading, selectedId,
  onSelect, onCreate, onOpenDm, canPost = true, creating, error = null, onRetry,
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('public');

  const { rooms, dms, gone } = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = c => !needle || (c.name || 'direct message').toLowerCase().includes(needle);
    const hit = channels.filter(match);
    return {
      rooms: hit.filter(c => c.type !== 'dm'),
      dms: hit.filter(c => c.type === 'dm'),
      gone: (showAll ? archived : []).filter(match),
    };
  }, [channels, archived, showAll, q]);

  const submit = async () => {
    const n = name.trim();
    if (!n) return;
    const made = await onCreate(n, type);
    if (made) { setName(''); setOpen(false); }
  };

  return (
    <div className="sv__list">
      <div className="sv__lhd">
        <span className="sv__lt">Channels <span className="sv__hi" lang="hi">चैनल</span></span>
        {/* `ScreensSanvaad.jsx:231` — the rail's own All/Unread switch. Without
            it the archived section has no way to appear, which is why the
            archived state was unreachable in both directions. */}
        <button
          type="button"
          className="sv__ltog"
          onClick={onToggleAll}
          aria-pressed={!!showAll}
        >
          {showAll ? 'Active' : 'All'}
        </button>
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

      <div className="sv__lsearch">
        <Input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search channels"
          aria-label="Search channels"
        />
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

      <div className="sv__scroll">
        {loading && <SkeletonList rows={6} showAvatar={false} />}

        {/* A failed list is not an empty one. Both section empties below make a
            claim about this person's membership — "No channels yet", "You are
            not in any channels yet" — and neither is knowable from a request
            that did not answer. The rail says so once, in place of both. */}
        {!loading && error && (
          <ErrorState
            kind={errorKind(error)}
            detail={errorKind(error) === 'offline'
              ? 'Your channels need a connection to load. Nothing has been lost — messages sent while you were away are waiting.'
              : 'Your channel list did not load. This is a read failure; no channel or message was removed.'}
            onRetry={onRetry}
          />
        )}

        {/* The Channels and Direct sections are both always rendered, because
            each carries the control that creates its own first row. A whole-rail
            "nothing here" would hide them. */}
        {!loading && !error && (
          <>
            <h2 className="sv__sec">Channels</h2>
            {rooms.map(c => (
              <ChannelRow key={c.id} ch={c} on={String(c.id) === String(selectedId)} onSelect={onSelect} />
            ))}
            {rooms.length === 0 && (
              <p className="sv__none">
                {q.trim()
                  ? `No channels match “${q.trim()}”.`
                  : canPost
                    ? 'No channels yet. Create one to start messaging.'
                    : 'You are not in any channels yet.'}
              </p>
            )}
          </>
        )}

        {!loading && !error && (
          <>
            <h2 className="sv__sec">
              Direct messages
              {/* `POST /v1/messaging/dm` exists and had no caller, and
                  `create_channel` refuses `type='dm'`, so this heading has
                  always sat over a list that could not be non-empty. */}
              {canPost && onOpenDm && (
                <button
                  type="button"
                  className="sv__secb"
                  onClick={() => { setDmOpen(o => !o); setOpen(false); }}
                  aria-label="New direct message"
                  aria-expanded={dmOpen}
                >
                  {SvIcons.plus}
                </button>
              )}
            </h2>
            {dmOpen && <DmPicker onPick={onOpenDm} onClose={() => setDmOpen(false)} />}
            {dms.map(c => (
              <ChannelRow key={c.id} ch={c} on={String(c.id) === String(selectedId)} onSelect={onSelect} />
            ))}
            {!dmOpen && dms.length === 0 && (
              <p className="sv__none">
                {q.trim() ? `No direct messages match “${q.trim()}”.` : 'No direct messages yet.'}
              </p>
            )}
          </>
        )}

        {!loading && !error && showAll && gone.length > 0 && (
          <>
            <h2 className="sv__sec">Archived <span className="sv__hi" lang="hi">संग्रहित</span></h2>
            {gone.map(c => (
              <ChannelRow key={c.id} ch={c} on={String(c.id) === String(selectedId)} onSelect={onSelect} />
            ))}
          </>
        )}
        {!loading && !error && showAll && gone.length === 0 && (
          <>
            <h2 className="sv__sec">Archived <span className="sv__hi" lang="hi">संग्रहित</span></h2>
            <p className="sv__none">No archived channels.</p>
          </>
        )}
      </div>
    </div>
  );
}
