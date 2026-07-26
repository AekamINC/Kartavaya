import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import { resolveScreenState } from '../../components/ScreenState';
import ModuleShell, { Stat, StatRow, SectionHead, Card, Tag } from './ModuleShell';
import { grahaApi, inrCompact, inr, num, type Deal } from '../../api/modules';
import { withAlpha } from '../../theme/tokens';

/**
 * Graha · ग्राहक — CRM, checking view.
 *
 * Endpoints:
 *   GET /api/v1/graha/pipeline-summary   value and count by stage
 *   GET /api/v1/graha/deals              newest 200, org-scoped
 *
 * The phone answers one question: what is open and what is slipping. Logging a
 * call, moving a stage and editing a contact are all desktop — and the screen
 * says so rather than leaving someone hunting for a button that is not there.
 */

/** Won and Lost are terminal; everything else is still open pipeline. */
const CLOSED = new Set(['won', 'lost', 'closed won', 'closed lost']);
const isOpen = (stage: string | null | undefined) => !CLOSED.has((stage ?? '').toLowerCase());

export default function GrahaScreen() {
  const { t } = useTheme();
  const online = useOnline();

  const summary = useQuery({
    queryKey: ['graha', 'pipeline-summary'],
    queryFn:  grahaApi.pipelineSummary,
  });
  const deals = useQuery({
    queryKey: ['graha', 'deals'],
    queryFn:  grahaApi.deals,
  });

  const rows = deals.data ?? [];
  const stages = summary.data ?? [];

  const totals = useMemo(() => {
    const open = stages.filter(st => isOpen(st.stage));
    return {
      openValue: open.reduce((a, st) => a + num(st.total_value), 0),
      openCount: open.reduce((a, st) => a + num(st.count), 0),
      // "Slipping" is an expected close date already in the past on a deal that
      // is still open. It is the only figure on this screen that is a judgement
      // rather than a total, and it is the one worth opening the phone for.
      slipping: rows.filter(d => {
        if (!isOpen(d.stage) || !d.expected_close_date) return false;
        const due = new Date(d.expected_close_date);
        return !Number.isNaN(due.getTime()) && due < new Date();
      }).length,
    };
  }, [stages, rows]);

  const hasData = summary.data !== undefined || deals.data !== undefined;
  const status = resolveScreenState({
    isLoading: summary.isLoading || deals.isLoading,
    isError:   summary.isError || deals.isError,
    error:     summary.error ?? deals.error,
    online,
    hasData,
    isEmpty:   hasData && rows.length === 0,
  });

  const refetch = () => { summary.refetch(); deals.refetch(); };

  return (
    <ModuleShell
      title="CRM" hi="ग्राहक"
      status={status}
      stale={hasData && !online}
      onRetry={refetch}
      refreshing={summary.isRefetching || deals.isRefetching}
      emptyTitle="No deals yet"
      emptyBody="Deals created on the web show up here."
      boundary="Logging a call, moving a stage and editing a contact are desktop work. The phone is for knowing what is open and what is slipping."
    >
      <StatRow>
        <Stat value={inrCompact(totals.openValue)} label="Open pipeline" />
        <Stat value={String(totals.openCount)} label="Open deals" />
        <Stat
          value={String(totals.slipping)}
          label="Past close date"
          tone={totals.slipping > 0 ? t.error : undefined}
        />
      </StatRow>

      <SectionHead label="DEALS" hi="सौदे" right={String(rows.length)} />
      {rows.slice(0, 40).map(d => <DealRow key={d.id} deal={d} />)}
      {rows.length > 40 && (
        <Text style={[s.more, { color: t.ink4 }]}>
          Showing the 40 most recent of {rows.length}. The full list is on the web.
        </Text>
      )}
    </ModuleShell>
  );
}

function DealRow({ deal }: { deal: Deal }) {
  const { t } = useTheme();

  const open = isOpen(deal.stage);
  const due  = deal.expected_close_date ? new Date(deal.expected_close_date) : null;
  const late = open && !!due && !Number.isNaN(due.getTime()) && due < new Date();

  // Won gets the success colour, Lost the muted one, everything open the accent.
  // Three of the four are semantic tokens rather than a private palette, so a
  // contrast fix on the web reaches this row too.
  const stageTone =
    (deal.stage ?? '').toLowerCase() === 'won'  ? t.success :
    (deal.stage ?? '').toLowerCase() === 'lost' ? t.ink4 :
    late ? t.approval : t.primaryText;

  const who = deal.client_name ?? deal.contact_company ?? deal.contact_name ?? '';
  const whenLabel = due && !Number.isNaN(due.getTime())
    ? due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null;

  return (
    <Card accent={late ? t.approval : undefined}>
      <View style={s.rowTop}>
        <Text style={[s.dealTitle, { color: t.ink }]} numberOfLines={2}>{deal.title}</Text>
        <Text style={[s.dealValue, { color: t.ink2 }]}>{inr(deal.value)}</Text>
      </View>
      <View style={s.rowMeta}>
        {!!deal.stage && (
          <Tag text={deal.stage} tone={stageTone} bg={withAlpha(stageTone, 0.12)} />
        )}
        {!!who && <Text style={[s.dealWho, { color: t.ink3 }]} numberOfLines={1}>{who}</Text>}
        {!!whenLabel && (
          <Text style={[s.dealWhen, { color: late ? t.approval : t.ink4 }]}>
            {late ? 'was due ' : 'closes '}{whenLabel}
          </Text>
        )}
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  rowTop:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  dealTitle: { flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 19 },
  dealValue: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  dealWho:   { flex: 1, minWidth: 60, fontSize: 11.5 },
  dealWhen:  { fontSize: 11, fontWeight: '700' },
  more: { fontSize: 11.5, lineHeight: 16, marginTop: 8, textAlign: 'center' },
});
