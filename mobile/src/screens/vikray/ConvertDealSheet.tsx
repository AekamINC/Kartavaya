import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import { useOfflineMutation } from '../../hooks/useOfflineMutation';
import { useQueueStatus } from '../../hooks/useQueueStatus';
import { queuedEntityIds } from '../../offline/mutationQueue';
import Sheet from '../../components/Sheet';
import BiLabel from '../../theme/BiLabel';
import { a11yButton } from '../../components/a11y';
import { grahaApi, inr, num, type Deal } from '../../api/modules';
import {
  vikrayWriteApi, vikrayWriteError, type FromDealResult, type Order,
} from '../../api/vikray';
import {
  SheetFrame, PrimaryButton, ErrorNote, InfoNote, GoodNote, kickerStyles, panelStyle,
} from './sheetKit';

/**
 * A won deal becomes a sales order.
 *
 * ── WHY THIS IS THE WHOLE OF ORDER CREATION ON A PHONE ───────────────────────
 *
 * `POST /orders` exists and takes a full basket — line items with quantities,
 * HSN codes, GST rates and per-line discounts. Building that editor at 393pt is
 * four to five days of work, and it is the wrong four days: the resulting screen
 * is a spreadsheet with a keyboard over it, used standing up, to enter figures
 * that came off a price list somebody is holding.
 *
 * `POST /orders/from-deal/{deal_id}` gets ~80% of the same outcome in one tap,
 * because the SERVER does the deriving: it carries the company (migration 136's
 * `client_id`), the contact, and the deal's value as a single line, computes
 * subtotal / CGST / SGST / total through `_compute_order_totals`, mints the
 * order number off `next_doc_number`, ticks `graha_clients.is_sales_customer`,
 * and emits `order_created` inside the same transaction so a Niyam rule cannot
 * fire for an order that did not commit.
 *
 * What it does NOT do is invent a basket. `vikray.py:339` is explicit: "A deal
 * has a value, not a basket: inventing line items from a figure would put
 * quantities and HSN codes on the order that nobody entered." So the resulting
 * order carries ONE line, priced at the deal's value, with no product attached —
 * and this sheet says so before the tap rather than letting somebody discover it
 * afterwards. The consequences are real and both are stated on screen:
 *
 *   · no `product_id` on the line means confirming the order moves NO stock,
 *     because `_apply_stock_moves` skips lines without one;
 *   · the line has no HSN code, and `_refuse_final_if_incomplete` will refuse
 *     to raise a tax invoice from it until somebody adds one on the web.
 *
 * ── HOW MUCH THIS IS ACTUALLY WORTH, MEASURED ────────────────────────────────
 *
 * On the live database: 34 deals are Won, and exactly ONE order has ever been
 * created from a deal. Thirty-three won deals have never become an order by
 * this route. That is the gap this sheet is aimed at.
 *
 * ── QUEUEABLE, AND THE ONE WINDOW WHERE THAT BITES ───────────────────────────
 *
 * The only create in this module that may be replayed, because the server makes
 * it idempotent: it looks for an existing active order on the deal and returns
 * that one instead of writing a second. See `api/vikray.ts` for the narrow case
 * that still duplicates — a cancellation landing inside the offline window.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * The orders already on screen, so a deal that has been converted is shown as
   * converted instead of being offered again.
   *
   * Passed in rather than fetched: the list is already in the parent's cache and
   * a second copy would disagree with it for as long as one of them was stale —
   * which is precisely the moment somebody would tap "convert" on a deal that
   * already has an order.
   */
  orders: Order[];
}

