import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { useOfflineMutation } from '../../hooks/useOfflineMutation';
import { useQueueStatus } from '../../hooks/useQueueStatus';
import { queuedEntityIds } from '../../offline/mutationQueue';
import { a11yButton } from '../../components/a11y';
import { SectionHead, Card } from '../modules/ModuleShell';
import { inrCompact } from '../../api/modules';
import { grahaWriteApi, writeErrorMessage, type CrmToday } from '../../api/graha';
import { ErrorNote } from './sheetKit';

/**
 * Today · आज — the daily action view.
 *
 * `GET /api/v1/graha/today` has existed since the CRM shipped, is already
 * scoped by the server to the caller unless they are an org admin, and is
 * already five short capped lists rather than a page of records. It was
 * phone-shaped from the day it was written and no phone had ever called it.
 *
 * Two of the five are shown here and three are not, deliberately:
 *
 *   shown   `overdue_followups`  the only list with an ACTION attached
 *           `stale_deals`        seven days with nothing logged — what is
 *                                slipping, which is the question this whole
 *                                surface exists to answer
 *   not     `new_leads`          a lead is a contact, and contacts are not a
 *                                mobile destination this pass
 *           `todays_activities`  a log of what has already been recorded; the
 *                                deal sheet shows it where it means something
 *           `recent_closures`    a morale list, not an action list
 *
 * They can be added, but a "today" screen that lists five things is a dashboard
 * again, and the thing being fixed is that nobody opens the dashboard.
 */

interface Props {
  /** Opens the deal sheet. Held by `GrahaScreen` so one sheet serves both lists. */
  onOpenDeal: (dealId: string, title: string) => void;
  /** Reported upward so the shell's boundary/error copy stays in one place. */
  onError: (message: string | null) => void;
  /** The last write error, if any — rendered inline under the section. */
  error: string | null;
}

export default function TodayPanel({ onOpenDeal, onError, error }: Props) {
  const { t } = useTheme();
  const qc = useQueryClient();

  const today = useQuery({
    queryKey: ['graha', 'today'],
    queryFn:  grahaWriteApi.today,
  });

  // Annotated, not inferred — see the note in `api/modules.ts`. Without this
  // every field read below is unchecked.
  const data: CrmToday | undefined = today.data;
  const overdue = data?.overdue_followups ?? [];
  const stale   = data?.stale_deals ?? [];

  const { changes } = useQueueStatus();
  const queued = useMemo(() => queuedEntityIds('graha_follow_up'), [changes.count]);

  /**
   * Tick an overdue follow-up off from here.
   *
   * Queueable, unlike the two CREATE paths: the endpoint takes no body and does
   * nothing but set `is_completed` true, so a replayed call is the same call.
   * That matters most for exactly this list — the person clearing it is between
   * meetings, which is where the signal is worst.
   *
   * The optimistic update is written against `CrmToday` rather than shared with
   * the deal sheet's version of the same mutation. The two caches hold
   * different shapes — a flat `FollowUp[]` there, a five-list object here — and
   * a shared hook would have to take the updater as a callback, which is the
   * whole of what is being shared.
   */
  const complete = useOfflineMutation<{ followUpId: string }>({
    method: 'PATCH',
    urlBuilder: v => `/v1/graha/follow-ups/${v.followUpId}/complete`,
    bodyBuilder: () => ({}),
    mutationFn:  v => grahaWriteApi.completeFollowUp(v.followUpId),
    entity_type: 'graha_follow_up',
    entityId:    v => v.followUpId,
    optimisticId: v => `graha_follow_up_${v.followUpId}_complete`,
    snapshotKey:  () => ['graha', 'today'],
    optimisticUpdate: (v, client) => {
      client.setQueryData<CrmToday | undefined>(['graha', 'today'], (prev) => prev ? {
        ...prev,
        overdue_followups: prev.overdue_followups.filter(f => f.id !== v.followUpId),
      } : prev);
    },
    rollback: (_v, snapshot, client) => {
      if (snapshot) client.setQueryData(['graha', 'today'], snapshot);
    },
    onlineOptions: {
      onError: (err: unknown) => onError(writeErrorMessage(err)),
      onSettled: () => { void qc.invalidateQueries({ queryKey: ['graha', 'today'] }); },
    },
  });

  /**
   * Nothing at all is not an error and not an empty screen — it is the good
   * outcome, and it is also what a 403 on this one endpoint looks like from
   * here. The section simply does not draw. `GrahaScreen` still resolves its
   * own state from the pipeline and deal queries, so a broken Today cannot
   * blank the surface behind it.
   */
  if (today.isError || (overdue.length === 0 && stale.length === 0)) return null;

  return (
    <View>
      <SectionHead label="TODAY" hi="आज" right={String(overdue.length + stale.length)} />

      {overdue.map(f => {
        const due = f.due_at ? new Date(f.due_at) : null;
        const pending = queued.has(f.id);
        return (
          <Card key={f.id} accent={t.approval}>
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={[s.title, { color: t.ink }]} numberOfLines={2}>{f.title}</Text>
                <Text style={[s.meta, { color: t.approval }]}>
                  {/* Names, not ids — the contact's name is joined on the server
                      precisely so this line does not have to be a uuid. */}
                  {f.contact_name ? `${f.contact_name} · ` : ''}
                  Overdue
                  {due && !Number.isNaN(due.getTime())
                    ? ` since ${due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                    : ''}
                  {pending ? ' · not sent yet' : ''}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => { onError(null); complete.mutate({ followUpId: f.id }); }}
                hitSlop={10}
                {...a11yButton(`Mark done: ${f.title}`)}
              >
                <Ionicons name="ellipse-outline" size={24} color={t.ink3} />
              </TouchableOpacity>
            </View>
          </Card>
        );
      })}

      {stale.map(d => (
        <TouchableOpacity
          key={d.id}
          onPress={() => onOpenDeal(d.id, d.title)}
          activeOpacity={0.7}
          {...a11yButton(`${d.title}, nothing logged for a week`, 'Opens the deal')}
        >
          <Card>
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={[s.title, { color: t.ink }]} numberOfLines={2}>{d.title}</Text>
                <Text style={[s.meta, { color: t.ink3 }]}>
                  {d.contact_name ? `${d.contact_name} · ` : ''}
                  Nothing logged for a week
                </Text>
              </View>
              <Text style={[s.value, { color: t.ink2 }]}>{inrCompact(d.value)}</Text>
            </View>
          </Card>
        </TouchableOpacity>
      ))}

      {error && <ErrorNote text={error} />}
    </View>
  );
}

const s = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  title: { fontSize: 14, fontWeight: '700', lineHeight: 19 },
  meta:  { fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  value: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
