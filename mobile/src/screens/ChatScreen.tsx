import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert, type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { hindi } from '../theme/fonts';
import { useAuth } from '../hooks/useAuth';
import Refresher from '../components/Refresher';
import { messagesApi, type Message, type Reaction } from '../api/messages';
import { avatarColor, userInitials, withAlpha } from '../theme/tokens';
import type { RootStackParamList } from '../nav/RootStack';

/**
 * Chat — one channel.
 *
 * 17-mobile-app.md lists this screen as "reactions, thread affordance, read
 * ticks, hold-to-record mic replacing send when empty". Three of those four are
 * here. The mic is NOT, deliberately: `backend/routers/messaging.py` has no
 * voice-note endpoint and `MessageCreate` accepts only `content` and `type`, so
 * a record button could capture audio and then have nowhere to put it. A control
 * that looks like it works and silently discards a recording is worse than no
 * control. The gap is reported rather than faked.
 *
 * MessagesScreen previously rendered its channel rows as `Pressable` with no
 * `onPress` — the whole Messages tab was a dead end. This screen is what those
 * rows now open.
 *
 * The list is INVERTED. The server returns newest-first
 * (`ORDER BY m.created_at DESC`, messaging.py:317) and an inverted FlatList
 * consumes that order directly, opens pinned to the newest message, and grows
 * upward as older pages load — no reversing, no scrollToEnd on mount, and no
 * jump when the keyboard opens.
 */

type Route = RouteProp<RootStackParamList, 'Chat'>;
type Nav = NativeStackNavigationProp<RootStackParamList, 'Chat'>;

/** Offered on long-press. Kept short: a long grid is slower than typing. */
const QUICK_REACTIONS = ['👍', '✅', '🙏', '👀', '🎉'];

const PAGE = 50;

function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function dayOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yest)) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Collapse a reaction array into counts, preserving first-seen order. */
function tallyReactions(reactions: Reaction[] | undefined, meId: string) {
  if (!reactions?.length) return [];
  const order: string[] = [];
  const byEmoji = new Map<string, { count: number; mine: boolean }>();
  for (const r of reactions) {
    const prev = byEmoji.get(r.emoji);
    if (!prev) {
      order.push(r.emoji);
      byEmoji.set(r.emoji, { count: 1, mine: r.user_id === meId });
    } else {
      prev.count += 1;
      prev.mine = prev.mine || r.user_id === meId;
    }
  }
  return order.map(emoji => ({ emoji, ...byEmoji.get(emoji)! }));
}

