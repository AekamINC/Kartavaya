import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  Button, Card, CardBody, CardHead, Cell, ErrorState, HeadCell, Row,
  SkeletonPage, StatTile, Table, TableBody, TableHead, Tag, useToast,
} from '../../components/ui';
import { billingColor, billingLabel } from '../../lib/statusColors';
import { inr, grouped } from '../../lib/inr';
import { formatDate, formatPeriod } from '../../lib/timeFormat';
import { orgSeats, pahchanSeats } from './seatFigures';
import BillingUsageSection from '../billing/BillingUsageSection';
import useColumnPrefs from '../../hooks/useColumnPrefs';
import { ColumnsButton } from '../../components/ui/CustomizeColumns';

/**
 * The customer's own invoice list, declared once.
 *
 * `fixed` on Invoice: the number is the only cell that identifies which
 * document a row is, and it is what the firm quotes when it pays.
 *
 * `Pay to` is NOT fixed and is deliberately last, because the row reads as the
 * sentence it is — this much, of which this is tax, by this date, to this
 * address. It stays hideable: a firm that pays every invoice by the same
 * standing instruction does not need the payee repeated on twelve rows, and
 * hiding it costs them nothing they cannot get back. What must never happen is
 * the column not existing, which is the state this table shipped in.
 */
const ORG_INVOICE_COLUMNS = [
  { id: 'invoice', label: 'Invoice', fixed: true },
  { id: 'period', label: 'Period' },
  { id: 'total', label: 'Total', num: true },
  { id: 'gst', label: 'GST', num: true },
  { id: 'status', label: 'Status' },
  { id: 'due', label: 'Due' },
  { id: 'payto', label: 'Pay to' },
];

/**
 * TabBilling — plan, credits, plan comparison and invoices.
 *
 * `10-org-settings.md` §5 folds `pages/BillingPage.jsx` in here and redirects
 * `/billing` to `/settings/organisation?tab=billing`. The redirect is a routing
 * change in `App.jsx`, which this batch does not own, so both surfaces exist
 * until that lands — see the handover note in the report.
 *
 * Four of the defects §"What's wrong today" lists were already fixed on staging
 * before this file existed, and the fixes are carried across rather than redone:
 * the `${c}18` hex-alpha concatenation (now `Tag`, which mixes properly), the
 * `return null` that deleted the whole credit block on a failed request, the raw
 * `active` enum, and the raw ISO invoice period. The rupee formatter had already
 * been promoted to `lib/inr.js`.
 *
 * ── Two credit blocks on one tab, and why both stay ─────────────────────────
 *
 * `CreditUsage` below reads `/v1/subscription/cost-report?period=30d`: a ROLLING
 * thirty days, split three ways (AI / scrapers / total). `BillingUsageSection`
 * at the foot of the tab reads `/v1/billing/me/*`: a CALENDAR MONTH, split by
 * source and by person, which is the grain an allowance is actually granted at.
 *
 * They will not agree, and they are not meant to — one answers "how close am I
 * to the limit right now", the other answers "who spent it, on what, in the
 * month I am being billed for". Deleting the first is not this batch's call: it
 * is what the plan meter on this tab is drawn from, and `/cost-report` is being
 * repointed at the same aggregate by the agent that owns `subscription.py`.
 */

/**
 * An invoice nobody is waiting on. The payee on a settled document is a record
 * of where the money went, not an instruction — so the absence of one is not a
 * problem to raise, and marking it would send somebody chasing a payment that
 * has already been made.
 */
const SETTLED = new Set(['paid', 'cancelled']);

/**
 * The UPI address as the invoice itself carries it.
 *
 * `payable_by_upi` comes back on the same row and says the same thing — the
 * server derives it as `bool(vpa)` — but the ADDRESS is what a person actually
 * pays to, so the column is drawn from the address and stays right against a
 * backend deployed before that flag existed. Trimmed for the same reason the
 * server trims it: a VPA of three spaces would otherwise render as a payment
 * address.
 */
const upiOf = iv => (iv.upi_vpa || '').trim();

