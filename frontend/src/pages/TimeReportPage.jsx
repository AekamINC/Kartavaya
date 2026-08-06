/**
 * TimeReportPage.jsx — editorial Time Report.
 * Layout: filters card → two-col (daily distribution chart + by member) → entries table → quote
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../lib/api';
import { PageHeader, DataTable, Td } from '../components/editorial';
import { ErrorState, errorKind, EmptyState, SkeletonCard } from '../components/ui';
import { userInitials } from '../lib/utils';
import { avatarBg } from '../components/ui/Avatar';
import { Secondary } from '../components/Bilingual';

function fmtHours(mins) {
  if (!mins) return '0h';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}.${Math.round(m / 6)}h` : `${h}h`;
}

function fmtFull(mins) {
  if (!mins) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}`.trim() : `${m}m`;
}


function exportCSV(entries) {
  const rows = [
    ['Date', 'Member', 'Task', 'Note', 'Hours'],
    ...entries.map(e => [
      e.started_at ? new Date(e.started_at).toLocaleDateString() : '',
      e.user_name || '',
      e.task_title || '',
      e.description || '',
      ((e.minutes || 0) / 60).toFixed(2),
    ]),
  ];
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'Kartavaya-time-report.csv'; a.click();
  URL.revokeObjectURL(url);
}

// ── Vertical bar chart for daily distribution ─────────────────────────────
function DailyChart({ entries, from, to }) {
  const days = useMemo(() => {
    const arr = [];
    const s = new Date(from); const e = new Date(to);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      arr.push(new Date(d));
    }
    return arr.slice(-10); // max 10 days
  }, [from, to]);

  const dayMins = useMemo(() => {
    const m = {};
    entries.forEach(e => {
      if (!e.started_at) return;
      const k = new Date(e.started_at).toDateString();
      m[k] = (m[k] || 0) + (e.minutes || 0);
    });
    return m;
  }, [entries]);

  const max = Math.max(...days.map(d => dayMins[d.toDateString()] || 0), 1);

  return (
    <div className="trp-daily">
      {days.map((d) => {
        const mins = dayMins[d.toDateString()] || 0;
        const pct = (mins / max) * 100;
        const isToday = d.toDateString() === new Date().toDateString();
        // --h is the only per-bar value; the tone is a modifier class, so the
        // gradient and the empty-track colour live in the stylesheet where
        // prefers-reduced-motion and the theme can both reach them.
        const tone = mins > 0 ? (isToday ? ' trp-daily__bar--today' : ' trp-daily__bar--on') : '';
        return (
          <div key={d.toISOString()} className="trp-daily__col">
            {mins > 0 && <div className="trp-daily__v">{fmtHours(mins)}</div>}
            <div
              className={`trp-daily__bar${tone}`}
              style={{ '--h': `${Math.max(pct, mins > 0 ? 6 : 2)}%` }}
            />
            <div className={`trp-daily__d${isToday ? ' trp-daily__d--today' : ''}`}>
              {d.getDate()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Horizontal bar chart for by-member ───────────────────────────────────
function MemberChart({ byMember }) {
  const max = Math.max(...byMember.map(m => m.minutes), 1);
  return (
    <div className="trp-mem">
      {byMember.map((m, i) => {
        const color = avatarBg(m.label || String(i));
        const initials = userInitials(m.label);
        return (
          <div key={m.label} className="trp-mem__row">
            <span className="trp-mem__av" style={{ '--c': color }} aria-hidden="true">{initials}</span>
            <span className="trp-mem__n">{m.label.split(' ')[0]}</span>
            <div className="trp-mem__track">
              <div
                className="trp-mem__fill"
                style={{ '--w': `${(m.minutes / max) * 100}%`, '--c': color }}
              />
            </div>
            <span className="trp-mem__v">{fmtHours(m.minutes)}</span>
          </div>
        );
      })}
    </div>
  );
}

const TODAY_ISO    = new Date().toISOString().slice(0, 10);
const WEEK_AGO_ISO = new Date(Date.now() - 9 * 864e5).toISOString().slice(0, 10);

export default function TimeReportPage({ teamId }) {

  const [data,    setData]    = useState({ entries: [], total_minutes: 0 });
  const [loading, setLoading] = useState(true);
  const [from,    setFrom]    = useState(WEEK_AGO_ISO);
  const [to,      setTo]      = useState(TODAY_ISO);
  const [memberF, setMemberF] = useState('');
  const [members, setMembers] = useState([]);
  const [err,     setErr]     = useState(null);

  useEffect(() => {
    if (!teamId) return;
    api.get(`/teams/${teamId}`).then(r => setMembers(Array.isArray(r.data?.members) ? r.data.members : [])).catch(() => {});
  }, [teamId]);

  /* A failed fetch used to resolve to `{entries: []}`, which renders the empty
     state — so a 403, a 500 and a dead connection all told the user "No entries
     for this period". That is a wrong answer presented as a right one. The
     rejection is classified now and rendered as one of the four failure states
     (02-common-components.md); empty means empty. */
  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    const params = { team_id: teamId, from, to };
    if (memberF) params.user_id = memberF;
    api.get('/time/report', { params })
       .then(r => setData(r.data && Array.isArray(r.data.entries) ? r.data : { entries: [], total_minutes: 0 }))
       .catch(e => { setErr(e); setData({ entries: [], total_minutes: 0 }); })
       .finally(() => setLoading(false));
  }, [teamId, from, to, memberF]);

  useEffect(() => { load(); }, [load]);

  const byMember = useMemo(() => {
    const m = {};
    (data.entries || []).forEach(e => {
      const n = e.user_name || 'Unknown';
      m[n] = (m[n] || 0) + (e.minutes || 0);
    });
    return Object.entries(m).map(([label, minutes]) => ({ label, minutes })).sort((a, b) => b.minutes - a.minutes);
  }, [data.entries]);

  const memberColorMap = useMemo(() =>
    // Keyed on the member, so the swatch in the chart matches the swatch in the
    // list above it — and stays the same person's colour when the range changes
    // the order.
    Object.fromEntries(byMember.map((m, i) => [m.label, avatarBg(m.label || String(i))])),
  [byMember]);

  /**
   * The headline figure, and the one number on this page someone reads without
   * scrolling.
   *
   * It used to be `data.total_minutes ? … : '0'`, and the catch on the fetch
   * sets `total_minutes: 0` — so a failed request printed a confident **0h**
   * beside the word TOTAL while the error card sat underneath it. Zero hours
   * logged and "we could not find out" are different answers, and on a
   * timesheet the wrong one is the one that gets billed. The same applied while
   * loading: 0h for a beat, then the real figure.
   *
   * `ApprovalsPage` already draws its tiles as `—` when their fetch fails; this
   * is that rule, on the number that matters most here.
   */
  const totalHours = (loading || err) ? null
    : data.total_minutes ? (data.total_minutes / 60).toFixed(1) : '0';

  return (
    <div className="k-screen">
      <PageHeader
        kicker="OPERATIONS"
        title="Time Report"
        sanskrit="काल"
        lede="Hours logged across tasks and members. Filter to investigate."
        right={
          <div className="k-time-total">
            <div className="k-time-total__num">
              {totalHours === null ? '—' : <>{totalHours}<span className="k-time-total__unit">h</span></>}
            </div>
            <div className="k-time-total__lbl">TOTAL <Secondary className="k-lbl__in" value="कुल" /></div>
          </div>
        }
      />

      {/* Filter card */}
      <section className="k-card">
        <div className="k-tfilters">
          <div>
            <div className="k-fld-label">FROM</div>
            <input type="date" className="k-input" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <div className="k-fld-label">TO</div>
            <input type="date" className="k-input" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div>
            <div className="k-fld-label">MEMBER</div>
            <select className="k-input trp-filter__sel" value={memberF} onChange={e => setMemberF(e.target.value)}>
              <option value=''>All members</option>
              {members.map(m => <option key={m.user_id} value={m.user_id}>{m.display_name || m.full_name || m.email}</option>)}
            </select>
          </div>
          <div className="trp-filter__acts">
            <button className="k-btn k-btn--ghost k-btn--sm" onClick={() => { setFrom(weekAgoISO); setTo(todayISO); setMemberF(''); }}>
              Reset
            </button>
            <button className="k-btn k-btn--ghost k-btn--sm" onClick={() => exportCSV(data.entries)} disabled={!data.entries?.length}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 3v8M5 8l3 3 3-3M3 13h10"/></svg>
              CSV
            </button>
          </div>
        </div>
      </section>

      {loading && (
        <div className="k-twocol" aria-busy="true" aria-label="Loading time entries">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
        </div>
      )}

      {!loading && err && (
        <ErrorState
          kind={errorKind(err)}
          grant="viewer access to this project's time entries"
          onRetry={load}
        />
      )}

      {!loading && !err && (
        <>
          {/* Charts row */}
          {data.entries.length > 0 && (
            <div className="k-twocol">
              {/* Daily distribution */}
              <div className="k-card">
                <div className="k-card__head">
                  <div className="k-card__titles">
                    <h3 className="k-card__title">Daily distribution</h3>
                    <Secondary className="k-card__sans" value="दैनिक भार" />
                  </div>
                </div>
                <div className="k-card__body">
                  <DailyChart entries={data.entries} from={from} to={to} />
                </div>
              </div>

              {/* By member */}
              <div className="k-card">
                <div className="k-card__head">
                  <div className="k-card__titles">
                    <h3 className="k-card__title">By member</h3>
                    <Secondary className="k-card__sans" value="सहयोगी-वार" />
                  </div>
                </div>
                <div className="k-card__body">
                  <MemberChart byMember={byMember} />
                </div>
              </div>
            </div>
          )}

          {/* Entries table */}
          {data.entries.length === 0 ? (
            <EmptyState
              illustration="generic"
              title={{ en: 'No entries for this period', hi: 'इस अवधि में कोई प्रविष्टि नहीं' }}
              description="Adjust the date range or the member filter."
            />
          ) : (
            <section className="k-card">
              <div className="k-card__head">
                <div className="k-card__titles">
                  <h3 className="k-card__title">Entries</h3>
                  <Secondary className="k-card__sans" value="विवरण" />
                </div>
              </div>
              {/* Shared module table (see ReportsPage for the same convergence).
                  Headers are English only — 24-bilingual-devanagari.md lists
                  table column headers under "No". HOURS right-aligns because a
                  left-aligned numeric column cannot be scanned for magnitude,
                  which is the only reason anyone reads a column of hours. */}
              <DataTable columns={[
                'Date', 'Member', 'Task', 'Note',
                { label: 'Hours', align: 'right' },
              ]}>
                {data.entries.map((e, i) => {
                  const color    = memberColorMap[e.user_name] || 'var(--k-primary)';
                  const initials = userInitials(e.user_name || '');
                  const dateStr  = e.started_at ? new Date(e.started_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';
                  return (
                    <tr key={e.entry_id || i}>
                      <Td color="var(--ink-3)" mono>{dateStr}</Td>
                      <Td className="trp__member">
                        <span className="trp__avatar trp-av" style={{ '--c': color }}>{initials}</span>
                        <span className="trp__name">{(e.user_name || '—').split(' ')[0]}</span>
                      </Td>
                      <Td className="trp__task">
                        {e.task_title ? <span className="trp__ref">{e.task_ref || 'KAR'}</span> : null}
                        {e.task_title || '—'}
                      </Td>
                      <Td color="var(--ink-3)" className="trp__note">{e.description || e.note || '—'}</Td>
                      <Td align="right" bold mono>{fmtFull(e.minutes)}</Td>
                    </tr>
                  );
                })}
              </DataTable>
            </section>
          )}

          {/* Sanskrit quote */}
          {data.entries.length > 0 && (
            <div className="k-citation">
              <div className="k-citation__sans" lang="sa">कालः सृजति भूतानि</div>
              <div className="k-citation__src">— "Time creates all things." Account for it carefully.</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
