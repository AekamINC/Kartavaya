// Ganit · bank — imported statement lines and what they reconcile against.
import React, { useCallback, useEffect, useState } from 'react';
import { api, rows, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { StatTile } from '../../components/editorial';
import { EmptyState } from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonTable } from '../../components/ui/Skeleton';
import { Badge } from './_shared';
import { inr } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';

export default function BankTab() {
  const { pushToast } = useToast();
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'import statements' });
  const [statements, setStatements] = useState([]);
  const [stats, setStats] = useState(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState('');
  const [csvText, setCsvText] = useState('');
  const [batchLabel, setBatchLabel] = useState('');
  const [importing, setImporting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [busyId, setBusyId] = useState(null);
  // Manual matching had a working endpoint and no way to reach it: no button,
  // no picker, no list of payments to pick from. `matchFor` is the line whose
  // picker is open; there is only ever one, because reconciling is a decision
  // you make about one line at a time.
  const [matchFor, setMatchFor] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [candLoading, setCandLoading] = useState(false);
  const [candErr, setCandErr] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const params = {};
      if (filter === 'matched') params.reconciled = true;
      if (filter === 'unmatched') params.reconciled = false;
      const r = await api.get('/v1/ganit/bank-statements', { params });
      setStatements(rows(r));
    } catch (e) {
      // "No bank statements imported" after a failed fetch reads as "your
      // reconciliation is empty", which is a statement about the books.
      setErr(e);
      setStatements([]);
    } finally { setLoading(false); }
  }, [filter]);

  const loadStats = useCallback(async () => {
    setStatsFailed(false);
    try {
      const r = await api.get('/v1/ganit/bank-statements/stats');
      setStats(body(r));
    } catch {
      setStats(null);
      setStatsFailed(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadStats(); }, [loadStats]);

  async function handleImport(e) {
    e.preventDefault();
    if (!csvText.trim()) { pushToast({ title: 'Paste the statement rows first', type: 'error' }); return; }
    const lines = csvText.trim().split('\n').map(line => {
      const parts = line.split(',').map(s => s.trim());
      return {
        statement_date: parts[0] || '',
        description: parts[1] || '',
        reference: parts[2] || '',
        amount: parseFloat(parts[3]) || 0,
        running_balance: parseFloat(parts[4]) || 0,
      };
    });
    if (lines.length === 0) { pushToast({ title: 'No usable rows found', type: 'error' }); return; }
    setImporting(true);
    try {
      const r = await api.post('/v1/ganit/bank-statements/import', {
        lines, batch_label: batchLabel || undefined,
      });
      const d = body(r);
      pushToast({ title: `Imported ${d.imported} lines, ${d.auto_matched} auto-matched`, type: 'success' });
      setCsvText('');
      setBatchLabel('');
      setShowImport(false);
      load();
      loadStats();
    } catch (err2) {
      pushToast({ title: err2.response?.data?.detail || 'Import failed', type: 'error' });
    } finally { setImporting(false); }
  }

  async function unmatch(s) {
    setBusyId(s.id);
    try {
      await api.post(`/v1/ganit/bank-statements/${s.id}/unmatch`);
      pushToast({ title: 'Unmatched', type: 'success' });
      load();
      loadStats();
    } catch (err2) {
      pushToast({ title: err2.response?.data?.detail || 'Could not unmatch the line', type: 'error' });
    } finally { setBusyId(null); }
  }

  async function openMatch(s) {
    if (matchFor === s.id) { setMatchFor(null); return; }
    setMatchFor(s.id);
    setCandidates([]);
    setCandErr(null);
    setCandLoading(true);
    try {
      const r = await api.get(`/v1/ganit/bank-statements/${s.id}/candidates`);
      setCandidates(rows(r));
    } catch (err2) {
      setCandErr(err2);
    } finally { setCandLoading(false); }
  }

  async function confirmMatch(lineId, paymentId) {
    setBusyId(lineId);
    try {
      // `payment_id` is a query parameter on the server, not a body field.
      await api.post(`/v1/ganit/bank-statements/${lineId}/match`, null, {
        params: { payment_id: paymentId },
      });
      pushToast({ title: 'Matched', type: 'success' });
      setMatchFor(null);
      setCandidates([]);
      load();
      loadStats();
    } catch (err2) {
      // A 409 here is the server refusing to count one payment on two lines.
      // It carries the only sentence that tells the user what to do next, so it
      // is shown rather than replaced with a generic failure.
      pushToast({ title: err2.response?.data?.detail || 'Could not match the line', type: 'error' });
    } finally { setBusyId(null); }
  }

  return (
    <div>
      {stats && (
        <div className="gn-stats" style={{ '--gn-min': '160px' }}>
          <StatTile label="Total lines" value={stats.total_lines} />
          <StatTile label="Matched" sanskrit="मिलान" value={stats.matched} variant="ok" />
          <StatTile label="Unmatched" value={stats.unmatched} variant={Number(stats.unmatched) > 0 ? 'warn' : 'neutral'} />
          <StatTile label="Matched amount" value={inr(Number(stats.matched_amount || 0))} />
          <StatTile label="Unmatched amount" value={inr(Number(stats.unmatched_amount || 0))} />
        </div>
      )}
      {statsFailed && (
        // Said, not omitted. Silently dropping the strip makes a partial page
        // look like a complete one.
        <p className="note note--warn" role="status">
          The reconciliation totals could not be loaded. The statement lines below are unaffected.
        </p>
      )}

      <div className="gn-bar">
        <label className="gn-bar__f">
          <span className="gn-bar__fl">Show</span>
          <select className="inp gn-bar__sel" value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="">All lines</option>
            <option value="matched">Matched</option>
            <option value="unmatched">Unmatched</option>
          </select>
        </label>
        <span className="gn-bar__sp" />
        <button
          type="button" className="btn btn--fill btn--sm" onClick={() => setShowImport(v => !v)}
          disabled={!canWrite} title={denial || undefined}
        >
          {showImport ? 'Close' : 'Import CSV'}
        </button>
      </div>

      {showImport && canWrite && (
        <form className="gn-form" onSubmit={handleImport}>
          <h4 className="gn-form__h">Import a bank statement</h4>
          <label className="fld">
            <span className="fld__l">Batch label</span>
            <input className="inp" placeholder="e.g. HDFC Jul-2026" value={batchLabel}
              onChange={e => setBatchLabel(e.target.value)} />
          </label>
          <label className="fld gn-form__wide">
            <span className="fld__l">Statement rows</span>
            <span className="fld__hint">One per line: date, description, reference, amount, running balance.</span>
            <textarea
              className="inp gn-ta gn-ta--mono" rows={6} value={csvText}
              onChange={e => setCsvText(e.target.value)}
              placeholder={'2026-07-01,Office rent,REF001,-25000,475000\n2026-07-02,Customer receipt,UTR123,150000,625000'}
            />
          </label>
          <div className="gn-form__acts">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowImport(false)}>Cancel</button>
            <button type="submit" className="btn btn--fill btn--sm" disabled={importing}>
              {importing ? 'Importing…' : 'Import'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <SkeletonRegion label="Loading bank statements"><SkeletonTable rows={6} columns={5} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : statements.length === 0 ? (
        filter ? (
          <EmptyState
            illustration="search"
            title={{ en: `No ${filter} lines`, hi: 'कोई पंक्ति नहीं' }}
            description="Nothing sits at this state right now. Clear the filter to see every imported line."
            action="Show all lines"
            onAction={() => setFilter('')}
          />
        ) : (
          <EmptyState
            illustration="generic"
            title={{ en: 'No bank statements imported', hi: 'कोई विवरण नहीं' }}
            description="Import your bank's CSV export and Kartavaya matches the lines against invoices and bills automatically."
            action={canWrite ? 'Import CSV' : undefined}
            onAction={canWrite ? () => setShowImport(true) : undefined}
          />
        )
      ) : (
        <div className="tbl__wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Reference</th>
                <th className="tbl__num">Amount</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {statements.map(s => (
                <React.Fragment key={s.id}>
                  <tr>
                    <td className="gn-tbl__mono">{s.statement_date}</td>
                    <td>{s.description}</td>
                    <td className="gn-tbl__mono">{s.reference || '—'}</td>
                    <td className="tbl__num">{inr(Number(s.amount || 0))}</td>
                    <td>
                      {s.is_reconciled
                        ? <Badge text="Matched" color="var(--ok)" />
                        : <Badge text="Unmatched" color="var(--warn)" />}
                    </td>
                    <td>
                      {s.is_reconciled ? (
                        <button type="button" className="gn-act gn-act--danger"
                          disabled={busyId === s.id} onClick={() => unmatch(s)}>
                          {busyId === s.id ? 'Working…' : 'Unmatch'}
                        </button>
                      ) : (
                        <button
                          type="button" className="gn-act"
                          disabled={!canWrite || busyId === s.id}
                          title={denial || undefined}
                          aria-expanded={matchFor === s.id}
                          onClick={() => openMatch(s)}
                        >
                          {matchFor === s.id ? 'Close' : 'Match'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {matchFor === s.id && (
                    <tr>
                      <td colSpan={6}>
                        <div className="gn-match">
                          <p className="gn-match__h">
                            {Number(s.amount || 0) < 0
                              ? 'Payments you sent — pick the one this debit is'
                              : 'Payments you received — pick the one this credit is'}
                          </p>
                          {candLoading ? (
                            <p className="note" role="status">Loading payments…</p>
                          ) : candErr ? (
                            <ErrorState kind={errorKind(candErr)} onRetry={() => openMatch(s)} />
                          ) : candidates.length === 0 ? (
                            // Naming WHICH ledger is empty matters: "no payments"
                            // on a debit line sends the user to look at receipts.
                            <p className="note note--warn" role="status">
                              {Number(s.amount || 0) < 0
                                ? 'No unmatched vendor payments to offer. Record the payment against its bill first.'
                                : 'No unmatched receipts to offer. Record the payment against its invoice first.'}
                            </p>
                          ) : (
                            <ul className="gn-match__list">
                              {candidates.map(c => (
                                <li key={c.id} className="gn-match__row">
                                  <span className="gn-match__amt">
                                    {inr(Number(c.amount || 0))}
                                    {c.amount_matches && (
                                      <span className="gn-match__exact"> exact</span>
                                    )}
                                  </span>
                                  <span className="gn-match__meta">
                                    {c.payment_date || '—'}
                                    {c.document ? ` · ${c.document}` : ''}
                                    {c.party ? ` · ${c.party}` : ''}
                                    {c.reference ? ` · ${c.reference}` : ''}
                                  </span>
                                  <button
                                    type="button" className="gn-act"
                                    disabled={busyId === s.id}
                                    onClick={() => confirmMatch(s.id, c.id)}
                                  >
                                    {busyId === s.id ? 'Working…' : 'Match this'}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
