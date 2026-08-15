/**
 * BoardsScreen — project list.
 * Phase 2 will add project colour swatches, member counts, and pull-to-refresh.
 */
import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import ScreenState, { resolveScreenState } from '../components/ScreenState';
import { useOnline } from '../hooks/useOnline';
import { projectsApi } from '../api/projects';
import { projectColor } from '../theme/tokens';
import type { RootStackParamList } from '../nav/RootStack';
import type { Project } from '../api/types';
import CardRow from '../components/CardRow';
import { chunkRows, rowKey } from '../lib/cardRows';
import { gridColumns } from '../lib/windowClass';
import { useWindowClass } from '../hooks/useWindowClass';
import { devicePlatform } from '../nav/platform';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Main'>;

export default function BoardsScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTheme();
  const nav    = useNavigation<Nav>();

  const online = useOnline();

  const query = useQuery({
    queryKey: ['projects'],
    queryFn:  projectsApi.list,
  });
  // Not `= []`: that default turned a failed request into "No projects yet.",
  // which reads as a fact about the org rather than a failure to reach it.
  const projects = query.data ?? [];

  // The content region minus this list's own 16pt padding, so the threshold is
  // measured against the room the CARDS get rather than the room the screen has.
  const { content } = useWindowClass(devicePlatform());
  const columns = gridColumns(content - 32);
  const rows = React.useMemo(() => chunkRows(projects, columns), [projects, columns]);

  const status = resolveScreenState({
    isLoading: query.isLoading,
    isError:   query.isError,
    error:     query.error,
    online,
    hasData:   query.data !== undefined,
    isEmpty:   query.data !== undefined && projects.length === 0,
  });

  return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      <View style={[s.header, { backgroundColor: t.surface, borderBottomColor: t.outline, paddingTop: insets.top + 8 }]}>
        <Text style={[s.title, { color: t.ink }]} accessibilityRole="header">Boards</Text>
      </View>
      {status !== 'ready' && status !== 'empty' ? (
        <ScreenState status={status} onRetry={() => query.refetch()} />
      ) : status === 'empty' ? (
        <ScreenState
          status="empty"
          icon="grid-outline"
          title="No projects yet"
          body="Projects you are a member of appear here. They are created from the web app."
        />
      ) : (
      <FlatList
        // Rows, not projects — see `lib/cardRows.ts`. The list stays virtualised
        // and `numColumns` is never touched, so a rotation changes what is in a
        // row rather than remounting the list.
        data={rows}
        keyExtractor={(row: Project[]) => rowKey(row, p => p.team_id)}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        renderItem={({ item: row }: { item: Project[] }) => (
          <CardRow columns={columns}>
            {row.map(p => {
              const color = projectColor(p.team_id, p.color ?? undefined);
              return (
                <TouchableOpacity
                  key={p.team_id}
                  style={[s.card, { backgroundColor: t.surface, borderColor: t.outline, borderLeftColor: color }]}
                  onPress={() => nav.navigate('Board', { projectId: p.team_id, projectName: p.name })}
                  activeOpacity={0.8}
                >
                  <View style={[s.dot, { backgroundColor: color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.cardName, { color: t.ink }]}>{p.name}</Text>
                    {p.description ? <Text style={[s.cardDesc, { color: t.ink3 }]} numberOfLines={1}>{p.description}</Text> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={t.ink3} />
                </TouchableOpacity>
              );
            })}
          </CardRow>
        )}
      />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:     { flex: 1 },
  header:   { paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1 },
  title:    { fontSize: 24, fontWeight: '900', letterSpacing: 0.3 },
  card:     { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, padding: 14, borderWidth: 1, borderLeftWidth: 4 },
  dot:      { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  cardName: { fontSize: 14, fontWeight: '700' },
  cardDesc: { fontSize: 12, marginTop: 2 },
});
