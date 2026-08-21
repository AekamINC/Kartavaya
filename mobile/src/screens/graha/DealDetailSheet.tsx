import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import { useOfflineMutation } from '../../hooks/useOfflineMutation';
import { useQueueStatus } from '../../hooks/useQueueStatus';
import { queuedEntityIds } from '../../offline/mutationQueue';
import Sheet from '../../components/Sheet';
import ScreenState, { resolveScreenState } from '../../components/ScreenState';
import { a11yButton } from '../../components/a11y';
import BiLabel from '../../theme/BiLabel';
import { SEP } from '../../theme/labels';
import { display } from '../../theme/fonts';
import { withAlpha } from '../../theme/tokens';
import { inr, type Deal } from '../../api/modules';
import {
  grahaWriteApi, writeErrorMessage, stagesOf, isOpenStage,
  type DealDetail, type DealActivity, type FollowUp, type Pipeline, type TimelineEntry,
} from '../../api/graha';
import { ChipSelect, ErrorNote, InfoNote, panelStyle } from './sheetKit';
import LogActivitySheet from './LogActivitySheet';
import FollowUpSheet from './FollowUpSheet';

/**
 * The deal, in full — and the three things a rep can do to it.
 *
 * ── Why this is a sheet and not a route ──────────────────────────────────────
 *
 * It presents through `Sheet`, from `GrahaScreen`, rather than through a
 * `Stack.Screen`. That is an ownership boundary, not a design preference:
 * `nav/RootStack.tsx` and `nav/linking.ts` belong to another agent this pass, so
 * a `GrahaDeal` route could not be registered without editing them. The props
 * are shaped like route params (`dealId`, `dealTitle`) precisely so that
 * promoting this to a real screen later is a wiring change and not a rewrite —
 * and it should be promoted, because until it is there is no deep link to a
 * deal and no back-button history entry for it.
 *
 * ── What is queued and what is not ───────────────────────────────────────────
 *
 * The stage move and the follow-up tick both go through `useOfflineMutation`,
 * because both are PATCHes that mean the same thing applied twice. The two
 * CREATE sheets do not — see `api/graha.ts` for why, and for the server change
 * that would let them.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Null while the sheet is closing — the query is disabled rather than refetched. */
  dealId: string | null;
  /** From the row that opened this, so the header has a name before the fetch lands. */
  dealTitle: string;
}

