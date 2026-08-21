import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import { resolveScreenState } from '../../components/ScreenState';
import { a11yButton } from '../../components/a11y';
import ModuleShell, { Stat, StatRow, SectionHead, Card, Tag, ModuleCards } from './ModuleShell';
import { inrCompact, inr, num } from '../../api/modules';
import { withAlpha } from '../../theme/tokens';
import {
  vikrayApi, orderParty, ORDER_STATUS_LABEL,
  type Order, type Listed, type StockRow, type Target, type VikrayDashboard,
} from '../../api/vikray';
import OrderDetailSheet from '../vikray/OrderDetailSheet';
import ConvertDealSheet from '../vikray/ConvertDealSheet';
import StockAdjustSheet from '../vikray/StockAdjustSheet';

/**
 * Vikray · विक्रय — Sales.
 *
 * The module had NOTHING on mobile before this screen: no route, no nav entry,
 * no API client. 378 live orders, 34 targets and 34 stock rows were reachable
 * only from a desktop.
 *
 * Endpoints reached from here and from what it opens:
 *   GET   /api/v1/vikray/dashboard              order counts and order value
 *   GET   /api/v1/vikray/orders                 newest 200, active only
 *   GET   /api/v1/vikray/orders/{id}            one order, with the contact
 *   GET   /api/v1/vikray/stock                  the catalogue and what is on hand
 *   GET   /api/v1/vikray/targets                periods with attainment
 *   POST  /api/v1/vikray/orders/from-deal/{id}  a won deal becomes an order
 *   PATCH /api/v1/vikray/orders/{id}/status     move it down the line
 *   PATCH /api/v1/vikray/stock/{product_id}     count something
 *   POST  /api/v1/vikray/orders/{id}/invoice    raise the tax invoice
 *
 * ── WHAT THIS SCREEN IS FOR ─────────────────────────────────────────────────
 *
 * Not a checking view. The other seven module surfaces are — read a dashboard,
 * come back — and Sales cannot be, because the three things a rep needs are all
 * writes: raise the order, move it when the goods go, and correct a count.
 *
 * What it is NOT is an order BUILDER. `POST /orders` takes a full basket and
 * building that editor at 393pt is four to five days of work for a screen that
 * is a spreadsheet with a keyboard over it. `from-deal` covers the case that
 * actually happens standing in a customer's office, and the boundary note says
 * where the rest of the work lives. See `ConvertDealSheet` for the full argument.
 *
 * ── WHY THE `empty` STATE IS DELIBERATELY NOT USED ──────────────────────────
 *
 * `ModuleShell` hides its children when the status is `empty`, which is right
 * for a reading surface and wrong here: an org with no orders yet is exactly the
 * org that needs the "convert a won deal" button, and routing it through the
 * shell's empty block would hide the one control that fixes the emptiness. So
 * `isEmpty` is not passed, each tab renders its own empty copy inside the body,
 * and the action survives. `isError`, `error` and `hasData` ARE passed — the
 * false-empty guard is about a failure reading as nothing, and that still holds.
 *
 * The tabs stay visible for the same reason: a Stock tab that fails must not
 * take the Orders tab off screen with it, so per-tab failures render inline
 * rather than through the shell.
 */

type Tab = 'orders' | 'stock' | 'targets';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'orders',  label: 'Orders' },
  { id: 'stock',   label: 'Stock' },
  { id: 'targets', label: 'Targets' },
];

/** Order status → semantic token. Never a private hex. */
function statusTone(t: ReturnType<typeof useTheme>['t'], s: string | null | undefined): string {
  switch ((s ?? '').toLowerCase()) {
    case 'closed':
    case 'delivered':  return t.success;
    case 'cancelled':  return t.error;
    case 'draft':      return t.ink3;
    case 'dispatched': return t.approval;
    default:           return t.primaryText;   // confirmed
  }
}