export default function ConvertDealSheet({ visible, onClose, orders }: Props) {
  const { t } = useTheme();
  const online = useOnline();
  const qc = useQueryClient();

  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [done, setDone]     = useState<string | null>(null);

  /**
   * The deals to choose from.
   *
   * `enabled: visible` — the CRM list is 200 rows and this sheet is closed
   * almost all the time. Fetching it on mount would be a request per visit to
   * the Sales screen for a list most visits never open.
   *
   * A 403 HERE IS NOT A 403 ON THE SCREEN. `GET /graha/deals` is gated on the
   * CRM module; a member granted Sales but not CRM can read orders perfectly
   * well and simply cannot see deals. That must not take the Sales screen down
   * with it, which is why this query lives in the sheet and is reported inside
   * the sheet.
   */
  const deals = useQuery({
    queryKey: ['graha', 'deals'],
    queryFn:  grahaApi.deals,
    enabled:  visible,
  });

  // Annotated, not inferred — `useQuery(...).data` is `any` on this toolchain.
  // See the note in api/modules.ts; without this every field access is unchecked.
  const allDeals: Deal[] = deals.data ?? [];

  /** Which deals already have an order, by deal id. Ids never reach the screen. */
  const converted = useMemo(() => {
    const ids = new Set<string>();
    for (const o of orders) if (o.deal_id) ids.add(o.deal_id);
    return ids;
  }, [orders]);

  const { changes } = useQueueStatus();
  // Recomputed when the queue changes rather than on every render: MMKV is
  // synchronous but this reads and parses the whole queue.
  const queued = useMemo(() => queuedEntityIds('vikray_from_deal'), [changes.count]);

  /**
   * Won deals only.
   *
   * The server refuses anything else — "an open deal is a forecast, not an
   * agreement" — so offering one would be offering a button that 400s. Filtered
   * here so that refusal is a backstop rather than a path.
   */
  const wonDeals = useMemo(
    () => allDeals.filter(d => (d.stage ?? '').toLowerCase() === 'won'),
    [allDeals],
  );

  const convert = useOfflineMutation<{ dealId: string }, FromDealResult>({
    method:      'POST',
    urlBuilder:  v => `/v1/vikray/orders/from-deal/${v.dealId}`,
    // The route takes no body at all — the deal id is the whole request. An
    // empty object rather than the variables: `enqueueMutation` defaults the
    // body to `vars`, which would persist `{dealId}` and POST it back as a body
    // the server has no model for.
    bodyBuilder: () => ({}),
    mutationFn:  v => vikrayWriteApi.createOrderFromDeal(v.dealId),
    entity_type: 'vikray_from_deal',
    entityId:    v => v.dealId,
    // Dedup key, so a double-tap while offline replaces the queued entry rather
    // than queueing the same conversion twice.
    optimisticId: v => `vikray_from_deal_${v.dealId}`,
    onlineOptions: {
      onSuccess: (data: FromDealResult) => {
        // Both outcomes are successes and they say different things. `exists`
        // means somebody — possibly this user, on another device — already
        // converted it, and reporting that as "created" would leave two people
        // believing they each raised an order.
        setDone(
          data.status === 'exists'
            ? `Already converted. This deal is order ${data.order_number}.`
            : `Order ${data.order_number} created.`,
        );
        setPicked(null);
        qc.invalidateQueries({ queryKey: ['vikray'] });
      },
      onError: (err: Error) => setError(vikrayWriteError(err)),
    },
  });

  const submit = () => {
    if (!picked) return;
    setError(null);
    setDone(null);
    convert.mutate({ dealId: picked });
    if (!online) {
      setDone('Queued. The order is raised as soon as this device is back online.');
      setPicked(null);
    }
  };

  const loading = deals.isLoading && visible;
  const failed  = deals.isError;
  const forbidden = (deals.error as { response?: { status?: number } } | null)
    ?.response?.status === 403;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close deal conversion"
      panelStyle={panelStyle(t)}
    >
      <SheetFrame
        kicker={<BiLabel {...kickerStyles(t)}>FROM A DEAL · सौदे से</BiLabel>}
        title="Raise a sales order"
        onClose={onClose}
        footer={
          <PrimaryButton
            label={picked ? 'Create the order' : 'Pick a won deal'}
            onPress={submit}
            busy={convert.isPending}
            disabled={!picked}
          />
        }
      >
        {/* What the server will actually write. Said BEFORE the tap: an order
            whose single line has no product and no HSN behaves differently from
            one built on the web, and finding that out afterwards is how the
            "why didn't stock move?" question gets asked. */}
        <InfoNote
          icon="document-text-outline"
          text={
            'The order carries the company, the contact and the deal value as ONE '
            + 'line — no product, no HSN code. Confirming it will not move stock, '
            + 'and an invoice needs the HSN filled in on the web first.'
          }
        />

        {!online && (
          <InfoNote
            icon="cloud-offline-outline"
            text={
              'Offline. This one is queued and sent when the connection is back — '
              + 'it is the only Sales action that can be. The server returns the same '
              + 'order if it has already been raised, so a retry cannot duplicate it.'
            }
          />
        )}

        {!!error && <ErrorNote text={error} />}
        {!!done && <GoodNote text={done} />}

        <View style={{ height: 18 }} />

        {loading ? (
          <View style={s.centre}><ActivityIndicator color={t.primary} /></View>
        ) : forbidden ? (
          <View style={s.centre}>
            <Ionicons name="lock-closed-outline" size={26} color={t.ink3} />
            <Text style={[s.emptyTitle, { color: t.ink }]}>Deals are not available to you</Text>
            <Text style={[s.emptyBody, { color: t.ink3 }]}>
              Converting a deal reads the CRM, and you have not been granted it. Your
              Sales orders below are unaffected — an admin can add CRM from the web app.
            </Text>
          </View>
        ) : failed ? (
          <View style={s.centre}>
            <Ionicons name="alert-circle-outline" size={26} color={t.error} />
            <Text style={[s.emptyTitle, { color: t.ink }]}>Couldn’t load deals</Text>
            <Text style={[s.emptyBody, { color: t.ink3 }]}>
              Close this and pull down on the orders list to try again.
            </Text>
          </View>
        ) : wonDeals.length === 0 ? (
          <View style={s.centre}>
            <Ionicons name="trophy-outline" size={26} color={t.ink3} />
            <Text style={[s.emptyTitle, { color: t.ink }]}>No won deals</Text>
            <Text style={[s.emptyBody, { color: t.ink3 }]}>
              Only a won deal becomes an order. Move one to Won in CRM and it appears here.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {wonDeals.map(d => (
              <DealOption
                key={d.id}
                deal={d}
                selected={picked === d.id}
                already={converted.has(d.id)}
                pending={queued.has(d.id)}
                onPick={() => { setPicked(d.id); setError(null); setDone(null); }}
              />
            ))}
          </View>
        )}
      </SheetFrame>
    </Sheet>
  );
}

