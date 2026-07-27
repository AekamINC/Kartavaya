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

export default function BankTab() {
  const { pushToast } = useToast();
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
        <button type="button" className="btn btn--fill btn--sm" onClick={() => setShowImport(v => !v)}>
          {showImport ? 'Close' : 'Import CSV'}
        </button>
      </div>

      {showImport && (
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
            action="Import CSV"
            onAction={() => setShowImport(true)}
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
                <tr key={s.id}>
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
                    {s.is_reconciled && (
                      <button type="button" className="gn-act gn-act--danger"
                        disabled={busyId === s.id} onClick={() => unmatch(s)}>
                        {busyId === s.id ? 'Working…' : 'Unmatch'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
