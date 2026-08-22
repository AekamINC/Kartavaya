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
import { parseCsv, guessMapping, looksLikeHeader, toLines, FIELDS } from '../../lib/bankCsv';
import useTableView from '../../hooks/useTableView';
import TableToolbar from '../../components/ui/TableToolbar';
import { HeadCell } from '../../components/ui/Table';
import { CreatedHead, CreatedCell } from '../../components/ui/CreatedColumn';

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
  /* THE IMPORT WAS POSITIONAL. `split(',')` and take fields 0..4 — which
     imported the header row as a transaction, ignored that no Indian bank
     writes those columns in that order, and read the Withdrawal column as
     income because most statements have no signed amount at all. The flow is
     now: read the file, guess the columns, SHOW the guess, import what was
     confirmed. And the confirmed map is remembered against the bank's name, so
     next month's statement needs no mapping at all. */
  const [csvText, setCsvText] = useState('');
  const [batchLabel, setBatchLabel] = useState('');
  const [csvRows, setCsvRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [hasHeader, setHasHeader] = useState(true);
  const [bankName, setBankName] = useState('');
  const [formats, setFormats] = useState([]);
  const [formatsAvailable, setFormatsAvailable] = useState(true);
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

  const loadFormats = useCallback(async () => {
    try {
      const r = await api.get('/v1/ganit/bank-formats');
      const b = body(r);
      setFormats(b.data || []);
      setFormatsAvailable(b.available !== false);
    } catch { setFormats([]); }
  }, []);

  useEffect(() => { loadFormats(); }, [loadFormats]);

  /* Reading the file and reading pasted text are the same act — a statement
     arrives as a download, and asking the user to open it and copy its contents
     is asking them to do the computer's job. */
  function readText(text) {
    const parsed = parseCsv(text);
    setCsvRows(parsed);
    if (!parsed.length) return;
    const header = looksLikeHeader(parsed[0]);
    setHasHeader(header);
    const known = formats.find(f => f.bank_name.toLowerCase() === bankName.trim().toLowerCase());
    // A bank we have seen before brings its own map. A new one gets a guess.
    setMapping(known ? known.mapping : guessMapping(header ? parsed[0] : []));
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    readText(text);
    if (!batchLabel) setBatchLabel(file.name.replace(/\.csv$/i, ''));
  }

  function useSavedFormat(name) {
    setBankName(name);
    const known = formats.find(f => f.bank_name === name);
    if (known) {
      setMapping(known.mapping);
      setHasHeader(known.has_header);
    }
  }

  const preview = csvRows.length ? toLines(csvRows, mapping, { hasHeader }) : null;

  async function handleImport(e) {
    e.preventDefault();
    if (!preview || !preview.lines.length) {
      pushToast({ title: 'No rows could be read — check the Date column', type: 'error' });
      return;
    }
    setImporting(true);
    try {
      const r = await api.post('/v1/ganit/bank-statements/import', {
        lines: preview.lines, batch_label: batchLabel || undefined,
      });
      const d = body(r);
      pushToast({
        title: `Imported ${d.imported} lines, ${d.auto_matched} auto-matched`,
        type: 'success',
      });
      // Remembered only after an import that worked: a map that produced
      // nothing is not a map worth offering next month.
      if (bankName.trim() && formatsAvailable) {
        try {
          await api.put('/v1/ganit/bank-formats', {
            bank_name: bankName.trim(), mapping, has_header: hasHeader,
          });
          loadFormats();
        } catch { /* the import succeeded; the shortcut is not worth a scare */ }
      }
      setCsvText(''); setCsvRows([]); setMapping({}); setBatchLabel('');
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

  const view = useTableView(statements, {
    searchKeys: ['description', 'reference'],
    filters: [{ key: 'matched_type', label: 'Matched to' }],
  });
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
            <span className="fld__l">Bank</span>
            <span className="fld__hint">
              {formatsAvailable
                ? 'A bank you have imported before brings its own column map.'
                : 'Column maps cannot be saved on this database yet — the import still works.'}
            </span>
            <input className="inp" list="gn-banks" placeholder="e.g. HDFC current account"
                   value={bankName}
                   onChange={e => useSavedFormat(e.target.value)} />
            <datalist id="gn-banks">
              {formats.map(f => <option key={f.bank_name} value={f.bank_name} />)}
            </datalist>
          </label>

          <label className="fld">
            <span className="fld__l">Batch label</span>
            <input className="inp" placeholder="e.g. HDFC Jul-2026" value={batchLabel}
              onChange={e => setBatchLabel(e.target.value)} />
          </label>

          <label className="fld gn-form__wide">
            <span className="fld__l">Statement file</span>
            <span className="fld__hint">
              The CSV your bank exports, as it comes. Or paste the rows below.
            </span>
            <input className="inp" type="file" accept=".csv,text/csv" onChange={onFile} />
          </label>

          <label className="fld gn-form__wide">
            <span className="fld__l">…or paste the rows</span>
            <textarea
              className="inp gn-ta gn-ta--mono" rows={5} value={csvText}
              onChange={e => { setCsvText(e.target.value); readText(e.target.value); }}
              placeholder={'Date,Narration,Chq/Ref No,Withdrawal Amt,Deposit Amt,Closing Balance'}
            />
          </label>

          {csvRows.length > 0 && (
            <div className="gn-form__wide">
              <h5 className="gn-form__h">Which column is which</h5>
              <p className="fld__hint">
                Guessed from the headings — check it before importing. Money out
                belongs in Withdrawal, not in Amount: read the wrong way round,
                every payment imports as income.
              </p>
              <label className="fld">
                <span className="fld__l">
                  <input type="checkbox" checked={hasHeader}
                         onChange={e => setHasHeader(e.target.checked)} />
                  {' '}The first row is column headings
                </span>
              </label>
              <div className="gn-map">
                {FIELDS.map(f => (
                  <label key={f.key} className="fld">
                    <span className="fld__l">{f.label}{f.required ? ' *' : ''}</span>
                    <select
                      className="inp"
                      value={mapping[f.key] ?? ''}
                      onChange={e => setMapping({
                        ...mapping,
                        [f.key]: e.target.value === '' ? undefined : Number(e.target.value),
                      })}
                    >
                      <option value="">— Not in this statement —</option>
                      {(csvRows[0] || []).map((h, i) => (
                        <option key={i} value={i}>
                          {hasHeader ? (String(h).trim() || `Column ${i + 1}`) : `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              {preview && (
                <p className={`note ${preview.lines.length ? '' : 'note--warn'}`} role="status">
                  {preview.lines.length} row(s) ready
                  {preview.skipped.length > 0 && (
                    <> · {preview.skipped.length} skipped because no date could be
                    read (statements carry subtotal and opening-balance rows)</>
                  )}
                  {preview.lines.length > 0 && (
                    <> · first: {preview.lines[0].statement_date}, {inr(preview.lines[0].amount)}</>
                  )}
                </p>
              )}
            </div>
          )}

          <div className="gn-form__acts">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowImport(false)}>Cancel</button>
            <button type="submit" className="btn btn--fill btn--sm"
                    disabled={importing || !preview?.lines.length}>
              {importing ? 'Importing…' : `Import ${preview?.lines.length || 0} rows`}
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
        <div className="tv-card">
        <TableToolbar view={view} label="lines" />
        <div className="tbl__wrap">
          <table className="tbl">
            <thead>
              <tr>
                <HeadCell sortKey="statement_date" sort={view.sort} onSort={view.onSort}>Date</HeadCell>
                <HeadCell sortKey="description" sort={view.sort} onSort={view.onSort}>Description</HeadCell>
                <HeadCell sortKey="reference" sort={view.sort} onSort={view.onSort}>Reference</HeadCell>
                <HeadCell sortKey="amount" sort={view.sort} onSort={view.onSort} num>Amount</HeadCell>
                <HeadCell sortKey="is_reconciled" sort={view.sort} onSort={view.onSort}>Status</HeadCell>
                {/* STATEMENT DATE is the bank's date on the line; this is
                    when the line was imported into the books. On a
                    back-dated import the two differ by weeks. */}
                <CreatedHead sort={view.sort} onSort={view.onSort} />
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {view.rows.map(s => (
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
                    <CreatedCell value={s.created_at} />
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
                      <td colSpan={7}>
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
        </div>
      )}
    </div>
  );
}
