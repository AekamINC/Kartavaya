// Onboarding — five steps, run immediately after org creation.
// Every step auto-saves to kv_onboarding, so dropping off resumes in place.
const OB_MODS = [
  { code: 'kartavya', hi: 'कर्तव्य', en: 'Kartavya', d: 'Projects, boards, tasks, time', ic: 'task' },
  { code: 'graha', hi: 'ग्रह', en: 'Graha', d: 'CRM, contacts, deals, follow-ups', ic: 'crm' },
  { code: 'vikray', hi: 'विक्रय', en: 'Vikray', d: 'Orders, stock, targets', ic: 'sales' },
  { code: 'ganit', hi: 'गणित', en: 'Ganit', d: 'GST invoices, expenses, e-way bills', ic: 'fin', sens: true },
  { code: 'manav', hi: 'मानव', en: 'Manav', d: 'Employees, leave, documents', ic: 'hr', sens: true },
  { code: 'vetana', hi: 'वेतन', en: 'Vetana', d: 'Payroll, payslips, PF and TDS', ic: 'pay', sens: true },
  { code: 'pahchan', hi: 'पहचान', en: 'Pahchan', d: 'Face attendance, shifts, geo-fence', ic: 'clock' },
  { code: 'sanvaad', hi: 'संवाद', en: 'Sanvaad', d: 'Team channels and WhatsApp inbox', ic: 'chat' },
  { code: 'prachar', hi: 'प्रचार', en: 'Prachar', d: 'Campaigns, sequences, ads', ic: 'mkt' },
  { code: 'srijan', hi: 'सृजन', en: 'Srijan', d: 'AI assistant across your data', ic: 'ai' },
  { code: 'dristi', hi: 'दृष्टि', en: 'Dristi', d: 'Reports, dashboards, pivots', ic: 'report' },
  { code: 'esign', hi: 'हस्ताक्षर', en: 'eSign', d: 'Send, sign, store agreements', ic: 'sign' },
];
// Preselection comes from the industry answered at signup, not from a default set.
const OB_PRESETS = {
  'CA / Legal practice': ['kartavya', 'ganit', 'graha', 'esign'],
  'IT Services': ['kartavya', 'graha', 'sanvaad', 'dristi'],
  'Manufacturing': ['kartavya', 'ganit', 'vikray', 'manav', 'pahchan'],
  'Retail & Trading': ['ganit', 'vikray', 'graha', 'pahchan'],
  'Agency': ['kartavya', 'graha', 'prachar', 'srijan', 'sanvaad'],
  'Consulting': ['kartavya', 'graha', 'ganit', 'dristi'],
  'Other': ['kartavya', 'graha', 'ganit'],
};
const OB_TEMPLATES = [
  ['blank', 'Blank', 'नया', 'Three columns and nothing else. Build it your way.', ['To Do', 'In Progress', 'Done']],
  ['software', 'Software delivery', 'विकास', 'Sprints, review and release columns, with a bug label set.', ['Backlog', 'In Progress', 'In Review', 'QA', 'Released']],
  ['marketing', 'Marketing campaign', 'अभियान', 'Brief through publish, with an approval gate before anything goes live.', ['Brief', 'Draft', 'Approval', 'Scheduled', 'Live']],
  ['client', 'Client project', 'ग्राहक', 'Client-visible board with internal items hidden by default.', ['Scoping', 'In Progress', 'Client Review', 'Signed Off']],
  ['gst', 'GST filing cycle', 'कर', 'A month of returns — 2B reconciliation, working notes, filing.', ['Collect', 'Reconcile', 'Review', 'Filed']],
  ['hr', 'HR onboarding', 'भर्ती', 'Offer to day one, with document collection built in.', ['Offer', 'Documents', 'Setup', 'Day One']],
];
const OB_TIPS = [
  ['Press ⌘K anywhere', 'One search for records, actions and navigation. Learn this and skip the sidebar entirely.', 'search'],
  ['Esc walks back', 'Never a dead end — Esc closes the drawer, then the panel, then clears focus. Tally-style.', 'chevL'],
  ['Add it to your phone', 'Kartavaya is a PWA. Attendance and approvals work offline for 72 hours.', 'clock'],
];

