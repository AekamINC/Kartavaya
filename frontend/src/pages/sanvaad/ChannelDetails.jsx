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
 *
 * `samvada_channel_members.muted` is the fifth of the same kind. The column has
 * existed since 058, no endpoint ever wrote it and no component ever read it, so
 * a channel a reader did not want to hear from had no off switch anywhere in the
 * product. `PUT /v1/messaging/channels/:id/mute` is that switch and this sheet
 * is its only door.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  Avatar, Field, Input, Sheet, SkeletonList, Toggle, useToast,
} from '../../components/ui';
import { SvIcons } from './icons';

/**
 * `samvada_presence.status` is `'online'` or `'away'`, and a user with no row
 * seen in the last five minutes is omitted from `/live`'s map entirely — an
 * absent key IS offline, which is what keeps the payload small in a
 * two-hundred-person firm. The CSS modifiers are `--on` / `--away` / `--off`.
 *
 * Two vocabularies for one fact. This codebase's last four defects were each a
 * name that did not exist on the other side, so the translation is a function
 * with the three cases written out and never `sv__pres--${status}` straight off
 * the wire, which would silently ask for a `.sv__pres--online` rule that nobody
 * wrote.
 */
const presMod = s => (s === 'online' ? 'on' : s === 'away' ? 'away' : 'off');
const PRES_LABEL = { on: 'Online', away: 'Away', off: 'Offline' };

