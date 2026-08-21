import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Card, CardBody, CardHead, Cell, EmptyState, ErrorState, errorKind,
  HeadCell, Modal, Row, Select, SkeletonTable, StatTile, Table, TableBody,
  TableHead, Tag,
} from '../../components/ui';
import { api } from '../../lib/api';
import { currentUser } from '../../lib/auth';
import { grouped, inr } from '../../lib/inr';
import { formatDate } from '../../lib/timeFormat';
import { canManageBilling } from '../admin/platformRoles';
import MemberCeilingModal from './MemberCeilingModal';
import OutboundLog from './OutboundLog';
import SpendByPerson from './SpendByPerson';
import UsageBySource, {
  CREDIT_PRICE_INR, CreditFigure, indicativeInr, sourceLabel,
} from './UsageBySource';
import '../../styles/billing.css';

/**
 * BillingUsageSection — the billing section people actually look at.
 *
 * ONE component, TWO mounts. An org admin opens it at `/settings/organisation`
 * over their own org; Aekam opens it at `/admin/usage` over any org including
 * itself. What differs is `basePath`:
 *
 *     /v1/billing/me                 the caller's org, resolved from X-Org-Id
 *     /v1/billing/orgs/{org_id}      any org, named in the path
 *
 * — and `upiOnInvoices`, which only the tenant mount can answer, because only
 * that page has read the invoices it describes. It is spent in one place, at
 * the foot of the billing-lines card, and the argument is made there.
 *
 * Aekam's "view of itself" is therefore not a third code path — it is this
 * component pointed at Aekam's own org id. Forking it would guarantee the two
 * views drift, and the whole point of the exercise is that Aekam sees itself the
 * way its clients see themselves.
 *
 * ── What the numbers are, and what they are not ─────────────────────────────
 *
 * Everything here is CREDITS, because credits are what the ledger holds. The
 * rupee figure beside each total is `credits × CREDIT_PRICE_INR` and is labelled
 * indicative every time it appears: it is not an amount due, it is not what any
 * invoice says, and nothing downstream should read it as either. An invoice is a
 * query over `org_billing_lines`, which is the read-only block at the bottom of
 * this section.
 *
 * ── Why `wallet` is not a usage tab ─────────────────────────────────────────
 *
 * The API's source taxonomy includes `wallet` — top-ups and period grants. Those
 * are movements of the balance, not consumption, and adding them to a spend
 * total produces a number that means nothing. They are rendered beside the
 * balance, where they belong, and are excluded from the tab set. That is the one
 * place this file overrides the server's list, and it is a statement about
 * meaning rather than a hard-coded tab list — every other tab is whatever
 * `sources[]` contained.
 */

/* ── Period arithmetic ──────────────────────────────────────────────────────
   Built from the YYYY-MM string rather than through `new Date(iso)`, on purpose.
   `new Date('2026-08-01')` is parsed as UTC midnight and then rendered in the
   reader's local zone, so west of Greenwich the picker would offer "Jul 2026"
   for the month whose value is `2026-08`. A billing period cannot be off by one
   because of where somebody is sitting. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** The current month, UTC — the same grain `credits.current_period()` uses. */