function ObDots({ step, done = [] }) {
  return (
    <div className="ob-prog">
      <div className="ob-prog__bar"><span style={{ width: (step / 5) * 100 + '%' }} /></div>
      <div className="ob-prog__steps">
        {['Welcome', 'Modules', 'Team', 'First project', 'Done'].map((l, i) => (
          <span key={l} className={'ob-prog__s' + (done.includes(i + 1) ? ' done' : step === i + 1 ? ' on' : step > i + 1 ? ' skip' : '')}
            title={step > i + 1 && !done.includes(i + 1) ? 'Skipped' : undefined}>
            <i>{done.includes(i + 1) ? I.check : step > i + 1 ? '–' : i + 1}</i>{l}
          </span>
        ))}
      </div>
    </div>
  );
}

function ObStep1({ next, skipAll }) {
  return (
    <div className="ob-mid">
      <span className="ob-hero__mark"><Mark size={62} /></span>
      <h1 className="ob-h1">Welcome to Kartavaya,<br /><em>Keval.</em></h1>
      <p className="ob-hi hi">कर्तव्य में आपका स्वागत है</p>
      <p className="ob-lede">
        Aekam Inc is created. Four short steps and your workspace is set up the way your business actually runs —
        which modules you use, who is in, and what you are working on first.
      </p>
      <div className="ob-marquee">
        {['कर्तव्य', 'ग्रह', 'गणित', 'वेतन', 'पहचान', 'संवाद', 'सृजन', 'दृष्टि'].map((h, i) => (
          <span key={h} style={{ animationDelay: i * 90 + 'ms' }}>{h}</span>
        ))}
      </div>
      <div className="ob-cta">
        <AButton onClick={next}>Set up my workspace</AButton>
        <button className="au-link au-link--c au-link--mute" onClick={skipAll}>Skip setup — take me to the dashboard</button>
      </div>
      <div className="ob-fine">Takes about two minutes. You can change every one of these later.</div>
    </div>
  );
}

