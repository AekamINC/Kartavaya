import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, rows as asRows } from '../../lib/api';
import { ErrorState, errorKind, EmptyState, SkeletonList, Tag } from '../../components/ui';
import { inr } from '../../lib/inr';
import { Secondary } from '../../components/Bilingual';

/**
 * CollectionsTab — what is owed, and whether the customer has actually looked
 * at the link.
 *
 * ── The three states this screen exists to separate ─────────────────────────
 *
 * In the ledger all three read as "unpaid". They are completely different
 * problems and they need different phone calls:
 *
 *   Not opened      They may never have received it. Chase the DELIVERY — wrong
 *                   number, wrong address, gone to spam. Dunning someone whose
 *                   invoice never arrived is the worst outcome on this screen.
 *   Opened          They saw it and did not pay. Chase the CUSTOMER.
 *   Tried to pay    They pressed a pay button. If nothing has landed, something
 *                   failed at their end — that is a call, not a reminder.
 *
 * ── THIS IS NOT PAYMENT STATUS AND MUST NEVER BE READ AS ONE ────────────────
 *
 * There is no payment gateway in this product. A scan means a code was rendered
 * or a button was pressed; it does not mean money moved. "Paid" arrives from
 * bank reconciliation and from nowhere else, which is why every label here is
 * about LOOKING — opened, viewed, tried — and none of them says "paying". A
 * firm that stops chasing a debt because this column looked encouraging has
 * been misled by us.
 *
 * ── Nothing was recorded before P6 ──────────────────────────────────────────
 *
 * The table is new, so an invoice sent last month shows "not opened" because
 * nobody was counting, not because nobody looked. The screen says so rather
 * than letting a zero be read as evidence.
 */

const ENGAGEMENT = {
  never_opened: { label: 'Not opened',   tone: 'var(--on-surface-3)' },
  opened:       { label: 'Opened',       tone: 'var(--st-in-review)' },
  tried_to_pay: { label: 'Tried to pay', tone: 'var(--ok)' },
};

/** "3 days ago" from an ISO timestamp. Absolute dates are unreadable in a
 *  column you are scanning for recency; the exact value is in the title. */
function ago(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return `${Math.floor(days / 30)} mo ago`;
}

export default function CollectionsTab() {
  const [rows, setRows] = useState([]);
  const [since, setSince] = useState(90);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    api.get(`/v1/ganit/collections?days=${since}`)
      .then(r => { if (alive) setRows(asRows(r)); })
      .catch(e => { if (alive) setErr(e); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [since]);

  if (loading) return <SkeletonList rows={6} showAvatar={false} />;
  if (err) return <ErrorState kind={errorKind(err)} onRetry={() => setSince(s => s)} />;

  const owed = rows.reduce((n, r) => n + Number(r.balance_due || 0), 0);
  const unseen = rows.filter(r => r.engagement === 'never_opened').length;

  return (
    <div>
      <div className="gn-bar">
        <div className="gn-bar__f">
          <span className="gn-bar__fl">Raised in the last</span>
          <select className="inp gn-bar__sel" value={since}
            onChange={e => setSince(Number(e.target.value))}>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
          </select>
        </div>
        <div className="gn-bar__sp" />
        {/* Pay gets no analytics tab of its own (owner, 2026-08-18): the
            pay-link funnel — opened, converted, time to payment — lives on
            Dristi's cross-module surface as the Payments preset, and this is
            its door. */}
        <Link
          className="k-btn k-btn--ghost k-btn--sm"
          to="/dristi?tab=analytics&preset=payments"
          aria-label="Payments analytics, in Dristi"
          title="Links opened, conversion and time to payment — opens Dristi analytics"
        >
          {/* The same bilingual run Sanvaad's door carries — the three doors
              are one affordance and must read as one. Secondary is absent
              under EN and aria-hidden otherwise, so the aria-label above
              stays the whole accessible name. */}
          Analytics <Secondary value="विश्लेषण" /> <span aria-hidden="true">↗</span>
        </Link>
      </div>

      <p className="gn-coll__lede">
        {rows.length} unpaid {rows.length === 1 ? 'invoice' : 'invoices'} ·{' '}
        <strong>{inr(owed)}</strong> outstanding
        {unseen > 0 && <> · <strong>{unseen}</strong> never opened</>}
        <Secondary className="gn-coll__hi" value="वसूली" />
      </p>

      {/* Said once, plainly, rather than letting a zero speak for itself. */}
      <p className="gn-coll__note">
        “Opened” counts only since payment links started recording. An older
        invoice can read “Not opened” because nobody was counting then. And
        opening a link is not paying — a payment appears here only once it is
        matched against your bank statement.
      </p>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing outstanding"
          body="Every issued invoice in this period has been settled."
        />
      ) : (
        <div className="gn-coll__wrap">
          <table className="gn-coll">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th className="gn-num">Due</th>
                <th className="gn-num">Outstanding</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const e = ENGAGEMENT[r.engagement] || ENGAGEMENT.never_opened;
                return (
                  <tr key={r.id}>
                    <td className="gn-mono">{r.invoice_number}</td>
                    {/* The CUSTOMER is the company. The contact is a person
                        there, and people leave — so the company leads and the
                        person is the smaller line under it. */}
                    <td>
                      {r.client_name || r.contact_name || '—'}
                      {r.client_name && r.contact_name && (
                        <span className="gn-coll__sub">{r.contact_name}</span>
                      )}
                    </td>
                    <td className="gn-num">{r.due_date || '—'}</td>
                    <td className="gn-num">{inr(r.balance_due)}</td>
                    <td>
                      <Tag color={e.tone}>{e.label}</Tag>
                      {r.last_seen && (
                        <span className="gn-coll__sub" title={r.last_seen}>
                          {ago(r.last_seen)}
                          {r.views > 1 && ` · ${r.views} views`}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