export default function DealDetailSheet({ visible, onClose, dealId, dealTitle }: Props) {
  const { t } = useTheme();
  const online = useOnline();
  const qc = useQueryClient();

  const [showLog, setShowLog]       = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const detail = useQuery({
    queryKey: ['graha', 'deal', dealId],
    queryFn:  () => grahaWriteApi.deal(dealId as string),
    enabled:  visible && !!dealId,
  });

  const pipelines = useQuery({
    queryKey: ['graha', 'pipelines'],
    queryFn:  grahaWriteApi.pipelines,
    enabled:  visible,
    // The stage list changes about once a year. Refetching it every time a deal
    // is opened is a request per tap for an answer that has not moved.
    staleTime: 30 * 60 * 1000,
  });

  const followUps = useQuery({
    queryKey: ['graha', 'follow-ups', dealId],
    queryFn:  () => grahaWriteApi.followUps({ deal_id: dealId as string }),
    enabled:  visible && !!dealId,
  });

  // Annotated, not inferred — `useQuery(...).data` is `any` on this toolchain.
  // `api/modules.ts` sets out why the type argument does not fix it, and every
  // field access below these four lines is unchecked without them.
  const deal:       DealDetail | undefined = detail.data?.deal;
  const activities: DealActivity[]         = detail.data?.activities ?? [];
  const pipes:      Pipeline[]             = pipelines.data ?? [];
  const nextSteps:  FollowUp[]             = followUps.data ?? [];

  /**
   * The whole relationship, on demand.
   *
   * `enabled` is gated on the user ASKING, not on the sheet opening. It is a
   * fourth request on a screen a rep opens between meetings, and four of the
   * five rows it returns are usually already visible above — the reason to
   * fetch it is the one that is not: an unpaid invoice at this customer, which
   * is worth knowing before a pricing conversation and is not on this deal.
   */
  const timeline = useQuery({
    queryKey: ['graha', 'timeline', deal?.contact_id],
    queryFn:  () => grahaWriteApi.contactTimeline(deal?.contact_id as string),
    enabled:  visible && showHistory && !!deal?.contact_id,
  });

  // Annotated, not inferred — same reason as the four above.
  const history: TimelineEntry[] = timeline.data ?? [];

  const stages = useMemo(() => stagesOf(pipes), [pipes]);

  /**
   * Which records have an unsent write against them.
   *
   * §7.1, the rule `TasksScreen` already follows: never lie about state. A
   * stage chip that moved because of an optimistic update looks identical to
   * one the server accepted, and on a sheet the user is about to close that is
   * the difference between "moved" and "moved here, not yet there".
   */
  const { changes } = useQueueStatus();
  const queuedDeals     = useMemo(() => queuedEntityIds('graha_deal'), [changes.count]);
  const queuedFollowUps = useMemo(() => queuedEntityIds('graha_follow_up'), [changes.count]);
  const stagePending    = !!dealId && queuedDeals.has(dealId);

  /**
   * Move the stage — and ONLY the stage.
   *
   * `update_deal` builds its SET list from `exclude_unset`, so a one-key body
   * writes one column. Sending the deal object back would clobber a value or a
   * close date someone is editing on the desktop right now, and the queue's
   * last-write-wins replay would do it again minutes later.
   */
  const moveStage = useOfflineMutation<{ dealId: string; stage: string }>({
    method: 'PATCH',
    urlBuilder: v => `/v1/graha/deals/${v.dealId}`,
    bodyBuilder: v => ({ stage: v.stage }),
    mutationFn:  v => grahaWriteApi.moveStage(v.dealId, v.stage),
    entity_type: 'graha_deal',
    entityId:    v => v.dealId,
    // Tapping two stages in a row before the first lands must leave ONE queued
    // write carrying the last choice, not two that replay in order.
    optimisticId: v => `graha_deal_${v.dealId}_stage`,
    snapshotKey:  v => ['graha', 'deal', v.dealId],
    optimisticUpdate: (v, client) => {
      client.setQueryData<{ deal: DealDetail; activities: DealActivity[] } | undefined>(
        ['graha', 'deal', v.dealId],
        (prev) => prev ? { ...prev, deal: { ...prev.deal, stage: v.stage } } : prev,
      );
      // The list behind this sheet shows the stage too. Leaving it alone means
      // closing the sheet appears to undo the move until the next refetch.
      client.setQueryData<Deal[] | undefined>(['graha', 'deals'], (prev) =>
        (prev ?? []).map(d => d.id === v.dealId ? { ...d, stage: v.stage } : d),
      );
    },
    rollback: (v, snapshot, client) => {
      if (snapshot) client.setQueryData(['graha', 'deal', v.dealId], snapshot);
      void client.invalidateQueries({ queryKey: ['graha', 'deals'] });
    },
    onlineOptions: {
      onError: (err: unknown) => setWriteError(writeErrorMessage(err)),
      onSuccess: () => {
        setWriteError(null);
        // Won and Lost are set by the SERVER along with `won_at` and
        // `probability`, so the optimistic row is incomplete until this lands.
        void qc.invalidateQueries({ queryKey: ['graha', 'deal', dealId] });
        void qc.invalidateQueries({ queryKey: ['graha', 'deals'] });
        void qc.invalidateQueries({ queryKey: ['graha', 'pipeline-summary'] });
        void qc.invalidateQueries({ queryKey: ['graha', 'today'] });
      },
    },
  });

  /** Ticking a follow-up off. A bare UPDATE with no body — safe to replay. */
  const completeFollowUp = useOfflineMutation<{ followUpId: string }>({
    method: 'PATCH',
    urlBuilder: v => `/v1/graha/follow-ups/${v.followUpId}/complete`,
    bodyBuilder: () => ({}),
    mutationFn:  v => grahaWriteApi.completeFollowUp(v.followUpId),
    entity_type: 'graha_follow_up',
    entityId:    v => v.followUpId,
    optimisticId: v => `graha_follow_up_${v.followUpId}_complete`,
    snapshotKey:  () => ['graha', 'follow-ups', dealId],
    optimisticUpdate: (v, client) => {
      client.setQueryData<FollowUp[] | undefined>(['graha', 'follow-ups', dealId], (prev) =>
        (prev ?? []).map(f => f.id === v.followUpId ? { ...f, is_completed: true } : f),
      );
    },
    rollback: (_v, snapshot, client) => {
      if (snapshot) client.setQueryData(['graha', 'follow-ups', dealId], snapshot);
    },
    onlineOptions: {
      onError: (err: unknown) => setWriteError(writeErrorMessage(err)),
      onSettled: () => {
        void qc.invalidateQueries({ queryKey: ['graha', 'follow-ups', dealId] });
        void qc.invalidateQueries({ queryKey: ['graha', 'today'] });
      },
    },
  });

  const hasData = detail.data !== undefined;
  const status = resolveScreenState({
    isLoading: detail.isLoading,
    isError:   detail.isError,
    error:     detail.error,
    online,
    hasData,
  });

  const due = deal?.expected_close_date ? new Date(deal.expected_close_date) : null;
  const late = !!deal && isOpenStage(deal.stage) && !!due && !Number.isNaN(due.getTime()) && due < new Date();
  // Names, never ids. The company is the customer; the person is who you spoke
  // to. Both come off the row already joined by `get_deal`.
  const who = deal?.contact_company ?? deal?.contact_name ?? null;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close the deal"
      panelStyle={panelStyle(t)}
    >
      <View style={[s.handle, { backgroundColor: t.outline }]} />

      <View style={[s.header, { borderBottomColor: t.outline }]}>
        <View style={{ flex: 1 }}>
          <BiLabel
            latinStyle={{ fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: t.primary }}
            hindiStyle={{ color: t.primaryText }}
            hindiSize={11}
            style={{ marginBottom: 2 }}
          >
            DEAL · सौदा
          </BiLabel>
          <Text style={[s.headerTitle, { color: t.ink }]} numberOfLines={3}>
            {deal?.title ?? dealTitle}
          </Text>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={12} {...a11yButton('Close')}>
          <Ionicons name="close" size={22} color={t.ink3} accessibilityElementsHidden />
        </TouchableOpacity>
      </View>

      {status !== 'ready' && status !== 'empty' ? (
        <View style={s.stateBox}>
          <ScreenState status={status} onRetry={() => { void detail.refetch(); }} />
        </View>
      ) : (
        <ScrollView style={s.body} showsVerticalScrollIndicator={false}>
          {/* The facts, above anything actionable. */}
          <View style={s.factRow}>
            <Text style={[s.value, { color: t.ink }]}>{inr(deal?.value)}</Text>
            {typeof deal?.probability === 'number' && (
              <Text style={[s.fact, { color: t.ink3 }]}>{deal.probability}% likely</Text>
            )}
          </View>
          {!!who && <Text style={[s.fact, { color: t.ink2 }]}>{who}</Text>}
          {!!due && !Number.isNaN(due.getTime()) && (
            <Text style={[s.fact, { color: late ? t.approval : t.ink3 }]}>
              {late ? 'Was due ' : 'Closes '}
              {due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
          )}
          {!!deal?.notes && <Text style={[s.notes, { color: t.ink2 }]}>{deal.notes}</Text>}

          {/* ── Stage ─────────────────────────────────────────────────────── */}
          <SectionLabel latin="STAGE" hindi="चरण" />
          <ChipSelect
            options={stages.map(name => ({
              key: name,
              label: name,
              tone: name.toLowerCase() === 'won'  ? t.success
                  : name.toLowerCase() === 'lost' ? t.ink3
                  : t.primary,
            }))}
            value={deal?.stage ?? null}
            onChange={(stage) => {
              if (!dealId || stage === deal?.stage) return;
              setWriteError(null);
              moveStage.mutate({ dealId, stage });
            }}
            disabled={!dealId || moveStage.isPending}
          />
          {stagePending && (
            <InfoNote
              icon="time-outline"
              text="This move is saved on the phone and will be sent when there is a connection. It is not on the server yet."
            />
          )}

          {/* ── Next steps ────────────────────────────────────────────────── */}
          <SectionLabel latin="NEXT STEPS" hindi="अगला कदम" />
          {followUps.isLoading ? (
            <ActivityIndicator color={t.primary} style={{ alignSelf: 'flex-start' }} />
          ) : nextSteps.length === 0 ? (
            <Text style={[s.none, { color: t.ink3 }]}>
              Nothing set. A deal with no next step is the one that goes quiet.
            </Text>
          ) : (
            nextSteps.map(f => {
              const fDue = f.due_at ? new Date(f.due_at) : null;
              const fLate = !!fDue && !Number.isNaN(fDue.getTime()) && fDue < new Date();
              const pending = queuedFollowUps.has(f.id);
              return (
                <View key={f.id} style={[s.row, { borderColor: t.outlineVar, backgroundColor: t.surface2 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.rowTitle, { color: f.is_completed ? t.ink3 : t.ink }]} numberOfLines={2}>
                      {f.title}
                    </Text>
                    {!!fDue && !Number.isNaN(fDue.getTime()) && (
                      <Text style={[s.rowMeta, { color: fLate && !f.is_completed ? t.approval : t.ink3 }]}>
                        {fLate && !f.is_completed ? 'Overdue · ' : 'Due '}
                        {fDue.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        {pending ? ' · not sent yet' : ''}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    onPress={() => { setWriteError(null); completeFollowUp.mutate({ followUpId: f.id }); }}
                    disabled={f.is_completed}
                    hitSlop={10}
                    {...a11yButton(f.is_completed ? `${f.title}, done` : `Mark done: ${f.title}`)}
                    accessibilityState={{ disabled: f.is_completed }}
                  >
                    <Ionicons
                      name={f.is_completed ? 'checkmark-circle' : 'ellipse-outline'}
                      size={24}
                      color={f.is_completed ? t.success : t.ink3}
                    />
                  </TouchableOpacity>
                </View>
              );
            })
          )}

          {/* ── What has happened ─────────────────────────────────────────── */}
          <SectionLabel latin="ACTIVITY" hindi="गतिविधि" />
          {activities.length === 0 ? (
            <Text style={[s.none, { color: t.ink3 }]}>Nothing logged against this deal yet.</Text>
          ) : (
            activities.slice(0, 15).map(a => {
              const when = a.scheduled_at ?? a.created_at;
              const at = when ? new Date(when) : null;
              return (
                <View key={a.id} style={[s.row, { borderColor: t.outlineVar, backgroundColor: t.surface2 }]}>
                  <View style={[s.kind, { backgroundColor: withAlpha(t.primary, 0.12) }]}>
                    <Text style={[s.kindText, { color: t.primaryText }]}>{a.activity_type}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.rowTitle, { color: t.ink }]} numberOfLines={2}>{a.title}</Text>
                    {!!at && !Number.isNaN(at.getTime()) && (
                      <Text style={[s.rowMeta, { color: t.ink3 }]}>
                        {at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })
          )}
          {activities.length > 15 && (
            <Text style={[s.none, { color: t.ink4 }]}>
              The 15 most recent of {activities.length}. The rest is on the web.
            </Text>
          )}

          {/* ── The whole relationship ─────────────────────────────────── */}
          {!!deal?.contact_id && (
            <>
              <SectionLabel latin="HISTORY" hindi="इतिहास" />
              {!showHistory ? (
                <TouchableOpacity
                  onPress={() => setShowHistory(true)}
                  style={[s.ghostBtn, { borderColor: t.outline }]}
                  {...a11yButton(
                    who ? `Show everything with ${who}` : 'Show everything with this customer',
                    'Loads deals, invoices and past activity',
                  )}
                >
                  <Ionicons name="time-outline" size={15} color={t.primaryText} accessibilityElementsHidden />
                  <Text style={[s.ghostText, { color: t.primaryText }]}>
                    {who ? `Everything with ${who}` : 'Everything with this customer'}
                  </Text>
                </TouchableOpacity>
              ) : timeline.isLoading ? (
                <ActivityIndicator color={t.primary} style={{ alignSelf: 'flex-start' }} />
              ) : timeline.isError ? (
                // A failed fourth request must not blank a sheet whose deal
                // loaded fine. It says so where it happened, and nowhere else.
                <Text style={[s.none, { color: t.ink3 }]}>The history did not load. The deal above is unaffected.</Text>
              ) : history.length === 0 ? (
                <Text style={[s.none, { color: t.ink3 }]}>Nothing else on record with this customer.</Text>
              ) : (
                history.map(h => {
                  const at = h.ts ? new Date(h.ts) : null;
                  return (
                    <View key={`${h.type}_${h.id}`} style={[s.row, { borderColor: t.outlineVar, backgroundColor: t.surface2 }]}>
                      <View style={[s.kind, { backgroundColor: withAlpha(t.ink3, 0.12) }]}>
                        <Text style={[s.kindText, { color: t.ink2 }]}>{h.type}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.rowTitle, { color: t.ink }]} numberOfLines={2}>
                          {h.title ?? '—'}
                        </Text>
                        <Text style={[s.rowMeta, { color: t.ink3 }]}>
                          {[
                            h.subtype,
                            h.stage,
                            at && !Number.isNaN(at.getTime())
                              ? at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                              : null,
                          ].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      {/* An amount only where the source table has one — an
                          activity has none, and `₹0` would read as a free deal. */}
                      {h.amount !== null && h.amount !== undefined && (
                        <Text style={[s.rowAmount, { color: t.ink2 }]}>{inr(h.amount)}</Text>
                      )}
                    </View>
                  );
                })
              )}
            </>
          )}

          {writeError && <ErrorNote text={writeError} />}

          <View style={{ height: 20 }} />
        </ScrollView>
      )}

      {/* The two creates. Disabled until the deal has loaded — logging against a
          deal whose id has not been confirmed is how an activity lands on the
          wrong record. */}
      <View style={[s.actions, { borderTopColor: t.outline }]}>
        <TouchableOpacity
          onPress={() => { setWriteError(null); setShowLog(true); }}
          disabled={!deal}
          style={[s.actionBtn, { backgroundColor: t.primary }, !deal && s.disabled]}
          {...a11yButton('Log activity')}
          accessibilityState={{ disabled: !deal }}
        >
          <Ionicons name="create-outline" size={16} color={t.onPrimary} accessibilityElementsHidden />
          <Text style={[s.actionText, { color: t.onPrimary }]}>Log activity</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { setWriteError(null); setShowFollowUp(true); }}
          disabled={!deal}
          style={[s.actionBtn, s.actionGhost, { borderColor: t.outline }, !deal && s.disabled]}
          {...a11yButton('Set a follow-up')}
          accessibilityState={{ disabled: !deal }}
        >
          <Ionicons name="alarm-outline" size={16} color={t.primaryText} accessibilityElementsHidden />
          <Text style={[s.actionText, { color: t.primaryText }]}>Follow-up</Text>
        </TouchableOpacity>
      </View>

      {!!deal && (
        <>
          <LogActivitySheet
            visible={showLog}
            onClose={() => setShowLog(false)}
            dealId={deal.id}
            dealTitle={deal.title}
            contactId={deal.contact_id}
          />
          <FollowUpSheet
            visible={showFollowUp}
            onClose={() => setShowFollowUp(false)}
            dealId={deal.id}
            dealTitle={deal.title}
            contactId={deal.contact_id}
          />
        </>
      )}
    </Sheet>
  );
}

/** `STAGE · चरण`. BiLabel, because one <Text> would track the Devanagari. */
function SectionLabel({ latin, hindi }: { latin: string; hindi: string }) {
  const { t } = useTheme();
  return (
    <BiLabel
      style={{ marginTop: 20, marginBottom: 8 }}
      latinStyle={{ fontSize: 10, fontWeight: '800', letterSpacing: 1.3, color: t.ink3 }}
      hindiStyle={{ color: t.ink4 }}
      hindiSize={11}
    >
      {`${latin} ${SEP} ${hindi}`}
    </BiLabel>
  );
}

const s = StyleSheet.create({
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 20, ...display(400) },
  body: { paddingHorizontal: 20, paddingTop: 12 },
  stateBox: { height: 260 },

  factRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  value: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -0.4 },
  fact:  { fontSize: 13, lineHeight: 19 },
  notes: { fontSize: 13, lineHeight: 19, marginTop: 8 },

  none: { fontSize: 12.5, lineHeight: 18 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    marginBottom: 6,
    // The row contract — 48pt tier, the compact one, because these are inside a
    // sheet rather than on a full table surface.
    minHeight: 48,
  },
  rowTitle: { fontSize: 13.5, fontWeight: '600', lineHeight: 18 },
  rowMeta:  { fontSize: 11.5, marginTop: 2 },
  rowAmount:{ fontSize: 12.5, fontWeight: '800', fontVariant: ['tabular-nums'] },

  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderWidth: 1.5, borderRadius: 10, paddingVertical: 11, minHeight: 44,
  },
  ghostText: { fontSize: 13, fontWeight: '700' },

  kind: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  kindText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3, textTransform: 'uppercase' },

  actions: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderRadius: 12, paddingVertical: 13, minHeight: 48,
  },
  actionGhost: { backgroundColor: 'transparent', borderWidth: 1.5 },
  actionText: { fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
