import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import { resolveScreenState } from '../../components/ScreenState';
import ModuleShell, { SectionHead, Card, Tag, ModuleCards } from './ModuleShell';
import { vetanaApi, inr, num, type Payslip } from '../../api/modules';
import { withAlpha } from '../../theme/tokens';

/**
 * Vetana · वेतन — your own payslips. Nothing else.
 *
 * Endpoint:
 *   GET /api/v1/vetana/payslips
 *
 * The self-scoping is the SERVER's, not this screen's. `list_payslips` replaces
 * `employee_id` with the caller's own employee row unless they are a payroll
 * admin, and 403s an explicit request for someone else's. So this screen sends
 * no filter at all: a client-side "only mine" check would be a second, weaker
 * copy of a rule that is already enforced where it matters, and the two would
 * eventually disagree.
 *
 * That does mean a payroll admin sees the whole org here. The employee name is
 * therefore printed on every row rather than assumed — a screen that says "your
 * payslips" while listing thirty people is worse than one that just names them.
 *
 * `month` is a TEXT column (migration 020) in YYYY-MM form, ordered DESC by the
 * server, so the newest is row zero and no client-side sort is needed.
 */

const STATUS_LABEL: Record<string, string> = {
  generated: 'Generated',
  approved:  'Approved',
  disbursed: 'Paid',
};

/** "2026-07" → "July 2026". Falls back to the raw value on anything unexpected. */
function monthLabel(m: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(m ?? '');
  if (!match) return m ?? '';
  const d = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return Number.isNaN(d.getTime()) ? m : d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export default function VetanaScreen() {
  const { t } = useTheme();
  const online = useOnline();

  const q = useQuery({ queryKey: ['vetana', 'payslips'], queryFn: vetanaApi.payslips });

  // Annotated, not inferred — see the note in api/modules.ts.
  const rows: Payslip[] = q.data ?? [];
  const latest = rows[0];

  const status = resolveScreenState({
    isLoading: q.isLoading,
    isError:   q.isError,
    error:     q.error,
    online,
    hasData:   q.data !== undefined,
    isEmpty:   q.data !== undefined && rows.length === 0,
  });

  return (
    <ModuleShell
      title="Payslips" hi="वेतन"
      status={status}
      stale={q.data !== undefined && !online}
      onRetry={() => q.refetch()}
      refreshing={q.isRefetching}
      emptyTitle="No payslips yet"
      emptyBody="Once a payroll run that includes you is processed, your payslips appear here."
      boundary="Salary structures, payroll runs and statutory filings are desktop work. This screen shows payslips only — and unless you run payroll, only your own."
    >
      {!!latest && (
        <View style={[s.hero, { backgroundColor: t.primaryContainer, borderColor: t.primary }]}>
          <Text style={[s.heroKicker, { color: t.onPrimaryContainer }]}>
            LATEST NET PAY · {monthLabel(latest.month).toUpperCase()}
          </Text>
          <Text style={[s.heroValue, { color: t.onPrimaryContainer }]}>{inr(latest.net_pay)}</Text>
          <Text style={[s.heroSub, { color: t.onPrimaryContainer }]}>
            {latest.status === 'disbursed' && latest.disbursed_at
              ? `Credited ${new Date(latest.disbursed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
              : STATUS_LABEL[latest.status ?? ''] ?? 'Not yet disbursed'}
            {num(latest.total_deductions) > 0
              ? ` · ${inr(latest.total_deductions)} deducted from ${inr(latest.gross)}`
              : ''}
          </Text>
        </View>
      )}

      <SectionHead label="PAYSLIPS" hi="वेतन पर्ची" right={String(rows.length)} />
      <ModuleCards>
        {rows.map(p => <PayslipRow key={p.id} slip={p} />)}
      </ModuleCards>

      <View style={[s.privacy, { backgroundColor: t.surface2, borderColor: t.outlineVar }]}>
        <Ionicons name="lock-closed-outline" size={14} color={t.ink3} />
        <Text style={[s.privacyText, { color: t.ink3 }]}>
          Payroll is scoped on the server, not in the app. Unless you hold a payroll
          admin grant, this device can only ever be sent your own records.
        </Text>
      </View>
    </ModuleShell>
  );
}

function PayslipRow({ slip }: { slip: Payslip }) {
  const { t } = useTheme();
  const key  = (slip.status ?? '').toLowerCase();
  const tone = key === 'disbursed' ? t.success : key === 'approved' ? t.primaryText : t.ink3;

  return (
    <Card>
      <View style={s.rowTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.month, { color: t.ink }]} numberOfLines={1}>{monthLabel(slip.month)}</Text>
          <Text style={[s.rowMeta, { color: t.ink3 }]} numberOfLines={1}>
            {slip.employee_name ?? ''}
            {slip.payslip_number ? ` · ${slip.payslip_number}` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={[s.net, { color: t.ink }]}>{inr(slip.net_pay)}</Text>
          <Tag text={STATUS_LABEL[key] ?? slip.status ?? '—'} tone={tone} bg={withAlpha(tone, 0.12)} />
        </View>
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  hero: { borderWidth: 1, borderRadius: 14, padding: 15, gap: 3 },
  heroKicker: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.2 },
  heroValue:  { fontSize: 30, fontWeight: '800', letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  heroSub:    { fontSize: 11.5, lineHeight: 16 },

  rowTop:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  month:   { fontSize: 14, fontWeight: '700' },
  rowMeta: { fontSize: 11.5, marginTop: 2 },
  net:     { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },

  privacy: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderWidth: 1, borderRadius: 10, padding: 11, marginTop: 14,
  },
  privacyText: { flex: 1, fontSize: 11.5, lineHeight: 16.5 },
});
