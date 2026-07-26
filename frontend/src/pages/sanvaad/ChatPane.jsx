/**
 * ChatPane.jsx — header, log, composer for one channel.
 */
import React, { useState } from 'react';
import { ErrorState, errorKind, useToast } from '../../components/ui';
import MessageLog from './MessageLog';
import Composer from './Composer';
import { channelIcon, SvIcons } from './icons';
import useChannelMessages from './useChannelMessages';

export default function ChatPane({
  channel, me, meId, meName, onOpenThread, onSent, onBack, threadOpen,
}) {
  const { pushToast } = useToast();
  const { messages, loading, error, send, react } = useChannelMessages(channel.id, meId, me);
  const [replyTo, setReplyTo] = useState(null);

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
        {channel.description && <p className="sv__hd-d">{channel.description}</p>}
        {channel.member_count != null && (
          <span className="sv__hd-act">
            <span className="ch__ic" aria-hidden="true">{SvIcons.users}</span>
            <span className="sv__hd-d">{channel.member_count}</span>
          </span>
        )}
      </header>

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
          onReact={react}
          onOpenThread={onOpenThread}
          onReply={setReplyTo}
          emptyBody={`Nothing has been said in ${name || 'this channel'} yet. Everyone in it will see what you write.`}
        />
      )}

      <Composer
        emoji
        onSend={submit}
        disabled={!!error}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        placeholder={threadOpen ? 'Write in the channel…' : 'Write a message…  संदेश लिखें'}
      />
    </div>
  );
}
