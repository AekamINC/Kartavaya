/**
 * ChannelList.jsx — search, create, and the two sections (channels · DMs).
 */
import React, { useMemo, useState } from 'react';
import { Input, Select, SkeletonList } from '../../components/ui';
import { relTime } from '../../lib/utils';
import { channelIcon, SvIcons } from './icons';

function ChannelRow({ ch, on, onSelect }) {
  const unread = Number(ch.unread_count) || 0;
  const members = Number(ch.member_count) || 0;
  const name = ch.name || 'Direct message';

  return (
    <button
      type="button"
      className={`ch${on ? ' on' : ''}${unread > 0 ? ' unread' : ''}`}
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
      {unread > 0 && (
        <span className="ch__badge" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>
      )}
    </button>
  );
}

export default function ChannelList({
  channels, loading, selectedId, onSelect, onCreate, creating,
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('public');

  const { rooms, dms } = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = c => !needle || (c.name || 'direct message').toLowerCase().includes(needle);
    const hit = channels.filter(match);
    return {
      rooms: hit.filter(c => c.type !== 'dm'),
      dms: hit.filter(c => c.type === 'dm'),
    };
  }, [channels, q]);

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
        <button
          type="button"
          className="svbtn"
          onClick={() => setOpen(o => !o)}
          aria-label="New channel"
          aria-expanded={open}
        >
          {SvIcons.plus}
        </button>
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

        {!loading && rooms.length === 0 && dms.length === 0 && (
          <p className="sv__none">
            {q.trim()
              ? `No channels match “${q.trim()}”.`
              : 'No channels yet. Create one to start messaging.'}
          </p>
        )}

        {!loading && rooms.length > 0 && (
          <>
            <h2 className="sv__sec">Channels</h2>
            {rooms.map(c => (
              <ChannelRow key={c.id} ch={c} on={String(c.id) === String(selectedId)} onSelect={onSelect} />
            ))}
          </>
        )}

        {!loading && dms.length > 0 && (
          <>
            <h2 className="sv__sec">Direct messages</h2>
            {dms.map(c => (
              <ChannelRow key={c.id} ch={c} on={String(c.id) === String(selectedId)} onSelect={onSelect} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
