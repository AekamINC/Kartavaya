/**
 * ReportsPage.jsx — Generate Report screen.
 * Layout matches the design: two-column builder (left) + sticky preview/export (right).
 * Schedules management toggles below the builder via "Manage schedules" in the header.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { api, rows as asRows, body as asBody } from '../lib/api';
import { PageHeader, DataTable, Td } from '../components/editorial';
import { ErrorState, errorKind, SkeletonText } from '../components/ui';
import { useToast } from '../components/ui/toast';
import { PROJECT_COLORS, userInitials } from '../lib/utils';
import { useLanguage } from '../components/CustomizePanel';
import { secondaryOf } from '../lib/labels';
import { Secondary } from '../components/Bilingual';

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
  const { pushToast } = useToast();
  // ONE LABEL SHAPE — `.rep-seg__hi` is not in `[data-language="en"]`'s
  // six-name list. Read once because FREQ_OPTS is mapped.
  const lang = useLanguage();
  const [teamId,    setTeamId]    = useState(teams[0]?.team_id || '');
  const [schedules, setSchedules] = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [err,       setErr]       = useState(null);
  const [showForm,  setShowForm]  = useState(false);
  const [submitting,setSubmitting]= useState(false);
  const [form, setForm] = useState({
    frequency: 'weekly', file_formats: ['pdf'], recipients: '',
    day_of_week: 1, day_of_month: 1, send_hour_utc: 2,
  });

  /* Previously `.catch(() => setSchedules([]))`, so a 403 or a 500 rendered the
     "No schedules yet" empty state and invited the user to create a schedule
     that may already exist. Classified and rendered as a real failure state
     now (02-common-components.md). */
  const loadSchedules = useCallback((tid) => {
    if (!tid) return;
    setLoading(true);
    setErr(null);
    api.get(`/reports/schedules/${tid}`)
      .then(r => setSchedules(asRows(r)))
      .catch(e => { setErr(e); setSchedules([]); })
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
      setSchedules(s => [asBody(r), ...s]);
      setShowForm(false);
      setForm(f => ({ ...f, recipients: '' }));
    } catch (e) {
      // Was `catch (_) {}`. A rejected create closed nothing, added nothing and
      // said nothing — the form simply sat there, so the user pressed Create
      // again. On a schedule that DID save before erroring, that is a duplicate
      // recurring email to a client.
      pushToast({
        type: 'error',
        title: 'Could not create the schedule',
        message: e?.response?.data?.detail || 'Try again.',
      });
    } finally { setSubmitting(false); }
  }

  async function del(id) {
    try {
      await api.delete(`/reports/schedules/${id}`);
      setSchedules(s => s.filter(x => x.schedule_id !== id));
    } catch (e) {
      // Also `catch (_) {}` before: a failed delete left the row on screen with
      // no explanation, which reads as the button being broken.
      pushToast({
        type: 'error',
        title: 'Could not delete the schedule',
        message: e?.response?.data?.detail || 'Try again.',
      });
    }
  }

  return (
    <div className="rep-page">
      {/* Project + new button */}
      <section className="k-card">
        <div className="rep-bar">
          <div className="rep-bar__grow">
            <div className="k-fld-label">PROJECT</div>
            <select className="k-input rep-sel" value={teamId} onChange={e => setTeamId(e.target.value)}>
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
              <Secondary className="k-card__sans" value="स्वचालित प्रेषण" />
            </div>
          </div>
          <form onSubmit={createSchedule}>
            <div className="k-card__body rep-form">
              {/* Frequency */}
              <div>
                <div className="k-fld-label">FREQUENCY</div>
                <div className="rep-seg">
                  {FREQ_OPTS.map(opt => {
                    const oi = secondaryOf(opt.hi, lang);
                    return (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={form.frequency === opt.value}
                      className={`rep-seg__btn${form.frequency === opt.value ? ' is-on' : ''}`}
                      onClick={() => setForm(f => ({ ...f, frequency: opt.value }))}
                    >
                      {opt.label}
                      {oi.secondary && (
                        <Secondary className="rep-seg__hi" value={oi.secondary} />
                      )}
                    </button>
                    );
                  })}
                </div>
              </div>
              {/* Day of week */}
              {form.frequency === 'weekly' && (
                <div>
                  <div className="k-fld-label">DAY</div>
                  <div className="rep-seg">
                    {DAYS.map((d, i) => (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={form.day_of_week === i}
                        className={`rep-seg__btn rep-seg__btn--day${form.day_of_week === i ? ' is-on' : ''}`}
                        onClick={() => setForm(f => ({ ...f, day_of_week: i }))}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* Day of month */}
              {form.frequency === 'monthly' && (
                <div>
                  <div className="k-fld-label">DAY OF MONTH</div>
                  <input
                    type="number" min="1" max="28"
                    className="k-input rep-num"
                    aria-label="Day of month"
                    value={form.day_of_month}
                    onChange={e => setForm(f => ({ ...f, day_of_month: e.target.value }))}
                  />
                </div>
              )}
              {/* Send hour */}
              <div>
                <div className="k-fld-label">SEND TIME (UTC)</div>
                <select
                  className="k-input rep-sel rep-sel--time"
                  aria-label="Send time in UTC"
                  value={form.send_hour_utc}
                  onChange={e => setForm(f => ({ ...f, send_hour_utc: e.target.value }))}
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2, '0')}:00 UTC</option>
                  ))}
                </select>
              </div>
              {/* Formats */}
              <div>
                <div className="k-fld-label">FORMAT</div>
                <div className="rep-fmt">
                  {['pdf', 'excel'].map(fmt => (
                    <label key={fmt} className="rep-fmt__l">
                      <input
                        type="checkbox"
                        className="rep-fmt__cb"
                        checked={form.file_formats.includes(fmt)}
                        onChange={() => toggleFmt(fmt)}
                      />
                      {fmt.toUpperCase()}
                    </label>
                  ))}
                </div>
              </div>
              {/* Recipients */}
              <div>
                <div className="k-fld-label">RECIPIENTS</div>
                <textarea
                  className="k-input rep-ta"
                  aria-label="Recipients"
                  placeholder="name@example.com, another@example.com"
                  rows={3}
                  value={form.recipients}
                  onChange={e => setForm(f => ({ ...f, recipients: e.target.value }))}
                />
                <div className="rep-hint">Separate with commas or new lines.</div>
              </div>
              <div className="rep-acts">
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
        <div className="k-card" aria-busy="true" aria-label="Loading schedules"><SkeletonText width="40%" height={14} /></div>
      ) : err ? (
        <ErrorState
          kind={errorKind(err)}
          grant="owner access to this project"
          onRetry={() => loadSchedules(teamId)}
        />
      ) : schedules.length === 0 ? (
        <div className="k-empty">
          <div className="k-empty__icon"><CalIcon /></div>
          <div className="k-empty__title">No schedules yet</div>
          <div className="k-empty__sub">Create one to auto-deliver reports to your inbox.</div>
        </div>
      ) : (
        <section className="k-card">
          <div className="k-card__head">
            <div className="k-card__titles">
              <h3 className="k-card__title">Active schedules</h3>
              <Secondary className="k-card__sans" value="स्वचालित सूची" />
            </div>
          </div>
          {/* One table component, not a tenth hand-rolled one. `DataTable`/`Td`
              from components/editorial is the module-surface table already used
              by Vikray, Prachar, Dristi, Vetana and Pahchan; it brings the
              sticky header, the --ix-scaled row hover and right-align/mono
              support that this hand-rolled copy never had.

              Column headers are English only: 24-bilingual-devanagari.md puts
              table column headers on the "No" list. */}
          <DataTable columns={['Frequency', 'Format', 'Recipients', 'Next run', 'Last sent', '']}>
            {schedules.map(s => (
              <tr key={s.schedule_id}>
                <Td>
                  <span className="k-statuschip rep-chip--cap" style={{ '--c': 'var(--primary)' }}>
                    <span className="k-statuschip__dot" />
                    {s.frequency}
                  </span>
                </Td>
                <Td color="var(--ink-2)">{(s.file_formats || []).map(f => f.toUpperCase()).join(' + ')}</Td>
                <Td color="var(--ink-2)" className="rp-sched__rcpt">{(s.recipients || []).join(', ')}</Td>
                <Td color="var(--ink-3)" mono>{fmtDT(s.next_run_at)}</Td>
                <Td color="var(--ink-3)" mono>
                  {s.last_sent_at ? fmtDT(s.last_sent_at) : 'Never'}
                </Td>
                <Td align="right">
                  <button className="k-btn k-btn--ghost k-btn--sm rp-sched__del"
                    onClick={() => del(s.schedule_id)} title="Delete schedule"
                    aria-label={`Delete ${s.frequency} schedule`}>
                    <TrashIcon />
                  </button>
                </Td>
              </tr>
            ))}
          </DataTable>
        </section>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export default function ReportsPage({ teams: propTeams }) {
  const [teams,      setTeams]      = useState(Array.isArray(propTeams) ? propTeams : []);
  const [allMembers, setAllMembers] = useState({});   // { team_id: [{user_id, display_name}] }
  /**
   * Project ids whose `/teams/{id}/members` call FAILED, kept apart from ids
   * that simply have not answered yet.
   *
   * Without this the catch below folded a failure into `members: []`, and the
   * panel's only non-empty branch was `uniqueMembers.length === 0 ? 'Loading
   * members…'` — so a 500 left "Loading members…" on screen permanently, and a
   * project that genuinely has no members said the same thing. A spinner that
   * never resolves is the one failure mode a person will wait through instead
   * of retrying.
   */
  const [memberErrs, setMemberErrs] = useState({});   // { team_id: true }
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
  const loadMembers = useCallback((ids) => {
    if (!ids.length) return;
    setMemberErrs(prev => {
      const next = { ...prev };
      ids.forEach(id => { delete next[id]; });
      return next;
    });
    Promise.all(
      ids.map(id =>
        api.get(`/teams/${id}/members`)
          .then(r => ({ id, members: Array.isArray(r.data) ? r.data : [] }))
          .catch(() => ({ id, failed: true }))
      )
    ).then(results => {
      setAllMembers(prev => {
        const next = { ...prev };
        results.forEach(({ id, members, failed }) => { if (!failed) next[id] = members; });
        return next;
      });
      const failedIds = results.filter(r => r.failed).map(r => r.id);
      if (failedIds.length) {
        setMemberErrs(prev => {
          const next = { ...prev };
          failedIds.forEach(id => { next[id] = true; });
          return next;
        });
      }
    });
  }, []);

  useEffect(() => {
    loadMembers(projectIds.filter(id => !allMembers[id] && !memberErrs[id]));
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

  // A selected project that has neither answered nor failed is still in flight;
  // one that failed is not going to arrive on its own.
  const membersFailed  = projectIds.some(id => memberErrs[id]);
  const membersPending = projectIds.some(id => !allMembers[id] && !memberErrs[id]);

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
              <Secondary className="gr__block-sans" value="प्रकार" />
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
              <Secondary className="gr__block-sans" value="परियोजनाएँ" />
              <button className="gr__block-action" onClick={() => setProjectIds(teams.map(t => t.team_id))}>All</button>
              <button className="gr__block-action" onClick={() => setProjectIds([])}>None</button>
            </div>
            <div className="gr__chips">
              {teams.map((t, i) => (
                <button key={t.team_id}
                  className={'gr__chip' + (projectIds.includes(t.team_id) ? ' is-active' : '')}
                  onClick={() => toggleProject(t.team_id)}>
                  <i className="gr__chip-dot rep-swatch" style={{ '--c': colorFor(i) }} />
                  <span className="gr__chip-name">{t.name}</span>
                  {t.task_count !== null && t.task_count !== undefined && (
                    <span className="gr__chip-n">{t.task_count} tasks</span>
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
              <Secondary className="gr__block-sans" value="सहयोगी" />
              <button className="gr__block-action" onClick={() => setMemberIds(uniqueMembers.map(m => m.user_id))}>All</button>
              <button className="gr__block-action" onClick={() => setMemberIds([])}>None</button>
            </div>
            {/* Four outcomes, not two: nothing chosen · still arriving ·
                failed · genuinely nobody. The last three all read "Loading
                members…" before, so a failure was indistinguishable from a
                slow network and from an empty project. */}
            {projectIds.length === 0 ? (
              <p className="rep-note">Select a project above first.</p>
            ) : membersFailed ? (
              <p className="rep-note" role="alert">
                The member list did not load, so this report cannot be scoped by person yet.{' '}
                <button type="button" className="k-link"
                  onClick={() => loadMembers(projectIds.filter(id => memberErrs[id]))}>
                  Try again
                </button>
              </p>
            ) : membersPending ? (
              <p className="rep-note">Loading members…</p>
            ) : uniqueMembers.length === 0 ? (
              <p className="rep-note">No members on the selected projects.</p>
            ) : (
              <div className="gr__people">
                {uniqueMembers.map((m, i) => (
                  <button key={m.user_id}
                    className={'gr__person' + (memberIds.includes(m.user_id) ? ' is-active' : '')}
                    onClick={() => toggleMember(m.user_id)}>
                    <span className="gr__person-av rep-swatch" style={{ '--c': colorFor(i) }}>
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
              <Secondary className="gr__block-sans" value="समावेश" />
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
                <Secondary className="gr__preview-brand-hi" value="कर्तव्य" />
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
                    <div className="rep-note rep-note--cell">
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
                <Secondary  value="कर्तव्ये अधिकारस्ते — Bhagavad Gita 2.47" />
              </div>
            </div>
            <div className="gr__preview-label">Live preview · approx. cover page</div>
          </div>

          {/* Export buttons */}
          <div className="gr__export">
            <div className="gr__export-h">
              Export <Secondary className="gr__export-hi" value="निर्यात" />
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
              <Secondary className="gr__history-hi" value="पूर्व निर्यात" />
            </div>
            {history.length === 0 ? (
              <div className="rep-note rep-note--pad">
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
        <div className="rep-sched">
          <div className="rep-sched__head">
            <h2 className="rep-sched__t">
              Automated schedules
            </h2>
            <Secondary className="rep-sched__hi" value="स्वचालित प्रेषण" />
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
