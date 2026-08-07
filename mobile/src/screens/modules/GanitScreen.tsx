import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import { resolveScreenState } from '../../components/ScreenState';
import ModuleShell, { Stat, StatRow, SectionHead, Card, Tag, ModuleCards } from './ModuleShell';
import { ganitApi, inrCompact, inr, num, type Invoice, type InvoiceStats } from '../../api/modules';
import { withAlpha } from '../../theme/tokens';

/**
 * Ganit · गणित — invoicing, checking view.
 *
 * Endpoints:
 *   GET /api/v1/ganit/stats                        outstanding, collected, counts
 *   GET /api/v1/ganit/invoices?invoice_type=tax_invoice
 *
 * `/stats` already filters to `invoice_type='tax_invoice'` server-side, so the
 * list is filtered the same way. Without the param the list would include
 * proformas, credit notes and quotations, and the row count under the header
 * would disagree with the total above it — the kind of mismatch that makes a
 * user distrust both numbers.
 *
 * The reference design puts a "send payment reminder" button on this screen and
 * argues it belongs on the phone. It is NOT built here: `ganit.py` exposes no
 * reminder endpoint, and OUTBOUND_MODE governs anything that actually leaves the
 * building. A button wired to nothing is worse than its absence, so the boundary
 * note names it as the one action still to come rather than pretending.
 */

/** Payment status → semantic token. Never a private hex. */
function statusTone(t: ReturnType<typeof useTheme>['t'], s: string | null) {
  switch ((s ?? '').toLowerCase()) {
    case 'paid':    return t.success;
    case 'overdue': return t.error;
    case 'partial': return t.approval;
    default:        return t.ink3;
  }
}

const LABEL: Record<string, string> = {
  paid: 'Paid', overdue: 'Overdue', partial: 'Part paid', unpaid: 'Unpaid', cancelled: 'Cancelled',
};

export default function GanitScreen() {
  const { t } = useTheme();
  const online = useOnline();

  const stats    = useQuery({ queryKey: ['ganit', 'stats'],    queryFn: ganitApi.stats });
  const invoices = useQuery({ queryKey: ['ganit', 'invoices'], queryFn: ganitApi.invoices });

  // Annotated, not inferred — see the note in api/modules.ts.
  const rows: Invoice[]                = invoices.data ?? [];
  const st:   InvoiceStats | undefined = stats.data;

  const hasData = stats.data !== undefined || invoices.data !== undefined;
  const status = resolveScreenState({
    isLoading: stats.isLoading || invoices.isLoading,
    isError:   stats.isError || invoices.isError,
    error:     stats.error ?? invoices.error,
    online,
    hasData,
    isEmpty:   hasData && rows.length === 0,
  });

  const refetch = () => { stats.refetch(); invoices.refetch(); };
  const overdue = num(st?.overdue_count);

  return (
    <ModuleShell
      title="Invoicing" hi="गणित"
      status={status}
      stale={hasData && !online}
      onRetry={refetch}
      refreshing={stats.isRefetching || invoices.isRefetching}
      emptyTitle="No invoices yet"
      emptyBody="Tax invoices raised on the web show up here."
      boundary="Raising an invoice, GST filing and ledgers are desktop work. Sending a payment reminder from the phone is not built yet — there is no endpoint for it."
    >
      <StatRow>
        <Stat
          value={inrCompact(st?.total_outstanding)}
          label="Outstanding"
          tone={num(st?.total_outstanding) > 0 ? t.error : undefined}
        />
        <Stat value={inrCompact(st?.total_collected)} label="Collected" tone={t.success} />
        <Stat value={String(overdue)} label="Overdue" tone={overdue > 0 ? t.error : undefined} />
      </StatRow>

      <SectionHead label="INVOICES" hi="बीजक" right={String(rows.length)} />
      <ModuleCards>
        {rows.slice(0, 40).map(inv => <InvoiceRow key={inv.id} invoice={inv} />)}
      </ModuleCards>
      {rows.length > 40 && (
        <Text style={[s.more, { color: t.ink4 }]}>
          Showing the 40 most recent of {rows.length}. The full ledger is on the web.
        </Text>
      )}
    </ModuleShell>
  );
}

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const { t } = useTheme();
  const tone = statusTone(t, invoice.payment_status);
  const key  = (invoice.payment_status ?? '').toLowerCase();
  const who  = invoice.contact_company ?? invoice.contact_name ?? 'No contact';

  const due = invoice.due_date ? new Date(invoice.due_date) : null;
  const dueLabel = due && !Number.isNaN(due.getTime())
    ? due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null;

  // Show what is still owed on anything unpaid, and the full total once it is
  // settled. A paid invoice showing a balance of zero reads as an error.
  const paid = key === 'paid';
  const amount = paid ? invoice.total : invoice.balance_due;

  return (
    <Card>
      <View style={s.rowTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.who, { color: t.ink }]} numberOfLines={1}>{who}</Text>
          <Text style={[s.number, { color: t.ink3 }]} numberOfLines={1}>
            {invoice.invoice_number}{dueLabel ? ` · due ${dueLabel}` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={[s.amount, { color: t.ink }]}>{inr(amount)}</Text>
          <Tag
            text={LABEL[key] ?? invoice.payment_status ?? 'Draft'}
            tone={tone}
            bg={withAlpha(tone, 0.12)}
          />
        </View>
      </View>
      {!paid && num(invoice.amount_paid) > 0 && (
        <Text style={[s.part, { color: t.ink4 }]}>
          {inr(invoice.amount_paid)} received of {inr(invoice.total)}
        </Text>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  who:    { fontSize: 14, fontWeight: '700' },
  number: { fontSize: 11.5, marginTop: 2 },
  amount: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  part:   { fontSize: 11, marginTop: 2 },
  more:   { fontSize: 11.5, lineHeight: 16, marginTop: 8, textAlign: 'center' },
});
