import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, Card } from '../components/editorial';

const CATEGORY_LABELS = {
  social: 'Social Media', leads: 'Lead Generation', seo: 'SEO & Search',
  linkedin: 'LinkedIn', google_ads: 'Google Ads', meta_ads: 'Meta Ads',
  ecommerce: 'E-commerce', govindia: 'GovIndia (MCA/GST)', whatsapp: 'WhatsApp',
  enrichment: 'Contact Enrichment',
};
const STATUS_COLORS = { pending: '#f59e0b', running: '#0082c6', succeeded: '#10b981', failed: '#ef4444' };

export default function ScrapersPage() {
  const [tab, setTab] = useState('catalog');
  const [pendingRunId, setPendingRunId] = useState(null);
  const tabs = ['catalog', 'runs'];

  return (
    <div style={{ padding: '0 0 48px' }}>
      <PageHeader title="Data Tools · डेटा" subtitle="Scrape leads, profiles & insights from the web" />
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--rule-soft)' }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? 'var(--k-primary)' : 'var(--ink-3)',
              borderBottom: tab === t ? '2px solid var(--k-primary)' : '2px solid transparent',
              background: 'none', border: 'none', cursor: 'pointer', textTransform: 'capitalize' }}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'catalog' && <CatalogTab onViewResult={id => { setPendingRunId(id); setTab('runs'); }} />}
      {tab === 'runs' && <RunsTab initialRunId={pendingRunId} onConsumeInitial={() => setPendingRunId(null)} />}
    </div>
  );
}

