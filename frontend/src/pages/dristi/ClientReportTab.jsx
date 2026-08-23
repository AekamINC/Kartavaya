// Dristi · the blended client report (proposal 60, A5; its files are A6).
//
// One client, one period, one page: leads and deals from the CRM, invoiced /
// collected / outstanding from Finance, ad spend and sessions from the ingest
// spine. The external columns are real numbers when an account is connected
// and a STATED absence when it is not — the absence copy comes from the server
// and renders as-is, because "not connected" is an answer and ₹0 is a lie
// wearing one (the Withheld rule, applied to a connector).
//
// The downloads hit the SAME endpoint with `format=` — one query set, four
// renderings — so the file can never disagree with the screen.
//
// State discipline is the folder's: loading, restricted, error and data are
// four different answers and none may impersonate another. In particular a
// failed picker fetch must never render as "no clients" — that exact collapse
// is the defect _shared.jsx's header exists to name.
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Shimmer, StatTile } from '../../components/editorial';
import RestrictedNote from '../../components/module/RestrictedNote';
import {
  FMT, NUM, Panel, DataTable, Td, Meters, useDristiWindow, explicitBounds,
} from './_shared';

/** `2026-05` → `May 2026`. The monthly table is read alone in a file too,
 *  so unlike a chart axis it keeps the year. */
function monthCell(v) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v ?? ''));
  if (!m) return String(v ?? '');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MON[Number(m[2]) - 1]} ${m[1]}`;
}

/** en-IN day label, pinned like the rest of this folder. */
const fmtDay = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const MIME = {
  csv: 'text/csv;charset=utf-8;',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/** The detail string of an axios error, or the fallback — never an object,
 *  which React would refuse to render. */
const detailOf = (e, fallback) => (
  (typeof e.response?.data?.detail === 'string' && e.response.data.detail) || fallback
);

/** The server's own filename stem, mirrored: the client's NAME (ASCII-safe,
 *  never its id), falling back the way the server does. */
function stemOf(name, range) {
  const safe = String(name || '')
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .trim()
    .replace(/ /g, '-')
    .slice(0, 40) || 'client';
  return `client-report_${safe}_${range.from}_${range.to}`;
}

/** CSV / XLSX / PDF chips — same blob path as AnalyticsTab's Downloads. */
function Downloads({ clientId, clientName, range }) {
  const { pushToast } = useToast();
  const [busy, setBusy] = useState('');

  const pull = async (format) => {
    setBusy(format);
    try {
      const q = new URLSearchParams({
        client_id: clientId, date_from: range.from, date_to: range.to, format,
      });
      const r = await api.get(`/v1/analytics/client-report?${q}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([r.data], { type: MIME[format] }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${stemOf(clientName, range)}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      // A blob-typed error body is a Blob, not JSON — read it back before it
      // becomes "[object Blob]" in the toast.
      let detail = 'The download failed.';
      if (e.response?.data instanceof Blob) {
        try { detail = JSON.parse(await e.response.data.text()).detail || detail; } catch { /* keep default */ }
      } else {
        detail = detailOf(e, detail);
      }
      pushToast({ type: 'error', title: typeof detail === 'string' ? detail : 'The download failed.' });
    }
    setBusy('');
  };

  return (
    <span className="anx-dl" role="group" aria-label="Download this report">
      {['csv', 'xlsx', 'pdf'].map((f) => (
        <button
          type="button"
          key={f}
          className="k-btn k-btn--ghost k-btn--sm"
          disabled={busy !== ''}
          aria-label={`Download as ${f.toUpperCase()}`}
          onClick={() => pull(f)}
        >
          {busy === f ? '…' : f.toUpperCase()}
        </button>
      ))}
    </span>
  );
}

/** An ads/sessions block: a figure with its account's name, or the server's
 *  stated absence, verbatim. Plain figure markup — the Panel is already the
 *  frame, and a k-stat inside it is the box-in-box components.css §10 names. */
