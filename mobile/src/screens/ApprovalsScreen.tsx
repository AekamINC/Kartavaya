import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, TextInput, ActivityIndicator,
  Modal, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { hindi } from '../theme/fonts';
import { a11yButton } from '../components/a11y';
import SwipeRow from '../components/SwipeRow';
import {
  approvalsApi, approvalTitle, isTaskApproval,
  type PendingApproval, type ApprovalHistoryRow,
} from '../api/approvals';
import { PRIORITY_COLORS, withAlpha } from '../theme/tokens';
import type { RootStackParamList } from '../nav/RootStack';

/**
 * Approvals.
 *
 * 17-mobile-app.md: "swipe right approve, left decline, batch select, decline
 * gated on a reason." All four are here.
 *
 * THE DECLINE GATE IS THE POINT OF THE SCREEN. server.py:1209 rejects a decline
 * with no reason, so a swipe-left cannot simply fire — it opens the reason sheet
 * and the confirm stays disabled until something is typed. A swipe is a fast
 * gesture and declining is not a fast decision; the gate is what keeps the two
 * from being confused. Approving, which is not destructive and needs no reason,
 * does commit straight from the swipe.
 *
 * Swiping uses the shared SwipeRow so the threshold, the haptic and the action
 * colours match Tasks — 17 is explicit that three implementations would drift.
 */

type Nav = NativeStackNavigationProp<RootStackParamList, 'Approvals'>;
type Tab = 'pending' | 'history';