function CatalogTab({ onViewResult }) {
  const { pushToast } = useToast();
  const [scrapers, setScrapers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [inputs, setInputs] = useState({});
  const [running, setRunning] = useState(false);
  const [activeRun, setActiveRun] = useState(null); // { id, status, error }

  useEffect(() => {
    api.get('/v1/scrapers/catalog')
      .then(r => setScrapers(r.data.data || []))
      .catch(() => pushToast({ title: 'Failed to load scrapers', type: 'error' }))
      .finally(() => setLoading(false));
  }, []);

  function selectScraper(s) {
    setSelected(s);
    const defaults = {};
    (s.input_schema || []).forEach(f => { if (f.default) defaults[f.name] = f.default; });
    setInputs(defaults);
  }

  async function runScraper() {
    if (!selected) return;
    setRunning(true);
    try {
      const r = await api.post('/v1/scrapers/run', { scraper_id: selected.id, inputs });
      pushToast({ title: `Started! Billed ₹${r.data.billed_inr}`, type: 'success' });
      setActiveRun({ id: r.data.run_id, status: 'running' });
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Failed to start', type: 'error' });
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    if (!activeRun || activeRun.status !== 'running') return;
    const interval = setInterval(async () => {
      try {
        const r = await api.get(`/v1/scrapers/runs/${activeRun.id}`);
        if (r.data.status !== 'running' && r.data.status !== 'pending') {
          setActiveRun({ id: activeRun.id, status: r.data.status, error: r.data.error, result_count: r.data.result_count });
        }
      } catch {}
    }, 4000);
    return () => clearInterval(interval);
  }, [activeRun]);

  function closeModal() {
    setSelected(null);
    setInputs({});
    setActiveRun(null);
  }

  function viewResult() {
    onViewResult(activeRun.id);
    closeModal();
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading...</p>;

  const grouped = {};
  scrapers.forEach(s => {
    const cat = s.category || 'general';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(s);
  });

  return (
    <div>
      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget && !activeRun) closeModal(); }}>
          <div style={{ background: 'var(--bg)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480,
            border: '1px solid var(--rule-soft)', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 28 }}>{selected.icon}</span>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{selected.name}</h3>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>{selected.description}</p>
              </div>
            </div>

            {activeRun ? (
              <div style={{ textAlign: 'center', padding: '20px 8px' }}>
                {activeRun.status === 'running' && (
                  <>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
                    <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Running…</p>
                    <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>This can take a minute or two. Feel free to close this and check the Runs tab later.</p>
                  </>
                )}
                {activeRun.status === 'succeeded' && (
                  <>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                    <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Done — {activeRun.result_count} result{activeRun.result_count === 1 ? '' : 's'}</p>
                  </>
                )}
                {activeRun.status === 'failed' && (
                  <>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
                    <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: '#ef4444' }}>Run failed</p>
                    {activeRun.error && <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>{activeRun.error}</p>}
                  </>
                )}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 20 }}>
                  <button onClick={closeModal}
                    style={{ padding: '8px 20px', fontSize: 13, borderRadius: 8, background: 'var(--surface-1)',
                      border: '1px solid var(--rule-soft)', cursor: 'pointer' }}>Close</button>
                  {activeRun.status === 'succeeded' && (
                    <button onClick={viewResult}
                      style={{ padding: '8px 24px', fontSize: 13, fontWeight: 700, borderRadius: 8,
                        background: 'var(--k-primary)', color: '#fff', border: 'none', cursor: 'pointer' }}>
                      View Result →
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div style={{ background: 'var(--surface-1)', borderRadius: 8, padding: '10px 14px', marginBottom: 16,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                  <span style={{ color: 'var(--ink-3)' }}>Price per run</span>
                  <span style={{ fontWeight: 700, color: 'var(--k-primary)', fontSize: 16 }}>₹{Number(selected.price_inr).toFixed(0)}</span>
                </div>

                {(selected.input_schema || []).map(field => (
                  <label key={field.name} style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
                    <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      {field.label} {field.required && <span style={{ color: '#ef4444' }}>*</span>}
                    </span>
                    {field.type === 'textarea' ? (
                      <textarea className="k-input" rows={4} placeholder={field.placeholder || ''}
                        value={inputs[field.name] || ''} onChange={e => setInputs({ ...inputs, [field.name]: e.target.value })} />
                    ) : field.type === 'number' ? (
                      <input className="k-input" type="number" placeholder={field.placeholder || ''}
                        value={inputs[field.name] || ''} onChange={e => setInputs({ ...inputs, [field.name]: e.target.value })} />
                    ) : (
                      <input className="k-input" placeholder={field.placeholder || ''}
                        value={inputs[field.name] || ''} onChange={e => setInputs({ ...inputs, [field.name]: e.target.value })} />
                    )}
                  </label>
                ))}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                  <button onClick={closeModal}
                    style={{ padding: '8px 20px', fontSize: 13, borderRadius: 8, background: 'var(--surface-1)',
                      border: '1px solid var(--rule-soft)', cursor: 'pointer' }}>Cancel</button>
                  <button onClick={runScraper} disabled={running}
                    style={{ padding: '8px 24px', fontSize: 13, fontWeight: 700, borderRadius: 8,
                      background: 'var(--k-primary)', color: '#fff', border: 'none', cursor: 'pointer',
                      opacity: running ? 0.6 : 1 }}>
                    {running ? 'Starting...' : `Run · ₹${Number(selected.price_inr).toFixed(0)}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            {CATEGORY_LABELS[cat] || cat}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {items.map(s => (
              <button key={s.id} onClick={() => selectScraper(s)}
                style={{ textAlign: 'left', padding: 18, borderRadius: 12, cursor: 'pointer',
                  background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', transition: 'border-color .15s' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 24 }}>{s.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{s.description}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8,
                  paddingTop: 8, borderTop: '1px solid var(--rule-soft)' }}>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Up to {s.max_results} results</span>
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--k-primary)' }}>₹{Number(s.price_inr).toFixed(0)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}


function RunsTab({ initialRunId, onConsumeInitial }) {
  const { pushToast } = useToast();
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [polling, setPolling] = useState(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => {
    api.get('/v1/scrapers/runs')
      .then(r => setRuns(r.data.data || []))
      .catch(() => pushToast({ title: 'Failed to load runs', type: 'error' }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (initialRunId) {
      openDetail(initialRunId);
      onConsumeInitial?.();
    }
  }, [initialRunId]);

  async function openDetail(runId) {
    try {
      const r = await api.get(`/v1/scrapers/runs/${runId}`);
      setDetail(r.data);
      if (r.data.status === 'running' || r.data.status === 'pending') {
        const interval = setInterval(async () => {
          try {
            const r2 = await api.get(`/v1/scrapers/runs/${runId}`);
            setDetail(r2.data);
            if (r2.data.status !== 'running' && r2.data.status !== 'pending') {
              clearInterval(interval);
              setPolling(null);
              load();
            }
          } catch {}
        }, 5000);
        setPolling(interval);
      }
    } catch { pushToast({ title: 'Failed to load run', type: 'error' }); }
  }

  useEffect(() => { return () => { if (polling) clearInterval(polling); }; }, [polling]);

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading...</p>;

  if (detail) {
    const results = typeof detail.results === 'string' ? JSON.parse(detail.results) : (detail.results || []);
    const cols = typeof detail.result_columns === 'string' ? JSON.parse(detail.result_columns) : (detail.result_columns || []);

    function exportCSV() {
      if (!results.length) return;
      const keys = cols.length ? cols : Object.keys(results[0]);
      const header = keys.join(',');
      const rows = results.map(r => keys.map(k => {
        const v = r[k];
        const s = v == null ? '' : String(v).replace(/"/g, '""');
        return `"${s}"`;
      }).join(','));
      const csv = [header, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${detail.scraper_id}_${detail.id.slice(0,8)}.csv`; a.click();
      URL.revokeObjectURL(url);
    }

    async function importToGraha() {
      setImporting(true);
      try {
        const r = await api.post(`/v1/scrapers/runs/${detail.id}/import-to-graha`);
        const { imported, skipped_duplicate, skipped_unmappable } = r.data;
        pushToast({
          title: `Imported ${imported} lead${imported === 1 ? '' : 's'} to Graha` +
            (skipped_duplicate ? ` · ${skipped_duplicate} duplicate${skipped_duplicate === 1 ? '' : 's'} skipped` : '') +
            (skipped_unmappable ? ` · ${skipped_unmappable} skipped` : ''),
          type: 'success',
        });
        setDetail({ ...detail, graha_imported_count: imported });
      } catch (err) {
        pushToast({ title: err.response?.data?.detail || 'Import failed', type: 'error' });
      } finally {
        setImporting(false);
      }
    }

    return (
      <div>
        <button onClick={() => { setDetail(null); if (polling) { clearInterval(polling); setPolling(null); } }}
          style={{ fontSize: 12, color: 'var(--k-primary)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 12 }}>← Back to runs</button>

        <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{detail.scraper_name}</h3>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 99,
            background: `${STATUS_COLORS[detail.status]}18`, color: STATUS_COLORS[detail.status], textTransform: 'uppercase' }}>
            {detail.status}
          </span>
          {detail.status === 'running' && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Polling for results...</span>}
        </div>

        <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--ink-3)', marginBottom: 16 }}>
          <span>Results: <strong style={{ color: 'var(--ink)' }}>{detail.result_count}</strong></span>
          <span>Billed: <strong style={{ color: 'var(--k-primary)' }}>₹{Number(detail.billed_inr).toFixed(0)}</strong></span>
          <span>{new Date(detail.created_at).toLocaleString('en-IN')}</span>
        </div>

        {detail.error && <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{detail.error}</p>}

        {results.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              {detail.graha_imported_count > 0 && (
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {detail.graha_imported_count} imported to Graha
                </span>
              )}
              <button onClick={importToGraha} disabled={importing}
                style={{ padding: '6px 16px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                  background: 'var(--surface-1)', color: 'var(--k-primary)', border: '1px solid var(--k-primary)',
                  cursor: 'pointer', opacity: importing ? 0.6 : 1 }}>
                {importing ? 'Importing...' : 'Import to Graha'}
              </button>
              <button onClick={exportCSV}
                style={{ padding: '6px 16px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                  background: 'var(--k-primary)', color: '#fff', border: 'none', cursor: 'pointer' }}>
                Export CSV
              </button>
            </div>
            <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 8, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-raised)', textAlign: 'left' }}>
                    {(cols.length ? cols : Object.keys(results[0])).map(col => (
                      <th key={col} style={{ padding: '8px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.slice(0, 100).map((row, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--rule-soft)' }}>
                      {(cols.length ? cols : Object.keys(results[0])).map(col => (
                        <td key={col} style={{ padding: '6px 10px', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row[col] == null ? '—' : typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {results.length > 100 && <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8 }}>Showing first 100 of {results.length} results. Export CSV for all.</p>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {runs.length === 0 ? (
        <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No scraper runs yet. Go to Catalog to start one.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {runs.map(r => (
            <button key={r.id} onClick={() => openDetail(r.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--surface-1)',
                border: '1px solid var(--rule-soft)', borderRadius: 10, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
              <span style={{ fontSize: 20 }}>{r.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{r.scraper_name}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{new Date(r.created_at).toLocaleString('en-IN')}</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 99,
                background: `${STATUS_COLORS[r.status]}18`, color: STATUS_COLORS[r.status], textTransform: 'uppercase' }}>
                {r.status}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 50, textAlign: 'right' }}>{r.result_count} results</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--k-primary)', minWidth: 50, textAlign: 'right' }}>₹{Number(r.billed_inr).toFixed(0)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
