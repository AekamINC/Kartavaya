import React from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { hindi } from '../theme/fonts';
import Refresher from '../components/Refresher';
import { messagesApi, type Channel } from '../api/messages';

/**
 * Channel list. 17-mobile-app.md gives Messages the fourth tab slot because
 * messaging is the highest-frequency mobile action, moving Inbox under More.
 *
 * Unread is rendered as a count, not a dot: "how many" is the thing that decides
 * whether to open a channel now or later, and a dot throws that away.
 */

import type { RootStackParamList } from '../nav/RootStack';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Main'>;
type Glyph = keyof typeof Ionicons.glyphMap;

const CHANNEL_ICON: Record<Channel['type'], Glyph> = {
  public:  'globe-outline',
  private: 'lock-closed-outline',
  dm:      'person-outline',
};

/** A channel type the server adds later must not crash the list. */
const iconFor = (type: Channel['type']): Glyph => CHANNEL_ICON[type] ?? 'chatbubble-outline';

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function MessagesScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();

  const { data: channels, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['messaging', 'channels'],
    queryFn: messagesApi.channels,
  });

  if (isLoading) {
    return (
      <View style={[s.centre, { backgroundColor: t.bg }]}>
        <ActivityIndicator color={t.primary} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[s.centre, { backgroundColor: t.bg, paddingHorizontal: 32 }]}>
        <Ionicons name="cloud-offline-outline" size={30} color={t.ink3} />
        <Text style={[s.emptyTitle, { color: t.ink }]}>Couldn't load channels</Text>
        <Text style={[s.emptyBody, { color: t.ink3 }]}>
          Check your connection and pull down to retry.
        </Text>
      </View>
    );
  }

  const list = channels ?? [];

  return (
    <View style={[s.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={[s.title, { color: t.ink }]}>Messages</Text>
        <Text style={[s.titleHi, { color: t.primaryText }]}>संवाद</Text>
      </View>

      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        contentContainerStyle={[s.listPad, list.length === 0 && s.listGrow]}
        refreshControl={
          <Refresher refreshing={isRefetching} onRefresh={refetch} />
        }
        ListEmptyComponent={
          <View style={s.centre}>
            <Ionicons name="chatbubbles-outline" size={30} color={t.ink3} />
            <Text style={[s.emptyTitle, { color: t.ink }]}>No channels yet</Text>
            <Text style={[s.emptyBody, { color: t.ink3 }]}>
              Channels are created on the web. Once you're a member, they appear here.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const unread = item.unread_count > 0;
          return (
            <Pressable
              onPress={() => nav.navigate('Chat', { channelId: item.id, channelName: item.name })}
              accessibilityRole="button"
              accessibilityLabel={
                unread
                  ? `${item.name}, ${item.unread_count} unread`
                  : item.name
              }
              style={({ pressed }) => [
                s.row,
                {
                  backgroundColor: pressed ? t.surface2 : t.surface,
                  borderColor: unread ? t.primaryContainer : t.outlineVar,
                },
              ]}
            >
              <View style={[s.icon, { backgroundColor: t.surface3 }]}>
                <Ionicons name={iconFor(item.type)} size={16} color={t.ink2} />
              </View>

              <View style={s.rowBody}>
                <View style={s.rowHead}>
                  <Text
                    style={[s.name, { color: t.ink, fontWeight: unread ? '700' : '600' }]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  <Text style={[s.when, { color: t.ink4 }]}>{relTime(item.updated_at)}</Text>
                </View>
                <Text style={[s.sub, { color: t.ink3 }]} numberOfLines={1}>
                  {item.topic?.trim()
                    ? item.topic
                    : `${item.member_count} ${item.member_count === 1 ? 'member' : 'members'}`}
                </Text>
              </View>

              {unread && (
                <View style={[s.count, { backgroundColor: t.primary }]}>
                  <Text style={[s.countText, { color: t.onPrimary }]}>
                    {item.unread_count > 99 ? '99+' : item.unread_count}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.4 },
  titleHi: { fontSize: 14, marginTop: 2, ...hindi() },
  listPad: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
  listGrow: { flexGrow: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 12, padding: 12,
  },
  icon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, minWidth: 0 },
  rowHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  name: { flex: 1, fontSize: 15 },
  when: { fontSize: 11.5 },
  sub: { fontSize: 12.5, marginTop: 2 },
  count: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  countText: { fontSize: 11, fontWeight: '800' },
  emptyTitle: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  emptyBody: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
});
