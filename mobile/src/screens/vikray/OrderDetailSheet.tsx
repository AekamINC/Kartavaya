import React, { useMemo, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import Sheet from '../../components/Sheet';
import BiLabel from '../../theme/BiLabel';
import { hindi } from '../../theme/fonts';
import { inr, num } from '../../api/modules';
import {
  vikrayApi, vikrayWriteApi, vikrayWriteError, orderLines, orderParty,
  nextStatuses, flowIndex, ORDER_FLOW, ORDER_STATUS_LABEL, ORDER_STATUS_EFFECT,
  VIKRAY_OFFLINE_NOTE,
  type OrderDetail, type OrderLine, type OrderStatus,
} from '../../api/vikray';
import {
  SheetFrame, PrimaryButton, ChoiceList, ErrorNote, InfoNote, GoodNote,
  DetailRow, kickerStyles, panelStyle,
} from './sheetKit';

/**
 * One sales order, in full — and the two things a phone may do to it.
 *
 * ── WHY A SHEET AND NOT A ROUTE ──────────────────────────────────────────────
 *
 * `nav/RootStack.tsx` is another agent's file this pass. Vikray gets exactly ONE
 * route registered there — the module screen — and the detail presents through
 * `Sheet` from it. The props are shaped like route params (`orderId`) precisely
 * so promoting this to a `VikrayOrder` screen later is a wiring change and not a
 * rewrite. It SHOULD be promoted: until it is, there is no deep link to an order
 * and no back-stack entry for one, which is the same debt `screens/graha/`
 * records for the deal sheet.
 *
 * ── WHAT IS READ-ONLY HERE, AND WHY IT IS NOT A LIMITATION ───────────────────
 *
 * The LINES are read-only. `PATCH /orders/{id}` accepts a whole basket and
 * recomputes the totals, but only for a DRAFT order — and editing quantities,
 * HSN codes and per-line GST at 393pt is a spreadsheet with a keyboard over it.
 * That editor is not built, deliberately: `from-deal` covers the case a rep
 * actually has standing in a customer's office, and the boundary note on the
 * screen says where the rest of the work happens.
 *
 * ── THE TWO WRITES, BOTH ONLINE ONLY ─────────────────────────────────────────
 *
 * Moving the status drives `_apply_stock_moves`; generating an invoice draws a
 * serial from `next_doc_number`. Neither may be queued and `api/vikray.ts`
 * carries the full reasoning for each. What this file adds is the honest UI for
 * it: the buttons are DISABLED with an explanation when offline, rather than
 * armed and doomed to be discarded by the queue's 4xx rule without telling
 * anyone.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Null while the sheet is closing — the query is disabled, not refetched. */
  orderId: string | null;
  /** From the row that opened this, so the header has a number before the fetch. */
  orderNumber: string;
}

