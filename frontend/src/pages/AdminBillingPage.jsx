/**
 * AdminBillingPage — the Aekam billing console. 11-platform-admin.md.
 *
 * ── 11's headline finding, and what actually fixed it ────────────────────────
 *
 * "`/admin/billing` is not a platform page. Every call it makes is org-scoped…
 * No `org_id` anywhere. So a page titled 'Billing Administration', reached from
 * the platform admin link, can only change the plan of and raise invoices
 * against the org the operator is logged into."
 *
 * Confirmed: `subscription.py` resolves the org from `Depends(get_org_id)` on
 * set-plan, create-invoice, current, invoices and usage. And the single
 * exception 11 names is real — `/admin/invoices/overdue` returns `org_name`
 * across every org while taking no org itself, so the operator could read
 * another company's overdue invoice and record its payment against their own.
 *
 * 11 concludes this needs new `/v1/admin/orgs/:orgId/…` endpoints. It does not:
 * `middleware/org_resolver.py` already reads an `X-Org-Id` header first and
 * already lets platform staff resolve to any org through it. The scope was
 * never missing from the server, only from the caller. See `admin/orgScope.js`.
 *
 * So this page now has ONE tenant scope, stated at the top, sticky, and applied
 * to every write. Acting on another org's overdue invoice moves the scope to
 * that org first — visibly — rather than silently posting into the wrong one.
 *
 * ── The other defects, and their status ──────────────────────────────────────
 *
 *  · Five local primitives (Card, Badge, Input, Select, Btn) — HELD, deleted,
 *    now `components/ui`.
 *  · The `${c}18` hex-alpha hack, `#ef4444` / `#f59e0b` inline, `⚠` in a card
 *    title — HELD, all gone. Status colour comes from `lib/statusColors.js`.
 *  · `line_items` array with a one-line form — HELD, see `InvoiceBuilder`.
 *  · Payment has no date — STALE, it was already sent. No amount — HELD, and it
 *    is a backend gap; see `PaymentForm`.
 *  · "Upgrade to Professional or higher… there is no Professional plan" —
 *    STALE. The string on the branch reads "Upgrade to Growth or Scale", which
 *    matches the free/starter/growth/scale catalogue.
 *  · "--surface-1, --ink-1, --k-primary-ghost are defined NOWHERE" — STALE.
 *    All three are declared in `styles/kartavaya-design.css`, and the file
 *    carried a comment saying they had already been remapped.
 *
 * ── Two defects this page was still producing, found on the pixel pass ───────
 *
 *  · **Every control here 403s for `platform_staff`.** The whole page is
 *    guarded server-side by `BILLING_CONSOLE_ROLES`, which deliberately omits
 *    `platform_staff` — its operating set stops short of finance. But
 *    `components/admin/adminNav.js` offers all four console entries to anyone
 *    holding any platform role, so a staff operator arrived here, saw a
 *    populated page (the org list is `CONSOLE_ROLES_WITH_FINANCE` and does
 *    return), and every button failed. Now refused up front, in words.
 *  · **"Record payment" on the overdue table did nothing.** `Tabs` renders only
 *    the active tab's content; the overdue list is in Overview and the payment
 *    form was a card in Invoices. The form is now a page-level `SlideOver`, so
 *    it opens from wherever the payment starts and restates the scope it is
 *    about to write into.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import {
  Button, Card, CardHead, CardBody, Field, Input, Select, Tag, Tabs,
  EmptyState, ErrorState, errorKind, SkeletonPage,
  Table, TableHead, TableBody, Row, Cell, HeadCell,
  StatTile, useToast,
} from '../components/ui';
import { billingColor, billingLabel } from '../lib/statusColors';
import { currentUser } from '../lib/auth';
import { inr } from '../lib/inr';
import { scoped, readScope, writeScope } from './admin/orgScope';
import { canManageBilling } from './admin/platformRoles';
import { orgSeats, pahchanSeats } from './org/seatFigures';
import InvoiceBuilder from './admin/InvoiceBuilder';
import PaymentForm from './admin/PaymentForm';
import SlideOver from './admin/SlideOver';
import TopUpDialog from './admin/TopUpDialog';
import '../styles/admin.css';
import { Secondary } from '../components/Bilingual';
import useColumnPrefs from '../hooks/useColumnPrefs';
import { ColumnsButton } from '../components/ui/CustomizeColumns';

/**
 * The two record lists on this console, declared once each — the floor a saved
 * arrangement resolves against.
 *
 * `fixed` on Invoice and on Actions in both. The invoice NUMBER is the only
 * thing that says which invoice a row is (the org name repeats down the overdue
 * list, and every other column is money), and Actions carries "Record payment",
 * which is the whole reason an operator opens this page. A stale arrangement
 * that hid either would leave a table of money nobody can act on.
 */
