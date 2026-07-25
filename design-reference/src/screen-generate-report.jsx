// Manual report generator screen.
// Users configure scope (date range, projects, team, sections), see a live
// preview of the report, then export to PDF, CSV, or XLSX. Recent exports
// show a history list with re-download.

function ScreenGenerateReport() {
  const [kind, setKind]         = React.useState('weekly'); // daily | weekly | monthly | custom
  const [from, setFrom]         = React.useState('2026-05-11');
  const [to, setTo]             = React.useState('2026-05-17');
  const [projectIds, setProjectIds] = React.useState(PROJECTS.map(p => p.id));
  const [teamIds, setTeamIds]   = React.useState(TEAM.filter(u => u.role !== 'client').map(u => u.id));
  const [sections, setSections] = React.useState({
    summary: true, projects: true, leaderboard: true, champion: true,
    tasks: true, throughput: true, time: false, attachments: false,
  });
  const [deliver, setDeliver]   = React.useState('download'); // download | email
  const [emails, setEmails]     = React.useState('keval@aekaminc.com, vikram@aekaminc.com');
  const [busy, setBusy]         = React.useState(null);

  // Snap from/to based on the kind preset
  React.useEffect(() => {
    if (kind === 'daily')   { setFrom('2026-05-17'); setTo('2026-05-17'); }
    if (kind === 'weekly')  { setFrom('2026-05-11'); setTo('2026-05-17'); }
    if (kind === 'monthly') { setFrom('2026-04-01'); setTo('2026-04-30'); }
  }, [kind]);

  const toggleProject = (id) => setProjectIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleTeam    = (id) => setTeamIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleSection = (k)  => setSections(s => ({ ...s, [k]: !s[k] }));

  // Derived numbers for preview
  const today = '2026-05-14';
  const inScope = TASKS.filter(t => projectIds.includes(t.project));
  const completed = inScope.filter(t => t.done).length;
  const due = inScope.filter(t => !t.done && t.due >= from && t.due <= to).length;
  const awaiting = inScope.filter(t => t.column === 'c3').length;
  const overdue = inScope.filter(t => !t.done && new Date(t.due) < new Date(today)).length;

  const handleExport = (fmt) => {
    setBusy(fmt);
    setTimeout(() => setBusy(null), 1400);
  };

  const fmtDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const rangeLabel = from === to ? fmtDate(from) : `${fmtDate(from)} — ${fmtDate(to)}`;

  return (
    <div className="k-screen">
      <PageHeader
        kicker="Operations · Reports"
        title="Generate report"
        sansTitle="प्रतिवेदन निर्माण"
        lede="Build a report on demand. Pick scope, choose what to include, and export to PDF, CSV, or XLSX — or email it straight to the team."
        right={
          <div className="gr__phead-right">
            <span className="gr__phead-meta">
              <b>Last automated send</b>
              <span>Mon 17 May · 09:00 IST</span>
            </span>
            <a href="#" className="k-btn k-btn--ghost k-btn--sm">Manage schedules</a>
          </div>
        }
      />

      <div className="gr">
        {/* ── LEFT: builder form ───────────────────────────────── */}
        <div className="gr__form">
          {/* Type */}
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
                ['monthly', 'Monthly', 'past calendar month'],
                ['custom',  'Custom',  'pick range'],
              ].map(([k, lbl, hint]) => (
                <button
                  key={k}
                  className={'gr__seg-btn' + (kind === k ? ' is-active' : '')}
                  onClick={() => setKind(k)}
                >
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

          {/* Projects */}
          <div className="gr__block">
            <div className="gr__block-h">
              <span className="gr__step">2</span>
              <h3>Projects</h3>
              <span className="gr__block-sans">परियोजनाएँ</span>
              <button className="gr__block-action" onClick={() => setProjectIds(PROJECTS.map(p => p.id))}>All</button>
              <button className="gr__block-action" onClick={() => setProjectIds([])}>None</button>
            </div>
            <div className="gr__chips">
              {PROJECTS.map(p => {
                const active = projectIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    className={'gr__chip' + (active ? ' is-active' : '')}
                    onClick={() => toggleProject(p.id)}
                  >
                    <i className="gr__chip-dot" style={{ background: p.color }} />
                    <span className="gr__chip-name">{p.name}</span>
                    <span className="gr__chip-hi">{p.sanskrit}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Team */}
          <div className="gr__block">
            <div className="gr__block-h">
              <span className="gr__step">3</span>
              <h3>Team members</h3>
              <span className="gr__block-sans">सहयोगी</span>
              <button className="gr__block-action" onClick={() => setTeamIds(TEAM.filter(u => u.role !== 'client').map(u => u.id))}>All</button>
              <button className="gr__block-action" onClick={() => setTeamIds([])}>None</button>
            </div>
            <div className="gr__people">
              {TEAM.filter(u => u.role !== 'client').map(u => {
                const active = teamIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    className={'gr__person' + (active ? ' is-active' : '')}
                    onClick={() => toggleTeam(u.id)}
                  >
                    <span className="gr__person-av" style={{ background: u.color }}>{u.initials}</span>
                    <span className="gr__person-name">{u.name}</span>
                    <span className="gr__person-role">{u.role}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sections */}
          <div className="gr__block">
            <div className="gr__block-h">
              <span className="gr__step">4</span>
              <h3>Include in report</h3>
              <span className="gr__block-sans">समावेश</span>
            </div>
            <div className="gr__toggles">
              {[
                ['summary',     'Summary KPIs',         'Completed · Due · Awaiting · Overdue'],
                ['projects',    'Per-project breakdown', 'One row per project, with counts'],
                ['leaderboard', 'Team leaderboard',     'Ranking by completed tasks'],
                ['champion',    'Champion call-out',    'Top contributor in the period'],
                ['throughput',  'Throughput chart',     'Bars per day or per week'],
                ['tasks',       'Detailed task list',   'Every task with status, due, owner'],
                ['time',        'Time tracking',        'Hours logged per task / person'],
                ['attachments', 'Attachment manifest',  'Files added in the period'],
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

          {/* Delivery */}
          <div className="gr__block">
            <div className="gr__block-h">
              <span className="gr__step">5</span>
              <h3>Delivery</h3>
              <span className="gr__block-sans">प्रेषण</span>
            </div>
            <div className="gr__deliver">
              <label className={'gr__radio' + (deliver === 'download' ? ' is-on' : '')}>
                <input type="radio" checked={deliver === 'download'} onChange={() => setDeliver('download')} />
                <span className="gr__radio-mark" />
                <span>
                  <b>Download to this device</b>
                  <span className="gr__radio-hint">File is generated, signed, and downloaded over HTTPS.</span>
                </span>
              </label>
              <label className={'gr__radio' + (deliver === 'email' ? ' is-on' : '')}>
                <input type="radio" checked={deliver === 'email'} onChange={() => setDeliver('email')} />
                <span className="gr__radio-mark" />
                <span>
                  <b>Email as attachment</b>
                  <span className="gr__radio-hint">Uploads to R2 storage and emails the file as an attachment. Link valid for 30 days.</span>
                </span>
              </label>
              {deliver === 'email' && (
                <div className="gr__emails">
                  <label>
                    <span>Send to</span>
                    <input
                      type="text"
                      value={emails}
                      onChange={e => setEmails(e.target.value)}
                      placeholder="comma-separated emails"
                    />
                  </label>
                  <div className="gr__email-hint">
                    Defaults to all admins and team owners on Aekam Workspace.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT: preview + exports ─────────────────────────── */}
        <aside className="gr__side">
          {/* Preview */}
          <div className="gr__preview">
            <div className="gr__preview-paper">
              <div className="gr__preview-brand">
                <span className="gr__preview-brand-main">Kartavya</span>
                <span className="gr__preview-brand-hi">कर्तव्य</span>
              </div>
              <div className="gr__preview-kicker">
                {kind === 'daily'   && 'DAILY REPORT'}
                {kind === 'weekly'  && 'WEEKLY REPORT'}
                {kind === 'monthly' && 'MONTHLY REPORT'}
                {kind === 'custom'  && 'CUSTOM REPORT'}
                {' · '}{rangeLabel}
              </div>
              <h2 className="gr__preview-h2">Aekam Workspace</h2>
              <div className="gr__preview-scope">
                <span><b>{teamIds.length}</b> of {TEAM.filter(u => u.role !== 'client').length} members</span>
                <i>·</i>
                <span><b>{projectIds.length}</b> of {PROJECTS.length} projects</span>
              </div>

              {sections.summary && (
                <div className="gr__preview-stats">
                  <div><b>{completed}</b><i>Done</i></div>
                  <div><b>{due}</b><i>Due</i></div>
                  <div><b>{awaiting}</b><i>Approve</i></div>
                  <div className={overdue > 0 ? 'is-bad' : ''}><b>{overdue}</b><i>Overdue</i></div>
                </div>
              )}

              <div className="gr__preview-sections">
                {sections.projects && <div className="gr__preview-sec"><i>§</i> Per-project breakdown ({projectIds.length} projects)</div>}
                {sections.leaderboard && <div className="gr__preview-sec"><i>§</i> Team leaderboard ({teamIds.length} people)</div>}
                {sections.champion && <div className="gr__preview-sec"><i>§</i> Champion of the period</div>}
                {sections.throughput && <div className="gr__preview-sec"><i>§</i> Throughput chart</div>}
                {sections.tasks && <div className="gr__preview-sec"><i>§</i> Detailed task list (~{inScope.length} tasks)</div>}
                {sections.time && <div className="gr__preview-sec"><i>§</i> Time tracking ledger</div>}
                {sections.attachments && <div className="gr__preview-sec"><i>§</i> Attachment manifest</div>}
              </div>

              <div className="gr__preview-foot">
                Generated <b>now</b> · by Keval Shah · Aekam Inc<br/>
                <span>Bhagavad Gita 2.47 — कर्तव्ये अधिकारस्ते।</span>
              </div>
            </div>
            <div className="gr__preview-label">Live preview · approx. cover page</div>
          </div>

          {/* Export actions */}
          <div className="gr__export">
            <div className="gr__export-h">
              Export <span className="gr__export-hi">निर्यात</span>
            </div>

            <button
              className={'gr__export-btn gr__export-btn--pdf' + (busy === 'pdf' ? ' is-busy' : '')}
              onClick={() => handleExport('pdf')}
              disabled={busy !== null}
            >
              <span className="gr__fmt"><span className="gr__fmt-tag">PDF</span></span>
              <span className="gr__export-body">
                <b>Generate PDF</b>
                <span>Editorial layout, print-ready · approx. {Math.max(2, Math.round(Object.values(sections).filter(Boolean).length * 1.2))} pages</span>
              </span>
              <span className="gr__export-go">
                {busy === 'pdf' ? <Spinner/> : <Arrow/>}
              </span>
            </button>

            <button
              className={'gr__export-btn gr__export-btn--xlsx' + (busy === 'xlsx' ? ' is-busy' : '')}
              onClick={() => handleExport('xlsx')}
              disabled={busy !== null}
            >
              <span className="gr__fmt"><span className="gr__fmt-tag gr__fmt-tag--xlsx">XLSX</span></span>
              <span className="gr__export-body">
                <b>Generate Excel workbook</b>
                <span>{Object.values(sections).filter(Boolean).length} sheets · formulas + pivots preserved</span>
              </span>
              <span className="gr__export-go">
                {busy === 'xlsx' ? <Spinner/> : <Arrow/>}
              </span>
            </button>

            <button
              className={'gr__export-btn gr__export-btn--csv' + (busy === 'csv' ? ' is-busy' : '')}
              onClick={() => handleExport('csv')}
              disabled={busy !== null}
            >
              <span className="gr__fmt"><span className="gr__fmt-tag gr__fmt-tag--csv">CSV</span></span>
              <span className="gr__export-body">
                <b>Generate CSV</b>
                <span>Flat task table · UTF-8 · ~{inScope.length} rows</span>
              </span>
              <span className="gr__export-go">
                {busy === 'csv' ? <Spinner/> : <Arrow/>}
              </span>
            </button>

            <div className="gr__export-meta">
              <div>
                <b>Where it goes</b>
                <span>
                  {deliver === 'download'
                    ? 'Saved to your Downloads folder.'
                    : `Uploaded to R2 and emailed to ${emails.split(',').length} recipient${emails.split(',').length === 1 ? '' : 's'}.`}
                </span>
              </div>
              <div>
                <b>Privacy</b>
                <span>Only data you can already see in Kartavya is included.</span>
              </div>
            </div>
          </div>

          {/* Recent exports */}
          <div className="gr__history">
            <div className="gr__history-h">
              Recent exports
              <span className="gr__history-hi">पूर्व निर्यात</span>
            </div>
            {[
              { kind: 'weekly',  fmt: 'XLSX', name: 'aekam_weekly_wk19_2026.xlsx',   who: 'Auto · 09:00',  when: 'Mon 17 May · 09:00', size: '128 KB' },
              { kind: 'daily',   fmt: 'PDF',  name: 'aekam_daily_2026-05-16.pdf',    who: 'Keval Shah',    when: 'Sat 16 May · 18:42', size: '88 KB'  },
              { kind: 'custom',  fmt: 'CSV',  name: 'tata-steel_apr-may_tasks.csv',  who: 'Vikram Joshi',  when: 'Fri 15 May · 11:08', size: '34 KB'  },
              { kind: 'monthly', fmt: 'XLSX', name: 'aekam_monthly_2026-04.xlsx',    who: 'Auto · 09:00',  when: 'Fri 01 May · 09:00', size: '412 KB' },
              { kind: 'custom',  fmt: 'PDF',  name: 'gst-automation_q1.pdf',         who: 'Keval Shah',    when: 'Thu 30 Apr · 16:21', size: '212 KB' },
            ].map((r, i) => (
              <div key={i} className="gr__hrow">
                <span className={'gr__hrow-fmt gr__hrow-fmt--' + r.fmt.toLowerCase()}>{r.fmt}</span>
                <div className="gr__hrow-body">
                  <div className="gr__hrow-name">{r.name}</div>
                  <div className="gr__hrow-meta">{r.who} · {r.when} · {r.size}</div>
                </div>
                <a href="#" className="gr__hrow-go">Download</a>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
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

Object.assign(window, { ScreenGenerateReport });