export default function OrderDetailSheet({ visible, onClose, orderId, orderNumber }: Props) {
  const { t } = useTheme();
  const online = useOnline();
  const qc = useQueryClient();

  const [nextStatus, setNextStatus] = useState<OrderStatus | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [done, setDone]     = useState<string | null>(null);
  const [busy, setBusy]     = useState(false);

  const detail = useQuery({
    queryKey: ['vikray', 'order', orderId],
    queryFn:  () => vikrayApi.order(orderId as string),
    enabled:  visible && !!orderId,
  });

  // Annotated, not inferred — `useQuery(...).data` is `any` on this toolchain.
  // See the note in api/modules.ts; every field access below is unchecked without it.
  const order: OrderDetail | undefined = detail.data;
  const lines: OrderLine[] = useMemo(() => orderLines(order), [order]);

  const status = (order?.status ?? '').toLowerCase();
  const moves  = nextStatuses(status);
  const party  = order ? orderParty(order) : null;

  /**
   * The status options, each carrying what it DOES.
   *
   * `cancelled` is offered because `_VALID_TRANSITIONS` holds it from both
   * `draft` and `confirmed`, and hiding a move the product supports would send
   * somebody to a laptop to do the one thing they are most likely to need in a
   * hurry. It is toned as destructive and it states the restock, because
   * cancelling a confirmed order puts inventory back and that is not obvious
   * from the word.
   */
  const options = useMemo(
    () => moves.map(m => ({
      key:   m,
      label: ORDER_STATUS_LABEL[m] ?? m,
      note:  ORDER_STATUS_EFFECT[m],
      tone:  m === 'cancelled' ? t.error : undefined,
    })),
    [moves, t.error],
  );

  /**
   * Can an invoice be raised from here?
   *
   * The server's own three conditions, mirrored so the button is absent rather
   * than present-and-refused: not a draft (`generate_invoice_from_order` 400s),
   * no invoice already (`invoice_id` set is a 400), and a connection.
   *
   * The FOURTH condition is not checkable here and is stated instead: every
   * line needs an HSN code or `_refuse_final_if_incomplete` rejects the invoice
   * before the serial is drawn. An order raised by `from-deal` has no HSN on
   * its single line, so this is the common case rather than an edge one.
   */
  const canInvoice = !!order && status !== 'draft' && !order.invoice_id;
  const missingHsn = lines.length > 0 && lines.some(l => !l.hsn_code?.trim());

  const applyStatus = async () => {
    if (!orderId || !nextStatus || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await vikrayWriteApi.setOrderStatus(orderId, nextStatus);
      setDone(`Moved to ${ORDER_STATUS_LABEL[nextStatus] ?? nextStatus}.`);
      setNextStatus(null);
      // The list, the dashboard figures and the stock counts can all have moved:
      // confirming deducts stock and closing marks a deal won. Invalidating the
      // whole module is cheaper than reasoning about which three keys.
      qc.invalidateQueries({ queryKey: ['vikray'] });
    } catch (e: unknown) {
      setError(vikrayWriteError(e));
    } finally {
      setBusy(false);
    }
  };

  const raiseInvoice = async () => {
    if (!orderId || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await vikrayWriteApi.generateInvoice(orderId);
      setDone(`Invoice ${res.invoice_number} raised. It is read-only on the phone.`);
      qc.invalidateQueries({ queryKey: ['vikray'] });
      qc.invalidateQueries({ queryKey: ['ganit'] });
    } catch (e: unknown) {
      setError(vikrayWriteError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close order"
      panelStyle={panelStyle(t)}
    >
      <SheetFrame
        kicker={<BiLabel {...kickerStyles(t)}>SALES ORDER · विक्रय आदेश</BiLabel>}
        title={order?.order_number ?? orderNumber}
        onClose={onClose}
        footer={
          options.length > 0 ? (
            <PrimaryButton
              label={
                nextStatus
                  ? `Move to ${ORDER_STATUS_LABEL[nextStatus] ?? nextStatus}`
                  : 'Pick the next status'
              }
              onPress={applyStatus}
              busy={busy}
              disabled={!nextStatus || !online}
              tone={nextStatus === 'cancelled' ? t.error : undefined}
              onTone={nextStatus === 'cancelled' ? t.onError : undefined}
            />
          ) : undefined
        }
      >
        {detail.isLoading ? (
          <View style={s.centre}><ActivityIndicator color={t.primary} /></View>
        ) : detail.isError ? (
          <View style={s.centre}>
            <Ionicons name="alert-circle-outline" size={26} color={t.error} />
            <Text style={[s.emptyTitle, { color: t.ink }]}>Couldn’t load this order</Text>
            <Text style={[s.emptyBody, { color: t.ink3 }]}>
              Close this and pull down on the list to try again.
            </Text>
          </View>
        ) : !order ? null : (
          <>
            <StatusLine status={status} />

            <View style={{ height: 10 }} />

            {/* Who and when. `orderParty` returns null for the ten live orders
                that name nobody, and "Not named" is the honest answer — it is
                never backfilled with a uuid. */}
            <DetailRow label="Customer" value={party ?? 'Not named'} />
            {!!order.contact_name && party !== order.contact_name && (
              <DetailRow label="Contact" value={order.contact_name} />
            )}
            <DetailRow label="Ordered" value={dateLabel(order.order_date) ?? '—'} />
            {!!order.expected_delivery && (
              <DetailRow label="Expected" value={dateLabel(order.expected_delivery) ?? '—'} />
            )}
            {!!order.deal_id && <DetailRow label="Source" value="Converted from a won deal" />}
            <DetailRow
              label="Invoice"
              value={order.invoice_id ? 'Raised' : 'Not raised'}
              tone={order.invoice_id ? t.success : undefined}
            />

            {/* ── Lines ── */}
            <SectionRule label="LINES" hi="पंक्तियाँ" right={String(lines.length)} />
            {lines.length === 0 ? (
              <Text style={[s.emptyBody, { color: t.ink3, textAlign: 'left' }]}>
                This order has no lines.
              </Text>
            ) : (
              <View style={{ gap: 9 }}>
                {lines.map((l, i) => <LineRow key={i} line={l} />)}
              </View>
            )}

            {/* ── Money ── */}
            <SectionRule label="TOTAL" hi="कुल" />
            <DetailRow label="Subtotal" value={inr(order.subtotal)} mono />
            {num(order.discount) > 0 && (
              <DetailRow label="Discount" value={`− ${inr(order.discount)}`} mono />
            )}
            {order.is_igst ? (
              <DetailRow label="IGST" value={inr(order.igst)} mono />
            ) : (
              <>
                <DetailRow label="CGST" value={inr(order.cgst)} mono />
                <DetailRow label="SGST" value={inr(order.sgst)} mono />
              </>
            )}
            <View style={[s.grand, { borderTopColor: t.outlineVar }]}>
              <Text style={[s.grandLabel, { color: t.ink2 }]}>Order total</Text>
              <Text style={[s.grandValue, { color: t.ink }]}>{inr(order.total)}</Text>
            </View>

            {!!order.notes && (
              <>
                <SectionRule label="NOTES" hi="टिप्पणी" />
                <Text style={[s.notes, { color: t.ink3 }]}>{order.notes}</Text>
              </>
            )}

            {/* ── Invoice ── */}
            {canInvoice && (
              <>
                <SectionRule label="INVOICE" hi="बीजक" />
                {missingHsn && (
                  <InfoNote
                    icon="warning-outline"
                    text={
                      'At least one line has no HSN code. A tax invoice is refused '
                      + 'without one — before the number is drawn, so no gap is left '
                      + 'in the sequence. Add it on the web, then come back.'
                    }
                  />
                )}
                <View style={{ height: 12 }} />
                <PrimaryButton
                  label="Raise the tax invoice"
                  onPress={raiseInvoice}
                  busy={busy}
                  disabled={!online}
                />
                <Text style={[s.footNote, { color: t.ink4 }]}>
                  This mints the next invoice number in your sequence and needs the
                  Invoicing module as well as Sales. The invoice itself is read-only
                  on the phone.
                </Text>
              </>
            )}

            {/* ── Status ── */}
            {options.length > 0 ? (
              <>
                <SectionRule label="NEXT STATUS" hi="अगली स्थिति" />
                {!online && <InfoNote icon="cloud-offline-outline" text={VIKRAY_OFFLINE_NOTE} />}
                <View style={{ height: 12 }} />
                <ChoiceList
                  options={options}
                  value={nextStatus}
                  onChange={k => { setNextStatus(k as OrderStatus); setError(null); setDone(null); }}
                  disabled={!online || busy}
                />
              </>
            ) : (
              <>
                <SectionRule label="NEXT STATUS" hi="अगली स्थिति" />
                <Text style={[s.footNote, { color: t.ink3 }]}>
                  {status === 'cancelled'
                    ? 'This order was cancelled. Nothing moves from here.'
                    : 'This order is closed. Nothing moves from here.'}
                </Text>
              </>
            )}

            {!!error && <ErrorNote text={error} />}
            {!!done && <GoodNote text={done} />}
          </>
        )}
      </SheetFrame>
    </Sheet>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

/**
 * Where the order sits on the five-stage line — `_PIPELINE_STAGES`.
 *
 * A cancelled order is deliberately OFF the line: `flowIndex` returns -1 for it
 * and the row renders as a single statement instead of a bar with nothing lit.
 * The server takes the same view — a cancelled order is soft-deleted and is not
 * money sitting anywhere, so it is neither a stage nor part of any total.
 */
function StatusLine({ status }: { status: string }) {
  const { t } = useTheme();
  const at = flowIndex(status);

  if (at < 0) {
    return (
      <View style={[s.cancelled, { backgroundColor: t.errorBg, borderColor: t.error }]}>
        <Ionicons name="close-circle-outline" size={15} color={t.onErrorContainer} accessibilityElementsHidden />
        <Text style={[s.cancelledText, { color: t.onErrorContainer }]}>
          Cancelled. Any stock this order held has been put back.
        </Text>
      </View>
    );
  }

  return (
    <View
      style={s.flow}
      accessibilityLabel={`Status: ${ORDER_STATUS_LABEL[status] ?? status}, stage ${at + 1} of ${ORDER_FLOW.length}`}
    >
      {ORDER_FLOW.map((stage, i) => {
        const passed = i <= at;
        const here   = i === at;
        return (
          <View key={stage} style={{ flex: 1, gap: 4 }}>
            <View
              style={[
                s.flowBar,
                { backgroundColor: passed ? t.primary : t.outlineVar },
                here && { backgroundColor: t.primary, height: 5 },
              ]}
            />
            <Text
              style={[
                s.flowLabel,
                { color: here ? t.primaryText : passed ? t.ink3 : t.ink4 },
                here && { fontWeight: '800' },
              ]}
              numberOfLines={1}
            >
              {ORDER_STATUS_LABEL[stage]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * One line on the order.
 *
 * `product_id` is checked but never shown: a line WITHOUT one moves no stock
 * when the order is confirmed, because `_apply_stock_moves` skips it. That is
 * the single most surprising thing about an order raised from a deal, so the
 * line says it rather than leaving somebody to wonder why the count did not
 * change.
 */
function LineRow({ line }: { line: OrderLine }) {
  const { t } = useTheme();
  const qty  = num(line.quantity);
  const rate = num(line.rate);
  const disc = num(line.discount_pct);
  const net  = qty * rate * (1 - disc / 100);
  const uncatalogued = !line.product_id;

  return (
    <View style={[s.line, { borderColor: t.outlineVar, backgroundColor: t.surface2 }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.lineDesc, { color: t.ink }]} numberOfLines={2}>
          {line.description?.trim() || 'Unnamed line'}
        </Text>
        <Text style={[s.lineMeta, { color: t.ink3 }]} numberOfLines={1}>
          {qty} {line.unit || 'NOS'} × {inr(rate)}
          {disc > 0 ? ` · ${disc}% off` : ''}
          {line.gst_rate !== undefined ? ` · ${num(line.gst_rate)}% GST` : ''}
        </Text>
        {uncatalogued && (
          <Text style={[s.lineWarn, { color: t.approval }]}>
            No product attached — confirming will not move stock for this line.
          </Text>
        )}
      </View>
      <Text style={[s.lineAmt, { color: t.ink2 }]}>{inr(net)}</Text>
    </View>
  );
}

/**
 * A rule with a bilingual caption.
 *
 * Two props rather than one fused middot string, and NOT for style: the
 * Devanagari run gets its family from `s.ruleHi`, and the Latin keeps the
 * tracked uppercase treatment that must never touch it. RN applies tracking
 * after shaping, so one <Text> across both scripts breaks the shirorekha.
 */
function SectionRule({ label, hi, right }: { label: string; hi: string; right?: string }) {
  const { t } = useTheme();
  return (
    <View style={[s.rule, { borderTopColor: t.outlineVar }]}>
      <Text style={[s.ruleLabel, { color: t.ink3 }]}>{label}</Text>
      <Text style={[s.ruleHi, { color: t.ink4 }]}>{hi}</Text>
      {!!right && <Text style={[s.ruleRight, { color: t.primaryText }]}>{right}</Text>}
    </View>
  );
}

/** `14 Aug 2026`, or null when the column is empty or unparseable. */
function dateLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const s = StyleSheet.create({
  centre: { alignItems: 'center', gap: 6, paddingVertical: 40, paddingHorizontal: 12 },
  emptyTitle: { fontSize: 15, fontWeight: '700', marginTop: 4, textAlign: 'center' },
  emptyBody:  { fontSize: 13, lineHeight: 19, textAlign: 'center' },

  flow: { flexDirection: 'row', gap: 4, marginTop: 12 },
  flowBar: { height: 3, borderRadius: 2 },
  flowLabel: { fontSize: 9.5, fontWeight: '600' },

  cancelled: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 11, paddingVertical: 9, marginTop: 12,
  },
  cancelledText: { flex: 1, fontSize: 12, lineHeight: 17 },

  rule: {
    flexDirection: 'row', alignItems: 'baseline', gap: 8,
    borderTopWidth: 1, paddingTop: 12, marginTop: 18, marginBottom: 8,
  },
  ruleLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.3 },
  // The Devanagari half. `hindi()` rather than a family literal — a typo in a
  // fontFamily string is silent and the text just renders in the system face.
  // No weight and no tracking: Tiro ships one weight, and RN applies tracking
  // after shaping, which splits the shirorekha.
  ruleHi:    { fontSize: 11.5, ...hindi() },
  ruleRight: { marginLeft: 'auto', fontSize: 12.5, fontWeight: '800' },

  line: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderWidth: 1, borderRadius: 10, padding: 11,
  },
  lineDesc: { fontSize: 13.5, fontWeight: '600', lineHeight: 18 },
  lineMeta: { fontSize: 11.5, marginTop: 3 },
  lineWarn: { fontSize: 11, lineHeight: 15.5, marginTop: 4, fontWeight: '600' },
  lineAmt:  { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },

  grand: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderTopWidth: 1, paddingTop: 10, marginTop: 8,
  },
  grandLabel: { flex: 1, fontSize: 13, fontWeight: '700' },
  grandValue: { fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },

  notes: { fontSize: 13, lineHeight: 19 },
  footNote: { fontSize: 11.5, lineHeight: 16.5, marginTop: 10 },
});