export default function VikrayScreen() {
  const { t } = useTheme();
  const online = useOnline();

  const [tab, setTab] = useState<Tab>('orders');
  const [openOrder, setOpenOrder]   = useState<{ id: string; number: string } | null>(null);
  const [orderVisible, setOrderVisible] = useState(false);
  const [convertVisible, setConvertVisible] = useState(false);
  const [openStock, setOpenStock]   = useState<StockRow | null>(null);
  const [stockVisible, setStockVisible] = useState(false);

  /**
   * The figures come from `/dashboard`, NOT from the orders list.
   *
   * The list caps at 200 and there are 378 orders. Summing the page would report
   * a little over half the money as the whole of it — the exact defect
   * `_listed`'s `truncated` flag exists to make visible, and the one that had
   * the CRM pipeline reporting 199 of 510.
   */
  const dash   = useQuery({ queryKey: ['vikray', 'dashboard'], queryFn: vikrayApi.dashboard });
  const orders = useQuery({ queryKey: ['vikray', 'orders'],    queryFn: () => vikrayApi.orders() });

  // Both secondary tabs are fetched only once their tab is opened. Stock is the
  // whole product catalogue and targets is every period ever set; neither is
  // needed by the screen a user actually lands on.
  const stock   = useQuery({
    queryKey: ['vikray', 'stock'],
    queryFn:  vikrayApi.stock,
    enabled:  tab === 'stock',
  });
  const targets = useQuery({
    queryKey: ['vikray', 'targets'],
    queryFn:  vikrayApi.targets,
    enabled:  tab === 'targets',
  });

  // Annotated, not inferred: `useQuery(...).data` is `any` on this toolchain.
  // See the note in api/modules.ts — without these four annotations every field
  // access below this line is unchecked.
  const stats:     VikrayDashboard | undefined = dash.data;
  const page:      Listed<Order> | undefined   = orders.data;
  const stockRows: StockRow[]                  = stock.data ?? [];
  const targetRows: Target[]                   = targets.data ?? [];

  const rows: Order[] = page?.data ?? [];

  /**
   * The screen's own load is the dashboard and the orders list.
   *
   * Stock and Targets are deliberately NOT in this decision: they are lazy, and
   * folding a disabled query's flags in here would make the screen claim to be
   * loading a tab nobody has opened.
   */
  const hasData = dash.data !== undefined || orders.data !== undefined;
  const status = resolveScreenState({
    isLoading: dash.isLoading || orders.isLoading,
    isError:   dash.isError || orders.isError,
    error:     dash.error ?? orders.error,
    online,
    hasData,
  });

  const refetch = () => {
    dash.refetch();
    orders.refetch();
    if (tab === 'stock') stock.refetch();
    if (tab === 'targets') targets.refetch();
  };

  /**
   * Low stock, counted the way a person means it.
   *
   * `GET /stock?low_stock=true` exists and is NOT used: its filter is
   * `quantity_on_hand <= low_stock_threshold`, and a threshold left at the
   * default 0 makes every uncounted product "low". On a fresh org that is the
   * entire catalogue. Requiring a threshold ABOVE zero is what makes this the
   * number somebody set an alert for rather than an artefact of the default.
   */
  const lowStock = useMemo(
    () => stockRows.filter(r => num(r.low_stock_threshold) > 0
      && num(r.quantity_on_hand) <= num(r.low_stock_threshold)),
    [stockRows],
  );

  const sortedStock = useMemo(() => {
    const low = new Set(lowStock.map(r => r.product_id));
    // Low first, otherwise the server's order (by name) is kept. A stable
    // partition rather than a re-sort: the catalogue is already alphabetical and
    // re-sorting it would shuffle rows for no reason a user asked for.
    return [...stockRows.filter(r => low.has(r.product_id)),
            ...stockRows.filter(r => !low.has(r.product_id))];
  }, [stockRows, lowStock]);

  const toDispatch = num(stats?.confirmed_orders);

  return (
    <>
      <ModuleShell
        title="Sales" hi="विक्रय"
        status={status}
        stale={hasData && !online}
        onRetry={refetch}
        refreshing={dash.isRefetching || orders.isRefetching
          || stock.isRefetching || targets.isRefetching}
        boundary="Building an order line by line, editing one, quotes and the customer ledger are desktop work. From here you can turn a won deal into an order, move an order down the line, raise its invoice and correct a stock count — and everything except the deal conversion needs a connection, because it moves stock or mints a document number."
      >
        <StatRow>
          <Stat value={inrCompact(stats?.order_value)} label="Order value" />
          <Stat value={String(num(stats?.total_orders))} label="Orders" />
          <Stat
            value={String(toDispatch)}
            label="To dispatch"
            tone={toDispatch > 0 ? t.approval : undefined}
          />
        </StatRow>

        {/* ── Tabs ── */}
        <View style={[s.tabs, { backgroundColor: t.surface3 }]} accessibilityRole="tablist">
          {TABS.map(({ id, label }) => {
            const active = tab === id;
            return (
              <Pressable
                key={id}
                onPress={() => setTab(id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[s.tab, active && { backgroundColor: t.surface }]}
              >
                <Text style={[s.tabText, { color: active ? t.ink : t.ink3 }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        {tab === 'orders' && (
          <>
            {/* The one create this screen offers, and the reason it is at the
                top rather than behind a FAB: it is what somebody opens Sales on
                a phone TO DO, and 33 of the 34 won deals in the live database
                have never been converted. */}
            <Pressable
              onPress={() => setConvertVisible(true)}
              {...a11yButton('Turn a won deal into a sales order')}
              style={({ pressed }) => [
                s.action,
                { borderColor: t.primary, backgroundColor: pressed ? withAlpha(t.primary, 0.12) : 'transparent' },
              ]}
            >
              <Ionicons name="git-merge-outline" size={17} color={t.primaryText} accessibilityElementsHidden />
              <Text style={[s.actionText, { color: t.primaryText }]}>
                Turn a won deal into an order
              </Text>
              <Ionicons name="chevron-forward" size={16} color={t.primaryText} accessibilityElementsHidden />
            </Pressable>

            <SectionHead label="ORDERS" hi="आदेश" right={String(rows.length)} />
            {rows.length === 0 ? (
              <EmptyNote
                icon="cart-outline"
                title="No orders yet"
                body="Orders raised on the web show up here — and a won deal can become one from the button above."
              />
            ) : (
              <ModuleCards>
                {rows.slice(0, 40).map(o => (
                  <OrderRow
                    key={o.id}
                    order={o}
                    onOpen={() => {
                      setOpenOrder({ id: o.id, number: o.order_number });
                      setOrderVisible(true);
                    }}
                  />
                ))}
              </ModuleCards>
            )}
            {/* The server's own truncation flag, not a client-side guess. */}
            {(rows.length > 40 || page?.truncated) && (
              <Text style={[s.more, { color: t.ink4 }]}>
                Showing the {Math.min(40, rows.length)} most recent of {page?.total ?? rows.length}.
                The full ledger is on the web.
              </Text>
            )}
          </>
        )}

        {tab === 'stock' && (
          <TabBody
            isLoading={stock.isLoading}
            isError={stock.isError}
            empty={stockRows.length === 0}
            emptyTitle="No products"
            emptyBody="Stock follows the product catalogue. Add a product on the web and it appears here at zero."
            onRetry={() => stock.refetch()}
          >
            <SectionHead
              label="STOCK"
              hi="भंडार"
              right={lowStock.length > 0 ? `${lowStock.length} low` : String(stockRows.length)}
            />
            <ModuleCards>
              {sortedStock.slice(0, 60).map(r => (
                <StockRowCard
                  key={r.product_id}
                  row={r}
                  low={num(r.low_stock_threshold) > 0
                    && num(r.quantity_on_hand) <= num(r.low_stock_threshold)}
                  onOpen={() => { setOpenStock(r); setStockVisible(true); }}
                />
              ))}
            </ModuleCards>
            {stockRows.length > 60 && (
              <Text style={[s.more, { color: t.ink4 }]}>
                Showing 60 of {stockRows.length} products. The full catalogue is on the web.
              </Text>
            )}
          </TabBody>
        )}

        {tab === 'targets' && (
          <TabBody
            isLoading={targets.isLoading}
            isError={targets.isError}
            empty={targetRows.length === 0}
            emptyTitle="No targets set"
            emptyBody="Sales targets are set on the web, per person and per period."
            onRetry={() => targets.refetch()}
          >
            <SectionHead label="TARGETS" hi="लक्ष्य" right={String(targetRows.length)} />
            <ModuleCards>
              {targetRows.slice(0, 30).map(tg => <TargetCard key={tg.id} target={tg} />)}
            </ModuleCards>
            {/* Attainment is measured off WON DEALS, not off orders or invoices —
                neither of those carries an owner. Said once, under the list, so
                nobody reconciles it against the order value above and files a bug. */}
            <Text style={[s.more, { color: t.ink4 }]}>
              Attainment counts deals won in the period by that person. Orders and
              invoices carry no owner, so they cannot be attributed.
            </Text>
          </TabBody>
        )}
      </ModuleShell>

      {/* Mounted OUTSIDE `ModuleShell` so a refetch that briefly fails cannot
          unmount a sheet the user is working in. The ids stay set through the
          dismissal animation; `enabled` on each sheet's query is what stops it
          refetching while it closes. */}
      <OrderDetailSheet
        visible={orderVisible}
        onClose={() => setOrderVisible(false)}
        orderId={openOrder?.id ?? null}
        orderNumber={openOrder?.number ?? ''}
      />
      <ConvertDealSheet
        visible={convertVisible}
        onClose={() => setConvertVisible(false)}
        orders={rows}
      />
      <StockAdjustSheet
        visible={stockVisible}
        onClose={() => setStockVisible(false)}
        row={openStock}
      />
    </>
  );
}

// ── Tab body ─────────────────────────────────────────────────────────────────

/**
 * Loading, failure and emptiness for ONE tab, inside the shell rather than
 * instead of it.
 *
 * `ScreenState` is not reused here on purpose: it fills its container and
 * centres, which inside a scroll body would push the tabs off the top of the
 * screen and leave no way back to the tab that was working.
 */
function TabBody({ isLoading, isError, empty, emptyTitle, emptyBody, onRetry, children }: {
  isLoading: boolean;
  isError:   boolean;
  empty:     boolean;
  emptyTitle: string;
  emptyBody:  string;
  onRetry:   () => void;
  children:  React.ReactNode;
}) {
  const { t } = useTheme();

  if (isLoading) {
    return (
      <View style={s.tabCentre} accessibilityLabel="Loading">
        <ActivityIndicator color={t.primary} />
      </View>
    );
  }
  if (isError) {
    return (
      <View style={s.tabCentre}>
        <Ionicons name="alert-circle-outline" size={26} color={t.error} />
        <Text style={[s.emptyTitle, { color: t.ink }]}>Couldn’t load this</Text>
        <Pressable
          onPress={onRetry}
          {...a11yButton('Retry')}
          style={[s.retry, { borderColor: t.outline }]}
        >
          <Text style={[s.retryText, { color: t.primaryText }]}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (empty) return <EmptyNote icon="file-tray-outline" title={emptyTitle} body={emptyBody} />;
  return <>{children}</>;
}

function EmptyNote({ icon, title, body }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  const { t } = useTheme();
  return (
    <View style={s.tabCentre}>
      <Ionicons name={icon} size={26} color={t.ink3} />
      <Text style={[s.emptyTitle, { color: t.ink }]}>{title}</Text>
      <Text style={[s.emptyBody, { color: t.ink3 }]}>{body}</Text>
    </View>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function OrderRow({ order, onOpen }: { order: Order; onOpen: () => void }) {
  const { t } = useTheme();
  const key  = (order.status ?? '').toLowerCase();
  const tone = statusTone(t, key);
  // Company first, person second, and never an id — `orderParty` returns null
  // for the ten live orders that name nobody at all.
  const who  = orderParty(order);

  const when = order.order_date ? new Date(order.order_date) : null;
  const whenLabel = when && !Number.isNaN(when.getTime())
    ? when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null;

  return (
    <Pressable
      onPress={onOpen}
      {...a11yButton(
        `Order ${order.order_number}, ${who ?? 'no customer named'}, `
        + `${inr(order.total)}, ${ORDER_STATUS_LABEL[key] ?? order.status}`,
        'Opens the order',
      )}
    >
      <Card accent={key === 'cancelled' ? t.error : undefined}>
        <View style={s.rowTop}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.who, { color: t.ink }]} numberOfLines={1}>
              {who ?? 'No customer named'}
            </Text>
            <Text style={[s.number, { color: t.ink3 }]} numberOfLines={1}>
              {order.order_number}{whenLabel ? ` · ${whenLabel}` : ''}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={[s.amount, { color: t.ink }]}>{inr(order.total)}</Text>
            <Tag
              text={ORDER_STATUS_LABEL[key] ?? order.status}
              tone={tone}
              bg={withAlpha(tone, 0.12)}
            />
          </View>
        </View>
        {!!order.invoice_id && (
          <Text style={[s.sub, { color: t.ink4 }]}>Invoiced</Text>
        )}
      </Card>
    </Pressable>
  );
}

function StockRowCard({ row, low, onOpen }: { row: StockRow; low: boolean; onOpen: () => void }) {
  const { t } = useTheme();
  const qty = num(row.quantity_on_hand);
  const threshold = num(row.low_stock_threshold);

  return (
    <Pressable
      onPress={onOpen}
      {...a11yButton(
        `${row.name}, ${qty} ${row.unit || 'units'} on hand${low ? ', low stock' : ''}`,
        'Opens the stock adjustment',
      )}
    >
      <Card accent={low ? t.approval : undefined}>
        <View style={s.rowTop}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.who, { color: t.ink }]} numberOfLines={2}>{row.name}</Text>
            <Text style={[s.number, { color: t.ink3 }]} numberOfLines={1}>
              {threshold > 0 ? `Alert at ${threshold}` : 'No alert set'}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={[s.amount, { color: low ? t.approval : t.ink }]}>
              {qty} <Text style={[s.unit, { color: t.ink3 }]}>{row.unit || 'NOS'}</Text>
            </Text>
            {low && <Tag text="Low" tone={t.approval} bg={withAlpha(t.approval, 0.14)} />}
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

/**
 * One target period, read-only.
 *
 * Writing a target is not offered: `POST /targets` needs a `salesperson_id`,
 * and picking a person on a phone means rendering a member list — which is the
 * one thing the names-not-IDs rule makes expensive to do correctly, and which
 * nobody does from a phone anyway. Setting targets is quarterly desk work.
 */
function TargetCard({ target }: { target: Target }) {
  const { t } = useTheme();
  const goal = num(target.target_amount);
  const got  = num(target.actual_amount);
  const pct  = goal > 0 ? Math.round((got / goal) * 100) : 0;
  const tone = pct >= 100 ? t.success : pct >= 60 ? t.primaryText : t.approval;
  const unattributed = num(target.unattributed_amount);

  return (
    <Card>
      <View style={s.rowTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.who, { color: t.ink }]} numberOfLines={1}>
            {target.salesperson_name ?? 'Unassigned'}
          </Text>
          <Text style={[s.number, { color: t.ink3 }]} numberOfLines={1}>
            {periodLabel(target.period_start, target.period_end)}
          </Text>
        </View>
        <Text style={[s.amount, { color: tone }]}>{goal > 0 ? `${pct}%` : '—'}</Text>
      </View>

      <View style={[s.bar, { backgroundColor: t.outlineVar }]}>
        <View
          style={[
            s.barFill,
            // Capped at 100% of the track so an over-achiever does not draw
            // outside the card. The figure above is uncapped and says 140%.
            { backgroundColor: tone, width: `${Math.min(100, Math.max(0, pct))}%` },
          ]}
        />
      </View>

      <Text style={[s.sub, { color: t.ink3 }]}>
        {inr(got)} of {inr(goal)}
        {num(target.target_deals) > 0
          ? ` · ${num(target.actual_deals)} of ${num(target.target_deals)} deals`
          : ''}
      </Text>
      {unattributed > 0 && (
        <Text style={[s.sub, { color: t.ink4 }]}>
          {inr(unattributed)} won in this period belongs to nobody’s target.
        </Text>
      )}
    </Card>
  );
}

/** `1 Jul – 30 Sep 2026`, or the raw pair if either date will not parse. */
function periodLabel(start: string, end: string): string {
  const a = new Date(start);
  const b = new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${start} – ${end}`;
  const sameYear = a.getFullYear() === b.getFullYear();
  const fa = a.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }),
  });
  const fb = b.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${fa} – ${fb}`;
}

const s = StyleSheet.create({
  tabs: { flexDirection: 'row', borderRadius: 10, padding: 3, gap: 3, marginTop: 14 },
  tab:  { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8, minHeight: 38, justifyContent: 'center' },
  tabText: { fontSize: 13, fontWeight: '700' },

  action: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 13, paddingVertical: 12,
    marginTop: 14, minHeight: 48,
  },
  actionText: { flex: 1, fontSize: 14, fontWeight: '700' },

  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  who:    { fontSize: 14, fontWeight: '700' },
  number: { fontSize: 11.5, marginTop: 2 },
  amount: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  unit:   { fontSize: 11, fontWeight: '600' },
  sub:    { fontSize: 11.5, lineHeight: 16, marginTop: 3 },

  bar:     { height: 5, borderRadius: 3, marginTop: 8, overflow: 'hidden' },
  barFill: { height: 5, borderRadius: 3 },

  tabCentre:  { alignItems: 'center', gap: 6, paddingVertical: 40, paddingHorizontal: 16 },
  emptyTitle: { fontSize: 15, fontWeight: '700', marginTop: 4, textAlign: 'center' },
  emptyBody:  { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retry:      { marginTop: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 9 },
  retryText:  { fontSize: 13, fontWeight: '700' },

  more: { fontSize: 11.5, lineHeight: 16, marginTop: 8, textAlign: 'center' },
});
