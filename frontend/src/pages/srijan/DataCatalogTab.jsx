// Srijan → Data catalog. The scrapers, grouped, and the run dialog.
//
// Two things the original got wrong that cost credits rather than pixels:
//
//  · The run dialog's poller had a bare `catch {}`. A run that finished while
//    the network was flaky left the dialog on "Running…" forever, and the only
//    way out was to close it — at which point the person had no idea whether
//    they had been charged. The poller now counts its failures and says so.
//  · `required` on an input schema field was rendered as a red asterisk but
//    never enforced, so a run could be started with a mandatory input empty and
//    fail server-side after the credits were charged.
import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty } from '../../components/editorial';
import { Resource, StatusPill, useList, errText } from '../hub/_shared';
import { SCRAPER_CATEGORIES, RUN_TONE } from './_shared';

export default function DataCatalogTab({ onViewRun, onSpent }) {
  const { pushToast } = useToast();
  const catalog = useList('/v1/scrapers/catalog', []);
  const [picked, setPicked] = useState(null);
  const [inputs, setInputs] = useState({});
  const [starting, setStarting] = useState(false);
  const [run, setRun] = useState(null);   // { id, status, error, result_count, stale }
  const timer = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

  function open(s) {
    setPicked(s);
    setRun(null);
    setInputs(Object.fromEntries(
      (s.input_schema || []).filter(f => f.default != null).map(f => [f.name, f.default])
    ));
  }

  function close() {
    clearInterval(timer.current);
    setPicked(null);
    setInputs({});
    setRun(null);
  }

  async function start(e) {
    e.preventDefault();
    setStarting(true);
    try {
      const r = await api.post('/v1/scrapers/run', { scraper_id: picked.id, inputs });
      onSpent?.();
      setRun({ id: r.data.run_id, status: 'running', charged: r.data.credits_charged ?? 0 });
      poll(r.data.run_id);
    } catch (err) {
      pushToast({ title: errText(err, 'Could not start the run.'), type: 'error' });
    } finally { setStarting(false); }
  }

  function poll(id) {
    clearInterval(timer.current);
    let misses = 0;
    timer.current = setInterval(async () => {
      try {
        const r = await api.get(`/v1/scrapers/runs/${id}`);
        misses = 0;
        if (!['running', 'pending'].includes(r.data.status)) {
          clearInterval(timer.current);
          setRun(v => ({ ...v, status: r.data.status, error: r.data.error, result_count: r.data.result_count, stale: false }));
        }
      } catch {
        // Silence here is what stranded the dialog. After three consecutive
        // failures, stop pretending and tell the person where to look.
        if (++misses >= 3) {
          clearInterval(timer.current);
          setRun(v => ({ ...v, stale: true }));
        }
      }
    }, 4000);
  }

  const grouped = {};
  for (const s of catalog.items || []) (grouped[s.category || 'general'] ||= []).push(s);

  return (
    <div>
      <Resource
        state={catalog}
        what="The data catalog"
        empty={<Empty icon="search" title="No data tools available"
          sub="Nothing in the catalog is enabled for this organisation." />}
      >
        {Object.entries(grouped).map(([cat, items]) => (
          <section className="sr-cat" key={cat}>
            <h3 className="sr-cat__t">{SCRAPER_CATEGORIES[cat] || cat}</h3>
            <div className="hb-cards">
              {items.map(s => (
                <button type="button" className="hb-card sr-tool" key={s.id} onClick={() => open(s)}>
                  <span className="sr-tool__t">{s.name}</span>
                  <span className="hb-cap sr-tool__d">{s.description}</span>
                  <span className="sr-tool__foot">
                    <span className="hb-cap">Up to {s.max_results} results</span>
                    <span className="hb-cap hb-mono">{s.credit_cost ?? 2} credits</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </Resource>

      {picked && (
        <div className="sr-modal" role="dialog" aria-modal="true" aria-label={picked.name}
          onClick={e => { if (e.target === e.currentTarget && !run) close(); }}>
          <div className="sr-modal__box">
            <div className="sr-modal__head">
              <h3 className="sr-modal__t">{picked.name}</h3>
              <p className="hb-cap">{picked.description}</p>
            </div>

            {run ? (
              <div className="sr-runstate">
                {run.stale ? (
                  <div className="note note--warn hb-err" role="status">
                    <b>We lost track of this run.</b> It was started and {run.charged} credits were
                    charged — it may still be working. Open the Data runs tab to see where it got to.
                  </div>
                ) : run.status === 'running' ? (
                  <>
                    <StatusPill status="running" tone={RUN_TONE.running} />
                    <p className="sr-runstate__t">Running…</p>
                    <p className="hb-cap">
                      This can take a minute or two. You can close this — the run continues, and it
                      will be waiting on the Data runs tab.
                    </p>
                  </>
                ) : run.status === 'succeeded' ? (
                  <>
                    <StatusPill status="succeeded" tone={RUN_TONE.succeeded} />
                    <p className="sr-runstate__t">
                      {run.result_count} {run.result_count === 1 ? 'result' : 'results'}
                    </p>
                  </>
                ) : (
                  <>
                    <StatusPill status="failed" tone={RUN_TONE.failed} />
                    <p className="sr-runstate__t">This run failed.</p>
                    {run.error && <p className="hb-cap hb-cap--bad">{run.error}</p>}
                  </>
                )}

                <div className="hb-form__foot hb-form__foot--end">
                  <button type="button" className="k-btn k-btn--ghost" onClick={close}>Close</button>
                  {(run.status === 'succeeded' || run.stale) && (
                    <button type="button" className="k-btn k-btn--primary"
                      onClick={() => { const id = run.id; close(); onViewRun(id); }}>
                      {run.stale ? 'Open in Data runs' : 'View the results'}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <form className="hb-form" onSubmit={start}>
                <div className="sr-cost">
                  <span className="hb-cap">This run spends</span>
                  <b className="hb-mono">{picked.credit_cost ?? 2} credits</b>
                </div>

                {(picked.input_schema || []).map(f => (
                  <label className="hb-field" key={f.name}>
                    <span className="hb-field__l">
                      {f.label}
                      {f.required && <span className="hb-req" aria-hidden="true">*</span>}
                    </span>
                    {f.type === 'textarea' ? (
                      <textarea className="k-input hb-ta" rows={4} required={!!f.required}
                        placeholder={f.placeholder || ''} value={inputs[f.name] || ''}
                        onChange={e => setInputs({ ...inputs, [f.name]: e.target.value })} />
                    ) : (
                      <input className="k-input" type={f.type === 'number' ? 'number' : 'text'}
                        required={!!f.required} placeholder={f.placeholder || ''}
                        value={inputs[f.name] || ''}
                        onChange={e => setInputs({ ...inputs, [f.name]: e.target.value })} />
                    )}
                  </label>
                ))}

                <div className="hb-form__foot hb-form__foot--end">
                  <button type="button" className="k-btn k-btn--ghost" onClick={close}>Cancel</button>
                  <button type="submit" className="k-btn k-btn--primary" disabled={starting}>
                    {starting ? 'Starting…' : `Run · ${picked.credit_cost ?? 2} credits`}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