function SpineFigure({ block, money }) {
  if (!block) return null;
  if (block.absent) return <p className="dnone">{block.absent}</p>;
  return (
    <div className="dcrt__fig">
      <span className="dcrt__val">{money ? FMT(block.total) : NUM(block.total)}</span>
      <span className="dcrt__acc">{block.account_name}</span>
    </div>
  );
}

export default function ClientReportTab() {
  const win = useDristiWindow();
  // The picker's four-way state: the list, or why there isn't one.
  const [picker, setPicker] = useState({ status: 'loading', list: [], truncated: false });
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [restricted, setRestricted] = useState(false);
  const [pickerNonce, setPickerNonce] = useState(0);

  // The list caps at 200 server-side, so `?search=` is wired: past the cap,
  // typing is how the older clients are reached. Debounced so a keystroke is
  // not a request.
  useEffect(() => {
    let on = true;
    const t = setTimeout(() => {
      const q = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      api.get(`/v1/graha/clients${q}`).then(
        (r) => {
          if (!on) return;
          const list = (r.data?.data || [])
            .map((c) => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name));
          setPicker({ status: 'ok', list, truncated: Boolean(r.data?.truncated) });
        },
        (e) => {
          if (!on) return;
          // 403 is an ordinary answer (no CRM read), not a fault — but a 500
          // or a dropped connection must NEVER render as "no clients".
          if (e.response?.status === 403) setPicker({ status: 'restricted', list: [], truncated: false });
          else setPicker({ status: 'err', list: [], truncated: false });
        },
      );
    }, search ? 300 : 0);
    return () => { on = false; clearTimeout(t); };
  }, [search, pickerNonce]);

  // The endpoint honestly refuses a flow question with no period, so "All
  // time" resolves HERE to explicit bounds — capped at the server's own
  // maximum span, or the default window 400s (see explicitBounds).
  const range = useMemo(() => explicitBounds(win), [win.from, win.to]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!clientId) {
      // Reset ALL four states, not just the data: a stale error (or an
      // in-flight load whose cleanup already fired) must not haunt the
      // "pick a client" hint.
      setReport(null);
      setLoading(false);
      setErr('');
      setRestricted(false);
      return undefined;
    }
    let on = true;
    setLoading(true);
    setErr('');
    setRestricted(false);
    const q = new URLSearchParams({
      client_id: clientId, date_from: range.from, date_to: range.to,
    });
    api.get(`/v1/analytics/client-report?${q}`).then(
      (r) => { if (on) { setReport(r.data); setLoading(false); } },
      (e) => {
        if (!on) return;
        setReport(null);
        setLoading(false);
        if (e.response?.status === 403) setRestricted(true);
        else setErr(detailOf(e, 'Retry, or check your connection.'));
      },
    );
    return () => { on = false; };
  }, [clientId, range.from, range.to]);

  const clientName = picker.list.find((c) => c.id === clientId)?.name || '';
  const leads = report?.leads;
  const deals = report?.deals;
  const invoices = report?.invoices;
  const monthly = report?.monthly || [];
  const maxSource = Math.max(...(leads?.by_source || []).map((s) => Number(s.value) || 0), 0);

  return (
    <>
      <div className="dcrt">
        <select
          className="k-select dcrt__pick"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          aria-label="Client"
        >
          <option value="">Pick a client…</option>
          {picker.list.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {(picker.truncated || search) && (
          <input
            className="k-input dcrt__find"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search all clients…"
            aria-label="Search clients"
          />
        )}
        {report && !loading && (
          <Downloads clientId={clientId} clientName={clientName} range={range} />
        )}
      </div>

      {picker.status === 'err' && (
        <div className="note note--warn" role="status">
          <span><b>The client list did not load.</b> Retry, or check your connection.</span>
          <button type="button" className="k-btn k-btn--ghost k-btn--sm dret"
            onClick={() => setPickerNonce((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
      {picker.status === 'restricted' && (
        <RestrictedNote module="the CRM (Graha)" />
      )}
      {picker.status === 'ok' && picker.list.length === 0 && !search && (
        <p className="dnone">No clients yet — the report starts when the CRM has one.</p>
      )}
      {picker.status === 'ok' && picker.list.length === 0 && search && (
        <p className="dnone">Nothing matches “{search}”.</p>
      )}
      {!clientId && picker.status === 'ok' && picker.list.length > 0 && (
        <p className="dnone">Pick a client to see their whole story on one page.</p>
      )}

      {loading && <Shimmer count={6} />}
      {restricted && <RestrictedNote module="the CRM (Graha) or accounting (Ganit)" />}
      {err && (
        <div className="note note--warn" role="status">
          <span><b>The report did not load.</b> {err}</span>
        </div>
      )}

      {report && !loading && (
        <>
          {report.client?.since && (
            <p className="dcrt__since">Client since {fmtDay(report.client.since)}.</p>
          )}

          <div className="k-stats dstats">
            {leads && (
              <StatTile label="Leads added" sanskrit="नए संपर्क" value={NUM(leads.total)} />
            )}
            {deals && (
              <StatTile
                label="Won value" sanskrit="विजित" value={FMT(deals.won_value)} variant="ok"
                sub={`${NUM(deals.won_count)} ${Number(deals.won_count) === 1 ? 'deal' : 'deals'} won`}
              />
            )}
            {deals && (
              <StatTile
                label="Open pipeline" sanskrit="प्रवाह"
                value={FMT(deals.open_pipeline_value)} sub="undecided, as at today"
              />
            )}
            {invoices && (
              <StatTile
                label="Invoiced" sanskrit="बीजक" value={FMT(invoices.invoiced)}
                sub={`${NUM(invoices.invoice_count)} ${Number(invoices.invoice_count) === 1 ? 'document' : 'documents'}`}
              />
            )}
            {invoices && (
              <StatTile
                label="Collected" sanskrit="प्राप्त" value={FMT(invoices.collected)} variant="ok"
              />
            )}
            {invoices && (
              <StatTile
                label="Outstanding" sanskrit="बकाया" value={FMT(invoices.outstanding)}
                variant={Number(invoices.outstanding) > 0 ? 'warn' : undefined}
                sub="all time, unpaid and not cancelled"
              />
            )}
          </div>

          <div className="dgal">
            <Panel title="Ad spend" hi="विज्ञापन व्यय">
              <SpineFigure block={report.ads} money />
            </Panel>
            <Panel title="Website sessions" hi="वेब सत्र">
              <SpineFigure block={report.sessions} />
            </Panel>
            {leads && (
              <Panel title="Where the leads came from" hi="स्रोत">
                <Meters
                  empty="No leads in this period."
                  items={(leads.by_source || []).map((s) => ({
                    label: s.source,
                    pct: maxSource > 0 ? (Number(s.value) || 0) / maxSource * 100 : 0,
                    value: NUM(s.value),
                  }))}
                />
              </Panel>
            )}
            <Panel title="Month by month" hi="मासिक" wide>
              {monthly.length === 0 ? (
                <p className="dnone">No invoices, payments or spend in this period.</p>
              ) : (
                <DataTable
                  arrange="dristi.client_monthly"
                  columns={['Month',
                    { label: 'Invoiced', align: 'right' },
                    { label: 'Collected', align: 'right' },
                    { label: 'Ad spend', align: 'right' }]}
                >
                  {monthly.map((m) => (
                    <tr key={m.period}>
                      <td>{monthCell(m.period)}</td>
                      <Td align="right" mono>{m.invoiced != null ? FMT(m.invoiced) : '—'}</Td>
                      <Td align="right" mono>{m.collected != null ? FMT(m.collected) : '—'}</Td>
                      <Td align="right" mono>{m.spend != null ? FMT(m.spend) : '—'}</Td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
