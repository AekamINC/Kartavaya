/**
 * ChannelDetails.jsx — the `⋯` in the chat header.
 *
 * `ScreensSanvaad.jsx:257` ends the channel header with a "Channel settings"
 * button. It was never built, and it is the only door to four endpoints that
 * have existed since migration 058 with **zero callers anywhere in
 * `frontend/src`**:
 *
 *   · `PATCH  /v1/messaging/channels/:id`               rename · describe · archive
 *   · `GET    /v1/messaging/channels/:id/members`       who is in here
 *   · `POST   /v1/messaging/channels/:id/members`       add somebody
 *   · `DELETE /v1/messaging/channels/:id/members/:uid`  remove somebody
 *
 * The middle two are not cosmetic. `create_channel` inserts exactly one
 * membership row — the creator, as `admin` — and `add_member` is the only other
 * writer of that table. `list_messages` refuses a non-member on a private
 * channel. So with no caller for `add_member`, **a private channel was
 * permanently a channel of one**: the create form offered "Private", the channel
 * appeared, and no second person could ever be put in it or read a word of it.
 *
 * The member picker reads `GET /v1/messaging/directory`, added alongside this,
 * because the only user directory in the API (`GET /v1/org/members`) is gated on
 * `require_org_role("org_admin", "org_owner")` — an ordinary member could not
 * name anybody, which is the proximate reason `add_member` had no caller.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  Avatar, Field, Input, Sheet, SkeletonList, useToast,
} from '../../components/ui';
import { SvIcons } from './icons';

export default function ChannelDetails({ channel, meId, onClose, onChanged }) {
  const { pushToast } = useToast();
  const isDm = channel.type === 'dm';

  const [name, setName] = useState(channel.name || '');
  const [description, setDescription] = useState(channel.description || '');
  const [saving, setSaving] = useState(false);

  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [people, setPeople] = useState([]);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  // The caller's own row decides what this sheet may offer: `update_channel`
  // and `remove_member` both answer 403 to anyone who is not the channel admin.
  const myRole = members.find(m => String(m.user_id) === String(meId))?.role;
  const iAmAdmin = myRole === 'admin';

  const loadMembers = useCallback(async () => {
    try {
      const r = await api.get(`/v1/messaging/channels/${channel.id}/members`);
      setMembers(Array.isArray(r.data) ? r.data : []);
    } catch {
      setMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  }, [channel.id]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  // The picker is only ever open on a non-DM channel, so the directory is not
  // fetched for a DM at all.
  useEffect(() => {
    if (isDm) return undefined;
    let dead = false;
    const t = setTimeout(() => {
      api.get('/v1/messaging/directory', { params: q.trim() ? { q: q.trim() } : undefined })
        .then(r => { if (!dead) setPeople(Array.isArray(r.data) ? r.data : []); })
        .catch(() => { if (!dead) setPeople([]); });
    }, 220);
    return () => { dead = true; clearTimeout(t); };
  }, [q, isDm]);

  const save = async () => {
    const next = name.trim();
    if (!next) return;
    setSaving(true);
    try {
      const r = await api.patch(`/v1/messaging/channels/${channel.id}`, {
        name: next,
        description: description.trim(),
      });
      onChanged?.(r.data);
      pushToast({ type: 'success', title: 'Channel updated' });
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  };

  const setArchived = async (is_archived) => {
    try {
      const r = await api.patch(`/v1/messaging/channels/${channel.id}`, { is_archived });
      onChanged?.(r.data, { archived: is_archived });
      pushToast({
        type: 'success',
        title: is_archived ? 'Channel archived' : 'Channel unarchived',
      });
      setConfirmArchive(false);
      if (is_archived) onClose?.();
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to archive' });
    }
  };

  const add = async (person) => {
    setAdding(person.user_id);
    try {
      await api.post(
        `/v1/messaging/channels/${channel.id}/members`,
        null,
        { params: { user_id: person.user_id } }
      );
      await loadMembers();
      onChanged?.(null, { members: true });
      pushToast({ type: 'success', title: `${person.full_name} added` });
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to add' });
    } finally {
      setAdding(null);
    }
  };

  const remove = async (m) => {
    try {
      await api.delete(`/v1/messaging/channels/${channel.id}/members/${m.user_id}`);
      await loadMembers();
      onChanged?.(null, { members: true });
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to remove' });
    }
  };

  const inChannel = new Set(members.map(m => String(m.user_id)));
  const addable = people.filter(p => !inChannel.has(String(p.user_id)));

  return (
    <Sheet open onClose={onClose} title={isDm ? 'Direct message' : 'Channel settings'}>
      <div className="svd">
        {!isDm && (
          <section className="svd__sec">
            <h3 className="svd__t">Details</h3>
            <Field label="Name">
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={!iAmAdmin || channel.is_archived}
                aria-label="Channel name"
              />
            </Field>
            <Field label="Topic" hint="Shown beside the name in the header.">
              <Input
                value={description}
                onChange={e => setDescription(e.target.value)}
                disabled={!iAmAdmin || channel.is_archived}
                aria-label="Channel topic"
              />
            </Field>
            {iAmAdmin && !channel.is_archived && (
              <button
                type="button"
                className="btn btn--fill btn--sm"
                onClick={save}
                disabled={saving || !name.trim()}
              >
                Save
              </button>
            )}
            {!iAmAdmin && (
              <p className="sv__none">Only a channel admin can rename this channel.</p>
            )}
          </section>
        )}

        <section className="svd__sec">
          <h3 className="svd__t">
            Members
            {members.length > 0 && <span className="svd__n">{members.length}</span>}
          </h3>
          {loadingMembers && <SkeletonList rows={3} showAvatar />}
          {!loadingMembers && members.map(m => (
            <div key={m.user_id} className="svd__row">
              <Avatar name={m.full_name} src={m.avatar_url} size={28} />
              <span className="svd__rn">
                {m.full_name}
                {m.role === 'admin' && <span className="svd__tag">admin</span>}
              </span>
              {/* `remove_member` lets anyone remove THEMSELVES and requires
                  channel admin to remove anyone else — the button follows that
                  rule rather than guessing at it. */}
              {!isDm && (String(m.user_id) === String(meId) || iAmAdmin) && (
                <button
                  type="button"
                  className="svbtn"
                  onClick={() => remove(m)}
                  aria-label={
                    String(m.user_id) === String(meId)
                      ? 'Leave channel'
                      : `Remove ${m.full_name}`
                  }
                >
                  {SvIcons.close}
                </button>
              )}
            </div>
          ))}
        </section>

        {!isDm && !channel.is_archived && (
          <section className="svd__sec">
            <h3 className="svd__t">Add someone</h3>
            <Input
              type="search"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search people"
              aria-label="Search people to add"
            />
            {addable.length === 0 && (
              <p className="sv__none">
                {q.trim() ? `Nobody matches “${q.trim()}”.` : 'Everyone in your organisation is already here.'}
              </p>
            )}
            {addable.map(p => (
              <div key={p.user_id} className="svd__row">
                <Avatar name={p.full_name} src={p.avatar_url} size={28} />
                <span className="svd__rn">{p.full_name}</span>
                <button
                  type="button"
                  className="btn btn--out btn--sm"
                  onClick={() => add(p)}
                  disabled={adding === p.user_id}
                >
                  Add
                </button>
              </div>
            ))}
          </section>
        )}

        {!isDm && iAmAdmin && (
          <section className="svd__sec">
            <h3 className="svd__t">Archive</h3>
            {channel.is_archived ? (
              <>
                <p className="sv__none">
                  This channel is archived. Its history stays readable and searchable; nobody can post.
                </p>
                <button type="button" className="btn btn--out btn--sm" onClick={() => setArchived(false)}>
                  Unarchive
                </button>
              </>
            ) : (
              <>
                <p className="sv__none">
                  Archiving closes the channel. History stays readable and searchable, and nobody can
                  post — including admins. It can be unarchived later.
                </p>
                {/* Confirmed in place rather than through `ConfirmDialog`. That
                    component portals to `document.body` and this sheet traps
                    focus inside its own subtree, so the dialog would open
                    outside the trap and the trap would pull focus straight back
                    out of it. Archiving is reversible from this same panel, so
                    the weight of a modal is not owed here anyway. */}
                {confirmArchive ? (
                  <div className="svd__row">
                    <span className="svd__rn">Archive {channel.name}?</span>
                    <button type="button" className="btn btn--fill btn--sm" onClick={() => setArchived(true)}>
                      Archive
                    </button>
                    <button type="button" className="btn btn--out btn--sm" onClick={() => setConfirmArchive(false)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button type="button" className="btn btn--out btn--sm" onClick={() => setConfirmArchive(true)}>
                    Archive channel
                  </button>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </Sheet>
  );
}