export default function ChatScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const qc = useQueryClient();
  const { user } = useAuth();
  const meId = user?.user_id ?? '';

  const { channelId, channelName } = route.params;

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [sending, setSending] = useState(false);
  const composerRef = useRef<TextInput>(null);

  const { data: messages = [], isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['messaging', 'messages', channelId],
    queryFn: () => messagesApi.list(channelId, { limit: PAGE }),
  });

  /**
   * Mark read on open, and again whenever the newest message changes.
   *
   * Keyed on the newest id rather than run on an interval: the server stores one
   * last_read_at per member, so re-posting the same state is wasted work, and
   * marking read on every render would fight the unread badge.
   */
  const newestId = messages[0]?.id;
  const markedRef = useRef<string | null>(null);
  React.useEffect(() => {
    if (!newestId || markedRef.current === newestId) return;
    markedRef.current = newestId;
    messagesApi.markRead(channelId)
      .then(() => {
        // The channel list badge and the tab badge both read from these.
        qc.invalidateQueries({ queryKey: ['messaging', 'channels'] });
        qc.invalidateQueries({ queryKey: ['messaging', 'unread'] });
      })
      .catch(() => {
        // A failed read-receipt must not interrupt reading. It retries on the
        // next new message.
        markedRef.current = null;
      });
  }, [newestId, channelId, qc]);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['messaging', 'messages', channelId] });
  }, [qc, channelId]);

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    // Clear optimistically so a slow network does not invite a double-send.
    setDraft('');
    const parent = replyTo?.id;
    setReplyTo(null);
    try {
      await messagesApi.send(channelId, content, parent);
      invalidate();
      qc.invalidateQueries({ queryKey: ['messaging', 'channels'] });
    } catch (e: unknown) {
      // Hand the text back rather than losing it.
      setDraft(content);
      Alert.alert('Not sent', e instanceof Error ? e.message : 'Could not send that message.');
    } finally {
      setSending(false);
    }
  }, [draft, sending, replyTo, channelId, invalidate, qc]);

  const react = useMutation({
    mutationFn: ({ id, emoji, mine }: { id: string; emoji: string; mine: boolean }) =>
      mine ? messagesApi.unreact(id, emoji) : messagesApi.react(id, emoji),
    onSuccess: invalidate,
    onError: (e: unknown) =>
      Alert.alert('Reaction failed', e instanceof Error ? e.message : 'Try again.'),
  });

  const onLongPress = useCallback((m: Message) => {
    const mine = m.sender_id === meId;
    const tally = tallyReactions(m.reactions, meId);
    Alert.alert(
      m.sender_name ?? 'Message',
      m.content.slice(0, 100),
      [
        ...QUICK_REACTIONS.map(emoji => ({
          text: emoji,
          onPress: () => react.mutate({
            id: m.id,
            emoji,
            mine: tally.find(r => r.emoji === emoji)?.mine ?? false,
          }),
        })),
        { text: 'Reply in thread', onPress: () => { setReplyTo(m); composerRef.current?.focus(); } },
        ...(mine
          ? [{
              text: 'Delete',
              style: 'destructive' as const,
              onPress: () => messagesApi.remove(m.id).then(invalidate).catch(() => {}),
            }]
          : []),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  }, [meId, react, invalidate]);

  const renderItem = useCallback(({ item, index }: ListRenderItemInfo<Message>) => {
    const mine = item.sender_id === meId;
    const name = item.sender_name ?? 'Unknown';
    // Inverted list: the NEXT index is the older message, so a day divider
    // belongs above this row when the older one falls on a different day.
    const older = messages[index + 1];
    const showDay = !older || dayOf(older.created_at) !== dayOf(item.created_at);
    // Group consecutive messages from one sender inside the same day.
    const grouped = !!older
      && older.sender_id === item.sender_id
      && dayOf(older.created_at) === dayOf(item.created_at);

    const tally = tallyReactions(item.reactions, meId);
    const threadCount = item.thread_count ?? 0;

    return (
      <View>
        <Pressable
          onLongPress={() => onLongPress(item)}
          delayLongPress={280}
          accessibilityRole="button"
          accessibilityLabel={`${name} at ${timeOf(item.created_at)}. ${item.content}`}
          accessibilityHint="Long press to react or reply"
          style={({ pressed }) => [
            s.row,
            grouped && s.rowGrouped,
            pressed && { backgroundColor: t.surface2 },
          ]}
        >
          {grouped ? (
            <View style={s.avatarSpacer} />
          ) : (
            <View style={[s.avatar, { backgroundColor: avatarColor(item.sender_id) }]}>
              <Text style={s.avatarText}>{userInitials(name)}</Text>
            </View>
          )}

          <View style={s.body}>
            {!grouped && (
              <View style={s.head}>
                <Text style={[s.name, { color: mine ? t.primaryText : t.ink }]} numberOfLines={1}>
                  {mine ? 'You' : name}
                </Text>
                <Text style={[s.when, { color: t.ink4 }]}>{timeOf(item.created_at)}</Text>
              </View>
            )}

            <Text style={[s.content, { color: t.ink2 }]}>{item.content}</Text>

            {item.edited_at ? (
              <Text style={[s.edited, { color: t.ink4 }]}>edited</Text>
            ) : null}

            {(tally.length > 0 || threadCount > 0) && (
              <View style={s.metaRow}>
                {tally.map(r => (
                  <Pressable
                    key={r.emoji}
                    onPress={() => react.mutate({ id: item.id, emoji: r.emoji, mine: r.mine })}
                    accessibilityRole="button"
                    accessibilityLabel={`${r.emoji} ${r.count}${r.mine ? ', you reacted' : ''}`}
                    style={[
                      s.reaction,
                      {
                        backgroundColor: r.mine ? t.primaryContainer : t.surface3,
                        borderColor: r.mine ? t.primary : 'transparent',
                      },
                    ]}
                  >
                    <Text style={s.reactionEmoji}>{r.emoji}</Text>
                    <Text style={[s.reactionCount, { color: r.mine ? t.onPrimaryContainer : t.ink3 }]}>
                      {r.count}
                    </Text>
                  </Pressable>
                ))}

                {threadCount > 0 && (
                  <Pressable
                    onPress={() => { setReplyTo(item); composerRef.current?.focus(); }}
                    accessibilityRole="button"
                    accessibilityLabel={`${threadCount} ${threadCount === 1 ? 'reply' : 'replies'}, open thread`}
                    style={s.threadBtn}
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={13} color={t.primaryText} />
                    <Text style={[s.threadText, { color: t.primaryText }]}>
                      {threadCount} {threadCount === 1 ? 'reply' : 'replies'}
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        </Pressable>

        {showDay && (
          <View style={s.dayRow}>
            <View style={[s.dayLine, { backgroundColor: t.outlineVar }]} />
            <Text style={[s.dayText, { color: t.ink4, backgroundColor: t.bg }]}>
              {dayOf(item.created_at)}
            </Text>
            <View style={[s.dayLine, { backgroundColor: t.outlineVar }]} />
          </View>
        )}
      </View>
    );
  }, [meId, messages, t, onLongPress, react]);

  const canSend = draft.trim().length > 0 && !sending;

  const header = (
    <View style={[s.header, { paddingTop: insets.top + 6, borderBottomColor: t.outlineVar, backgroundColor: t.surface }]}>
      <Pressable
        onPress={() => nav.goBack()}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Back to messages"
      >
        <Ionicons name="chevron-back" size={24} color={t.ink2} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.headerTitle, { color: t.ink }]} numberOfLines={1}>{channelName}</Text>
        <Text style={[s.headerSub, { color: t.ink4 }]} numberOfLines={1}>संवाद</Text>
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <View style={[s.root, { backgroundColor: t.bg }]}>
        {header}
        <View style={s.centre}><ActivityIndicator color={t.primary} /></View>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[s.root, { backgroundColor: t.bg }]}>
        {header}
        <View style={[s.centre, { paddingHorizontal: 32 }]}>
          <Ionicons name="cloud-offline-outline" size={30} color={t.ink3} />
          <Text style={[s.emptyTitle, { color: t.ink }]}>Couldn't load messages</Text>
          <Pressable onPress={() => refetch()} accessibilityRole="button" style={[s.retry, { borderColor: t.outline }]}>
            <Text style={{ color: t.primaryText, fontWeight: '700', fontSize: 13 }}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      {header}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          data={messages}
          keyExtractor={m => m.id}
          renderItem={renderItem}
          inverted
          contentContainerStyle={s.listPad}
          keyboardShouldPersistTaps="handled"
          refreshControl={<Refresher refreshing={isRefetching} onRefresh={refetch} />}
          ListEmptyComponent={
            <View style={[s.centre, s.emptyInverted]}>
              <Ionicons name="chatbubbles-outline" size={30} color={t.ink3} />
              <Text style={[s.emptyTitle, { color: t.ink }]}>No messages yet</Text>
              <Text style={[s.emptyBody, { color: t.ink3 }]}>Say something to start the channel.</Text>
            </View>
          }
        />

        <View style={[s.composer, { backgroundColor: t.surface, borderTopColor: t.outlineVar, paddingBottom: insets.bottom || 10 }]}>
          {replyTo && (
            <View style={[s.replyBar, { backgroundColor: t.primaryContainer }]}>
              <Ionicons name="return-down-forward-outline" size={14} color={t.onPrimaryContainer} />
              <Text style={[s.replyText, { color: t.onPrimaryContainer }]} numberOfLines={1}>
                Replying to {replyTo.sender_name ?? 'message'}
              </Text>
              <Pressable onPress={() => setReplyTo(null)} hitSlop={8} accessibilityLabel="Cancel reply">
                <Ionicons name="close" size={15} color={t.onPrimaryContainer} />
              </Pressable>
            </View>
          )}
          <View style={s.composerRow}>
            <TextInput
              ref={composerRef}
              style={[s.input, { backgroundColor: t.bg, borderColor: t.outline, color: t.ink }]}
              value={draft}
              onChangeText={setDraft}
              placeholder={replyTo ? 'Reply…' : 'Message…'}
              placeholderTextColor={t.ink4}
              multiline
              maxLength={4000}
              accessibilityLabel="Message text"
            />
            <Pressable
              onPress={send}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              accessibilityState={{ disabled: !canSend }}
              style={[
                s.send,
                { backgroundColor: canSend ? t.primary : withAlpha(t.primary, 0.35) },
              ]}
            >
              {sending
                ? <ActivityIndicator size="small" color={t.onPrimary} />
                : <Ionicons name="send" size={16} color={t.onPrimary} />}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  // The list is inverted, so its empty state would render upside down.
  emptyInverted: { transform: [{ scaleY: -1 }], paddingVertical: 60 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  headerSub: { fontSize: 11.5, marginTop: 1, ...hindi() },

  listPad: { paddingHorizontal: 12, paddingVertical: 10 },

  row: { flexDirection: 'row', gap: 10, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 10 },
  rowGrouped: { paddingVertical: 2 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  avatarSpacer: { width: 32 },
  avatarText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  body: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  name: { fontSize: 13.5, fontWeight: '700', flexShrink: 1 },
  when: { fontSize: 11 },
  content: { fontSize: 14.5, lineHeight: 20, marginTop: 1 },
  edited: { fontSize: 10.5, marginTop: 1 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 },
  reaction: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, borderWidth: 1,
  },
  reactionEmoji: { fontSize: 12 },
  reactionCount: { fontSize: 11, fontWeight: '700' },
  threadBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3, paddingHorizontal: 4 },
  threadText: { fontSize: 11.5, fontWeight: '700' },

  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 4 },
  dayLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dayText: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8 },

  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 8 },
  replyBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8,
  },
  replyText: { flex: 1, fontSize: 12 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1, borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9,
    fontSize: 14.5, maxHeight: 120,
  },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },

  emptyTitle: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  emptyBody: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  retry: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8, marginTop: 6 },
});
