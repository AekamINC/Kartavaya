import React, { useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Modal, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import { resolveScreenState } from '../../components/ScreenState';
import ModuleShell, { Stat, StatRow, SectionHead, Card } from './ModuleShell';
import { manavApi, num, type LeaveRequest, type HrStats, type Holiday } from '../../api/modules';
import { a11yButton } from '../../components/a11y';

/**
 * Manav · मानव — HR, checking view plus the one action worth having on a phone.
 *
 * Endpoints:
 *   GET   /api/v1/manav/stats                     headcount, present, pending
 *   GET   /api/v1/manav/leaves?status=pending     the queue this screen exists for
 *   GET   /api/v1/manav/holidays                  current year
 *   PATCH /api/v1/manav/leaves/{id}/action        approve / decline
 *
 * A leave request sitting unanswered is the HR item that actually blocks
 * somebody, and it is answerable in two taps — which is why this is the one
 * light surface that writes. Employee records, payroll mapping and org
 * structure stay on desktop.
 *
 * Declining is gated on a reason before the call is made, matching the approvals
 * flow. `rejection_reason` is stored and mailed to the employee, so an empty one
 * produces a decision the person cannot act on.
 */

function fmtRange(start: string | null, end: string | null): string {
  const s = start ? new Date(start) : null;
  const e = end ? new Date(end) : null;
  const d = (x: Date) => x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  if (s && !Number.isNaN(s.getTime()) && e && !Number.isNaN(e.getTime())) {
    return s.toDateString() === e.toDateString() ? d(s) : `${d(s)} – ${d(e)}`;
  }
  if (s && !Number.isNaN(s.getTime())) return d(s);
  return '';
}

export default function ManavScreen() {
  const { t } = useTheme();
  const online = useOnline();
  const qc = useQueryClient();

  const stats    = useQuery({ queryKey: ['manav', 'stats'],    queryFn: manavApi.stats });
  const leaves   = useQuery({ queryKey: ['manav', 'leaves'],   queryFn: manavApi.pendingLeaves });
  const holidays = useQuery({ queryKey: ['manav', 'holidays'], queryFn: manavApi.holidays });

  const [busyId,   setBusyId]   = useState<string | null>(null);
  const [declining, setDeclining] = useState<LeaveRequest | null>(null);
  const [reason,   setReason]   = useState('');

  // Annotated, not inferred — see the note in api/modules.ts.
  const st:        HrStats | undefined = stats.data;
  const rows:      LeaveRequest[]      = leaves.data   ?? [];
  const holidayRows: Holiday[]         = holidays.data ?? [];

  const hasData = stats.data !== undefined || leaves.data !== undefined;
  const status = resolveScreenState({
    isLoading: stats.isLoading || leaves.isLoading,
    isError:   stats.isError || leaves.isError,
    error:     stats.error ?? leaves.error,
    online,
    hasData,
    // Never "empty": the stats block is worth showing on a day with no pending
    // leave, and an empty queue is good news that deserves saying out loud
    // rather than a tray icon.
    isEmpty:   false,
  });

  const refetch = () => { stats.refetch(); leaves.refetch(); holidays.refetch(); };

  const decide = async (row: LeaveRequest, decision: 'approved' | 'rejected', why?: string) => {
    if (busyId) return;
    if (!online) {
      Alert.alert(
        'You are offline',
        'A leave decision debits the balance and emails the employee, so it is not queued — it would send a stale answer. Try again once you have a connection.',
      );
      return;
    }
    setBusyId(row.id);
    try {
      await manavApi.actionLeave(row.id, decision, why);
      qc.invalidateQueries({ queryKey: ['manav'] });
    } catch (e: unknown) {
      const err = e as { friendlyMessage?: string; response?: { status?: number } };
      // 400 here almost always means someone else already decided it — the
      // server refuses to action anything that is no longer pending. Refetching
      // is the repair, so the row disappears instead of staying falsely actionable.
      if (err?.response?.status === 400) qc.invalidateQueries({ queryKey: ['manav'] });
      Alert.alert('Could not save', err?.friendlyMessage ?? 'Try again.');
    } finally {
      setBusyId(null);
    }
  };

  const nextHoliday = holidayRows.find(h => {
    const d = new Date(h.date);
    return !Number.isNaN(d.getTime()) && d >= new Date(new Date().toDateString());
  });

  return (
    <ModuleShell
      title="HR" hi="मानव"
      status={status}
      stale={hasData && !online}
      onRetry={refetch}
      refreshing={stats.isRefetching || leaves.isRefetching}
      boundary="Employee records, departments and payroll mapping are desktop work. Answering a leave request is not — it posts to the same ledger as the web."
    >
      <StatRow>
        <Stat value={String(num(st?.today_present))} label="Present today" tone={t.success} />
        <Stat value={String(num(st?.on_leave_today))} label="On leave" />
        <Stat
          value={String(num(st?.pending_leaves))}
          label="To approve"
          tone={num(st?.pending_leaves) > 0 ? t.approval : undefined}
        />
        <Stat value={String(num(st?.total_employees))} label="Headcount" />
      </StatRow>

      <SectionHead label="LEAVE REQUESTS" hi="अवकाश" right={String(rows.length)} />
      {rows.length === 0 ? (
        <Card>
          <View style={s.clearRow}>
            <Ionicons name="checkmark-circle-outline" size={18} color={t.success} />
            <Text style={[s.clearText, { color: t.ink2 }]}>
              Nothing waiting on you. Every request has been answered.
            </Text>
          </View>
        </Card>
      ) : rows.map(row => (
        <Card key={row.id} accent={t.approval}>
          <Text style={[s.name, { color: t.ink }]} numberOfLines={1}>
            {row.employee_name ?? 'Employee'}
          </Text>
          <Text style={[s.meta, { color: t.ink3 }]} numberOfLines={1}>
            {row.leave_type_name ?? 'Leave'}
            {row.days ? ` · ${num(row.days)} day${num(row.days) === 1 ? '' : 's'}` : ''}
            {fmtRange(row.start_date, row.end_date) ? ` · ${fmtRange(row.start_date, row.end_date)}` : ''}
          </Text>
          {!!row.reason && (
            <Text style={[s.reason, { color: t.ink4 }]} numberOfLines={3}>{row.reason}</Text>
          )}
          <View style={s.actions}>
            <Pressable
              onPress={() => decide(row, 'approved')}
              disabled={busyId === row.id}
              {...a11yButton(`Approve leave for ${row.employee_name ?? 'employee'}`)}
              style={({ pressed }) => [
                s.btn,
                { backgroundColor: pressed ? t.success : t.successBg, borderColor: t.success },
              ]}
            >
              {busyId === row.id
                ? <ActivityIndicator size="small" color={t.onSuccessContainer} />
                : <Text style={[s.btnText, { color: t.onSuccessContainer }]}>Approve</Text>}
            </Pressable>
            <Pressable
              onPress={() => { setDeclining(row); setReason(''); }}
              disabled={busyId === row.id}
              {...a11yButton(`Decline leave for ${row.employee_name ?? 'employee'}`)}
              style={({ pressed }) => [
                s.btn,
                { backgroundColor: pressed ? t.errorBg : 'transparent', borderColor: t.error },
              ]}
            >
              <Text style={[s.btnText, { color: t.error }]}>Decline</Text>
            </Pressable>
          </View>
        </Card>
      ))}

      {!!nextHoliday && (
        <>
          <SectionHead label="NEXT HOLIDAY" hi="अवकाश दिवस" />
          <Card>
            <Text style={[s.name, { color: t.ink }]}>{nextHoliday.name}</Text>
            <Text style={[s.meta, { color: t.ink3 }]}>
              {new Date(nextHoliday.date).toLocaleDateString('en-IN', {
                weekday: 'long', day: 'numeric', month: 'long',
              })}
              {nextHoliday.is_optional ? ' · optional' : ''}
            </Text>
          </Card>
        </>
      )}

      {/* Decline needs a reason before it can be sent — the employee is told it
          verbatim, so an empty one produces a decision they cannot act on. */}
      <Modal
        visible={!!declining}
        transparent
        animationType="slide"
        // Android's hardware back must dismiss this, per 17's platform table.
        onRequestClose={() => setDeclining(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={s.modalRoot}
        >
          <Pressable style={s.scrim} onPress={() => setDeclining(null)} accessibilityLabel="Dismiss" />
          <View style={[s.sheet, { backgroundColor: t.surface, borderColor: t.outlineVar }]}>
            <View style={[s.grab, { backgroundColor: t.outline }]} />
            <Text style={[s.sheetTitle, { color: t.ink }]}>
              Decline {declining?.employee_name ?? 'this request'}?
            </Text>
            <Text style={[s.sheetBody, { color: t.ink3 }]}>
              The reason is sent to them. Say what would change your answer.
            </Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Reason"
              placeholderTextColor={t.ink4}
              multiline
              style={[s.input, { color: t.ink, borderColor: t.outline, backgroundColor: t.surface2 }]}
              accessibilityLabel="Reason for declining"
            />
            <View style={s.sheetActions}>
              <Pressable
                onPress={() => setDeclining(null)}
                {...a11yButton('Cancel')}
                style={[s.btn, { borderColor: t.outline }]}
              >
                <Text style={[s.btnText, { color: t.ink2 }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const row = declining;
                  if (!row || !reason.trim()) return;
                  setDeclining(null);
                  decide(row, 'rejected', reason.trim());
                }}
                disabled={!reason.trim()}
                {...a11yButton('Confirm decline')}
                style={[
                  s.btn,
                  {
                    backgroundColor: reason.trim() ? t.error : t.surface2,
                    borderColor: reason.trim() ? t.error : t.outline,
                  },
                ]}
              >
                <Text style={[s.btnText, { color: reason.trim() ? t.onError : t.inkDisabled }]}>
                  Decline
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ModuleShell>
  );
}

const s = StyleSheet.create({
  name:   { fontSize: 14, fontWeight: '700' },
  meta:   { fontSize: 11.5, marginTop: 1 },
  reason: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  btn: {
    flex: 1, borderWidth: 1, borderRadius: 10,
    paddingVertical: 9, alignItems: 'center', justifyContent: 'center',
  },
  btnText: { fontSize: 13, fontWeight: '800' },

  clearRow:  { flexDirection: 'row', alignItems: 'center', gap: 9 },
  clearText: { flex: 1, fontSize: 12.5, lineHeight: 17 },

  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim:     { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderWidth: 1, borderBottomWidth: 0, padding: 18, paddingBottom: 34, gap: 8,
  },
  grab: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 6 },
  sheetTitle: { fontSize: 17, fontWeight: '700' },
  sheetBody:  { fontSize: 12.5, lineHeight: 18 },
  input: {
    borderWidth: 1, borderRadius: 10, padding: 11,
    fontSize: 14, minHeight: 84, textAlignVertical: 'top', marginTop: 4,
  },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
});