const OVERDUE_COLUMNS = [
  { id: 'invoice', label: 'Invoice', fixed: true },
  { id: 'org', label: 'Organisation' },
  { id: 'total', label: 'Total', num: true },
  { id: 'due', label: 'Due' },
  { id: 'actions', label: 'Actions', sr: true, fixed: true },
];

const INVOICE_COLUMNS = [
  { id: 'invoice', label: 'Invoice', fixed: true },
  { id: 'period', label: 'Period' },
  { id: 'subtotal', label: 'Subtotal', num: true },
  { id: 'gst', label: 'GST', num: true },
  { id: 'total', label: 'Total', num: true },
  { id: 'status', label: 'Status' },
  { id: 'due', label: 'Due' },
  { id: 'actions', label: 'Actions', sr: true, fixed: true },
];

/* `billingLabel` title-cases anything the map does not carry, so a status the
   server adds later reaches the operator as "Partially Paid" rather than as
   `partially_paid`. The local copies this file used to hold returned the raw
   enum. */

const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export default function AdminBillingPage() {
  const { pushToast } = useToast();
  const mayBill = canManageBilling(currentUser()?.platform_roles);

  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrgId] = useState(() => readScope());
  const [sub, setSub] = useState(null);
  const [activeModules, setActiveModules] = useState([]);
  const [plans, setPlans] = useState([]);
  const [catalogModules, setCatalogModules] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [usage, setUsage] = useState(null);
  const [overdue, setOverdue] = useState([]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState('');
  const [payTarget, setPayTarget] = useState(null);
  const [toppingUp, setToppingUp] = useState(false);
  const [planForm, setPlanForm] = useState({ plan_code: '', billing_cycle: 'monthly' });

  const org = orgs.find(o => o.id === orgId) || null;

  /* Both hooks sit ABOVE the `mayBill`, `loading` and `err` returns below. A
     staff operator who is refused, or a first paint still loading, would
     otherwise render fewer hooks than the populated console — and React counts
     hooks, not branches. */
  const overdueCols = useColumnPrefs('admin.billing_overdue', OVERDUE_COLUMNS);
  const invoiceCols = useColumnPrefs('admin.billing_invoices', INVOICE_COLUMNS);

  /* Cross-org, and deliberately unscoped: the overdue list is the one endpoint
     that is genuinely platform-wide. */
  const loadPlatform = useCallback(async () => {
    if (!mayBill) return;
    const [orgRes, catalog, od] = await Promise.all([
      api.get('/v1/admin/orgs'),
      api.get('/v1/subscription/plans').catch(() => ({ data: {} })),
      api.get('/v1/subscription/admin/invoices/overdue').catch(() => ({ data: { data: [] } })),
    ]);
    setOrgs(orgRes.data?.data || []);
    setPlans(catalog.data?.plans || []);
    setCatalogModules(catalog.data?.modules || []);
    setOverdue(od.data?.data || []);
  }, [mayBill]);

  /* Everything below carries the org. Without the header these five calls
     resolve to the OPERATOR's org, which is the whole finding. */
  const loadOrg = useCallback(async (id) => {
    if (!id || !mayBill) {
      setSub(null); setActiveModules([]); setInvoices([]); setUsage(null);
      return;
    }
    const [cur, inv, usg] = await Promise.all([
      api.get('/v1/subscription/current', scoped(id)),
      api.get('/v1/subscription/invoices', scoped(id)),
      api.get('/v1/subscription/usage', scoped(id)).catch(() => ({ data: null })),
    ]);
    setSub(cur.data?.subscription || null);
    setActiveModules(cur.data?.active_modules || []);
    setInvoices(inv.data?.data || []);
    setUsage(usg.data || null);
    setPlanForm(f => ({ ...f, plan_code: cur.data?.subscription?.plan_code || '' }));
  }, [mayBill]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    loadPlatform()
      .then(() => (live ? undefined : null))
      .catch(e => { if (live) setErr(e); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [loadPlatform]);

  useEffect(() => {
    let live = true;
    writeScope(orgId);
    loadOrg(orgId).catch(e => { if (live) pushToast({ type: 'error', title: 'Could not load this organisation', message: e?.response?.data?.detail }); });
    return () => { live = false; };
  }, [orgId, loadOrg, pushToast]);

  const refresh = () => Promise.all([loadPlatform(), loadOrg(orgId)]).catch(() => {});

  /* RETURNS WHAT THE WRAPPED CALL RETURNED. It used to `await fn(...)` and
     discard the value, which reads as harmless on a wrapper whose job is a
     precondition — and silently made one impossible: `InvoiceBuilder` awaits
     `onCreate` and renders the `payment_note` off the body it gets back, so the
     only sentence that says AN INVOICE CANNOT BE PAID resolved to `undefined`
     here and never reached a screen. Nothing else reads a return value today;
     passing it through costs nothing and stops the next one failing the same
     way, invisibly. The no-org branch still returns undefined, which is the
     honest answer — no call was made. */
  const guard = (fn) => async (...args) => {
    if (!orgId) { pushToast({ type: 'error', title: 'Choose an organisation first' }); return undefined; }
    return await fn(...args);
  };

  const setPlan = guard(async () => {
    setBusy('plan');
    try {
      await api.post('/v1/subscription/admin/set-plan', planForm, scoped(orgId));
      pushToast({ type: 'success', title: `${org?.name || 'Organisation'} moved to ${planForm.plan_code}` });
      await refresh();
    } catch (e) {
      pushToast({ type: 'error', title: e?.response?.data?.detail || 'Could not change the plan' });
    } finally { setBusy(''); }
  });

  const toggleModule = guard(async (code, on) => {
    setBusy(code);
    try {
      await api.post(`/v1/subscription/modules/${on ? 'deactivate' : 'activate'}`, { module_code: code }, scoped(orgId));
      pushToast({ type: 'success', title: `${code} ${on ? 'deactivated' : 'activated'}` });
      await refresh();
    } catch (e) {
      pushToast({ type: 'error', title: e?.response?.data?.detail || 'Module change failed' });
    } finally { setBusy(''); }
  });

  const createInvoice = guard(async (body) => {
    setBusy('invoice');
    try {
      const { gst_treatment: _t, ...payload } = body;
      const res = await api.post('/v1/subscription/admin/invoices', payload, scoped(orgId));
      pushToast({ type: 'success', title: `Invoice ${res.data?.invoice_number || ''} created for ${org?.name || 'the organisation'}` });
      await refresh();
      /* THE BODY GOES BACK TO THE FORM, and `payment_note` is the whole reason.
         It is computed at issue time from the payee that was snapshotted onto
         this document and returned NOWHERE ELSE — no later read recomputes it —
         so if it is dropped here the operator is never told that the invoice
         they just raised carries no UPI details, which with no payment gateway
         anywhere in this product means nobody can pay it. Returned after
         `refresh()` so the note and the reloaded list appear together.
         A failure returns undefined and the form clears its note, which is
         right: there is no invoice to say anything about. */
      return res.data;
    } catch (e) {
      pushToast({ type: 'error', title: e?.response?.data?.detail || 'Could not create the invoice' });
    } finally { setBusy(''); }
  });

  /* The only write on this page whose scope is NOT the header. `record_payment`
     resolves the invoice by id and updates that row, so the invoice id is the
     scope and the payment cannot land on the wrong org. The header goes anyway,
     because a call site that sometimes carries the scope and sometimes does not
     is how the next person gets it wrong. */
  const recordPayment = async (body) => {
    if (!payTarget) return;
    setBusy('payment');
    try {
      await api.patch(`/v1/subscription/admin/invoices/${payTarget.id}/record-payment`, body, scoped(payTarget.org_id || orgId));
      pushToast({ type: 'success', title: `${payTarget.invoice_number} marked paid` });
      setPayTarget(null);
      await refresh();
    } catch (e) {
      pushToast({ type: 'error', title: e?.response?.data?.detail || 'Could not record the payment' });
    } finally { setBusy(''); }
  };

  /* The combination 11 called out — a cross-org list beside single-tenant
     actions — is closed by moving the scope BEFORE opening the payment form,
     so the bar at the top names the org the write will land on. */
  const payOverdue = (invoice) => {
    if (invoice.org_id && invoice.org_id !== orgId) setOrgId(invoice.org_id);
    setPayTarget(invoice);
  };

  const pageHead = (
    <header className="apg__head">
      <div className="apg__titles">
        <h1 className="apg__t">
          Billing
          <Secondary className="apg__hi" value="शुल्क" />
        </h1>
        <p className="apg__lede">
          Plans, modules, invoices and payments — for the organisation named below, not for yours.
        </p>
      </div>
    </header>
  );

  /* Every write on this page is guarded by BILLING_CONSOLE_ROLES, which
     excludes `platform_staff` by design — its operating set stops short of
     finance. Without this the sidebar hands a staff operator a fully populated
     console whose every button 403s. Refusing in words is the whole point. */
  if (!mayBill) {
    return (
      <div className="apg">
        {pageHead}
        <ErrorState kind="denied" grant="platform owner, platform manager or account/finance access" />
      </div>
    );
  }

  if (loading) return <SkeletonPage withStats withTable />;
  if (err) return <ErrorState kind={errorKind(err)} grant="finance access to the platform console" onRetry={refresh} />;

  /* One visible, sticky tenant scope. `aria-live` because `payOverdue` MOVES the
     scope on the operator's behalf when they act on another org's overdue
     invoice — a scope that changes silently is the failure this bar exists to
     prevent, and a sighted operator sees the select change while a screen
     reader user would not. */
  const scopeBar = (
    <div className="osc">
      <span className="osc__l">Acting on</span>
      <Select
        aria-label="Organisation this page acts on"
        value={orgId}
        onChange={e => { setPayTarget(null); setOrgId(e.target.value); }}
      >
        <option value="">— Choose an organisation —</option>
        {orgs.map(o => (
          <option key={o.id} value={o.id}>{o.name}{o.is_active ? '' : ' (suspended)'}</option>
        ))}
      </Select>
      <span className="osc__v" aria-live="polite">
        {org
          ? <>{org.name} — {org.plan_name || org.plan_code || 'no plan'} · {org.owner_name || 'no owner'}</>
          : <span className="osc__none">Nothing is scoped — reads and writes below are disabled.</span>}
      </span>
      {/* The top-up lives on the scope bar rather than inside a tab, for the
          reason the bar exists: it moves money into a named organisation, and
          the name has to be beside the button. `Tabs` renders only the active
          panel, so a tab is also the place a control goes to be unfindable. */}
      <Button
        variant="out" size="sm"
        disabled={!orgId}
        onClick={() => setToppingUp(true)}
      >
        Top up credits
      </Button>
    </div>
  );

  /* null for an org with no attendance module and for no org in scope at all —
     `pahchanSeats` returns null in both cases, so the tile simply does not
     render rather than showing a zero nobody can interpret. */
  const pahchan = pahchanSeats(usage);

  const overviewTab = (
    <div className="apg__sec">
      <div className="apg__grid">
        <StatTile label="Plan" sanskrit="योजना" value={sub?.plan_name || (orgId ? 'Free' : '—')} />
        {/* Both figures come from `org/seatFigures.js`, the same module the
            customer's own Billing tab renders from. The operator deciding
            whether an org needs more seats and the customer looking at their own
            tile must not be reading two different arithmetics — that is the
            display-side version of the five disagreeing counters
            `routers/org_invites.py` documents on the server.

            "—" when there is no org in scope: this console starts unscoped, and
            a seat tile reading 0 for "no organisation selected" is a number
            somebody will act on. */}
        <StatTile label="Seats used" sanskrit="सदस्य"
          value={usage ? orgSeats(usage, sub).value : '—'} />
        {/* Counted separately by the owner's decision — never summed with the
            tile beside it. Absent for an org that does not run attendance. */}
        {pahchan && (
          <StatTile label="Attendance seats" sanskrit="पहचान" value={pahchan.value} />
        )}
        <StatTile label="Active modules" value={activeModules.length} />
        <StatTile label="Overdue, all orgs" value={overdue.length} variant={overdue.length ? 'danger' : 'neutral'} sub="platform-wide" />
      </div>

      <Card>
        <CardHead
          title="Overdue across every organisation"
          sanskrit="बकाया"
          actions={<ColumnsButton cols={overdueCols} />}
        />
        <CardBody flush>
          {overdue.length === 0 ? (
            <EmptyState
              icon="check"
              tone="ok"
              title={{ en: 'Nothing is overdue', hi: 'कुछ बकाया नहीं' }}
              description="Every raised invoice is inside its due date."
            />
          ) : (
            <Table>
              <TableHead>
                {overdueCols.columns.map(c => (
                  <HeadCell
                    key={c.id}
                    num={c.num}
                    width={c.width}
                    onResize={w => overdueCols.setWidth(c.id, w)}
                  >
                    {c.sr ? <span className="k-sr-only">{c.label}</span> : c.label}
                  </HeadCell>
                ))}
              </TableHead>
              <TableBody>
                {overdue.map(iv => (
                  <Row key={iv.id} on={iv.org_id === orgId}>
                    {overdueCols.cells({
                      invoice: <Cell><span className="adm-kv__v is-mono">{iv.invoice_number}</span></Cell>,
                      org: <Cell>{iv.org_name}</Cell>,
                      total: <Cell num>{inr(iv.total || 0)}</Cell>,
                      due: <Cell><Tag color="var(--danger)">{fmtDate(iv.due_date)}</Tag></Cell>,
                      actions: (
                        <Cell>
                          <Button size="sm" variant="out" onClick={() => payOverdue(iv)}>
                            Record payment
                          </Button>
                        </Cell>
                      ),
                    })}
                  </Row>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );

  const modulesTab = (
    <div className="apg__sec">
      {!orgId && <p className="osc__none">Choose an organisation to see what it has switched on.</p>}
      <div className="apg__grid">
        {catalogModules.map(m => {
          const on = activeModules.includes(m.code);
          return (
            <Card key={m.code} variant={on ? undefined : 'flat'}>
              <CardHead title={m.name || m.code} />
              <CardBody>
                <p className="apg__lede">{m.description || ''}</p>
                <p className="adm-kv__v">{inr(m.price_per_user_monthly || 0)} per user / month</p>
                {m.requires_module?.length > 0 && (
                  <p className="adm-kv__v">Requires {m.requires_module.join(', ')}</p>
                )}
                <div className="adm-actions">
                  <Button
                    variant={on ? 'danger' : 'fill'}
                    size="sm"
                    disabled={!orgId || busy === m.code}
                    onClick={() => toggleModule(m.code, on)}
                  >
                    {busy === m.code ? '…' : on ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
      {/* 11 flagged this string as naming a "Professional" tier that does not
          exist. On the branch it already reads Growth / Scale, which matches the
          free / starter / growth / scale catalogue. Reported as stale, not
          "fixed". */}
      {(!sub || sub.plan_code === 'free') && orgId && (
        <p className="inb__note">Add-on modules need Growth or Scale. This organisation is on Free.</p>
      )}
    </div>
  );

  const invoicesTab = (
    <div className="apg__sec">
      <Card>
        <CardHead title="Raise an invoice" sanskrit="बीजक" />
        <CardBody><InvoiceBuilder org={org} busy={busy === 'invoice'} onCreate={createInvoice} /></CardBody>
      </Card>

      <Card>
        <CardHead
          title="Invoices"
          actions={(
            <>
              <span className="apg__secn">{invoices.length}</span>
              <ColumnsButton cols={invoiceCols} />
            </>
          )}
        />
        <CardBody flush>
          {!orgId ? (
            <EmptyState
              title={{ en: 'No organisation scoped', hi: 'कोई संस्था नहीं' }}
              description="Invoices are per organisation. Choose one above."
            />
          ) : invoices.length === 0 ? (
            <EmptyState
              title={{ en: 'No invoices yet', hi: 'कोई बीजक नहीं' }}
              description="Raising one above is what puts the first row here."
            />
          ) : (
            <Table>
              <TableHead>
                {invoiceCols.columns.map(c => (
                  <HeadCell
                    key={c.id}
                    num={c.num}
                    width={c.width}
                    onResize={w => invoiceCols.setWidth(c.id, w)}
                  >
                    {c.sr ? <span className="k-sr-only">{c.label}</span> : c.label}
                  </HeadCell>
                ))}
              </TableHead>
              <TableBody>
                {invoices.map(iv => (
                  <Row key={iv.id}>
                    {invoiceCols.cells({
                      invoice: <Cell><span className="adm-kv__v is-mono">{iv.invoice_number}</span></Cell>,
                      period: <Cell>{fmtDate(iv.period_start)} → {fmtDate(iv.period_end)}</Cell>,
                      subtotal: <Cell num>{inr(iv.subtotal || 0)}</Cell>,
                      gst: <Cell num>{inr(iv.gst || 0)}</Cell>,
                      total: <Cell num>{inr(iv.total || 0)}</Cell>,
                      status: <Cell><Tag color={billingColor(iv.payment_status)}>{billingLabel(iv.payment_status)}</Tag></Cell>,
                      due: <Cell>{fmtDate(iv.due_date)}</Cell>,
                      actions: (
                        <Cell>
                          {iv.payment_status === 'pending' && (
                            <Button size="sm" variant="out" onClick={() => setPayTarget(iv)}>Record payment</Button>
                          )}
                        </Cell>
                      ),
                    })}
                  </Row>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );

  const planTab = (
    <Card>
      <CardHead title="Change plan" sanskrit="योजना बदलें" />
      <CardBody>
        <div className="adm-form">
          <Field label="Plan" htmlFor="plan-code">
            {p => (
              <Select {...p} value={planForm.plan_code} onChange={e => setPlanForm(f => ({ ...f, plan_code: e.target.value }))}>
                <option value="">— Select —</option>
                {plans.map(pl => (
                  <option key={pl.code} value={pl.code}>{pl.name} — {inr(pl.price_monthly || 0)}/mo</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Billing cycle" htmlFor="plan-cycle">
            {p => (
              <Select {...p} value={planForm.billing_cycle} onChange={e => setPlanForm(f => ({ ...f, billing_cycle: e.target.value }))}>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </Select>
            )}
          </Field>
        </div>
        {planForm.plan_code === 'free' && (
          <p className="inb__note">Moving to Free deactivates every add-on module on this organisation.</p>
        )}
        <div className="adm-actions">
          <Button
            variant="fill"
            disabled={!orgId || !planForm.plan_code || planForm.plan_code === sub?.plan_code || busy === 'plan'}
            onClick={setPlan}
          >
            {busy === 'plan' ? 'Applying…' : `Apply to ${org?.name || 'the organisation'}`}
          </Button>
        </div>
      </CardBody>
    </Card>
  );

  /* The payment form is a page-level panel, NOT a card inside the Invoices tab.
     `Tabs` renders only the active tab's content, and the overdue table that
     starts a payment lives in Overview — so a card in Invoices meant clicking
     "Record payment" on another org's overdue invoice did nothing visible at
     all. The panel also restates the scope in its own subtitle, because moving
     the scope silently is the failure 11 opens with. */
  const payPanel = payTarget && (
    <SlideOver
      open
      onClose={() => setPayTarget(null)}
      title={`Record payment · ${payTarget.invoice_number}`}
      subtitle={`Posting to ${org?.name || 'the scoped organisation'} — ${payTarget.org_name || org?.name || 'this org'} raised it.`}
    >
      <PaymentForm
        invoice={payTarget}
        busy={busy === 'payment'}
        onConfirm={recordPayment}
        onCancel={() => setPayTarget(null)}
      />
    </SlideOver>
  );

  return (
    <div className="apg">
      {pageHead}

      {scopeBar}

      <Tabs
        tabs={[
          { value: 'overview', label: 'Overview', content: overviewTab },
          { value: 'modules', label: 'Modules', count: activeModules.length, content: modulesTab },
          { value: 'invoices', label: 'Invoices', count: invoices.length, content: invoicesTab },
          { value: 'plan', label: 'Plan', content: planTab },
        ]}
      />

      {payPanel}

      {/* `mayBill` is BILLING_CONSOLE_ROLES, which is the same tuple as the
          endpoint's SAHAYAK_COMMERCIAL_ROLES (god mode + platform_manager +
          account_manager + account_finance) — checked against
          `middleware/role_tiers.py`, not assumed. The page has already refused
          everyone outside it above, so this is belt and braces. */}
      <TopUpDialog
        open={toppingUp}
        orgId={orgId}
        orgName={org?.name}
        isPlatformOrg={Boolean(org?.is_platform_org)}
        canWrite={mayBill}
        reason={mayBill ? null : 'Topping up credits needs platform owner, platform manager or account/finance access.'}
        onClose={() => setToppingUp(false)}
        onDone={refresh}
      />
    </div>
  );
}