/**
 * One won deal, as an option.
 *
 * A deal that already has an order stays VISIBLE and is disabled rather than
 * filtered out. Removing it would leave a rep who knows they won that deal
 * hunting for it in a list that silently omits it; saying "already an order"
 * answers the question they came with.
 */
function DealOption({ deal, selected, already, pending, onPick }: {
  deal:     Deal;
  selected: boolean;
  already:  boolean;
  pending:  boolean;
  onPick:   () => void;
}) {
  const { t } = useTheme();
  const blocked = already || pending;
  const who = deal.client_name ?? deal.contact_company ?? deal.contact_name ?? null;

  const state = pending ? 'Queued — not sent yet'
    : already ? 'Already an order'
    : null;

  return (
    <TouchableOpacity
      onPress={onPick}
      disabled={blocked}
      style={[
        s.option,
        { borderColor: selected ? t.primary : t.outline, backgroundColor: t.bg },
        selected && { backgroundColor: t.primary + '14' },
        blocked ? { opacity: 0.5 } : null,
      ]}
      {...a11yButton(
        `${deal.title}, ${inr(deal.value)}${who ? `, ${who}` : ''}${state ? `, ${state}` : ''}`,
      )}
      accessibilityState={{ selected, disabled: blocked }}
    >
      <View style={[s.radio, { borderColor: selected ? t.primary : t.outline }]}>
        {selected && <View style={[s.radioDot, { backgroundColor: t.primary }]} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.optTitle, { color: t.ink }]} numberOfLines={2}>{deal.title}</Text>
        {!!who && (
          <Text style={[s.optWho, { color: t.ink3 }]} numberOfLines={1}>{who}</Text>
        )}
        {!!state && (
          <Text style={[s.optState, { color: pending ? t.approval : t.ink4 }]}>{state}</Text>
        )}
      </View>
      <Text style={[s.optValue, { color: t.ink2 }]}>{inr(num(deal.value))}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  centre: { alignItems: 'center', gap: 6, paddingVertical: 34, paddingHorizontal: 12 },
  emptyTitle: { fontSize: 15, fontWeight: '700', marginTop: 4, textAlign: 'center' },
  emptyBody:  { fontSize: 13, lineHeight: 19, textAlign: 'center' },

  option: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 11,
    borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 13, paddingVertical: 11,
    minHeight: 48,
  },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },

  optTitle: { fontSize: 14, fontWeight: '700', lineHeight: 19 },
  optWho:   { fontSize: 12, marginTop: 2 },
  optState: { fontSize: 11, fontWeight: '700', marginTop: 3 },
  optValue: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