export default function ChannelDetails({
  channel, meId, onClose, onChanged, canPost = true, presence = {},
}) {
  const { pushToast } = useToast();
  const isDm = channel.type === 'dm';

  const [name, setName] = useState(channel.name || '');
  const [description, setDescription] = useState(channel.description || '');
  const [saving, setSaving] = useState(false);
  // `list_channels` carries `muted` on the row, so the switch is right on the
  // first paint rather than flicking over once a request lands.
  const [muted, setMuted] = useState(!!channel.muted);
  const [muting, setMuting] = useState(false);

  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  // `null` while unknown. "Everyone in your organisation is already here" is a
  // claim about the firm, and a failed directory read used to assert it.
  const [people, setPeople] = useState(null);
  const [dirErr, setDirErr] = useState(null);
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
        .then(r => { if (!dead) { setPeople(Array.isArray(r.data) ? r.data : []); setDirErr(null); } })
        .catch(e => { if (!dead) { setPeople(null); setDirErr(e); } });
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

  /**
   * PUT, not PATCH — it sets one boolean to a stated value and running it twice
   * lands in the same place.
   *
   * Optimistic, because a switch that waits for a round trip before moving
   * reads as a switch that did not take. The rollback is the same shape the
   * reaction path uses: keep the previous value, put it back on failure, and
   * let the server's own sentence be the toast.
   *
   * `onChanged` is handed a full row rather than `null`. The shell's
   * `channelChanged` merges `row` into both lists and into `selected`, so
   * spreading the channel with the new flag patches the rail's mute glyph
   * without a `loadChannels()` — and it degrades correctly against the version
   * of `channelChanged` that does not know about `opts.muted` yet, which
   * returns early on a null row and would otherwise drop the change on the
   * floor.
   */
  const toggleMute = async (next) => {
    const before = muted;
    setMuted(next);
    setMuting(true);
    try {
      const r = await api.put(`/v1/messaging/channels/${channel.id}/mute`, { muted: next });
      const value = typeof r.data?.muted === 'boolean' ? r.data.muted : next;
      setMuted(value);
      onChanged?.({ ...channel, muted: value }, { muted: value });
    } catch (e) {
      setMuted(before);
      pushToast({
        type: 'error',
        title: e.response?.data?.detail || 'Failed to change notifications for this channel',
      });
    } finally {
      setMuting(false);
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
  // Stays null when the directory is unknown, so the render below cannot
  // mistake "we could not ask" for "there is nobody left to add".
  const addable = people === null ? null : people.filter(p => !inChannel.has(String(p.user_id)));

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

        {/* Above the member list and offered on a DM as well as a room —
            muting a direct message is a legitimate thing to want and there is
            no reading of "do not interrupt me" that stops at the door of a
            two-person conversation.

            Gated on `canPost` (D3). `PUT …/mute` is a genuine write and takes
            the module's write-verb gate, so a legacy `viewer` grant-holder gets
            a 403 from the middleware before the handler runs. Every grant
            issued since `NEW_GRANT_LEVEL_BY_MODULE["sanvaad"] == EDITOR` landed
            is an editor, so the affected set is small — and someone who cannot
            post has the weakest claim on needing to mute. Hiding the control
            follows this module's rule of passing `undefined` rather than
            rendering something disabled. */}
        {canPost && (
          <section className="svd__sec">
            <h3 className="svd__t">Notifications</h3>
            {/* `.svd__mute` alone, not `.svd__row` beside it — the stylesheet
                gives this one its own padding, border and `> :last-child {
                margin-left: auto }`, which is the whole row, and stacking the
                plain row class on top would only re-declare the flex it already
                sets. The Toggle has to stay the LAST child for that rule. */}
            <div className="svd__mute">
              {/* The Devanagari sits on this row and not on `.svd__t` above it:
                  that heading is `text-transform: uppercase` with
                  `letter-spacing: .07em`, and letter-spacing pulls a Devanagari
                  conjunct apart at exactly the joins that make it one letter. */}
              <span className="svd__rn">
                Mute this channel
                <span className="sv__hi" lang="hi">इस चैनल को म्यूट करें</span>
              </span>
              <Toggle
                checked={muted}
                onChange={toggleMute}
                disabled={muting}
                label={muted ? 'Unmute this channel' : 'Mute this channel'}
              />
            </div>
            {/* Read back against what the three sides ACTUALLY do, because the
                sentence that stood here got the most important clause backwards.
                What was checked, and where:

                  · `ChannelList.jsx:28` — `showUnread = unread > 0 && !muted`.
                    The count badge is hidden, and `loud` drops with it so the
                    row stops bolding. "Turns off the unread count" holds.
                  · `ChannelList.jsx:66` — `.ch__mn` renders on `mentions > 0`
                    with no reference to `muted` at all. The mention badge
                    survives, which is what `sanvaad.css` calls "the badge that
                    survives muting".
                  · `services/samvaad_mentions.py:572` — `targets = [uid for uid
                    in fresh if uid not in muted]`, and `targets` gates BOTH the
                    `public.notifications` insert and the push. So muting stops
                    the in-app notification too, not only the push — and it stops
                    it for a mention exactly as much as for anything else.

                "You are still told when somebody writes your name" was therefore
                false: nothing tells you. What survives is the RECORD — the
                `samvada_mentions` row is written for a muted channel, so the
                badge stays and the message is in the Mentions feed. The
                distinction matters because the two sentences send a reader to
                different places: one says wait to be interrupted, and the true
                one says go and look.

                The push is no longer named on its own. Naming it and not the
                notification implied the bell still rings, which was the omission
                that made the old sentence readable as true. */}
            <p className="sv__none">
              {muted
                ? 'Muted. The unread count is hidden, and nothing in this channel notifies you — not even somebody writing your name. The mention badge still appears on the channel, and the message is still in Mentions.'
                : 'Muting hides this channel’s unread count and stops its notifications and pushes, including for a message that writes your name. Nothing is hidden from you: the mention badge still appears on the channel, and the message is still in Mentions.'}
            </p>
          </section>
        )}

        <section className="svd__sec">
          <h3 className="svd__t">
            Members
            {members.length > 0 && <span className="svd__n">{members.length}</span>}
          </h3>
          {loadingMembers && <SkeletonList rows={3} showAvatar />}
          {!loadingMembers && members.map(m => {
            const st = presMod(presence[String(m.user_id)]);
            return (
              <div key={m.user_id} className="svd__row">
                <Avatar name={m.full_name} src={m.avatar_url} size={28} />
                <span className="svd__rn">
                  {/* `role="img"` with a name, not `aria-hidden`. A coloured dot
                      is the only thing carrying this fact, and
                      23-accessibility.md's rule is that a state expressed solely
                      as colour has to be in the accessible name too — the same
                      reasoning `.rx__c` uses for `aria-pressed`. */}
                  <span
                    className={`sv__pres sv__pres--${st}`}
                    role="img"
                    aria-label={PRES_LABEL[st]}
                  />
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
            );
          })}
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
            {dirErr ? (
              <p className="sv__none">
                The people list did not load, so this is not a list of who could be added.
              </p>
            ) : addable === null ? (
              <p className="sv__none">Searching…</p>
            ) : addable.length === 0 ? (
              <p className="sv__none">
                {q.trim() ? `Nobody matches “${q.trim()}”.` : 'Everyone in your organisation is already here.'}
              </p>
            ) : null}
            {(addable || []).map(p => (
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
