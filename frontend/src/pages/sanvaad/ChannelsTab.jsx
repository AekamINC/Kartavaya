/**
 * ChannelsTab.jsx — the three-pane shell: list · chat · thread.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { currentUser } from '../../lib/auth';
import { EmptyState, useToast } from '../../components/ui';
import ChannelList from './ChannelList';
import ChatPane from './ChatPane';
import ThreadPanel from './ThreadPanel';
import { ChatArt } from './icons';

export default function ChannelsTab() {
  const { pushToast } = useToast();
  // `currentUser()` parses localStorage and returns a fresh object every call,
  // so it is read once — otherwise every render hands the tree a new identity.
  const me = useMemo(() => currentUser(), []);
  const meId = me?.user_id;
  const meName = me?.full_name || me?.name || null;

  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [thread, setThread] = useState(null);
  // Below 900px the grid is one column, so the list and the chat take turns.
  const [pane, setPane] = useState('list');

  /* ── Thread panel exit ────────────────────────────────────────────────────
   *
   * `setThread(null)` unmounted the panel on the spot, so `svThreadOut` could
   * never play — the same defect `Popover.jsx` documents for `.pop.is-closing`,
   * a keyframe that sat in the stylesheet for months with nothing to set its
   * class. The panel stays mounted with `.is-closing` until the exit animation
   * ends.
   *
   * DRIVEN BY `animationend`, NOT A TIMER, for the reason Popover spells out: the
   * CSS side is `calc(220ms * var(--ix))` and `--ix` is the user's own Animations
   * preference, so no constant is right at more than one setting. The timeout
   * below is a CEILING for the case where the node is hidden mid-animation and
   * the event never arrives — it sits above the longest possible CSS duration so
   * it is a fallback rather than a race.
   *
   * `--ix` bottoms out at `.001` and not `0` precisely so `animationend` still
   * fires under reduced motion; a zero-duration animation never fires it and the
   * panel would never unmount.
   */
  const [closingThread, setClosingThread] = useState(false);
  const closingRef = useRef(false);
  const exitTimer = useRef(null);

  const finishThreadClose = useCallback(() => {
    clearTimeout(exitTimer.current);
    closingRef.current = false;
    setClosingThread(false);
    setThread(null);
  }, []);

  const closeThread = useCallback(() => {
    closingRef.current = true;
    setClosingThread(true);
    clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(finishThreadClose, 600);
  }, [finishThreadClose]);

  // A thread panel is full of other people's animations — a skeleton while the
  // replies load, a reaction chip, a message arriving. `e.target !==
  // e.currentTarget` keeps any of them from being mistaken for the panel's own
  // exit, and `closingRef` keeps the ENTRANCE finishing from closing it.
  const onThreadAnimEnd = useCallback((e) => {
    if (e.target !== e.currentTarget) return;
    if (!closingRef.current) return;
    finishThreadClose();
  }, [finishThreadClose]);

  useEffect(() => () => clearTimeout(exitTimer.current), []);

  /**
   * Cancel any pending close and set the thread in one step.
   *
   * Both callers need this and neither wants an exit animation. Opening a
   * different thread while one is closing must cancel the close, or the pending
   * unmount lands on the newly opened panel; switching channel drops the thread
   * outright, because the pane it belonged to is going away in the same frame.
   */
  const setThreadNow = useCallback((msg) => {
    clearTimeout(exitTimer.current);
    closingRef.current = false;
    setClosingThread(false);
    setThread(msg);
  }, []);

  const openThread = useCallback(msg => setThreadNow(msg), [setThreadNow]);
  const dropThread = useCallback(() => setThreadNow(null), [setThreadNow]);

  const loadChannels = useCallback(async () => {
    try {
      const r = await api.get('/v1/messaging/channels');
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
      const r = await api.post('/v1/messaging/channels', { name, type });
      setChannels(prev => [r.data, ...prev]);
      setSelected(r.data);
      dropThread();
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
    dropThread();
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
          me={me}
          meId={meId}
          meName={meName}
          threadOpen={!!thread && !closingThread}
          onOpenThread={openThread}
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
          me={me}
          meId={meId}
          meName={meName}
          closing={closingThread}
          onAnimationEnd={onThreadAnimEnd}
          onClose={closeThread}
        />
      )}
    </div>
  );
}