function CreditUsage() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    return api.get('/v1/subscription/cost-report?period=30d')
      .then(r => setData(r.data))
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => { load(); }, [load]);

  // A failed request used to `return null`, so the entire credit block vanished
  // with no message. Someone checking whether they were near their limit got a
  // page that simply did not mention credits, which reads as "no limit exists".
  if (failed) {
    return (
      <Card>
        <CardHead title="Credits this month" />
        <CardBody>
          <p className="of__h">
            Couldn’t load credit usage. Your credits are unaffected — this is a display
            problem, not a billing one.
          </p>
          <Button variant="out" onClick={load} className="ocred__retry">Try again</Button>
        </CardBody>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card>
        <CardHead title="Credits this month" />
        <CardBody><p className="of__h">Loading…</p></CardBody>
      </Card>
    );
  }

  const pct = data.plan_credits > 0
    ? Math.min(100, Math.round((data.total_credits_used / data.plan_credits) * 100))
    : 0;
  const over = pct >= 100;

  return (
    <Card>
      <CardHead title="Credits this month" sanskrit="श्रेय" />
      <CardBody>
        <div className="ostats ostats--gap">
          <StatTile label="Plan credits" value={grouped(data.plan_credits)} />
          <StatTile label="Used" value={grouped(data.total_credits_used)}
            variant={data.is_over_plan ? 'danger' : 'neutral'} />
          <StatTile label="Balance" value={grouped(data.current_balance)}
            variant={data.current_balance <= 0 ? 'danger' : 'ok'} />
          {data.overage_credits > 0 && (
            <StatTile label="Overage" value={grouped(data.overage_credits)} variant="danger"
              sub="Chargeable" />
          )}
        </div>

        <div className="omtr" role="progressbar" aria-valuenow={pct} aria-valuemin={0}
          aria-valuemax={100} aria-label="Plan credits used">
          {/* The fill is the one genuinely per-instance value on this card, so
              it arrives as a custom property and `.omtr__f` owns the width. */}
          <div className={`omtr__f${over ? ' over' : ''}`} style={{ '--pct': `${pct}%` }} />
        </div>
        <div className="omtr__lg">
          <span>AI {grouped(data.ai_credits_used)} · Scrapers {grouped(data.scraper_credits_used)}</span>
          <span>{pct}% used</span>
        </div>
      </CardBody>
    </Card>
  );
}

