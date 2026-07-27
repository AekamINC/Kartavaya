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
import type { ClientState, ClientTask, Comment } from '../api/types';
import type { User } from '../api/types';
import { BRAND_GRADIENT_2 } from '../theme/tokens';

interface Props {
  onLogout?: () => void;
}

/**
 * The three client states, as words. `ClientTaskOut.state` replaced the raw
 * six-value `status` this screen used to print — which meant it was rendering
 * `undefined` into the pill, and the old `in_progress` special-case had nothing
 * to match.
 */
const STATE_LABEL: Record<ClientState, string> = {
  with_us:  'With us',
  with_you: 'With you',
  done:     'Done',
};

export default function ClientPortalScreen({ onLogout }: Props) {
  const { t } = useTheme();
  /**
   * `null` until a load succeeds, never `[]`.
   *
   * This is a client's only window onto the firm's work. "No tasks shared with
   * you yet" over a rejected request tells a paying client the firm has not
   * started — the swallowed catch below left the list at `[]` and the
   * FlatList's `ListEmptyComponent` printed it. The comment thread has the
   * same shape: "No comments yet. Be the first." over a failed read invites a
   * duplicate of a message that is already there.
   */
  const [tasks,    setTasks]    = useState<ClientTask[] | null>(null);
  const [tasksErr, setTasksErr] = useState(false);
  const [selected, setSelected] = useState<ClientTask | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [commErr,  setCommErr]  = useState(false);
  const [comment,  setComment]  = useState('');
  const [user]                  = useState<User | null>(getCachedUser);

  useEffect(() => {
    apiClient.get<ClientTask[]>('/client/tasks')
      .then(r => { setTasks(Array.isArray(r.data) ? r.data : []); setTasksErr(false); })
      .catch(() => { setTasks(null); setTasksErr(true); });
  }, []);

  /**
   * `selected.taskId`, not `selected.task_id`. The snake_case read produced the
   * literal URL `/api/tasks/undefined/comments`, which 404s — and both callers
   * swallow the failure, so the thread was permanently empty and every post
   * failed with the generic alert below. The endpoint itself is fine for a
   * client: `server.py:1641-1647` authorises them against the task and returns
   * only client-visible comments.
   */
  useEffect(() => {
    if (!selected) return;
    setComments(null);
    setCommErr(false);
    apiClient.get<Comment[]>(`/tasks/${selected.taskId}/comments`)
      .then(r => { setComments(Array.isArray(r.data) ? r.data : []); setCommErr(false); })
      .catch(() => { setComments(null); setCommErr(true); });
  }, [selected]);

  const postComment = useCallback(async () => {
    if (!comment.trim() || !selected) return;
    try {
      await apiClient.post(`/tasks/${selected.taskId}/comments`, { body: comment.trim() });
      setComment('');
      const r = await apiClient.get<Comment[]>(`/tasks/${selected.taskId}/comments`);
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
        data={comments ?? []}
        keyExtractor={c => c.comment_id}
        contentContainerStyle={s.commentList}
        ListEmptyComponent={
          commErr
            ? <Text style={[s.empty, { color: t.error }]}>The conversation did not load. This is not an empty thread.</Text>
            : comments === null
              ? <Text style={[s.empty, { color: t.ink3 }]}>Loading…</Text>
              : <Text style={[s.empty, { color: t.ink3 }]}>No comments yet. Be the first.</Text>
        }
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
        data={tasks ?? []}
        keyExtractor={item => item.taskId}
        contentContainerStyle={s.list}
        ListEmptyComponent={
          tasksErr
            ? <Text style={[s.empty, { color: t.error }]}>Your updates did not load. This is not a list of everything shared with you.</Text>
            : tasks === null
              ? <Text style={[s.empty, { color: t.ink3 }]}>Loading…</Text>
              : <Text style={[s.empty, { color: t.ink3 }]}>No tasks shared with you yet.</Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[s.taskCard, { backgroundColor: t.surface, borderColor: t.outline }]}
            onPress={() => setSelected(item)}
          >
            <View style={s.taskTop}>
              <Text style={[s.taskTitleText, { color: t.ink }]} numberOfLines={2}>{item.title}</Text>
              <View style={[s.status, { backgroundColor: `${t.primary}22` }]}>
                <Text style={[s.statusText, { color: t.primary }]}>
                  {STATE_LABEL[item.state] ?? ''}
                </Text>
              </View>
            </View>
            {item.note
              ? <Text style={[s.desc, { color: t.ink3 }]} numberOfLines={2}>{item.note}</Text>
              : null}
            {item.expectedAt
              ? <Text style={[s.due, { color: t.ink3 }]}>Due {new Date(item.expectedAt).toLocaleDateString()}</Text>
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
