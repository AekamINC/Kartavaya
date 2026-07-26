import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import { resolveScreenState } from '../../components/ScreenState';
import ModuleShell, { Stat, StatRow, SectionHead, Card } from './ModuleShell';
import { dristiApi, inrCompact, num } from '../../api/modules';
import { withAlpha } from '../../theme/tokens';

/**
 * Dristi · दृष्टि — the glance version of analytics.
 *
 * Endpoints:
 *   GET /api/v1/dristi/overview        seven blocks in one round trip
 *   GET /api/v1/dristi/revenue?months=6  dense monthly trend
 *
 * Report builders, filters, saved dashboards and exports need width and stay on
 * desktop. What survives 393px is: how much work is late, what is owed, and
 * whether collection is going up or down.
 *
 * The bars are drawn from `collected`, not `invoiced`. Invoiced is the number a
 * dashboard flatters itself with; collected is the one that pays salaries, and
 * on a screen this small there is room for exactly one of them.
 */

export default function DristiScreen() {
  const { t } = useTheme();
  const online = useOnline();

  const overview = useQuery({ queryKey: ['dristi', 'overview'], queryFn: dristiApi.overview });
  const revenue  = useQuery({ queryKey: ['dristi', 'revenue'],  queryFn: () => dristiApi.revenue(6) });

  const o = overview.data;
  const trend = revenue.data ?? [];

  const hasData = overview.data !== undefined;
  const status = resolveScreenState({
    isLoading: overview.isLoading,
    isError:   overview.isError,
    error:     overview.error,
    online,
    hasData,
    isEmpty:   false,
  });

  const refetch = () => { overview.refetch(); revenue.refetch(); };

  const done  = num(o?.tasks?.done_tasks);
  const total = num(o?.tasks?.total_tasks);
  const completion = total > 0 ? Math.round((done / total) * 100) : 0;
  const overdue = num(o?.tasks?.overdue_tasks);

  // Scale the bars against the tallest month rather than a fixed ceiling, and
  // guard the divide — a brand-new org has six months of zeroes, and 0/0 renders
  // every bar as NaN% which React Native silently drops to a zero-height view.
  const peak = Math.max(...trend.map(p => p.collected), 1);

  return (
    <ModuleShell
      title="Analytics" hi="दृष्टि"
      status={status}
      stale={hasData && !online}
      onRetry={refetch}
      refreshing={overview.isRefetching || revenue.isRefetching}
      boundary="Report builders, saved dashboards, filters and exports need the width and stay on desktop. This is the glance version."
    >
      <SectionHead label="WORK" hi="कार्य" />
      <StatRow>
        <Stat value={`${completion}%`} label="Tasks complete" tone={t.success} />
        <Stat value={String(num(o?.tasks?.active_tasks))} label="In progress" />
        <Stat value={String(overdue)} label="Overdue" tone={overdue > 0 ? t.error : undefined} />
      </StatRow>

      <SectionHead label="MONEY" hi="धन" />
      <StatRow>
        <Stat value={inrCompact(o?.revenue?.total_collected)} label="Collected" tone={t.success} />
        <Stat
          value={inrCompact(o?.revenue?.outstanding)}
          label="Outstanding"
          tone={num(o?.revenue?.outstanding) > 0 ? t.error : undefined}
        />
        <Stat value={inrCompact(o?.deals?.pipeline_value)} label="Pipeline" />
      </StatRow>

      {trend.length > 0 && (
        <>
          <SectionHead label="COLLECTED" hi="प्राप्त" right="last 6 months" />
          <View style={[s.chart, { backgroundColor: t.surface, borderColor: t.outlineVar }]}>
            {trend.map((p, i) => {
              const last = i === trend.length - 1;
              return (
                <View
                  key={p.month}
                  style={s.barCol}
                  accessibilityLabel={`${p.month}: ${inrCompact(p.collected)} collected`}
                >
                  <View style={s.barTrack}>
                    <View
                      style={[
                        s.barFill,
                        {
                          height: `${Math.round((p.collected / peak) * 100)}%`,
                          backgroundColor: last ? t.primary : withAlpha(t.primary, 0.4),
                        },
                      ]}
                    />
                  </View>
                  <Text style={[s.barLabel, { color: last ? t.primaryText : t.ink4 }]} numberOfLines={1}>
                    {p.month.slice(5)}
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      )}

      <SectionHead label="PEOPLE & PIPELINE" hi="लोग" />
      <Card>
        <Row label="Headcount"      value={String(num(o?.hr?.headcount))} />
        <Row label="Contacts"       value={String(num(o?.crm?.total_contacts))} />
        <Row label="Open deals"     value={String(num(o?.deals?.total_deals) - num(o?.deals?.won_deals) - num(o?.deals?.lost_deals))} />
        <Row label="Won this cycle" value={inrCompact(o?.deals?.won_value)} />
      </Card>
    </ModuleShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { t } = useTheme();
  return (
    <View style={s.row} accessibilityLabel={`${label}: ${value}`}>
      <Text style={[s.rowLabel, { color: t.ink3 }]}>{label}</Text>
      <Text style={[s.rowValue, { color: t.ink }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  chart: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 12, padding: 12, height: 136, gap: 4,
  },
  barCol:   { flex: 1, alignItems: 'center', gap: 6, height: '100%' },
  barTrack: { flex: 1, width: 16, justifyContent: 'flex-end' },
  barFill:  { width: 16, borderRadius: 4, minHeight: 3 },
  barLabel: { fontSize: 10, fontWeight: '700' },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { fontSize: 12.5 },
  rowValue: { fontSize: 13.5, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
