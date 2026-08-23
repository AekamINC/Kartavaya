// Sahayak → Data runs. Past runs, and the table each one produced.
import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty } from '../../components/editorial';
import { Resource, StatusPill, ErrorNote, Shim, useList, errText } from '../hub/_shared';
import { RUN_TONE, stamp } from './_shared';

const PAGE = 100;

export default function DataRunsTab({ initialRunId, onConsumeInitial }) {
  const runs = useList('/v1/scrapers/runs', []);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    if (initialRunId) { setOpenId(initialRunId); onConsumeInitial?.(); }
  }, [initialRunId, onConsumeInitial]);

  if (openId) return <RunDetail id={openId} onBack={() => { setOpenId(null); runs.reload(); }} />;

  return (
    <Resource
      state={runs}
      what="Your data runs"
      empty={<Empty icon="search" title="No data runs yet"
        sub="Start one from the Data catalog tab and the results will be kept here." />}
    >
      <div className="hb-list">
        {runs.items?.map(r => (
          <button type="button" className="hb-card sr-run" key={r.id} onClick={() => setOpenId(r.id)}>
            <span className="sr-run__id">
              <b className="sr-run__t">{r.scraper_name}</b>
              <span className="hb-cap hb-mono">{stamp(r.created_at)}</span>
            </span>
            <StatusPill status={r.status} tone={RUN_TONE[r.status]} />
            <span className="sr-run__n hb-mono">
              {r.result_count ?? 0} {r.result_count === 1 ? 'result' : 'results'}
            </span>
            <span className="sr-run__c hb-mono">{r.credits_charged ?? 0} cr</span>
          </button>
        ))}
      </div>
    </Resource>
  );
}

function RunDetail({ id, onBack }) {
  const { pushToast } = useToast();
  const [state, setState] = useState({ loading: true, error: '', run: null });
  const [importing, setImporting] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await api.get(`/v1/scrapers/runs/${id}`);
        if (!live) return;
        setState({ loading: false, error: '', run: r.data });
        if (['running', 'pending'].includes(r.data.status)) {
          timer.current = setInterval(async () => {
            try {
              const r2 = await api.get(`/v1/scrapers/runs/${id}`);
              setState(s => ({ ...s, run: r2.data }));
              if (!['running', 'pending'].includes(r2.data.status)) clearInterval(timer.current);
            } catch { /* a single poll miss is not news; the row keeps its last state */ }
          }, 5000);
        }
      } catch (err) {
        if (live) setState({ loading: false, error: errText(err), run: null });
      }
    })();
    return () => { live = false; clearInterval(timer.current); };
  }, [id]);

  if (state.loading) return <Shim count={3} />;
  if (state.error) {
    return (
      <div>
        <button type="button" className="hb-linkbtn sr-back" onClick={onBack}>Back to runs</button>
        <ErrorNote what="This run" error={state.error} />
      </div>
    );
  }

  const run = state.run;
  const results = parse(run.results);
  const cols = parse(run.result_columns);
  const keys = cols.length ? cols : (results[0] ? Object.keys(results[0]) : []);

  function exportCsv() {
    if (!results.length) return;
    const esc = v => `"${(v == null ? '' : String(v)).replace(/"/g, '""')}"`;
    const csv = [keys.join(','), ...results.map(r => keys.map(k => esc(r[k])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${run.scraper_id}_${String(run.id).slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importToGraha() {
    setImporting(true);
    try {
      const r = await api.post(`/v1/scrapers/runs/${run.id}/import-to-graha`);
      const { imported, skipped_duplicate, skipped_unmappable } = r.data;
      const parts = [`${imported} ${imported === 1 ? 'lead' : 'leads'} imported to Graha`];
      if (skipped_duplicate) parts.push(`${skipped_duplicate} already there`);
      if (skipped_unmappable) parts.push(`${skipped_unmappable} could not be mapped`);
      pushToast({ title: parts.join(' · '), type: imported > 0 ? 'success' : 'info' });
      setState(s => ({ ...s, run: { ...s.run, graha_imported_count: imported } }));
    } catch (err) {
      pushToast({ title: errText(err, 'The import failed.'), type: 'error' });
    } finally { setImporting(false); }
  }

  return (
    <div className="sr-detail">
      <button type="button" className="hb-linkbtn sr-back" onClick={onBack}>Back to runs</button>

      <div className="sr-detail__head">
        <h3 className="sr-detail__t">{run.scraper_name}</h3>
        <StatusPill status={run.status} tone={RUN_TONE[run.status]} />
      </div>

      <div className="sr-detail__meta">
        <span className="hb-cap">Results <b className="hb-mono">{run.result_count ?? 0}</b></span>
        <span className="hb-cap">Credits <b className="hb-mono">{run.credits_charged ?? 0}</b></span>
        <span className="hb-cap hb-mono">{stamp(run.created_at)}</span>
        {run.graha_imported_count > 0 && (
          <span className="hb-cap">{run.graha_imported_count} already imported to Graha</span>
        )}
      </div>

      {run.error && (
        <div className="note note--warn hb-err" role="status">
          <b>This run failed.</b> {run.error}
        </div>
      )}

      {['running', 'pending'].includes(run.status) && (
        <p className="hb-cap">Still working. This page refreshes itself every few seconds.</p>
      )}

      {run.status === 'succeeded' && results.length === 0 && (
        /* A successful run that matched nothing is a real answer and must not
           read like a broken page — it means the query was too narrow, not that
           the tool is down. */
        <p className="hb-none">
          This run completed and found nothing. The inputs were probably too narrow —
          widen them and run it again from the Data catalog.
        </p>
      )}

      {results.length > 0 && (
        <>
          <div className="sr-detail__act">
            <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
              disabled={importing} onClick={importToGraha}>
              {importing ? 'Importing…' : 'Import to Graha'}
            </button>
            <button type="button" className="k-btn k-btn--primary hb-btn--sm" onClick={exportCsv}>
              Export CSV
            </button>
          </div>

          {/* NOT opted into useColumnPrefs, and it is the runtime-column case
              rather than a judgement call. `keys` is whatever `result_columns`
              the driver reported, falling back to `Object.keys(results[0])` —
              so the column SET is different per scraper and can differ between
              two runs of the same one. There is no stable base list to declare
              and therefore nothing an arrangement could be reconciled against:
              one key across every scraper would mean a layout saved from a maps
              run being resolved against a jobs run's columns, where every saved
              id is dropped and every real column appends, i.e. the shipped
              order with a database write behind it. A key per scraper would be
              worse — a table key is a row identity for ever, and minting them
              from remote data grows a row per scraper the catalogue ever adds.
              This grid is also transient by design: it shows the first 100 rows
              and points at the CSV export for the rest. */}
          <div className="tbl__wrap hb-scroll sr-tblwrap">
            <table className="tbl sr-tbl">
              <thead>
                <tr>{keys.map(c => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {results.slice(0, PAGE).map((row, i) => (
                  <tr key={i}>
                    {keys.map(c => (
                      <td className="sr-tbl__c" key={c}>
                        {row[c] == null ? '—' : typeof row[c] === 'object' ? JSON.stringify(row[c]) : String(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {results.length > PAGE && (
            <p className="hb-cap">
              Showing the first {PAGE} of {results.length}. Export the CSV for the rest.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Results arrive as JSON or as a JSON string, depending on the driver. */
function parse(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}