export default function ApprovalsScreen() {
  const { t, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();

  const [tab, setTab] = useState<Tab>('pending');
  /** Batch selection. Empty set = normal mode; non-empty = batch mode. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [declining, setDeclining] = useState<PendingApproval[] | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const pendingQ = useQuery<PendingApproval[]>({
    queryKey: ['approvals', 'pending'],
    queryFn: approvalsApi.pending,
  });
  const historyQ = useQuery<ApprovalHistoryRow[]>({
    queryKey: ['approvals', 'history'],
    queryFn: approvalsApi.history,
    enabled: tab === 'history',
  });

  const pending: PendingApproval[] = pendingQ.data ?? [];

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['approvals'] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  }, [qc]);

  const clearSelection = () => setSelected(new Set());

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedRows = useMemo(
    () => pending.filter(a => selected.has(a.approval_id)),
    [pending, selected],
  );

  /** Approve one or many. No reason needed, so this commits directly. */
  const approve = useCallback(async (rows: PendingApproval[]) => {
    if (!rows.length || busy) return;
    setBusy(true);
    const failures: string[] = [];
    // Serial, not Promise.all: these are writes against shared rows and a burst
    // of parallel reviews is how you get partial application with no way to tell
    // which half landed.
    for (const row of rows) {
      try {
        await approvalsApi.review(row.approval_id, 'approved');
      } catch (e: unknown) {
        failures.push(approvalTitle(row));
      }
    }
    setBusy(false);
    clearSelection();
    refresh();
    if (failures.length) {
      Alert.alert(
        'Some approvals failed',
        `${failures.length} could not be approved:\n${failures.slice(0, 5).join('\n')}`,
      );
    }
  }, [busy, refresh]);

  /** Decline always routes through the reason sheet. Never fires from a swipe. */
  const openDecline = useCallback((rows: PendingApproval[]) => {
    if (!rows.length) return;
    setReason('');
    setDeclining(rows);
  }, []);

  const confirmDecline = useCallback(async () => {
    const rows = declining;
    const notes = reason.trim();
    if (!rows || !notes || busy) return;
    setBusy(true);
    const failures: string[] = [];
    for (const row of rows) {
      try {
        await approvalsApi.review(row.approval_id, 'rejected', { notes });
      } catch {
        failures.push(approvalTitle(row));
      }
    }
    setBusy(false);
    setDeclining(null);
    setReason('');
    clearSelection();
    refresh();
    if (failures.length) {
      Alert.alert(
        'Some declines failed',
        `${failures.length} could not be declined:\n${failures.slice(0, 5).join('\n')}`,
      );
    }
  }, [declining, reason, busy, refresh]);

  // ── Rows ────────────────────────────────────────────────────────────────────

  const renderPending = ({ item }: { item: PendingApproval }) => {
    const isSelected = selected.has(item.approval_id);
    const batchMode = selected.size > 0;
    const title = approvalTitle(item);
    // Narrow once into a typed local. `isTaskApproval(item)` stored as a boolean
    // does not narrow `item` for TypeScript on later property reads.
    const taskItem = isTaskApproval(item) ? item : null;
    const priority = taskItem?.priority ?? null;
    const pri = priority ? PRIORITY_COLORS[scheme][priority] ?? t.ink3 : null;

    const card = (
      <Pressable
        onPress={() => {
          if (batchMode) { toggleSelect(item.approval_id); return; }
          if (taskItem) nav.navigate('TaskDetail', { taskId: taskItem.task_id });
        }}
        onLongPress={() => toggleSelect(item.approval_id)}
        delayLongPress={260}
        accessibilityRole="button"
        accessibilityLabel={`${title}, requested by ${item.requester_name ?? 'someone'}`}
        accessibilityHint={batchMode ? 'Toggles selection' : 'Opens the task. Long press to select.'}
        accessibilityState={{ selected: isSelected }}
        style={({ pressed }) => [
          s.card,
          {
            backgroundColor: pressed ? t.surface2 : t.surface,
            borderColor: isSelected ? t.primary : t.outlineVar,
            borderWidth: isSelected ? 2 : 1,
          },
        ]}
      >
        {batchMode && (
          <View style={[s.check, { borderColor: isSelected ? t.primary : t.outline, backgroundColor: isSelected ? t.primary : 'transparent' }]}>
            {isSelected && <Ionicons name="checkmark" size={12} color={t.onPrimary} />}
          </View>
        )}

        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.cardHead}>
            <Text style={[s.cardTitle, { color: t.ink }]} numberOfLines={2}>{title}</Text>
            {pri && (
              <View style={[s.pri, { backgroundColor: withAlpha(pri, 0.13), borderColor: pri }]}>
                <Text style={[s.priText, { color: pri }]}>{priority}</Text>
              </View>
            )}
          </View>

          <Text style={[s.cardMeta, { color: t.ink3 }]} numberOfLines={1}>
            {item.requester_name ?? 'Unknown'}
            {taskItem ? ' · wants to mark done' : ' · wants to create this'}
          </Text>

          {item.notes ? (
            <Text style={[s.cardNotes, { color: t.ink3 }]} numberOfLines={2}>{item.notes}</Text>
          ) : null}
        </View>
      </Pressable>
    );

    // In batch mode the swipe is suppressed: a drag that both selects and
    // commits is how a bulk decline happens by accident.
    if (batchMode) return <View style={s.rowWrap}>{card}</View>;

    return (
      <View style={s.rowWrap}>
        <SwipeRow
          accessibilityLabel={title}
          // Container fills with their matching on-* foregrounds, not solid
          // accent fills with onPrimary. onPrimary is a dark teal in dark mode
          // and would have been drawn on a red panel. The container pairs are
          // the only ones the token layer guarantees contrast for in both themes.
          right={{
            label: 'Approve',
            icon: 'checkmark-circle',
            color: t.successBg,
            onColor: t.onSuccessContainer,
            onTrigger: () => approve([item]),
          }}
          left={{
            label: 'Decline',
            icon: 'close-circle',
            color: t.errorBg,
            onColor: t.onErrorContainer,
            // Opens the reason sheet. Does NOT decline.
            onTrigger: () => openDecline([item]),
          }}
          disabled={busy}
        >
          {card}
        </SwipeRow>
      </View>
    );
  };

  const renderHistory = ({ item }: { item: ApprovalHistoryRow }) => {
    const ok = item.status === 'approved';
    return (
      <View style={[s.rowWrap]}>
        <View style={[s.card, { backgroundColor: t.surface, borderColor: t.outlineVar, borderWidth: 1 }]}>
          <View style={[s.histIcon, { backgroundColor: ok ? t.successBg : t.errorBg }]}>
            <Ionicons
              name={ok ? 'checkmark-circle' : 'close-circle'}
              size={15}
              color={ok ? t.success : t.error}
            />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.cardTitle, { color: t.ink }]} numberOfLines={2}>{item.task_title}</Text>
            <Text style={[s.cardMeta, { color: t.ink3 }]} numberOfLines={1}>
              {ok ? 'Approved' : 'Declined'}
              {item.requester_name ? ` · ${item.requester_name}` : ''}
            </Text>
            {item.notes ? (
              <Text style={[s.cardNotes, { color: t.ink3 }]} numberOfLines={2}>{item.notes}</Text>
            ) : null}
          </View>
        </View>
      </View>
    );
  };

  // ── Chrome ──────────────────────────────────────────────────────────────────

  const loading = tab === 'pending' ? pendingQ.isLoading : historyQ.isLoading;
  const failed = tab === 'pending' ? pendingQ.isError : historyQ.isError;

  return (
    <View style={[s.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={() => nav.goBack()} hitSlop={10} {...a11yButton('Back')}>
          <Ionicons name="chevron-back" size={24} color={t.ink2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: t.ink }]}>Approvals</Text>
          <Text style={[s.titleHi, { color: t.primaryText }]}>सम्मति</Text>
        </View>
      </View>

      <View style={[s.tabs, { backgroundColor: t.surface3 }]} accessibilityRole="tablist">
        {(['pending', 'history'] as Tab[]).map(id => {
          const active = tab === id;
          return (
            <Pressable
              key={id}
              onPress={() => { setTab(id); clearSelection(); }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[s.tab, active && { backgroundColor: t.surface }]}
            >
              <Text style={[s.tabText, { color: active ? t.ink : t.ink3 }]}>
                {id === 'pending' ? 'Pending' : 'History'}
                {id === 'pending' && pending.length > 0 ? ` · ${pending.length}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={s.centre}><ActivityIndicator color={t.primary} /></View>
      ) : failed ? (
        <View style={[s.centre, { paddingHorizontal: 32 }]}>
          <Ionicons name="cloud-offline-outline" size={30} color={t.ink3} />
          <Text style={[s.emptyTitle, { color: t.ink }]}>Couldn't load approvals</Text>
          <Text style={[s.emptyBody, { color: t.ink3 }]}>Pull down to retry.</Text>
        </View>
      ) : tab === 'pending' ? (
        <FlatList
          data={pending}
          keyExtractor={a => a.approval_id}
          renderItem={renderPending}
          contentContainerStyle={[s.listPad, pending.length === 0 && s.listGrow]}
          onRefresh={pendingQ.refetch}
          refreshing={pendingQ.isRefetching}
          ListEmptyComponent={
            <View style={s.centre}>
              <Ionicons name="checkmark-done-outline" size={30} color={t.ink3} />
              <Text style={[s.emptyTitle, { color: t.ink }]}>Nothing waiting</Text>
              <Text style={[s.emptyBody, { color: t.ink3 }]}>
                Approvals you can action show up here.
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={historyQ.data ?? []}
          keyExtractor={h => h.approval_id}
          renderItem={renderHistory}
          contentContainerStyle={[s.listPad, (historyQ.data ?? []).length === 0 && s.listGrow]}
          onRefresh={historyQ.refetch}
          refreshing={historyQ.isRefetching}
          ListEmptyComponent={
            <View style={s.centre}>
              <Ionicons name="time-outline" size={30} color={t.ink3} />
              <Text style={[s.emptyTitle, { color: t.ink }]}>No decisions yet</Text>
            </View>
          }
        />
      )}

      {/* ── Batch bar ── */}
      {selected.size > 0 && tab === 'pending' && (
        <View style={[s.batchBar, { backgroundColor: t.surface, borderTopColor: t.outlineVar, paddingBottom: insets.bottom || 12 }]}>
          <Pressable onPress={clearSelection} hitSlop={8} {...a11yButton('Clear selection')}>
            <Text style={{ color: t.ink3, fontSize: 13, fontWeight: '600' }}>
              {selected.size} selected
            </Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => openDecline(selectedRows)}
            disabled={busy}
            {...a11yButton(`Decline ${selected.size} selected`)}
            style={[s.batchBtn, { backgroundColor: t.errorBg, borderColor: t.error }]}
          >
            <Text style={{ color: t.error, fontWeight: '800', fontSize: 13 }}>Decline</Text>
          </Pressable>
          <Pressable
            onPress={() => approve(selectedRows)}
            disabled={busy}
            {...a11yButton(`Approve ${selected.size} selected`)}
            style={[s.batchBtn, { backgroundColor: t.primary, borderColor: t.primary }]}
          >
            {busy
              ? <ActivityIndicator size="small" color={t.onPrimary} />
              : <Text style={{ color: t.onPrimary, fontWeight: '800', fontSize: 13 }}>Approve</Text>}
          </Pressable>
        </View>
      )}

      {/* ── Decline reason ── */}
      <Modal
        visible={!!declining}
        transparent
        animationType="fade"
        // Android hardware back must dismiss this, per 17's platform table.
        onRequestClose={() => setDeclining(null)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <Pressable style={s.overlay} onPress={() => setDeclining(null)}>
            <Pressable style={[s.sheet, { backgroundColor: t.surface }]} onPress={() => {}}>
              <Text style={[s.sheetTitle, { color: t.ink }]}>
                Decline {declining && declining.length > 1 ? `${declining.length} requests` : 'request'}
              </Text>
              <Text style={[s.sheetLabel, { color: t.ink3 }]}>REASON (REQUIRED)</Text>
              <TextInput
                style={[s.sheetInput, {
                  backgroundColor: t.bg,
                  borderColor: reason.trim() ? t.outline : t.error,
                  color: t.ink,
                }]}
                value={reason}
                onChangeText={setReason}
                placeholder="What needs to change?"
                placeholderTextColor={t.ink4}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                autoFocus
                accessibilityLabel="Decline reason, required"
              />
              <Text style={{ color: t.ink3, fontSize: 11.5, lineHeight: 16, marginTop: 6 }}>
                The person who did the work sees this.
              </Text>

              <View style={s.sheetActions}>
                <Pressable
                  onPress={() => setDeclining(null)}
                  style={[s.sheetBtn, { borderColor: t.outline }]}
                  {...a11yButton('Cancel')}
                >
                  <Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={confirmDecline}
                  disabled={!reason.trim() || busy}
                  accessibilityState={{ disabled: !reason.trim() || busy }}
                  {...a11yButton('Confirm decline')}
                  style={[
                    s.sheetBtn,
                    {
                      backgroundColor: t.errorBg,
                      borderColor: t.error,
                      opacity: reason.trim() && !busy ? 1 : 0.45,
                    },
                  ]}
                >
                  {busy
                    ? <ActivityIndicator size="small" color={t.error} />
                    : <Text style={{ color: t.error, fontWeight: '800', fontSize: 13 }}>Decline</Text>}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 60 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 10 },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  titleHi: { fontSize: 13, marginTop: 1, ...hindi() },

  tabs: { flexDirection: 'row', marginHorizontal: 16, borderRadius: 10, padding: 3, gap: 3 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 8 },
  tabText: { fontSize: 13, fontWeight: '700' },

  listPad: { padding: 16, gap: 10 },
  listGrow: { flexGrow: 1 },
  rowWrap: { marginBottom: 2 },

  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 12, padding: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitle: { flex: 1, fontSize: 14.5, fontWeight: '600', lineHeight: 20 },
  cardMeta: { fontSize: 12, marginTop: 3 },
  cardNotes: { fontSize: 12, marginTop: 5, lineHeight: 17, fontStyle: 'italic' },

  pri: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2 },
  priText: { fontSize: 9.5, fontWeight: '800', textTransform: 'uppercase' },

  check: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  histIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

  batchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth,
  },
  batchBtn: {
    borderRadius: 9, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 9,
    minWidth: 88, alignItems: 'center',
  },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  sheetTitle: { fontSize: 17, fontWeight: '800', marginBottom: 14 },
  sheetLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2, marginBottom: 6 },
  sheetInput: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, minHeight: 84 },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  sheetBtn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },

  emptyTitle: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  emptyBody: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
});
