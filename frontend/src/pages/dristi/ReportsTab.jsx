// Dristi · reports — scheduled email delivery, and one-off exports.
//
// ── The export buttons never worked ──────────────────────────────────────────
//
// Five of them, and all five were:
//
//     window.open(`/v1/dristi/exports/${type}?format=csv`, '_blank')
//
// which is a SITE-RELATIVE url. The API lives at `${VITE_BACKEND_URL}/api`, a
// different origin in every environment including local dev, so this opened
// `https://<frontend>/v1/dristi/exports/overview` — a path the SPA router does
// not have — and the user got a blank tab or the app's own not-found page. It
// also could not have authenticated if the origin had been right: the bearer
// token is attached by the axios interceptor in lib/api.js, and `window.open`
// goes nowhere near it. Cookie auth would not have saved it either, because the
// cookie is scoped to the backend origin, not this one.
//
// Fetching the blob through `api` fixes origin, auth and error handling at
// once — and a 403 from the source-module check now surfaces as a message
// rather than a blank tab.
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge, Empty, Shimmer } from '../../components/editorial';
import { Panel, NUM, DataTable, Td, useDristiWindow, windowQuery } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';
import DateInput from '../../components/ui/DateInput';

const FREQ_COLORS = {
  daily: 'var(--st-in-review)', weekly: 'var(--st-in-progress)', monthly: 'var(--ok)',
};
const REPORT_TYPES = ['overview', 'revenue', 'pipeline', 'hr', 'sales', 'custom'];
const FREQUENCIES = ['daily', 'weekly', 'monthly'];
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EXPORTABLE = ['overview', 'revenue', 'pipeline', 'hr', 'sales'];
const FORMATS = ['pdf', 'csv', 'json'];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ReportsTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change reports' });
  const win = useDristiWindow();
  const [reports, setReports] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [view, setView] = useState('list');
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState({ rows: null, err: '' });
  const [busyExport, setBusyExport] = useState('');
  const { pushToast } = useToast();

  // Two defects in three lines, both of which made this list permanently empty.
  //
  // `GET /scheduled-reports` answers `{"data": [...]}`, so `r.data` is the
  // ENVELOPE and `Array.isArray(r.data)` is false for every response this
  // endpoint has ever produced — the old `Array.isArray(r.data) ? r.data : []`
  // therefore evaluated to `[]` unconditionally. Every scheduled report in the
  // database was invisible, and the page offered to create another one.
  //
  // `.catch(() => setReports([]))` was the second: a 500 rendered as "No
  // scheduled reports" with a Create button under it, which is an empty state
  // inviting you to make a second copy of a report that already exists.
  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.get('/v1/dristi/scheduled-reports');
      const rows = Array.isArray(r.data) ? r.data : (r.data?.data || []);
      setReports(rows);
    } catch (e) {
      setReports(null);
      setErr(e.response?.data?.detail || 'The scheduled reports did not load.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const runNow = async (id) => {
    try {
      await api.post(`/v1/dristi/scheduled-reports/${id}/run-now`);
      pushToast({ type: 'success', title: 'Report queued for delivery' });
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Could not run the report' });
    }
  };

  const remove = async (id) => {
    try {
      await api.delete(`/v1/dristi/scheduled-reports/${id}`);
      pushToast({ type: 'success', title: 'Schedule deleted' });
      if (view === 'detail') { setView('list'); setSelected(null); }
      load();
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Could not delete' });
    }
  };

  const toggleActive = async (r) => {
    try {
      await api.patch(`/v1/dristi/scheduled-reports/${r.id}`, { is_active: !r.is_active });
      load();
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Could not change state' });
    }
  };

  const openDetail = async (r) => {
    setSelected(r);
    setView('detail');
    setLogs({ rows: null, err: '' });
    try {
      const res = await api.get(`/v1/dristi/scheduled-reports/${r.id}/logs`);
      // The endpoint answers `{logs: [...]}`; the old code assigned the whole
      // object to a list and then called `.length` on it, so a report WITH
      // delivery history rendered the "No logs yet" empty state.
      setLogs({ rows: Array.isArray(res.data) ? res.data : (res.data?.logs || []), err: '' });
    } catch (e) {
      setLogs({ rows: null, err: e.response?.data?.detail || 'Delivery history did not load.' });
    }
  };

  const openCreate = () => {
    setForm({
      name: '', report_type: 'overview', frequency: 'weekly',
      day_of_week: '1', day_of_month: '1', time_utc: '08:00',
      recipients: '', file_formats: ['pdf'],
    });
    setView('create');
  };

  const recipientsOf = (s) => String(s || '').split(/[\n,]/).map(x => x.trim()).filter(Boolean);
  const badEmails = form ? recipientsOf(form.recipients).filter(e => !EMAIL.test(e)) : [];
  const canSubmit = form
    && form.name.trim()
    && recipientsOf(form.recipients).length > 0
    && badEmails.length === 0
    && form.file_formats.length > 0;

  const submitCreate = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      await api.post('/v1/dristi/scheduled-reports', {
        name: form.name.trim(),
        report_type: form.report_type,
        frequency: form.frequency,
        day_of_week: form.frequency === 'weekly' ? Number(form.day_of_week) : null,
        day_of_month: form.frequency === 'monthly' ? Number(form.day_of_month) : null,
        time_utc: form.time_utc,
        file_formats: form.file_formats,
        recipients: recipientsOf(form.recipients),
        dashboard_id: null,
        filters: {},
      });
      pushToast({ type: 'success', title: 'Report scheduled' });
      setView('list');
      load();
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Could not schedule the report' });
    }
    setSaving(false);
  };

  /** Through `api`, so it hits the right origin with the right credentials. */
  const exportCSV = async (type) => {
    setBusyExport(type);
    try {
      // The export takes the period on screen. A file that does not say which
      // dates it covers is indistinguishable from one that covers all of them,
      // and these get forwarded to accountants.
      const r = await api.get(
        `/v1/dristi/exports/${type}?format=csv${windowQuery(win, '&')}`,
        { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([r.data], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = win.from && win.to
        ? `${type}_${win.from}_${win.to}.csv`
        : `${type}_all-time.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      // A blob-typed error body is a Blob, not JSON — read it back before it
      // becomes "[object Blob]" in the toast.
      let detail = 'The export failed.';
      if (e.response?.data instanceof Blob) {
        try { detail = JSON.parse(await e.response.data.text()).detail || detail; } catch { /* keep default */ }
      } else if (e.response?.data?.detail) {
        detail = e.response.data.detail;
      }
      pushToast({ type: 'error', title: detail });
    }
    setBusyExport('');
  };

  if (loading) return <Shimmer count={4} />;
  if (err) {
    return (
      <div className="note note--warn" role="status">
        <span><b>This did not load.</b> {err}</span>
        <button type="button" className="k-btn k-btn--ghost k-btn--sm dret" onClick={load}>Retry</button>
      </div>
    );
  }

  // ── Create ────────────────────────────────────────────────────────────────
  if (view === 'create' && form) {
    return (
      <div className="dstack">
        <button type="button" className="k-backbtn" onClick={() => setView('list')}>← Back</button>
        <Panel title="Schedule a report" hi="रिपोर्ट अनुसूची">
          <div className="dform">
            <label className="fld">
              <span className="fld__l">Name</span>
              <input className="inp" value={form.name} autoFocus
                onChange={e => setForm({ ...form, name: e.target.value })} />
            </label>

            <div className="dform__row">
              <label className="fld">
                <span className="fld__l">Report type</span>
                <select className="inp" value={form.report_type}
                  onChange={e => setForm({ ...form, report_type: e.target.value })}>
                  {REPORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="fld">
                <span className="fld__l">Frequency</span>
                <select className="inp" value={form.frequency}
                  onChange={e => setForm({ ...form, frequency: e.target.value })}>
                  {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
            </div>

            <div className="dform__row">
              {form.frequency === 'weekly' && (
                <label className="fld">
                  <span className="fld__l">Day of week</span>
                  <select className="inp" value={form.day_of_week}
                    onChange={e => setForm({ ...form, day_of_week: e.target.value })}>
                    {DAYS_OF_WEEK.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                </label>
              )}
              {form.frequency === 'monthly' && (
                <label className="fld">
                  <span className="fld__l">Day of month</span>
                  <input className="inp" type="number" min={1} max={31} value={form.day_of_month}
                    onChange={e => setForm({ ...form, day_of_month: e.target.value })} />
                </label>
              )}
              <label className="fld">
                <span className="fld__l">Time (UTC)</span>
                <DateInput className="inp" type="time" value={form.time_utc}
                  onChange={e => setForm({ ...form, time_utc: e.target.value })} />
              </label>
            </div>

            <label className="fld">
              <span className="fld__l">Recipients</span>
              <textarea className="inp" rows={3} value={form.recipients}
                placeholder="One email per line"
                aria-invalid={badEmails.length > 0}
                onChange={e => setForm({ ...form, recipients: e.target.value })} />
              {badEmails.length > 0
                ? <span className="fld__err">Not an email address: {badEmails.join(', ')}</span>
                : <span className="fld__hint">One per line, or comma separated.</span>}
            </label>

            <fieldset className="fld dfieldset">
              <legend className="fld__l">File formats</legend>
              <div className="chips">
                {FORMATS.map(fmt => {
                  const on = form.file_formats.includes(fmt);
                  return (
                    <button type="button" key={fmt} className={`chip${on ? ' on' : ''}`}
                      aria-pressed={on}
                      onClick={() => setForm({
                        ...form,
                        file_formats: on
                          ? form.file_formats.filter(f => f !== fmt)
                          : [...form.file_formats, fmt],
                      })}>
                      {fmt.toUpperCase()}
                    </button>
                  );
                })}
              </div>
              {form.file_formats.length === 0 && (
                <span className="fld__err">Pick at least one format.</span>
              )}
            </fieldset>

            <div className="dform__act">
              <button type="button" className="k-btn k-btn--primary"
                disabled={!canSubmit || saving || !canWrite} onClick={submitCreate} title={denial || undefined}>
                {saving ? 'Scheduling…' : 'Schedule'}
              </button>
              <button type="button" className="k-btn k-btn--ghost" onClick={() => setView('list')}>
                Cancel
              </button>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  // ── Detail ────────────────────────────────────────────────────────────────
  if (view === 'detail' && selected) {
    return (
      <div className="dstack">
        <button type="button" className="k-backbtn"
          onClick={() => { setView('list'); setSelected(null); }}>← Back</button>

        <Panel title={selected.name} hi="रिपोर्ट विवरण"
          right={<Badge color={FREQ_COLORS[selected.frequency]}>{selected.frequency}</Badge>}>
          <div className="dmeta">
            <Badge>{selected.report_type}</Badge>
            <span className="dmeta__i">
              {NUM(selected.recipients?.length || 0)} recipient{selected.recipients?.length === 1 ? '' : 's'}
            </span>
            <span className="dmeta__i">
              {selected.last_sent_at
                ? `Last sent ${new Date(selected.last_sent_at).toLocaleString()}`
                : 'Never sent'}
            </span>
          </div>
          <div className="dform__act">
            <button type="button" className="k-btn k-btn--primary"
              onClick={() => runNow(selected.id)}
          disabled={!canWrite} title={denial || undefined}>Run now</button>
            <button type="button" className="k-btn k-btn--ghost ddanger"
              onClick={() => remove(selected.id)}>Delete</button>
          </div>
        </Panel>

        <Panel title="Delivery log" hi="वितरण लॉग">
          {logs.err ? (
            <div className="note note--warn" role="status">
              <span><b>This did not load.</b> {logs.err}</span>
              <button type="button" className="k-btn k-btn--ghost k-btn--sm dret"
                onClick={() => openDetail(selected)}>Retry</button>
            </div>
          ) : !logs.rows ? <Shimmer count={3} />
            : logs.rows.length === 0 ? (
              <Empty title="Not sent yet"
                sub="Every delivery attempt is recorded here, including the ones that fail." />
            ) : (
              <DataTable arrange="dristi.report_deliveries" columns={['Sent at', 'Status', { label: 'Recipients', align: 'right' }, 'Error']}>
                {logs.rows.map((l, i) => (
                  <tr key={l.id || i}>
                    <td>{l.sent_at ? new Date(l.sent_at).toLocaleString() : '—'}</td>
                    <td>
                      <Badge color={l.status === 'sent' ? 'var(--ok)' : 'var(--danger)'}>{l.status}</Badge>
                    </td>
                    <Td align="right" mono>{NUM(l.recipients_count)}</Td>
                    <Td className={l.error ? 'dneg' : undefined}>{l.error || '—'}</Td>
                  </tr>
                ))}
              </DataTable>
            )}
        </Panel>
      </div>
    );
  }

  // ── List ──────────────────────────────────────────────────────────────────
  return (
    <div className="dstack">
      <Panel title="Scheduled reports" hi="अनुसूचित"
        right={<button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={openCreate}
          disabled={!canWrite} title={denial || undefined}>
          + Schedule report
        </button>}>
        {reports.length === 0 ? (
          <Empty title="No scheduled reports"
            sub={canWrite
              ? 'A scheduled report emails itself to the people you name, on the days you choose.'
              : `A scheduled report emails itself to the people you name, on the days you choose. ${denial}`}
            cta={canWrite ? 'Schedule a report' : undefined}
            onCta={canWrite ? openCreate : undefined} />
        ) : (
          <ul className="dlist">
            {reports.map(r => (
              <li key={r.id} className="dlist__i">
                <button type="button" className="dlist__main" onClick={() => openDetail(r)}>
                  <span className="dlist__t">{r.name}</span>
                  <span className="dlist__m">
                    <Badge>{r.report_type}</Badge>
                    <Badge color={FREQ_COLORS[r.frequency]}>{r.frequency}</Badge>
                    <span className="dmeta__i">
                      {NUM(r.recipients?.length || 0)} recipient{r.recipients?.length === 1 ? '' : 's'}
                    </span>
                    {r.last_sent_at && (
                      <span className="dmeta__i">Last {new Date(r.last_sent_at).toLocaleDateString()}</span>
                    )}
                  </span>
                </button>
                <span className="dlist__act">
                  <button type="button" className={`chip${r.is_active ? ' on' : ''}`}
                    aria-pressed={r.is_active} onClick={() => toggleActive(r)}>
                    {r.is_active ? 'Active' : 'Paused'}
                  </button>
                  <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                    onClick={() => runNow(r.id)}>Run now</button>
                  <button type="button" className="k-btn k-btn--ghost k-btn--sm ddanger"
                    onClick={() => remove(r.id)}>Delete</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Export data" hi="डेटा निर्यात"
        right={<span className="dcard__meta">CSV</span>}>
        <p className="dnote">
          Each export reads the module its figures come from — one you don’t have access to
          will say so rather than download an empty file.
        </p>
        <div className="chips">
          {EXPORTABLE.map(t => (
            <button type="button" key={t} className="chip" disabled={busyExport === t}
              onClick={() => exportCSV(t)}>
              {busyExport === t ? 'Preparing…' : `${t} CSV`}
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}
