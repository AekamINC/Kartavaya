/**
 * TimeReportPage.jsx — editorial Time Report.
 * Layout: filters card → two-col (daily distribution chart + by member) → entries table → quote
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../lib/api';
import { PageHeader, DataTable, Td } from '../components/editorial';
import { ErrorState, errorKind } from '../components/ui';
import { AVATAR_COLORS, userInitials } from '../lib/utils';

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
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 160, paddingBottom: 24, position: 'relative' }}>
      {days.map((d) => {
        const mins   = dayMins[d.toDateString()] || 0;
        const pct    = (mins / max) * 100;
        const isToday = d.toDateString() === new Date().toDateString();
        return (
          <div key={d.toISOString()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, height: '100%', justifyContent: 'flex-end', gap: 4 }}>
            {mins > 0 && (
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--k-primary)', fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>
                {fmtHours(mins)}
              </div>
            )}
            <div style={{
              width: '100%', background: mins > 0
                ? (isToday ? 'linear-gradient(180deg, var(--k-primary) 0%, var(--k-mid) 100%)' : 'color-mix(in srgb, var(--k-primary) 60%, var(--k-mid))')
                : 'var(--bg-soft)',
              borderRadius: '4px 4px 0 0',
              height: `${Math.max(pct, mins > 0 ? 6 : 2)}%`,
              transition: 'height 0.4s ease',
              minHeight: 4,
            }} />
            <div style={{ fontSize: 10, color: isToday ? 'var(--k-primary)' : 'var(--ink-3)', fontWeight: isToday ? 700 : 400, position: 'absolute', bottom: 0 }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {byMember.map((m, i) => {
        const color    = AVATAR_COLORS[i % AVATAR_COLORS.length];
        const initials = userInitials(m.label);
        return (
          <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 26, height: 26, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
              {initials}
            </span>
            <span style={{ width: 56, fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.label.split(' ')[0]}
            </span>
            <div style={{ flex: 1, height: 6, background: 'var(--bg-soft)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(m.minutes / max) * 100}%`, background: `linear-gradient(90deg, ${color} 0%, color-mix(in srgb, ${color} 60%, var(--k-mid)) 100%)`, borderRadius: 3, transition: 'width 0.4s ease' }} />
            </div>
            <span style={{ width: 36, fontSize: 13, fontWeight: 700, color: 'var(--ink-2)', textAlign: 'right', flexShrink: 0, fontFamily: 'var(--font-display)' }}>
              {fmtHours(m.minutes)}
            </span>
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
    Object.fromEntries(byMember.map((m, i) => [m.label, AVATAR_COLORS[i % AVATAR_COLORS.length]])),
  [byMember]);

  const totalHours = data.total_minutes ? (data.total_minutes / 60).toFixed(1) : '0';

  return (
    <div className="k-screen">
      <PageHeader
        kicker="OPERATIONS"
        title="Time Report"
        sanskrit="काल"
        lede="Hours logged across tasks and members. Filter to investigate."
        right={
          <div className="k-time-total">
            <div className="k-time-total__num">{totalHours}<span className="k-time-total__unit">h</span></div>
            <div className="k-time-total__lbl">TOTAL <span className="k-lbl__in" lang="hi">कुल</span></div>
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
            <select className="k-input" style={{ cursor: 'pointer' }} value={memberF} onChange={e => setMemberF(e.target.value)}>
              <option value=''>All members</option>
              {members.map(m => <option key={m.user_id} value={m.user_id}>{m.display_name || m.full_name || m.email}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-end' }}>
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
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-3)', fontFamily: 'var(--font-display)', fontStyle: 'italic' }}>
          Loading…
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
                    <span className="k-card__sans">दैनिक भार</span>
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
                    <span className="k-card__sans">सहयोगी-वार</span>
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
            <div className="k-empty">
              <div className="k-empty__icon">⏱</div>
              <div className="k-empty__title">No entries for this period</div>
              <div className="k-empty__sub">Adjust the date range or member filter.</div>
            </div>
          ) : (
            <section className="k-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="k-card__head" style={{ padding: '16px 24px' }}>
                <div className="k-card__titles">
                  <h3 className="k-card__title">Entries</h3>
                  <span className="k-card__sans">विवरण</span>
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
                        <span className="trp__avatar" style={{ background: color }}>{initials}</span>
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
