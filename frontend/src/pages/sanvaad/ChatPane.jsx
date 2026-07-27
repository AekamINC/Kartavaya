/**
 * ChatPane.jsx — header, log, composer for one channel.
 */
import React, { useState } from 'react';
import { ErrorState, errorKind, useToast } from '../../components/ui';
import MessageLog from './MessageLog';
import Composer from './Composer';
import ChannelDetails from './ChannelDetails';
import LockedComposer from './LockedComposer';
import { channelIcon, SvIcons } from './icons';
import useChannelMessages from './useChannelMessages';

export default function ChatPane({
  channel, me, meId, meName, access, onOpenThread, onSent, onBack, threadOpen,
  onChannelChanged,
}) {
  const { pushToast } = useToast();
  const {
    messages, loading, error, send, react, edit, remove, loadOlder, more, older,
  } = useChannelMessages(channel.id, meId, me);
  const [replyTo, setReplyTo] = useState(null);
  const [settings, setSettings] = useState(false);

  // Two independent reasons the composer can be shut, and they say different
  // things. `ScreensSanvaad.jsx:195` — `canPost = role === 'editor' && !archived`.
  const archived = !!channel.is_archived;
  const canPost = (access?.canPost !== false) && !archived;

  // Captured once per channel: the divider must mark where the reader was when
  // they arrived, not follow them down the log as `read` is re-posted.
  // `list_channels` returns the field as `my_last_read`.
  const [lastReadAt] = useState(() => channel.my_last_read || null);

  const submit = async (body) => {
    try {
      await send(body, replyTo?.id);
      if (replyTo) { onOpenThread?.(replyTo); setReplyTo(null); }
      onSent?.();
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to send' });
      throw e;
    }
  };

  // Both surface the server's own reason rather than a generic failure — the
  // router answers 403 "Can only edit your own messages" and 404 "Message not
  // found", and either is more use than "Something went wrong".
  const editMsg = async (msg, content) => {
    try {
      return await edit(msg, content);
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to save the edit' });
      throw e;
    }
  };

  const deleteMsg = async (msg) => {
    try {
      await remove(msg);
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to delete the message' });
      throw e;
    }
  };

  const name = channel.type === 'dm' ? (channel.name || 'Direct message') : channel.name;

  return (
    <div className="sv__chat">
      <header className="sv__hd">
        {onBack && (
          <button type="button" className="svbtn" onClick={onBack} aria-label="Back to channels">
            {SvIcons.back}
          </button>
        )}
        <span className="ch__ic" aria-hidden="true">{channelIcon(channel.type)}</span>
        <h2 className="sv__hd-n">{name}</h2>
        {archived && <span className="ch__arch">archived</span>}
        {channel.description && <p className="sv__hd-d">{channel.description}</p>}
        <span className="sv__hd-act">
          {channel.member_count != null && (
            <button
              type="button"
              className="sv__hd-mem"
              onClick={() => setSettings(true)}
              aria-label={`${channel.member_count} members — open channel settings`}
            >
              <span className="ch__ic" aria-hidden="true">{SvIcons.users}</span>
              {channel.member_count}
            </button>
          )}
          {/* `ScreensSanvaad.jsx:257`. The only door to PATCH /channels/:id and
              to the three member routes, all four of which have had zero callers
              since 058 — which is why a private channel could never gain a
              second member. */}
          <button
            type="button"
            className="svbtn"
            onClick={() => setSettings(true)}
            aria-label="Channel settings"
            aria-haspopup="dialog"
          >
            {SvIcons.dots}
          </button>
        </span>
      </header>

      {/* `ScreensSanvaad.jsx:260`. Without this an archived channel looked like
          an ordinary one whose composer had mysteriously vanished. */}
      {archived && (
        <div className="sv__banner">
          <span className="ch__ic" aria-hidden="true">{SvIcons.lock}</span>
          This channel is archived. History stays readable and searchable; nobody can post.
        </div>
      )}

      {error ? (
        <div className="sv__blank">
          <ErrorState kind={errorKind(error)} grant="access to this channel" />
        </div>
      ) : (
        <MessageLog
          messages={messages}
          loading={loading}
          meId={meId}
          meName={meName}
          lastReadAt={lastReadAt}
          // A viewer gets no reaction tray and no thread reply — the whole
          // hover tray is gated on `can` in `ScreensSanvaad.jsx:153`, not just
          // the composer. Passing `undefined` is what removes the control.
          onReact={canPost ? react : undefined}
          onOpenThread={onOpenThread}
          onReply={canPost ? setReplyTo : undefined}
          onEdit={canPost ? editMsg : undefined}
          onDelete={canPost ? deleteMsg : undefined}
          onLoadOlder={loadOlder}
          hasOlder={more}
          loadingOlder={older}
          emptyBody={`Nothing has been said in ${name || 'this channel'} yet. Everyone in it will see what you write.`}
        />
      )}

      {canPost ? (
        <Composer
          emoji
          onSend={submit}
          disabled={!!error}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          placeholder={threadOpen ? 'Write in the channel…' : 'Write a message…'}
        />
      ) : (
        <LockedComposer reason={archived ? 'archived' : 'viewer'} />
      )}

      {settings && (
        <ChannelDetails
          channel={channel}
          meId={meId}
          onClose={() => setSettings(false)}
          onChanged={onChannelChanged}
        />
      )}
    </div>
  );
}
