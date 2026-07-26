/**
 * ClientPortalScreen — read-only task view for client users.
 * Uses cookie-based apiClient (new API layer) and getCachedUser.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, Alert, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../api/client';
import { apiLogout, getCachedUser } from '../api/auth';
import { useTheme } from '../theme/ThemeProvider';
import type { Task, Comment } from '../api/types';
import type { User } from '../api/types';
import { BRAND_GRADIENT_2 } from '../theme/tokens';

interface Props {
  onLogout?: () => void;
}

export default function ClientPortalScreen({ onLogout }: Props) {
  const { t } = useTheme();
  const [tasks,    setTasks]    = useState<Task[]>([]);
  const [selected, setSelected] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [comment,  setComment]  = useState('');
  const [user]                  = useState<User | null>(getCachedUser);

  useEffect(() => {
    apiClient.get<Task[]>('/client/tasks')
      .then(r => setTasks(r.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) return;
    apiClient.get<Comment[]>(`/tasks/${selected.task_id}/comments`)
      .then(r => setComments(r.data))
      .catch(() => {});
  }, [selected]);

  const postComment = useCallback(async () => {
    if (!comment.trim() || !selected) return;
    try {
      await apiClient.post(`/tasks/${selected.task_id}/comments`, { body: comment.trim() });
      setComment('');
      const r = await apiClient.get<Comment[]>(`/tasks/${selected.task_id}/comments`);
      setComments(r.data);
    } catch {
      Alert.alert('Error', 'Could not post comment');
    }
  }, [comment, selected]);

  const confirmLogout = useCallback(() => {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => { await apiLogout(); onLogout?.(); } },
    ]);
  }, [onLogout]);

  const s = styles(t);

  if (selected) return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => setSelected(null)} style={s.back}>
          <Ionicons name="chevron-back" size={22} color={t.primary} />
        </TouchableOpacity>
        <Text style={[s.taskTitle, { color: t.ink }]} numberOfLines={2}>{selected.title}</Text>
      </View>
      <FlatList
        data={comments}
        keyExtractor={c => c.comment_id}
        contentContainerStyle={s.commentList}
        ListEmptyComponent={<Text style={[s.empty, { color: t.ink3 }]}>No comments yet. Be the first.</Text>}
        renderItem={({ item: c }) => (
          <View style={s.comment}>
            <View style={[s.commAvatar, { backgroundColor: t.primaryContainer }]}>
              <Text style={{ color: t.primary, fontSize: 10, fontWeight: '800' }}>{(c.user_name || '?')[0].toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.commName, { color: t.ink3 }]}>{c.user_name} · {new Date(c.created_at).toLocaleString()}</Text>
              <Text style={[s.commBody, { color: t.ink }]}>{c.body}</Text>
            </View>
          </View>
        )}
      />
      <View style={[s.inputRow, { backgroundColor: t.surface, borderTopColor: t.outline }]}>
        <TextInput
          style={[s.input, { backgroundColor: t.bg, borderColor: t.outline, color: t.ink }]}
          value={comment}
          onChangeText={setComment}
          placeholder="Add a comment…"
          placeholderTextColor={t.ink3}
          multiline
        />
        <TouchableOpacity onPress={postComment}>
          <LinearGradient colors={BRAND_GRADIENT_2} style={s.sendBtn}>
            <Text style={{ color: '#fff', fontWeight: '800' }}>Post</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      <View style={[s.header, { backgroundColor: t.surface, borderBottomColor: t.outline }]}>
        <LinearGradient colors={BRAND_GRADIENT_2} style={s.logo}>
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '900' }}>◆</Text>
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={[s.brand, { color: t.ink }]}>Kartavaya</Text>
          <Text style={[s.brandSub, { color: t.ink3 }]}>Hi, {user?.name ?? user?.full_name}</Text>
        </View>
        <TouchableOpacity onPress={confirmLogout} style={[s.logoutBtn, { backgroundColor: `${t.error}18` }]}>
          <Text style={[s.logoutText, { color: t.error }]}>Sign out</Text>
        </TouchableOpacity>
      </View>
      <Text style={[s.sectionLabel, { color: t.primary }]}>Your Updates</Text>
      <FlatList
        data={tasks}
        keyExtractor={item => item.task_id}
        contentContainerStyle={s.list}
        ListEmptyComponent={<Text style={[s.empty, { color: t.ink3 }]}>No tasks shared with you yet.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[s.taskCard, { backgroundColor: t.surface, borderColor: t.outline }]}
            onPress={() => setSelected(item)}
          >
            <View style={s.taskTop}>
              <Text style={[s.taskTitleText, { color: t.ink }]} numberOfLines={2}>{item.title}</Text>
              <View style={[s.status, { backgroundColor: `${t.primary}22` }]}>
                <Text style={[s.statusText, { color: t.primary }]}>
                  {item.status === 'in_progress' ? 'In Progress' : item.status}
                </Text>
              </View>
            </View>
            {item.description
              ? <Text style={[s.desc, { color: t.ink3 }]} numberOfLines={2}>{item.description}</Text>
              : null}
            {item.due_at
              ? <Text style={[s.due, { color: t.ink3 }]}>Due {new Date(item.due_at).toLocaleDateString()}</Text>
              : null}
            <Text style={[s.tapHint, { color: t.primary }]}>Tap to comment ›</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = (t: ReturnType<typeof useTheme>['t']) => StyleSheet.create({
  root:         { flex: 1 },
  header:       { paddingTop: Platform.OS === 'ios' ? 56 : 36, paddingHorizontal: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1 },
  logo:         { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  brand:        { fontSize: 13, fontWeight: '800', letterSpacing: 3 },
  brandSub:     { fontSize: 11, marginTop: 1 },
  logoutBtn:    { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  logoutText:   { fontSize: 11, fontWeight: '700' },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 2.5, textTransform: 'uppercase', padding: 16, paddingBottom: 8 },
  list:         { padding: 16, paddingBottom: 40 },
  empty:        { fontSize: 13, textAlign: 'center', marginTop: 40 },
  taskCard:     { borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 1 },
  taskTop:      { flexDirection: 'row', gap: 10, justifyContent: 'space-between', alignItems: 'flex-start' },
  taskTitleText:{ fontSize: 14, fontWeight: '700', flex: 1 },
  status:       { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText:   { fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  desc:         { fontSize: 12, marginTop: 8, lineHeight: 17 },
  due:          { fontSize: 10, marginTop: 6, fontWeight: '600' },
  tapHint:      { fontSize: 10, marginTop: 10, fontWeight: '700' },
  back:         { marginRight: 8 },
  taskTitle:    { fontSize: 16, fontWeight: '900', flex: 1 },
  commentList:  { padding: 16, paddingBottom: 20 },
  comment:      { flexDirection: 'row', gap: 10, marginBottom: 14 },
  commAvatar:   { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  commName:     { fontSize: 10, marginBottom: 4 },
  commBody:     { fontSize: 13, lineHeight: 19 },
  inputRow:     { flexDirection: 'row', gap: 10, padding: 14, borderTopWidth: 1 },
  input:        { flex: 1, borderRadius: 10, borderWidth: 1, padding: 10, maxHeight: 80 },
  sendBtn:      { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10 },
});
