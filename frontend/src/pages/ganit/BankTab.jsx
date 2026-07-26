import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { StatTile } from '../../components/editorial';
import { Badge } from './_shared';
import { inr } from '../../lib/inr';

export default function BankTab() {
  const { pushToast } = useToast();
  const [statements, setStatements] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [csvText, setCsvText] = useState('');
  const [batchLabel, setBatchLabel] = useState('');
  const [importing, setImporting] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const FMT = v => inr(Number(v || 0));

  useEffect(() => { load(); loadStats(); }, []);

  async function load() {
    try {
      let url = '/v1/ganit/bank-statements?';
      if (filter === 'matched') url += 'reconciled=true&';
      if (filter === 'unmatched') url += 'reconciled=false&';
      const r = await api.get(url);
      setStatements(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load bank statements', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadStats() {
    try {
      const r = await api.get('/v1/ganit/bank-statements/stats');
      setStats(r.data);
    } catch {}
  }

  async function handleImport(e) {
    e.preventDefault();
    if (!csvText.trim()) { pushToast({ title: 'Paste CSV data first', type: 'error' }); return; }
    const lines = csvText.trim().split('\n').map(line => {
      const parts = line.split(',').map(s => s.trim());
      return { statement_date: parts[0] || '', description: parts[1] || '', reference: parts[2] || '', amount: parseFloat(parts[3]) || 0, running_balance: parseFloat(parts[4]) || 0 };
    });
    if (lines.length === 0) { pushToast({ title: 'No valid lines found', type: 'error' }); return; }
    setImporting(true);
    try {
      const r = await api.post('/v1/ganit/bank-statements/import', { lines, batch_label: batchLabel || undefined });
      pushToast({ title: `Imported ${r.data.imported} lines, ${r.data.auto_matched} auto-matched`, type: 'success' });
      setCsvText('');
      setBatchLabel('');
      setShowImport(false);
      load();
      loadStats();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Import failed', type: 'error' }); }
    finally { setImporting(false); }
  }

  async function unmatch(id) {
    try {
      await api.post(`/v1/ganit/bank-statements/${id}/unmatch`);
      pushToast({ title: 'Unmatched', type: 'success' });
      load();
      loadStats();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Unmatch failed', type: 'error' }); }
  }

  return (
    <div>
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 20 }}>
          <StatTile label="Total Lines" value={stats.total_lines} />
          <StatTile label="Matched" value={stats.matched} />
          <StatTile label="Unmatched" value={stats.unmatched} />
          <StatTile label="Matched Amount" value={FMT(stats.matched_amount)} />
          <StatTile label="Unmatched Amount" value={FMT(stats.unmatched_amount)} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <select className="k-input" style={{ width: 150 }} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="">All</option>
          <option value="matched">Matched</option>
          <option value="unmatched">Unmatched</option>
        </select>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowImport(true)}>Import CSV</button>
      </div>

      {showImport && (
        <form onSubmit={handleImport} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Import Bank Statement</h4>
          <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Batch Label</span>
            <input className="k-input" placeholder="e.g. HDFC Jul-2026" value={batchLabel} onChange={e => setBatchLabel(e.target.value)} style={{ marginBottom: 12 }} /></label>
          <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>CSV Data (date, description, reference, amount, balance — one per line)</span>
            <textarea className="k-input" rows={6} value={csvText} onChange={e => setCsvText(e.target.value)}
              placeholder="2026-07-01,Office rent,REF001,25000,475000&#10;2026-07-02,Client payment,UTR123,150000,625000"
              style={{ resize: 'vertical', width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12 }} /></label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowImport(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={importing}>{importing ? 'Importing…' : 'Import'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        statements.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🏦</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No bank statements imported</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Import CSV statements from your bank to reconcile payments automatically.</div>
          </div>
        ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Date', 'Description', 'Reference', 'Amount', 'Status', ''].map(h => (
                <th key={h} style={{ textAlign: h === 'Amount' ? 'right' : 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {statements.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: '10px', fontSize: 12 }}>{s.statement_date}</td>
                <td style={{ padding: '10px' }}>{s.description}</td>
                <td style={{ padding: '10px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{s.reference || '—'}</td>
                <td className="mtbl__num" style={{ padding: '10px', fontWeight: 600 }}>{FMT(s.amount)}</td>
                <td style={{ padding: '10px' }}>
                  {s.is_reconciled ? <Badge text="Matched" color="var(--ok)" /> : <Badge text="Unmatched" color="var(--warn)" />}
                </td>
                <td style={{ padding: '10px' }}>
                  {s.is_reconciled && (
                    <button onClick={() => unmatch(s.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 11 }}>Unmatch</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