function ObStep2({ on, setOn, industry }) {
  const n = on.length;
  return (
    <>
      <div className="ob-head">
        <h2 className="ob-h2">Which modules do you need?</h2>
        <p className="ob-sub">
          Preselected for <b>{industry}</b>. Everything you switch off stays hidden — it does not sit greyed out in your
          sidebar advertising what you are not paying for.
        </p>
      </div>
      <div className="ob-mods">
        {OB_MODS.map(m => {
          const isOn = on.includes(m.code);
          return (
            <button key={m.code} className={'ob-mod' + (isOn ? ' on' : '') + (m.sens ? ' sens' : '')}
              onClick={() => setOn(isOn ? on.filter(x => x !== m.code) : [...on, m.code])}>
              <span className="ob-mod__ic">{I[m.ic]}</span>
              <span className="ob-mod__t">
                <b className="hi">{m.hi}</b>
                <i>{m.en}</i>
              </span>
              <span className="ob-mod__d">{m.d}</span>
              <span className="ob-mod__f">
                {m.sens && <span className="ob-mod__lock">{SI.lock} sensitive</span>}
                <span className={'ob-check' + (isOn ? ' on' : '')}>{I.check}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="ob-bar">
        <span><b>{n}</b> selected{n > 6 && <span className="mute"> · that is a lot for week one</span>}</span>
        <button className="au-link" onClick={() => setOn(OB_PRESETS[industry] || OB_PRESETS.Other)}>Reset to recommended</button>
      </div>
      <div className="ob-note">{SI.lock} Ganit, Manav and Vetana hold money and personal data. New members get <b>no access</b> to them until you grant it, one person at a time.</div>
    </>
  );
}

const OB_ROLES = [['org_member', 'Member'], ['org_admin', 'Admin']];
function ObStep3({ list, setList }) {
  const [v, setV] = React.useState('');
  const [bulk, setBulk] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const add = () => {
    const parts = v.split(/[,\s\n;]+/).map(x => x.trim()).filter(Boolean);
    if (!parts.length) return;
    const bad = parts.filter(p => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p));
    if (bad.length) { setErr(bad.length === 1 ? bad[0] + ' is not a valid email' : bad.length + ' addresses are not valid'); return; }
    const dupe = parts.filter(p => list.some(x => x.e === p));
    setErr(dupe.length ? dupe[0] + ' is already on the list' : null);
    const fresh = parts.filter(p => !list.some(x => x.e === p));
    setList([...list, ...fresh.map(e => ({ e, r: 'org_member' }))]);
    setV('');
  };
  return (
    <>
      <div className="ob-head">
        <h2 className="ob-h2">Invite your team</h2>
        <p className="ob-sub">They get an email and a WhatsApp message with a link. Module access is granted separately — an invite alone opens nothing sensitive.</p>
      </div>
      <div className="ob-invite">
        <div className="rowflex" style={{ gap: 9, alignItems: 'flex-start' }}>
          {bulk ? (
            <textarea className="inp" rows="3" style={{ flex: 1 }} value={v} onChange={e => { setV(e.target.value); setErr(null); }}
              placeholder={'aanya@aekam.co\nrohan@aekam.co\npriya@aekam.co'} autoFocus />
          ) : (
            <input className="inp" style={{ flex: 1 }} value={v} onChange={e => { setV(e.target.value); setErr(null); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
              placeholder="name@company.com" autoFocus />
          )}
          <button className="btn btn--fill" style={{ height: 42 }} onClick={add}>Add</button>
        </div>
        <div className="between" style={{ marginTop: 8 }}>
          {err ? <span className="au-f__err">{SI.alert} {err}</span> : <span className="mute" style={{ fontSize: 11.5 }}>{bulk ? 'One per line, or comma-separated.' : 'Press ⏎ to add. Paste a list to add several at once.'}</span>}
          <button className="au-link" onClick={() => { setBulk(!bulk); setV(''); setErr(null); }}>{bulk ? 'Single email' : 'Paste multiple'}</button>
        </div>
      </div>
      {list.length > 0 ? (
        <div className="ob-list">
          {list.map((x, i) => (
            <div key={x.e} className="ob-row" style={{ animationDelay: Math.min(i, 6) * 40 + 'ms' }}>
              <Av n={x.e.split('@')[0].replace(/[._]/g, ' ')} s={30} />
              <span className="ob-row__e">{x.e}</span>
              <select className="inp" style={{ width: 122, padding: '7px 26px 7px 10px' }} value={x.r}
                onChange={e => setList(list.map((y, j) => j === i ? { ...y, r: e.target.value } : y))}>
                {OB_ROLES.map(([v2, l]) => <option key={v2} value={v2}>{l}</option>)}
              </select>
              <button className="icobtn" onClick={() => setList(list.filter((_, j) => j !== i))} title="Remove">{I.x}</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="ob-empty">
          <span className="ob-empty__ic">{I.hr}</span>
          <b>No one invited yet</b>
          <span>Working alone for now is completely normal. You can invite people from Settings whenever you like.</span>
        </div>
      )}
      <div className="ob-bar">
        <span><b>{list.length}</b> {list.length === 1 ? 'person' : 'people'} to invite</span>
        {list.length > 0 && <span className="mute" style={{ fontSize: 11.5 }}>{list.filter(x => x.r === 'org_admin').length} as admin</span>}
      </div>
    </>
  );
}

function ObStep4({ proj, setProj, tpl, setTpl }) {
  const t = OB_TEMPLATES.find(x => x[0] === tpl);
  return (
    <>
      <div className="ob-head">
        <h2 className="ob-h2">Create your first project</h2>
        <p className="ob-sub">A template just sets up the columns and labels. Nothing is locked — rename or delete any of it.</p>
      </div>
      <label className="fld" style={{ marginBottom: 18 }}>
        <span className="fld__l">Project name</span>
        <input className="inp" value={proj} onChange={e => setProj(e.target.value)} placeholder="Q1 GST filing" autoFocus />
      </label>
      <div className="ob-tpls">
        {OB_TEMPLATES.map(([id, l, hi, d, cols]) => (
          <button key={id} className={'ob-tpl' + (tpl === id ? ' on' : '')} onClick={() => setTpl(id)}>
            <span className="ob-tpl__h">
              <b>{l}</b><i className="hi">{hi}</i>
              <span className={'ob-check' + (tpl === id ? ' on' : '')}>{I.check}</span>
            </span>
            <span className="ob-tpl__d">{d}</span>
            <span className="ob-tpl__cols">
              {cols.map(c => <i key={c}>{c}</i>)}
            </span>
          </button>
        ))}
      </div>
      {t && <div className="ob-note">{I.check} <b>{proj || 'Untitled project'}</b> will be created with {t[4].length} columns: {t[4].join(' · ')}.</div>}
    </>
  );
}

function ObStep5({ mods, invites, proj, tpl, done, finish }) {
  const t = OB_TEMPLATES.find(x => x[0] === tpl);
  const skipped = done.length === 0;
  // Only report what was actually applied. A celebration screen that claims work
  // the person skipped is the same lie as a sync chip that says Synced offline.
  const rows = [
    done.includes(2)
      ? [true, mods.length + ' modules turned on', OB_MODS.filter(m => mods.includes(m.code)).map(m => m.hi).join(' · ')]
      : [false, 'Recommended modules are on', OB_MODS.filter(m => mods.includes(m.code)).map(m => m.hi).join(' · ') + ' — change them in Settings'],
    done.includes(3) && invites.length
      ? [true, invites.length + ' invitation' + (invites.length === 1 ? '' : 's') + ' sent', invites.map(i => i.e).join(', ')]
      : [false, 'No one invited yet', 'Invite people any time from Settings → Members'],
    done.includes(4) && proj.trim()
      ? [true, '“' + proj.trim() + '” created', t[4].length + ' columns from the ' + t[1] + ' template']
      : [false, 'No project yet', 'Create one from the dashboard whenever you are ready'],
  ];
  return (
    <div className="ob-mid">
      {!skipped && <span className="ob-bloom" />}
      <span className={'ob-done' + (skipped ? ' ob-done--skip' : '')}>
        {skipped
          ? <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"><path d="M18 26h16" /></svg>
          : <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round"><path d="M14 27l8 8 16-18" /></svg>}
      </span>
      <h1 className="ob-h1">{skipped ? <>Setup skipped —<br /><em>that’s fine.</em></> : <>Your workspace<br /><em>is ready.</em></>}</h1>
      <p className="ob-hi hi">{skipped ? 'बाद में कर लेंगे' : 'सब तैयार है'}</p>
      {skipped && <p className="ob-lede">Nothing was configured. Aekam Inc exists with the modules your industry usually needs, and everything else waits until you want it.</p>}
      <div className="ob-summary">
        {rows.map(([ok, t2, d]) => (
          <div key={t2} className={'ob-sum' + (ok ? '' : ' ob-sum--pending')}>
            <span className="ob-sum__ic">{ok ? I.check : I.clock}</span>
            <span style={{ minWidth: 0 }}><b>{t2}</b><span>{d}</span></span>
          </div>
        ))}
      </div>
      <div className="ob-cta"><AButton onClick={finish}>Go to dashboard</AButton></div>
      <div className="ob-tips">
        {OB_TIPS.map(([t2, d, ic]) => (
          <div key={t2} className="ob-tip">
            <span className="ob-tip__ic">{I[ic]}</span>
            <b>{t2}</b>
            <span>{d}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const OB_KEY = 'kv_onboarding';
function OnboardingApp() {
  const load = () => { try { return JSON.parse(localStorage.getItem(OB_KEY) || '{}'); } catch (_) { return {}; } };
  const saved = load();
  const industry = saved.industry || 'CA / Legal practice';
  const [step, setStep] = React.useState(saved.step || 1);
  const [dir, setDir] = React.useState(1);
  const [mods, setMods] = React.useState(saved.mods || OB_PRESETS[industry]);
  const [invites, setInvites] = React.useState(saved.invites || []);
  const [proj, setProj] = React.useState(saved.proj != null ? saved.proj : '');
  const [tpl, setTpl] = React.useState(saved.tpl || 'gst');
  // Which steps were finished with the primary button. Skipping does not count,
  // so the final screen can only claim what actually happened.
  const [done, setDone] = React.useState(saved.done || []);
  const [surface, setSurface] = React.useState('mac');
  const [theme, setTheme] = React.useState('light');
  const mobile = surface === 'mweb' || surface === 'mapp';

  React.useEffect(() => {
    try { localStorage.setItem(OB_KEY, JSON.stringify({ step, mods, invites, proj, tpl, industry, done })); } catch (_) { }
  }, [step, mods, invites, proj, tpl, done]);
  React.useEffect(() => {
    const r = document.documentElement;
    r.dataset.theme = theme; r.dataset.platform = mobile ? 'mac' : surface; r.dataset.surfaceKind = surface;
  }, [surface, theme, mobile]);

  const go = n => { setDir(n > step ? 1 : -1); setStep(n); };
  // Primary button = the step was actually applied. Skip advances without claiming it.
  const advance = applied => { if (applied) setDone(d => (d.includes(step) ? d : [...d, step])); go(step + 1); };
  const skipAll = () => { setDone([]); setInvites([]); setProj(''); go(5); };
  const reset = () => { setStep(1); setMods(OB_PRESETS[industry]); setInvites([]); setProj(''); setTpl('gst'); setDone([]); };
  const finish = () => { window.location.href = 'Kartavaya Redesign.html'; };
  const wide = step === 1 || step === 5;

  return (
    <div className="obwrap">
      <header className="hubbar">
        <span className="hubbar__t">Onboarding<span className="hi">आरंभ</span></span>
        <div className="seg">
          {[1, 2, 3, 4, 5].map(n => <button key={n} className={'seg__b' + (step === n ? ' on' : '')} onClick={() => go(n)}>{n}</button>)}
        </div>
        <button className="chip" onClick={reset}>Reset progress</button>
        <span style={{ flex: 1 }} />
        <div className="seg">
          {[['mac', 'macOS'], ['win', 'Win'], ['mweb', 'M-web'], ['mapp', 'M-app']].map(([v, l]) => (
            <button key={v} className={'seg__b' + (surface === v ? ' on' : '')} onClick={() => setSurface(v)}>{l}</button>
          ))}
        </div>
        <button className="icobtn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? I.moon : I.sun}</button>
      </header>

      <div className={'ob' + (mobile ? ' ob--m' : '')}>
        <span className="ob__wm hi" aria-hidden="true">कर्तव्य</span>
        <ObDots step={step} done={done} />
        <main className={'ob__card' + (wide ? ' ob__card--mid' : '')}>
          <div className="ob__slide" key={step} data-dir={dir}>
            {step === 1 && <ObStep1 next={() => go(2)} skipAll={skipAll} />}
            {step === 2 && <ObStep2 on={mods} setOn={setMods} industry={industry} />}
            {step === 3 && <ObStep3 list={invites} setList={setInvites} />}
            {step === 4 && <ObStep4 proj={proj} setProj={setProj} tpl={tpl} setTpl={setTpl} />}
            {step === 5 && <ObStep5 mods={mods} invites={invites} proj={proj} tpl={tpl} done={done} finish={finish} />}
          </div>
        </main>
        {step > 1 && step < 5 && (
          <footer className="ob__foot">
            <button className="btn btn--out btn--sm" onClick={() => go(step - 1)}>{I.chevL} Back</button>
            <span className="ob__save">{I.check} Saved — you can close this and come back</span>
            <button className="au-link au-link--mute" onClick={() => advance(false)}>Skip this step</button>
            <AButton onClick={() => advance(true)} style={{ width: 'auto', minWidth: 150 }}>
              {step === 2 ? 'Turn on ' + mods.length + ' modules' : step === 3 ? (invites.length ? 'Send ' + invites.length + ' invitations' : 'Continue') : proj.trim() ? 'Create project' : 'Continue'}
            </AButton>
          </footer>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { OnboardingApp, OB_MODS, OB_PRESETS, OB_TEMPLATES, OB_TIPS });