function currentPeriod() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthOptions(count = 12) {
  const now = new Date();
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const periodLabel = (ym) => {
  const [y, m] = String(ym || '').split('-');
  return MONTHS[Number(m) - 1] ? `${MONTHS[Number(m) - 1]} ${y}` : String(ym || '—');
};

/**
 * The first of the month AFTER the one the allowance was granted for — the day
 * it resets to zero. Absolute, never "next month": a relative date in a sentence
 * about money is a date the reader has to work out while worried.
 */
function resetDate(periodStartIso) {
  const [y, m] = String(periodStartIso || '').split('-').map(Number);
  if (!y || !m) return null;
  const year = m === 12 ? y + 1 : y;
  const month = m === 12 ? 1 : m + 1;
  return `1 ${LONG_MONTHS[month - 1]} ${year}`;
}

/** The server's own words. Never parsed, never re-written. */
function refusalMessage(err, fallback) {
  const detail = err?.response?.data?.detail;
  if (detail && typeof detail === 'object' && detail.message) return detail.message;
  if (typeof detail === 'string' && detail) return detail;
  return fallback;
}

export default function BillingUsageSection({ basePath, upiOnInvoices = null }) {
  const [period, setPeriod] = useState(currentPeriod);
  const [sources, setSources] = useState(null);
  const [balance, setBalance] = useState(null);
  const [lines, setLines] = useState(null);
  const [linesFailed, setLinesFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [activeSource, setActiveSource] = useState('');
  const [peopleScope, setPeopleScope] = useState('source');
  const [people, setPeople] = useState(null);
  const [peopleErr, setPeopleErr] = useState('');

  const [selectedPerson, setSelectedPerson] = useState(null);
  const [drill, setDrill] = useState(null);
  const [ceilingFor, setCeilingFor] = useState(null);

  /**
   * Who may raise or remove a ceiling, mirroring the two server guards rather
   * than guessing one for both surfaces:
   *
   *   PUT /v1/billing/me/members/{u}/cap            require_org_role(org_owner, org_admin)
   *   PUT /v1/billing/orgs/{id}/members/{u}/cap     BILLING_CONSOLE_ROLES
   *
   * Derived from `basePath` so the component still takes one prop. A control
   * that 403s is worse than an absent one, and both pages already refuse up
   * front — this only stops the button appearing for the operator who can read
   * the console but not act on it.
   */
  const me = currentUser();
  const isTenantView = basePath.endsWith('/me');
  const maySetCeiling = isTenantView
    ? (me?.org_roles || []).some(r => r.role_code === 'org_owner' || r.role_code === 'org_admin')
    : canManageBilling(me?.platform_roles);

  const load = useCallback(async () => {
    setErr(null);
    setLinesFailed(false);
    const [src, bal, lns] = await Promise.all([
      api.get(`${basePath}/usage/sources`, { params: { period } }),
      api.get(`${basePath}/balance`),
      api.get(`${basePath}/lines`, { params: { period } }).catch(() => null),
    ]);
    setSources(src.data || null);
    setBalance(bal.data || null);
    if (lns) setLines(lns.data || null); else { setLines(null); setLinesFailed(true); }
  }, [basePath, period]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    load()
      .catch(e => { if (live) setErr(e); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [load]);

  /* `wallet` is a balance movement, not consumption — see the file header. */
  const usageSources = useMemo(
    () => (sources?.sources || []).filter(s => s.source !== 'wallet'),
    [sources],
  );
  const walletSource = useMemo(
    () => (sources?.sources || []).find(s => s.source === 'wallet') || null,
    [sources],
  );

  /**
   * The tab actually shown. DERIVED rather than corrected in an effect, and that
   * is the difference between one request and two: an effect would leave the
   * person table asking `/usage/people` for the render in between the sources
   * arriving and the correction landing, then immediately ask again scoped. It
   * also survives a month change that removes the chosen source — `scrapers` has
   * a tab in a month something scraped and none in a month nothing did.
   */
  const shownSource = usageSources.some(s => s.source === activeSource)
    ? activeSource
    : (usageSources[0]?.source || '');

  const sourcesLoaded = sources !== null;
  const scopedToSource = peopleScope === 'source' && Boolean(shownSource);

  const loadPeople = useCallback(async () => {
    // Nothing to scope by until the sources are in. Asking early would fetch the
    // org-wide split and then throw it away one render later.
    if (!sourcesLoaded) return;
    setPeopleErr('');
    const url = scopedToSource
      ? `${basePath}/usage/sources/${encodeURIComponent(shownSource)}/people`
      : `${basePath}/usage/people`;
    try {
      const res = await api.get(url, { params: { period } });
      setPeople(res.data || null);
    } catch (e) {
      setPeople(null);
      setPeopleErr(refusalMessage(e, 'Couldn’t load who spent what. The figures above are unaffected.'));
    }
  }, [basePath, period, shownSource, scopedToSource, sourcesLoaded]);

  useEffect(() => { loadPeople(); }, [loadPeople]);

  const capsByUser = useMemo(() => {
    const out = {};
    for (const m of balance?.members || []) out[m.user_id] = m;
    return out;
  }, [balance]);

  const bal = balance?.balance || null;
  const isPlatformOrg = Boolean(bal?.is_platform_org);
  /* NOT the same question as `isPlatformOrg`, and the two are easy to confuse.
     `isPlatformOrg` asks whether the org BEING VIEWED is Aekam (unlimited
     balance). `platformView` asks who is DOING the viewing: `/v1/billing/me`
     is a firm reading its own console, `/v1/billing/orgs/{id}` is Aekam
     reading a customer's. Aekam must not be shown a customer's contact
     addresses, so the second suppresses them. Same derivation as
     OutboundLog's. */
  const platformView = /\/billing\/orgs\//.test(basePath || '');
  /* Empty when nothing is scoped. `sourceLabel(undefined)` answers 'Unknown',
     which on the disabled scope button reads as a source that exists and could
     not be named rather than as no spend at all. */
  const activeLabel = shownSource
    ? sourceLabel(usageSources.find(s => s.source === shownSource))
    : '';

  if (loading) return <SkeletonTable rows={6} />;
  if (err) {
    return (
      <ErrorState
        kind={errorKind(err)}
        /* Name the grant this surface's reader would actually need. The same
           component refuses two different audiences, and "you need org admin"
           sends an Aekam finance operator to ask the wrong person. */
        grant={isTenantView
          ? 'org owner or org admin on this organisation'
          : 'platform owner or account/finance access'}
        detail={refusalMessage(err, undefined)}
        onRetry={() => { setLoading(true); load().catch(setErr).finally(() => setLoading(false)); }}
      />
    );
  }

  const total = Number(sources?.total_credits) || 0;
  const unitemised = Number(sources?.unitemised_credits) || 0;

  const periodBar = (
    <div className="bl__bar">
      <label className="bl__bar-l" htmlFor="billing-period">Period</label>
      <Select
        id="billing-period"
        value={period}
        onChange={e => { setSelectedPerson(null); setPeriod(e.target.value); }}
      >
        {monthOptions().map(ym => <option key={ym} value={ym}>{periodLabel(ym)}</option>)}
      </Select>
      <span className="bl__sub">
        A billing period is a calendar month, because that is what an allowance is
        granted for. Every figure below is credits; the ₹ beside one is indicative at
        ₹{CREDIT_PRICE_INR} per credit and is not an amount due.
      </span>
    </div>
  );

  const balanceCard = (
    <Card>
      <CardHead title="Balance" sanskrit="शेष" />
      <CardBody>
        <div className="bl__stats">
          <StatTile
            label="Allowance"
            value={isPlatformOrg ? 'Unlimited' : grouped(bal?.allowance || 0)}
            sub={bal?.period_start
              ? `Resets ${resetDate(bal.period_start)} — no carry-over`
              : 'Resets monthly — no carry-over'}
          />
          <StatTile
            label="Purchased"
            value={grouped(bal?.purchased || 0)}
            sub="Carries over — never expires"
            variant={Number(bal?.purchased) > 0 ? 'ok' : 'neutral'}
          />
          <StatTile
            label="Total held"
            value={isPlatformOrg ? 'Unlimited' : grouped(bal?.total || 0)}
            variant={!isPlatformOrg && Number(bal?.total) <= 0 ? 'danger' : 'neutral'}
          />
          <StatTile
            label="Spent this period"
            value={grouped(total)}
            sub={`${indicativeInr(total)} indicative`}
          />
        </div>

        {isPlatformOrg && (
          <p className="bl__note">
            <Tag color="var(--warn)">Metered only</Tag>
            Recorded, not deducted — this organisation’s wallet is unlimited. Ceilings
            still bind, and every spend is still written to the ledger.
          </p>
        )}

        {unitemised > 0 && (
          <p className="bl__note">
            {grouped(unitemised)} of the credits spent this period have no source recorded.
            They are in the “Before spend was itemised” tab and are not guessed into a
            source anywhere on this page.
          </p>
        )}

        {walletSource && (
          <div className="bl__wallet">
            <h4 className="bl__t">Wallet movements this period</h4>
            <p className="bl__note">
              Top-ups and period grants. These move the balance and are never added into
              a spend total.
            </p>
            <Table className="bl__tbl">
              <TableHead>
                <HeadCell>Movement</HeadCell>
                <HeadCell num>Credits</HeadCell>
                <HeadCell num>Transactions</HeadCell>
              </TableHead>
              <TableBody>
                {(walletSource.items || []).map(it => (
                  <Row key={it.ref_id || it.label}>
                    <Cell>{it.label || 'Other usage'}</Cell>
                    <Cell num>{grouped(it.credits || 0)}</Cell>
                    <Cell num>{grouped(it.tx_count || 0)}</Cell>
                  </Row>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardBody>
    </Card>
  );

  const sourcesCard = (
    <Card>
      <CardHead
        title="Where the credits went"
        sanskrit="व्यय"
        actions={<span className="bl__sub">{periodLabel(period)}</span>}
      />
      <CardBody>
        <UsageBySource
          sources={usageSources}
          active={shownSource}
          onActive={v => { setActiveSource(v); setSelectedPerson(null); }}
          isPlatformOrg={isPlatformOrg}
        />
      </CardBody>
    </Card>
  );

  const shownPeople = selectedPerson
    ? (people?.people || []).filter(p => p.user_id === selectedPerson)
    : (people?.people || []);

  const peopleCard = (
    <Card>
      <CardHead
        title="Who spent what"
        sanskrit="किसने"
        actions={(
          <div className="seg" role="group" aria-label="Spend by person, scope">
            <button
              type="button"
              className={`seg__b${peopleScope === 'source' ? ' on' : ''}`}
              onClick={() => setPeopleScope('source')}
              disabled={!shownSource}
            >
              {activeLabel || 'Active source'}
            </button>
            <button
              type="button"
              className={`seg__b${peopleScope === 'all' ? ' on' : ''}`}
              onClick={() => setPeopleScope('all')}
            >
              Every source
            </button>
          </div>
        )}
      />
      <CardBody>
        {peopleErr && <p className="bl__err" role="alert">{peopleErr}</p>}
        {selectedPerson && (
          <p className="bl__filter">
            Filtered to one person.
            <Button size="sm" variant="text" onClick={() => setSelectedPerson(null)}>
              Show everyone
            </Button>
          </p>
        )}
        {/* `people` is null until its own request lands, which is one render
            AFTER the sources it is scoped by. Handing that null to the table
            renders "Nobody spent anything here" — a claim about somebody's
            spending, made before it has been read. */}
        {people === null && !peopleErr ? <SkeletonTable rows={4} /> : (
          <SpendByPerson
            people={shownPeople}
            total={Number(people?.total_credits) || 0}
            caps={capsByUser}
            commitment={balance?.commitment || null}
            isPlatformOrg={isPlatformOrg}
            platformView={platformView}
            selected={selectedPerson}
            onSelect={setSelectedPerson}
            onDrill={(userId, name) => setDrill({ userId, name })}
            onSetCeiling={(p, cap) => setCeilingFor({ person: p, cap })}
            maySetCeiling={maySetCeiling}
            scopeLabel={scopedToSource ? activeLabel : null}
          />
        )}
      </CardBody>
    </Card>
  );

  const linesCard = (
    <Card>
      <CardHead title="What this organisation is billed" sanskrit="बीजक" />
      <CardBody flush>
        {linesFailed ? (
          <p className="bl__note bl__note--pad">
            Couldn’t load the billing lines. Credits and usage above are unaffected —
            they come from a different read.
          </p>
        ) : (lines?.data || []).length === 0 ? (
          <EmptyState
            title={{ en: 'No billing lines for this period', hi: 'कोई पंक्ति नहीं' }}
            description="A platform fee, a support plan or a one-off appears here once Aekam records it."
          />
        ) : (
          <>
            <Table className="bl__tbl">
              <TableHead>
                <HeadCell>Line</HeadCell>
                <HeadCell>Description</HeadCell>
                <HeadCell num>Amount</HeadCell>
                <HeadCell>Cadence</HeadCell>
                <HeadCell>From</HeadCell>
                <HeadCell>Until</HeadCell>
              </TableHead>
              <TableBody>
                {(lines?.data || []).map(l => (
                  <Row key={l.id} className={l.period_end ? 'bl__off' : ''}>
                    <Cell><span className="bl__item">{l.kind}</span></Cell>
                    <Cell>{l.description}</Cell>
                    <Cell num>{inr(l.amount || 0)}</Cell>
                    <Cell>{l.cadence === 'one_off' ? 'One-off' : 'Monthly'}</Cell>
                    <Cell>{formatDate(l.period_start)}</Cell>
                    <Cell>{l.period_end ? formatDate(l.period_end) : 'Open'}</Cell>
                  </Row>
                ))}
              </TableBody>
            </Table>
            <p className="bl__tot">
              {inr(lines?.monthly_total || 0)}/month recurring ·{' '}
              {inr(lines?.one_off_total || 0)} one-off this period.
            </p>
          </>
        )}

        {/* HOW ANY OF THIS IS PAID.
            This sentence stood here once and was taken out rather than shipped
            as a lie: the invoice ROW carried `upi_vpa` and the API returned it,
            but the invoice table above printed six columns and none of them was
            the payee. A client who read the promise went looking, found nothing,
            and the next thing they doubted was the amount. `TabBilling.jsx` now
            renders the payee per invoice, so it goes back in — and it is made
            over what that table can actually show, not over the mechanism in
            general. There is nothing to gain by being right in principle on the
            one screen a client checks before paying.

            OUTSIDE the branches above on purpose. This is a fact about invoices,
            and it does not stop being true in the month an org happens to have
            no recurring lines, or in the request where reading them failed.

            `null` on the `/admin/usage` mount, which reads a client's LINES and
            has never read that client's invoices. Silence there is the honest
            answer rather than an omission: an Aekam operator is not the person
            about to pay, and this component will not assert something it was
            not told. */}
        {upiOnInvoices === 'all' && (
          <p className="bl__note bl__note--pad">
            Invoices carry UPI details — there is no payment gateway.
          </p>
        )}
        {upiOnInvoices === 'some' && (
          <p className="bl__note bl__note--pad bl__note--warn">
            There is no payment gateway: an invoice is paid by UPI to the payee printed
            on it. Some of your outstanding invoices were issued without one and are
            marked “No UPI address” above — Aekam has to give you payment details for
            those.
          </p>
        )}
        {upiOnInvoices === 'none' && (
          <p className="bl__note bl__note--pad bl__note--warn">
            There is no payment gateway, and none of your outstanding invoices carries a
            UPI address. Ask Aekam for payment details before settling any of them.
          </p>
        )}
      </CardBody>
    </Card>
  );

  return (
    <div className="bl">
      {periodBar}
      {balanceCard}
      {sourcesCard}
      {peopleCard}
      {/* WHAT WAS ACTUALLY DONE FOR THE MONEY, between what it cost and what
          the client is charged, because that is where the question sits. It
          FETCHES ITS OWN DATA rather than joining `load()` above: a database
          whose outbound-log migration has not landed must lose this block and
          nothing else, and `load()` fails the whole section if any one of its
          requests does. It takes `period` so the month picker at the top
          governs it like everything else under that heading. */}
      <OutboundLog basePath={basePath} period={period} />
      {linesCard}

      <TransactionDrill
        drill={drill}
        basePath={basePath}
        period={period}
        source={scopedToSource ? shownSource : ''}
        sourceLabelText={scopedToSource ? activeLabel : 'every source'}
        onClose={() => setDrill(null)}
      />

      <MemberCeilingModal
        open={Boolean(ceilingFor)}
        person={ceilingFor?.person || null}
        cap={ceilingFor?.cap || null}
        basePath={basePath}
        onClose={() => setCeilingFor(null)}
        onSaved={() => { setCeilingFor(null); load().catch(() => {}); }}
      />
    </div>
  );
}

/**
 * The drill-down: the ledger rows behind one person's figure.
 *
 * `kind` is NULL on the 171 rows written before migration 095, and this is the
 * one surface that shows their `description` — because for those rows it is the
 * only record of what happened, and hiding it would leave a number with nothing
 * behind it. Nothing on this page PARSES a description; it is displayed as the
 * free text it is.
 */
function TransactionDrill({ drill, basePath, period, source, sourceLabelText, onClose }) {
  const [rows, setRows] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [failed, setFailed] = useState('');

  const userId = drill?.userId || '';

  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    setRows(null);
    setFailed('');
    api.get(`${basePath}/usage/transactions`, {
      params: { period, source: source || undefined, user_id: userId, limit: 200 },
    })
      .then(r => { if (!live) return; setRows(r.data?.data || []); setTruncated(Boolean(r.data?.truncated)); })
      .catch(e => { if (live) setFailed(refusalMessage(e, 'Couldn’t load these transactions.')); });
    return () => { live = false; };
  }, [basePath, period, source, userId]);

  return (
    <Modal
      open={Boolean(drill)}
      onOpenChange={v => { if (!v) onClose(); }}
      title={drill ? `${drill.name} · ${periodLabel(period)}` : 'Transactions'}
      dataTestId="usage-transactions"
      size="lg"
    >
      <p className="bl__sub">Every credit movement recorded against this person in {sourceLabelText}.</p>
      {failed && <p className="bl__err" role="alert">{failed}</p>}
      {!failed && rows === null && <SkeletonTable rows={5} />}
      {rows && rows.length === 0 && (
        <EmptyState
          title={{ en: 'No transactions', hi: 'कोई लेनदेन नहीं' }}
          description="Nothing was recorded against this person in this period."
        />
      )}
      {rows && rows.length > 0 && (
        <>
          <Table className="bl__tbl">
            <TableHead>
              <HeadCell>When</HeadCell>
              <HeadCell>What</HeadCell>
              <HeadCell>Recorded as</HeadCell>
              <HeadCell num>Qty</HeadCell>
              <HeadCell num>Credits</HeadCell>
              <HeadCell num>Balance after</HeadCell>
            </TableHead>
            <TableBody>
              {rows.map(t => (
                <Row key={t.id}>
                  <Cell>{formatDate(t.created_at)}</Cell>
                  <Cell>
                    <span className="bl__item">{t.kind || 'Not itemised'}</span>
                    {t.ref_id && <span className="bl__ref">{t.ref_id}</span>}
                    {!t.kind && <span className="bl__ref">{t.description}</span>}
                  </Cell>
                  <Cell>
                    <Tag color={t.tx_type === 'debit' ? 'var(--on-surface-3)' : 'var(--ok)'}>
                      {t.tx_type}
                    </Tag>
                    {t.metered_only && <Tag color="var(--warn)">metered only</Tag>}
                  </Cell>
                  <Cell num>{grouped(t.quantity || 0)}</Cell>
                  <Cell num><CreditFigure credits={t.amount} txCount={1} showInr={false} /></Cell>
                  <Cell num>{t.metered_only ? '—' : grouped(t.balance_after || 0)}</Cell>
                </Row>
              ))}
            </TableBody>
          </Table>
          {truncated && (
            <p className="bl__note bl__note--pad">
              The 200 most recent are shown. There are more in this period.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
