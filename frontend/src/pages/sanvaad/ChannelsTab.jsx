/**
 * ChannelsTab.jsx — the three-pane shell: list · chat · thread.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { currentUser } from '../../lib/auth';
import { EmptyState, useToast } from '../../components/ui';
import ChannelList from './ChannelList';
import ChatPane from './ChatPane';
import ThreadPanel from './ThreadPanel';
import { ChatArt } from './icons';

export default function ChannelsTab() {
  const { pushToast } = useToast();
  const meId = currentUser()?.user_id;

  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [thread, setThread] = useState(null);
  // Below 900px the grid is one column, so the list and the chat take turns.
  const [pane, setPane] = useState('list');

  const loadChannels = useCallback(async () => {
    try {
      const r = await api.get('/messaging/channels');
      setChannels(Array.isArray(r.data) ? r.data : []);
    } catch {
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadChannels(); }, [loadChannels]);

  const createChannel = async (name, type) => {
    setCreating(true);
    try {
      const r = await api.post('/messaging/channels', { name, type });
      setChannels(prev => [r.data, ...prev]);
      setSelected(r.data);
      setThread(null);
      setPane('chat');
      // `useToast()` returns { pushToast, error, success, warning, info } — the
      // handover's headline defect is that this file called a nonexistent
      // `addToast`. It does not: every call site here was already `pushToast`.
      pushToast({ type: 'success', title: 'Channel created' });
      return r.data;
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to create channel' });
      return null;
    } finally {
      setCreating(false);
    }
  };

  const select = (ch) => {
    setSelected(ch);
    setThread(null);
    setPane('chat');
    // The badge clears the moment the channel opens; the log keeps its own
    // snapshot of `last_read_at` for the unread divider.
    setChannels(prev => prev.map(c => (c.id === ch.id ? { ...c, unread_count: 0 } : c)));
  };

  return (
    <div className={`sv${thread ? ' sv--thread' : ''}`} data-pane={pane}>
      <ChannelList
        channels={channels}
        loading={loading}
        selectedId={selected?.id}
        onSelect={select}
        onCreate={createChannel}
        creating={creating}
      />

      {selected ? (
        <ChatPane
          key={selected.id}
          channel={selected}
          meId={meId}
          threadOpen={!!thread}
          onOpenThread={setThread}
          onSent={loadChannels}
          onBack={() => setPane('list')}
        />
      ) : (
        <div className="sv__blank">
          <EmptyState
            icon={ChatArt}
            title={{ en: 'Select a channel', hi: 'संवाद शुरू करने के लिए एक चैनल चुनें' }}
            description="Pick a channel or a direct message on the left, or create one to start a conversation."
          />
        </div>
      )}

      {thread && selected && (
        <ThreadPanel
          key={thread.id}
          channelId={selected.id}
          root={thread}
          meId={meId}
          onClose={() => setThread(null)}
        />
      )}
    </div>
  );
}