export default function TabBilling() {
  const { pushToast } = useToast();
  const [sub, setSub] = useState(null);
  const [active, setActive] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [cur, inv, usg] = await Promise.all([
        api.get('/v1/subscription/current'),
        api.get('/v1/subscription/invoices'),
        api.get('/v1/subscription/usage'),
      ]);
      setSub(cur.data.subscription);
      setActive(cur.data.active_modules || []);
      setInvoices(inv.data.data || []);
      setUsage(usg.data);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const downloadReport = async (period) => {
    try {
      const res = await api.get(`/v1/subscription/cost-report/pdf?period=${period}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `UsageReport-${period}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      pushToast({ type: 'error', title: 'Report generation failed' });
    }
  };

  /* Above the loading and error returns — the skeleton and the landed tab have
     to render the same hooks. */
  const cols = useColumnPrefs('org.invoices', ORG_INVOICE_COLUMNS);

  if (loading) return <SkeletonPage withStats withTable />;
  if (failed) {
    return <ErrorState kind="server" detail="Couldn’t load billing data." onRetry={() => { setLoading(true); load(); }} />;
  }

  const planName = sub?.plan_name || 'Free';

  /* Both seat figures come from `seatFigures.js`, which the platform console
     renders from too — the arithmetic that decides which number is the ENFORCED
     one belongs in one place, for the reason `org_invites.py` sets out at
     length about the five counters that disagreed on the server. */
  const seats = orgSeats(usage, sub);
  const pahchan = pahchanSeats(usage);

  /* ── Whether the client can actually pay what this tab shows them ──────────
     There is no payment gateway and there will not be one, so the UPI address
     snapshotted onto each invoice IS the collection mechanism. Counted here
     rather than inside the table because the sentence at the foot of the tab
     depends on the answer, and a claim about invoices must be made over the
     invoices themselves.

     OUTSTANDING ONLY. A settled invoice with no VPA is not a gap to report —
     it was paid some other way, and folding it into this count would put a
     warning on the tab of an org that owes nothing. */
  const outstanding = invoices.filter(iv => !SETTLED.has(iv.payment_status));
  const unpayable = outstanding.filter(iv => !upiOf(iv)).length;
  const upiOnInvoices = outstanding.length === 0 ? null
    : unpayable === 0 ? 'all'
      : unpayable === outstanding.length ? 'none' : 'some';

  return (
    <div>
      <section className="st__group">
        <div className="ostats">
          <StatTile label="Plan" value={planName} />
          <StatTile label="Seats" value={seats.value} sub={seats.note}
            variant={seats.full ? 'warn' : 'neutral'} />
          {pahchan && (
            <StatTile label="Attendance seats" sanskrit="पहचान"
              value={pahchan.value} sub={pahchan.note}
              variant={pahchan.full ? 'warn' : 'neutral'} />
          )}
          {/* billingLabel, not the raw enum — this printed a lowercase "active". */}
          <StatTile label="Status" value={billingLabel(sub?.status || 'active')} />
          <StatTile label="Modules" value={active.length} />
        </div>
      </section>

      <section className="st__group st__group--flush">
        <CreditUsage />
      </section>

      <section className="st__group">
        <h2 className="st__gt">Usage report</h2>
        <div className="orep">
          {[['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['ytd', 'Year to date']]
            .map(([p, label]) => (
              <Button key={p} variant="out" size="sm" onClick={() => downloadReport(p)}>{label}</Button>
            ))}
        </div>
      </section>

      <section className="st__group">
        <h2 className="st__gt">Invoices</h2>
        {invoices.length === 0 ? (
          <p className="of__h">No invoices yet.</p>
        ) : (
          /* The shared Table, not a seventh hand-rolled one: `num` puts money in
             mono tabular figures so a column of totals lines up on the decimal. */
          <>
            {/* Inside the has-invoices branch: a Columns button over "No
                invoices yet" is a control for a table that is not there. */}
            <div className="tbl__abar">
              <ColumnsButton cols={cols} />
            </div>
            <Table>
              <TableHead>
                {/* `Pay to` is last in the declaration, so a row reads as the
                    sentence it is: this much, of which this is tax, by this
                    date, to this address. Six columns stopped one step short of
                    the only one that lets the reader act. */}
                {cols.columns.map(c => (
                  <HeadCell
                    key={c.id}
                    num={c.num}
                    width={c.width}
                    onResize={w => cols.setWidth(c.id, w)}
                  >
                    {c.label}
                  </HeadCell>
                ))}
              </TableHead>
              <TableBody>
                {invoices.map(iv => (
                  <Row key={iv.id}>
                    {cols.cells({
                    invoice: <Cell><span className="oinv__n">{iv.invoice_number}</span></Cell>,
                    /* "Jul 2026", not "2026-07-01 → 2026-07-31". */
                    period: <Cell>{formatPeriod(iv.period_start, iv.period_end)}</Cell>,
                    total: <Cell num>{inr(iv.total)}</Cell>,
                    gst: <Cell num>{inr(iv.gst)}</Cell>,
                    status: <Cell><Tag color={billingColor(iv.payment_status)}>{billingLabel(iv.payment_status)}</Tag></Cell>,
                    due: <Cell>{formatDate(iv.due_date)}</Cell>,
                    /* PER ROW, never once above the table. The payee is
                        snapshotted onto the invoice at issue and deliberately
                        never refreshed, so that changing it later cannot
                        rewrite a document already sent. One payee printed over
                        the whole list would flatten exactly that distinction
                        and put today's address on last year's invoice.

                        The name is shown only when the row carries one: it is
                        COALESCEd server-side down to the org's own name, so an
                        empty one means nothing was recorded, and inventing
                        "Aekam" here would be this screen making up a payee. */
                    payto: (
                    <Cell>
                      {upiOf(iv) ? (
                        <>
                          {iv.upi_payee_name && <div>{iv.upi_payee_name}</div>}
                          <div className="oinv__n">{upiOf(iv)}</div>
                        </>
                      ) : SETTLED.has(iv.payment_status) ? (
                        <span className="of__h">—</span>
                      ) : (
                        /* Said plainly rather than left blank. An empty cell in
                           a money table reads as a rendering fault, and the
                           first thing doubted after it is the amount beside it. */
                        <Tag color="var(--warn)">No UPI address</Tag>
                      )}
                    </Cell>
                    ),
                    })}
                  </Row>
                ))}
              </TableBody>
            </Table>
            {unpayable > 0 && (
              <p className="of__h of__h--foot">
                “No UPI address” means the invoice was issued without payment details on
                it. There is no payment gateway, so ask your account manager at Aekam how
                to settle {unpayable === 1 ? 'that one' : 'those'}.
              </p>
            )}
          </>
        )}
      </section>

      {/* Where the money actually went. The stat tiles above say how much is
          left; this says who spent it and on what, which is the question an org
          admin opens this tab to answer and the one the tab could not answer at
          all until now. Same component Aekam runs over every org at
          `/admin/usage` — one implementation, so the figure a client reads and
          the figure Aekam reads about that client cannot diverge. */}
      <section className="st__group st__group--flush">
        <h2 className="st__gt">Usage &amp; spend</h2>
        <BillingUsageSection basePath="/v1/billing/me" upiOnInvoices={upiOnInvoices} />
      </section>
    </div>
  );
}
