/**
 * ReportsPage.jsx — Generate Report screen.
 * Layout matches the design: two-column builder (left) + sticky preview/export (right).
 * Schedules management toggles below the builder via "Manage schedules" in the header.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { PageHeader } from '../components/editorial';
import { PROJECT_COLORS, userInitials } from '../lib/utils';

const TODAY     = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 1  * 864e5).toISOString().slice(0, 10);
const WEEK_AGO  = new Date(Date.now() - 7  * 864e5).toISOString().slice(0, 10);
const MONTH_AGO = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);

const colorFor = i => PROJECT_COLORS[i % PROJECT_COLORS.length];
const fmtDate   = iso => {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso || '—'; }
};
const fmtDT = dt => {
  try { return new Date(dt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
};

// LocalStorage export history
function loadHistory() {
  try { return JSON.parse(localStorage.getItem('Kartavaya_report_history') || '[]'); }
  catch { return []; }
}
function pushHistory(entry) {
  const h = [entry, ...loadHistory()].slice(0, 8);
  localStorage.setItem('Kartavaya_report_history', JSON.stringify(h));
}

// ── Icons ──────────────────────────────────────────────────────────
function CalIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M5 1.5V4M11 1.5V4M2 7h12"/></svg>;
}
function PlusIcon() {
  return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v10M3 8h10"/></svg>;
}
function TrashIcon() {
  return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5h10M5 5V3h6v2M6 8v4M10 8v4"/></svg>;
}
function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="gr__spin">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeOpacity="0.25"/>
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}
function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8H12.5M9 4.5l3.5 3.5L9 11.5"/>
    </svg>
  );
}

// ── Schedules panel ───────────────────────────────────────────────
const FREQ_OPTS = [
  { value: 'daily',   label: 'Daily',   hi: 'दैनिक' },
  { value: 'weekly',  label: 'Weekly',  hi: 'साप्ताहिक' },
  { value: 'monthly', label: 'Monthly', hi: 'मासिक' },
];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function SchedulesPanel({ teams }) {
  const [teamId,    setTeamId]    = useState(teams[0]?.team_id || '');
  const [schedules, setSchedules] = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [showForm,  setShowForm]  = useState(false);
  const [submitting,setSubmitting]= useState(false);
  const [form, setForm] = useState({
    frequency: 'weekly', file_formats: ['pdf'], recipients: '',
    day_of_week: 1, day_of_month: 1, send_hour_utc: 2,
  });

  const loadSchedules = useCallback((tid) => {
    if (!tid) return;
    setLoading(true);
    api.get(`/reports/schedules/${tid}`)
      .then(r => setSchedules(Array.isArray(r.data) ? r.data : []))
      .catch(() => setSchedules([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadSchedules(teamId); }, [teamId, loadSchedules]);

  const toggleFmt = fmt => setForm(f => ({
    ...f,
    file_formats: f.file_formats.includes(fmt)
      ? f.file_formats.filter(x => x !== fmt)
      : [...f.file_formats, fmt],
  }));

  async function createSchedule(e) {
    e.preventDefault();
    const recipients = form.recipients.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (!recipients.length || !form.file_formats.length) return;
    setSubmitting(true);
    try {
      const r = await api.post(`/reports/schedules/${teamId}`, {
        frequency:     form.frequency,
        file_formats:  form.file_formats,
        recipients,
        send_hour_utc: Number(form.send_hour_utc),
        day_of_week:   form.frequency === 'weekly'  ? Number(form.day_of_week)  : null,
        day_of_month:  form.frequency === 'monthly' ? Number(form.day_of_month) : null,
      });
      setSchedules(s => [r.data, ...s]);
      setShowForm(false);
      setForm(f => ({ ...f, recipients: '' }));
    } catch (_) {}
    finally { setSubmitting(false); }
  }

  async function del(id) {
    try {
      await api.delete(`/reports/schedules/${id}`);
      setSchedules(s => s.filter(x => x.schedule_id !== id));
    } catch (_) {}
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Project + new button */}
      <section className="k-card">
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <div className="k-fld-label">PROJECT · योजना</div>
            <select className="k-input" value={teamId} onChange={e => setTeamId(e.target.value)} style={{ cursor: 'pointer' }}>
              {teams.map(t => <option key={t.team_id} value={t.team_id}>{t.name}</option>)}
            </select>
          </div>
          <button className="k-btn k-btn--primary k-btn--sm" onClick={() => setShowForm(s => !s)}>
            <PlusIcon /> New schedule
          </button>
        </div>
      </section>

      {/* Create form */}
      {showForm && (
        <section className="k-card">
          <div className="k-card__head">
            <div className="k-card__titles">
              <h3 className="k-card__title">New automated schedule</h3>
              <span className="k-card__sans">स्वचालित प्रेषण</span>
            </div>
          </div>
          <form onSubmit={createSchedule}>
            <div className="k-card__body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Frequency */}
              <div>
                <div className="k-fld-label">FREQUENCY · आवृत्ति</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  {FREQ_OPTS.map(opt => (
                    <button key={opt.value} type="button"
                      onClick={() => setForm(f => ({ ...f, frequency: opt.value }))}
                      style={{
                        padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
                        fontSize: 13, fontWeight: 600,
                        border: form.frequency === opt.value
                          ? '1.5px solid var(--k-teal)' : '1.5px solid var(--rule)',
                        background: form.frequency === opt.value
                          ? 'color-mix(in srgb, var(--k-teal) 10%, transparent)' : 'var(--surface)',
                        color: form.frequency === opt.value ? 'var(--k-teal)' : 'var(--ink-2)',
                      }}>
                      {opt.label}
                      <span style={{ display: 'block', fontSize: 10, fontWeight: 400, color: 'var(--ink-3)', marginTop: 1 }}>{opt.hi}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Day of week */}
              {form.frequency === 'weekly' && (
                <div>
                  <div className="k-fld-label">DAY · दिन</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    {DAYS.map((d, i) => (
                      <button key={d} type="button"
                        onClick={() => setForm(f => ({ ...f, day_of_week: i }))}
                        style={{
                          width: 38, height: 38, borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                          border: form.day_of_week === i ? '1.5px solid var(--k-teal)' : '1.5px solid var(--rule)',
                          background: form.day_of_week === i ? 'color-mix(in srgb, var(--k-teal) 10%, transparent)' : 'var(--surface)',
                          color: form.day_of_week === i ? 'var(--k-teal)' : 'var(--ink-3)',
                        }}>{d}</button>
                    ))}
                  </div>
                </div>
              )}
              {/* Day of month */}
              {form.frequency === 'monthly' && (
                <div>
                  <div className="k-fld-label">DAY OF MONTH · दिनांक</div>
                  <input type="number" min="1" max="28" className="k-input"
                    style={{ width: 80, marginTop: 6 }}
                    value={form.day_of_month}
                    onChange={e => setForm(f => ({ ...f, day_of_month: e.target.value }))} />
                </div>
              )}
              {/* Send hour */}
              <div>
                <div className="k-fld-label">SEND TIME (UTC) · समय</div>
                <select className="k-input" style={{ width: 130, marginTop: 6, cursor: 'pointer' }}
                  value={form.send_hour_utc}
                  onChange={e => setForm(f => ({ ...f, send_hour_utc: e.target.value }))}>
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2, '0')}:00 UTC</option>
                  ))}
                </select>
              </div>
              {/* Formats */}
              <div>
                <div className="k-fld-label">FORMAT · प्रारूप</div>
                <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                  {['pdf', 'excel'].map(fmt => (
                    <label key={fmt} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}>
                      <input type="checkbox" checked={form.file_formats.includes(fmt)}
                        onChange={() => toggleFmt(fmt)} style={{ accentColor: 'var(--k-teal)' }} />
                      {fmt.toUpperCase()}
                    </label>
                  ))}
                </div>
              </div>
              {/* Recipients */}
              <div>
                <div className="k-fld-label">RECIPIENTS · प्राप्तकर्ता</div>
                <textarea className="k-input"
                  placeholder="email@example.com, another@example.com"
                  rows={3} value={form.recipients}
                  onChange={e => setForm(f => ({ ...f, recipients: e.target.value }))}
                  style={{ marginTop: 6, resize: 'vertical' }} />
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>Separate with commas or new lines.</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="k-btn k-btn--primary k-btn--sm" disabled={submitting}>
                  {submitting ? 'Saving…' : 'Create schedule'}
                </button>
                <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </div>
          </form>
        </section>
      )}

      {/* List */}
      {loading ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-3)', fontFamily: 'var(--font-display)', fontStyle: 'italic' }}>Loading…</div>
      ) : schedules.length === 0 ? (
        <div className="k-empty">
          <div className="k-empty__icon"><CalIcon /></div>
          <div className="k-empty__title">No schedules yet</div>
          <div className="k-empty__sub">Create one to auto-deliver reports to your inbox.</div>
        </div>
      ) : (
        <section className="k-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="k-card__head" style={{ padding: '16px 24px' }}>
            <div className="k-card__titles">
              <h3 className="k-card__title">Active schedules</h3>
              <span className="k-card__sans">स्वचालित सूची</span>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-soft)' }}>
                  {[['FREQUENCY','आवृत्ति'],['FORMAT','प्रारूप'],['RECIPIENTS','प्राप्तकर्ता'],['NEXT RUN','अगला'],['LAST SENT','अंतिम'],['','']].map(([en, hi]) => (
                    <th key={en} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 700, color: 'var(--ink-3)', borderBottom: '1px solid var(--rule-soft)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>
                      {en}{hi && <span style={{ fontFamily: 'var(--font-hindi)', fontWeight: 400, fontSize: 10, color: 'var(--ink-faint)', textTransform: 'none', letterSpacing: 0, marginLeft: 4 }}>{hi}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedules.map(s => (
                  <tr key={s.schedule_id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                    <td style={{ padding: '11px 16px' }}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, background: 'color-mix(in srgb, var(--k-teal) 12%, transparent)', color: 'var(--k-teal)', fontWeight: 700, fontSize: 11, textTransform: 'capitalize' }}>
                        {s.frequency}
                      </span>
                    </td>
                    <td style={{ padding: '11px 16px', color: 'var(--ink-2)', fontSize: 12 }}>{(s.file_formats || []).map(f => f.toUpperCase()).join(' + ')}</td>
                    <td style={{ padding: '11px 16px', color: 'var(--ink-2)', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(s.recipients || []).join(', ')}</td>
                    <td style={{ padding: '11px 16px', color: 'var(--ink-3)', fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDT(s.next_run_at)}</td>
                    <td style={{ padding: '11px 16px', color: 'var(--ink-3)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {s.last_sent_at ? fmtDT(s.last_sent_at) : <span style={{ color: 'var(--ink-faint)' }}>Never</span>}
                    </td>
                    <td style={{ padding: '11px 16px' }}>
                      <button className="k-btn k-btn--ghost k-btn--sm"
                        style={{ color: '#dc2626', borderColor: 'transparent' }}
                        onClick={() => del(s.schedule_id)} title="Delete schedule">
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export default function ReportsPage({ teams: propTeams }) {
  const [teams,      setTeams]      = useState(Array.isArray(propTeams) ? propTeams : []);
  const [allMembers, setAllMembers] = useState({});   // { team_id: [{user_id, display_name}] }
  const [kind,       setKind]       = useState('weekly');
  const [from,       setFrom]       = useState(WEEK_AGO);
  const [to,         setTo]         = useState(TODAY);
  const [projectIds, setProjectIds] = useState([]);
  const [memberIds,  setMemberIds]  = useState([]);
  const [sections,   setSections]   = useState({
    summary: true, projects: true, leaderboard: true, champion: true,
    tasks: true, throughput: true, time: false, attachments: false,
  });
  const [busy,       setBusy]       = useState(null);   // null | 'pdf' | 'excel'
  const [preview,    setPreview]    = useState(null);
  const [prevLoading,setPrevLoading]= useState(false);
  const [history,    setHistory]    = useState(() => loadHistory());
  const [showSchedules, setShowSchedules] = useState(false);

  // Load teams
  useEffect(() => {
    if (propTeams?.length) { setTeams(propTeams); return; }
    api.get('/teams').then(r => setTeams(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, [propTeams]);

  // Init project selection when teams first load
  useEffect(() => {
    if (teams.length && projectIds.length === 0) {
      setProjectIds(teams.map(t => t.team_id));
    }
  }, [teams]); // eslint-disable-line

  // Snap date range when kind changes
  useEffect(() => {
    if (kind === 'daily')   { setFrom(YESTERDAY); setTo(TODAY); }
    if (kind === 'weekly')  { setFrom(WEEK_AGO);  setTo(TODAY); }
    if (kind === 'monthly') { setFrom(MONTH_AGO); setTo(TODAY); }
  }, [kind]);

  // Fetch members for any newly-selected projects
  useEffect(() => {
    const unloaded = projectIds.filter(id => !allMembers[id]);
    if (!unloaded.length) return;
    Promise.all(
      unloaded.map(id =>
        api.get(`/teams/${id}/members`)
          .then(r => ({ id, members: Array.isArray(r.data) ? r.data : [] }))
          .catch(() => ({ id, members: [] }))
      )
    ).then(results => {
      setAllMembers(prev => {
        const next = { ...prev };
        results.forEach(({ id, members }) => { next[id] = members; });
        return next;
      });
    });
  }, [projectIds]); // eslint-disable-line

  // Init member selection once members load
  useEffect(() => {
    const allM = projectIds.flatMap(id => allMembers[id] || []);
    const unique = [...new Map(allM.map(m => [m.user_id, m])).values()];
    if (memberIds.length === 0 && unique.length) {
      setMemberIds(unique.map(m => m.user_id));
    }
  }, [allMembers, projectIds]); // eslint-disable-line

  // Fetch preview stats (debounced, aggregated across all selected projects)
  useEffect(() => {
    if (!projectIds.length || !from || !to) { setPreview(null); return; }
    const t = setTimeout(async () => {
      setPrevLoading(true);
      try {
        const results = await Promise.all(
          projectIds.map(id =>
            api.get(`/reports/data/${id}`, { params: { from, to } })
              .then(r => r.data)
              .catch(() => null)
          )
        );
        const ok = results.filter(Boolean);
        const agg = ok.reduce((acc, d) => {
          acc.total_minutes += d.total_minutes || 0;
          acc.tasks.todo        += d.tasks?.todo        || 0;
          acc.tasks.in_progress += d.tasks?.in_progress || 0;
          acc.tasks.done        += d.tasks?.done        || 0;
          acc.tasks.overdue     += d.tasks?.overdue     || 0;
          return acc;
        }, { total_minutes: 0, tasks: { todo: 0, in_progress: 0, done: 0, overdue: 0 } });
        setPreview(ok.length ? agg : null);
      } catch { setPreview(null); }
      finally { setPrevLoading(false); }
    }, 700);
    return () => clearTimeout(t);
  }, [projectIds, from, to]);

  const toggleProject = id => setProjectIds(p =>
    p.includes(id) ? p.filter(x => x !== id) : [...p, id]
  );
  const toggleMember  = id => setMemberIds(p =>
    p.includes(id) ? p.filter(x => x !== id) : [...p, id]
  );
  const toggleSection = k  => setSections(s => ({ ...s, [k]: !s[k] }));

  const uniqueMembers = [
    ...new Map(
      projectIds.flatMap(id => allMembers[id] || []).map(m => [m.user_id, m])
    ).values(),
  ];

  const rangeLabel    = from === to ? fmtDate(from) : `${fmtDate(from)} — ${fmtDate(to)}`;
  const sectionsOn    = Object.values(sections).filter(Boolean).length;
  const approxPages   = Math.max(2, Math.round(sectionsOn * 1.2));
  const tasks         = preview?.tasks || {};
  const totalMins     = preview?.total_minutes || 0;
  const totalH        = totalMins ? `${Math.floor(totalMins / 60)}h ${totalMins % 60}m` : '—';

  async function doDownload(fmt) {
    if (!projectIds.length) return;
    setBusy(fmt);
    const ext = fmt === 'excel' ? 'xlsx' : 'pdf';
    try {
      for (const tid of projectIds) {
        const team  = teams.find(t => t.team_id === tid);
        const tname = (team?.name || 'report').toLowerCase().replace(/\s+/g, '-');
        const fname = `Kartavaya-${tname}-${from}-${to}.${ext}`;
        const res   = await api.get(`/reports/download/${tid}`, {
          params: { from, to, fmt },
          responseType: 'blob',
        });
        const url = URL.createObjectURL(res.data);
        const a   = document.createElement('a');
        a.href = url; a.download = fname; a.click();
        URL.revokeObjectURL(url);
        const entry = {
          kind, fmt: ext.toUpperCase(), name: fname, who: 'You',
          when: new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
        };
        pushHistory(entry);
        setHistory(loadHistory());
      }
    } catch (_) {}
    finally { setBusy(null); }
  }

  // Empty state
  if (!propTeams && teams.length === 0) {
    return (
      <div className="k-screen">
        <PageHeader kicker="OPERATIONS" title="Reports" sanskrit="प्रतिवेदन"
          lede="Generate and schedule project reports." />
        <div className="k-empty">
          <div className="k-empty__icon"><CalIcon /></div>
          <div className="k-empty__title">No projects found</div>
          <div className="k-empty__sub">Create or join a project to generate reports.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="k-screen">
      <PageHeader
        kicker="Operations · Reports"
        title="Generate report"
        sanskrit="प्रतिवेदन निर्माण"
        lede="Build a report on demand. Pick your scope, choose what to include, and export to PDF or Excel."
        right={
          <div className="gr__phead-right">
            <span className="gr__phead-meta">
              <b>Last automated send</b>
              <span>
                {(() => {
                  const auto = history.find(h => h.who?.startsWith('Auto'));
                  return auto ? auto.when : '—';
                })()}
              </span>
            </span>
            <button className="k-btn k-btn--ghost k-btn--sm" onClick={() => setShowSchedules(s => !s)}>
              <CalIcon /> {showSchedules ? 'Hide schedules' : 'Manage schedules'}
            </button>
          </div>
        }
      />

      <div className="gr">
        {/* ── LEFT: builder ────────────────────────────────────── */}
        <div className="gr__form">

          {/* 1 · Report type */}
          <div className="gr__block">
            <div className="gr__block-h">
              <span className="gr__step">1</span>
              <h3>Report type</h3>
              <span className="gr__block-sans">प्रकार</span>
            </div>
            <div className="gr__seg">
              {[
                ['daily',   'Daily',   'past 1 day'],
                ['weekly',  'Weekly',  'past 7 days'],
                ['monthly', 'Monthly', 'past 30 days'],
                ['custom',  'Custom',  'pick range'],
              ].map(([k, lbl, hint]) => (
                <button key={k} className={'gr__seg-btn' + (kind === k ? ' is-active' : '')} onClick={() => setKind(k)}>
                  <span className="gr__seg-lbl">{lbl}</span>
                  <span className="gr__seg-hint">{hint}</span>
                </button>
              ))}
            </div>
            <div className="gr__range">
              <label>
                <span>From</span>
                <input type="date" value={from} onChange={e => { setFrom(e.target.value); setKind('custom'); }} />
              </label>
              <label>
                <span>To</span>
                <input type="date" value={to} onChange={e => { setTo(e.target.value); setKind('custom'); }} />
              </label>
              <span className="gr__range-pill">{rangeLabel}</span>
            </div>
          </div>

          {/* 2 · Projects */}
          <div className="gr__block">
            <div className="gr__block-h">
              <span className="gr__step">2</span>
              <h3>Projects</h3>
              <span className="gr__block-sans">परियोजनाएँ</span>
              <button className="gr__block-action" onClick={() => setProjectIds(teams.map(t => t.team_id))}>All</button>
              <button className="gr__block-action" onClick={() => setProjectIds([])}>None</button>
            </div>
            <div className="gr__chips">
              {teams.map((t, i) => (
                <button key={t.team_id}
                  className={'gr__chip' + (projectIds.includes(t.team_id) ? ' is-active' : '')}
                  onClick={() => toggleProject(t.team_id)}>
                  <i className="gr__chip-dot" style={{ background: colorFor(i) }} />
                  <span className="gr__chip-name">{t.name}</span>
                  {t.task_count !== null && t.task_count !== undefined && (
                    <span className="gr__chip-hi">{t.task_count} tasks</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* 3 · Team members */}
          <div className="gr__block">
            <div className="gr__block-h">
              <span className="gr__step">3</span>
              <h3>Team members</h3>
              <span className="gr__block-sans">सहयोगी</span>
              <button className="gr__block-action" onClick={() => setMemberIds(uniqueMembers.map(m => m.user_id))}>All</button>
              <button className="gr__block-action" onClick={() => setMemberIds([])}>None</button>
            </div>
            {projectIds.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)', fontStyle: 'italic' }}>Select a project above first.</p>
            ) : uniqueMembers.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)', fontStyle: 'italic' }}>Loading members…</p>
            ) : (
              <div className="gr__people">
                {uniqueMembers.map((m, i) => (
                  <button key={m.user_id}
                    className={'gr__person' + (memberIds.includes(m.user_id) ? ' is-active' : '')}
                    onClick={() => toggleMember(m.user_id)}>
                    <span className="gr__person-av" style={{ background: colorFor(i) }}>
                      {userInitials(m.display_name)}
                    </span>
                    <span className="gr__person-name">{m.display_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 4 · Sections */}
          <div className="gr__block">
            <div className="gr__block-h">
              <span className="gr__step">4</span>
              <h3>Include in report</h3>
              <span className="gr__block-sans">समावेश</span>
            </div>
            <div className="gr__toggles">
              {[
                ['summary',     'Summary KPIs',          'Completed · Due · Awaiting · Overdue'],
                ['projects',    'Per-project breakdown',  'One row per project, with counts'],
                ['leaderboard', 'Team leaderboard',       'Ranking by completed tasks'],
                ['champion',    'Champion call-out',      'Top contributor in the period'],
                ['throughput',  'Throughput chart',       'Bars per day or per week'],
                ['tasks',       'Detailed task list',     'Every task with status, due, owner'],
                ['time',        'Time tracking',          'Hours logged per task and per person'],
                ['attachments', 'Attachment manifest',    'Files added in the period'],
              ].map(([k, lbl, hint]) => (
                <label key={k} className={'gr__toggle' + (sections[k] ? ' is-on' : '')}>
                  <input type="checkbox" checked={sections[k]} onChange={() => toggleSection(k)} />
                  <span className="gr__toggle-mark" />
                  <span className="gr__toggle-body">
                    <span className="gr__toggle-lbl">{lbl}</span>
                    <span className="gr__toggle-hint">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* 5 · Delivery */}
        </div>

        {/* ── RIGHT: preview + export + history ────────────────── */}
        <aside className="gr__side">

          {/* Preview paper */}
          <div className="gr__preview">
            <div className="gr__preview-paper">
              <div className="gr__preview-brand">
                <span className="gr__preview-brand-main">Kartavaya</span>
                <span className="gr__preview-brand-hi">कर्तव्य</span>
              </div>
              <div className="gr__preview-kicker">
                {kind.toUpperCase()} REPORT · {rangeLabel}
              </div>
              <h2 className="gr__preview-h2">Aekam Workspace</h2>
              <div className="gr__preview-scope">
                <span><b>{memberIds.length}</b> of {uniqueMembers.length} members</span>
                <i>·</i>
                <span><b>{projectIds.length}</b> of {teams.length} projects</span>
              </div>

              {sections.summary && (
                <div className="gr__preview-stats">
                  {prevLoading ? (
                    <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '8px 0', color: 'var(--ink-3)', fontSize: 12, fontStyle: 'italic' }}>
                      Loading…
                    </div>
                  ) : (
                    <>
                      <div><b>{tasks.done        || 0}</b><i>Done</i></div>
                      <div><b>{tasks.todo        || 0}</b><i>Due</i></div>
                      <div><b>{tasks.in_progress || 0}</b><i>Active</i></div>
                      <div className={tasks.overdue > 0 ? 'is-bad' : ''}><b>{tasks.overdue || 0}</b><i>Overdue</i></div>
                    </>
                  )}
                </div>
              )}

              <div className="gr__preview-sections">
                {sections.projects    && <div className="gr__preview-sec"><i>§</i> Per-project breakdown ({projectIds.length} project{projectIds.length !== 1 ? 's' : ''})</div>}
                {sections.leaderboard && <div className="gr__preview-sec"><i>§</i> Team leaderboard ({memberIds.length} member{memberIds.length !== 1 ? 's' : ''})</div>}
                {sections.champion    && <div className="gr__preview-sec"><i>§</i> Champion of the period</div>}
                {sections.throughput  && <div className="gr__preview-sec"><i>§</i> Throughput chart</div>}
                {sections.tasks       && <div className="gr__preview-sec"><i>§</i> Detailed task list</div>}
                {sections.time        && <div className="gr__preview-sec"><i>§</i> Time tracking — {totalH}</div>}
                {sections.attachments && <div className="gr__preview-sec"><i>§</i> Attachment manifest</div>}
              </div>

              <div className="gr__preview-foot">
                Generated <b>on demand</b> · Aekam Inc<br />
                <span>कर्तव्ये अधिकारस्ते — Bhagavad Gita 2.47</span>
              </div>
            </div>
            <div className="gr__preview-label">Live preview · approx. cover page</div>
          </div>

          {/* Export buttons */}
          <div className="gr__export">
            <div className="gr__export-h">
              Export <span className="gr__export-hi">निर्यात</span>
            </div>

            <button
              className={'gr__export-btn gr__export-btn--pdf' + (busy === 'pdf' ? ' is-busy' : '')}
              onClick={() => doDownload('pdf')}
              disabled={busy !== null || !projectIds.length}
            >
              <span className="gr__fmt"><span className="gr__fmt-tag">PDF</span></span>
              <span className="gr__export-body">
                <b>Generate PDF</b>
                <span>Editorial layout · approx. {approxPages} pages{projectIds.length > 1 ? ` × ${projectIds.length} projects` : ''}</span>
              </span>
              <span className="gr__export-go">{busy === 'pdf' ? <Spinner /> : <Arrow />}</span>
            </button>

            <button
              className={'gr__export-btn gr__export-btn--xlsx' + (busy === 'excel' ? ' is-busy' : '')}
              onClick={() => doDownload('excel')}
              disabled={busy !== null || !projectIds.length}
            >
              <span className="gr__fmt"><span className="gr__fmt-tag gr__fmt-tag--xlsx">XLSX</span></span>
              <span className="gr__export-body">
                <b>Generate Excel workbook</b>
                <span>{sectionsOn} sheets · formulas included{projectIds.length > 1 ? ` × ${projectIds.length} projects` : ''}</span>
              </span>
              <span className="gr__export-go">{busy === 'excel' ? <Spinner /> : <Arrow />}</span>
            </button>

            <div className="gr__export-meta">
              <div>
                <b>Where it goes</b>
                <span>
                  {`Saved to your Downloads folder.${projectIds.length > 1 ? ` ${projectIds.length} files, one per project.` : ''}`}
                </span>
              </div>
              <div>
                <b>Privacy</b>
                <span>Only data you can already see in Kartavaya is included.</span>
              </div>
            </div>
          </div>

          {/* Recent exports */}
          <div className="gr__history">
            <div className="gr__history-h">
              Recent exports
              <span className="gr__history-hi">पूर्व निर्यात</span>
            </div>
            {history.length === 0 ? (
              <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--ink-faint)', fontStyle: 'italic' }}>
                No exports this session.
              </div>
            ) : (
              history.map((r, i) => (
                <div key={i} className="gr__hrow">
                  <span className={`gr__hrow-fmt gr__hrow-fmt--${r.fmt.toLowerCase()}`}>{r.fmt}</span>
                  <div className="gr__hrow-body">
                    <div className="gr__hrow-name">{r.name}</div>
                    <div className="gr__hrow-meta">{r.who} · {r.when}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      {/* Schedules panel — toggled by header button */}
      {showSchedules && (
        <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--rule-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 20 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 500, color: 'var(--ink)', letterSpacing: '-0.005em' }}>
              Automated schedules
            </h2>
            <span style={{ fontFamily: 'var(--font-hindi)', fontSize: 14, color: 'var(--ink-3)' }}>स्वचालित प्रेषण</span>
          </div>
          <SchedulesPanel teams={teams} />
        </div>
      )}

      <div className="k-citation">
        <div className="k-citation__sans" lang="sa">कालः सृजति भूतानि कालः संहरते प्रजाः</div>
        <div className="k-citation__src">— "Time creates beings, time dissolves them." Track it carefully.</div>
      </div>
    </div>
  );
}
