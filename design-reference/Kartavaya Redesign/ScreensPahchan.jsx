// Pahchan (पहचान) — biometric attendance. PWA-first, mobile-primary, offline 72h buffer.
const ATT = { P: ['Present', '#04837A'], A: ['Absent', '#B42318'], H: ['Half day', '#A66207'], L: ['Leave', '#7c5cbf'], WO: ['Weekly off', '#8E8D87'] };
// July 2026 — 31 days, 1 Jul is a Wednesday. Weeks start Monday (सोम),
// so the grid needs 2 leading blanks. Derived, never hand-typed.
const MONTH = { y: 2026, m: 6, label: 'July 2026' };
const DAYS_IN = new Date(MONTH.y, MONTH.m + 1, 0).getDate();
const LEAD = (new Date(MONTH.y, MONTH.m, 1).getDay() + 6) % 7;
const EMP_MONTH = Array.from({ length: DAYS_IN }, (_, i) => {
  const dow = new Date(MONTH.y, MONTH.m, i + 1).getDay();
  if (dow === 0 || dow === 6) return 'WO';
  if (i + 1 === 13) return 'H';
  if (i + 1 === 29 || i + 1 === 30) return 'L';
  if (i + 1 === 3 || i + 1 === 17) return 'A';
  return 'P';
});
const WORKING = EMP_MONTH.filter(s => s !== 'WO').length;
const PRESENT = EMP_MONTH.filter(s => s === 'P').length;

const PAH_TABS = {
  employee: ['clock', 'my attendance', 'regularization'],
  manager: ['today', 'my attendance', 'regularization', 'anomalies', 'reports'],
  admin: ['today', 'clock', 'my attendance', 'bulk grid', 'shifts', 'regularization', 'anomalies', 'geo-fence', 'reports'],
};

function ScreenPahchan({ open }) {
  const [role, setRole] = React.useState('admin');
  const [tab, setTab] = React.useState('today');
  const [sync, setSync] = React.useState(2);
  const [inAt, setInAt] = React.useState(null);
  const TABS = PAH_TABS[role];
  React.useEffect(() => { if (!TABS.includes(tab)) setTab(TABS[0]); }, [role]);

  return (
    <div className="screen">
      <PH kick="People · जन" hi="पहचान" en="Attendance"
        lede={role === 'employee' ? 'Face check-in. Works offline — it syncs when you reconnect.' : 'Face check-in with geo-fencing. Feeds Manav leave balances and Vetana payroll.'}
        right={<>
          <Seg opts={[{ id: 'employee', l: 'Employee' }, { id: 'manager', l: 'Manager' }, { id: 'admin', l: 'Admin' }]} val={role} set={setRole} />
          {sync > 0 && <span className="tag" style={{ '--c': '#A66207' }}>{I.clock} {sync} pending sync</span>}
          {role !== 'employee' && <button className="btn btn--out btn--sm">{I.doc} Export</button>}
        </>} />
      <div className="mute" style={{ fontSize: 11.5, marginTop: -8 }}>
        Viewing as <b>{role}</b> — {role === 'employee' ? 'own records only, no team data' : role === 'manager' ? 'team attendance and approvals; no shift or geo-fence configuration' : 'full configuration including shifts, geo-fence and bulk edit'}.
      </div>

      {sync > 0 && (
        <div style={{ display: 'flex', gap: 10, padding: '10px 13px', background: 'var(--warn-container)', borderRadius: 'var(--r-md)', fontSize: 12.5, alignItems: 'flex-start' }}>
          <span style={{ flexShrink: 0, marginTop: 1 }}>{I.clock}</span>
          <span style={{ minWidth: 0 }}>
            <b>{sync} records saved on this device.</b>
            <span className="mute"> Oldest is from 14 Jul 09:02 — 11 hours into the 72-hour buffer. They upload automatically when you reconnect.</span>
          </span>
          <button className="btn btn--out btn--sm" style={{ flexShrink: 0 }} onClick={() => setSync(0)}>Retry now</button>
        </div>
      )}

      <TabBar tabs={TABS} val={tab} set={setTab} counts={{ anomalies: 3, regularization: 2 }} />

      {tab === 'clock' && (
        <div className="two" style={{ gridTemplateColumns: 'minmax(0,320px) minmax(0,1fr)' }}>
          {/* Camera — full-bleed, minimal chrome, no animation on the critical path */}
          <div style={{ background: '#0C0E11', borderRadius: 'var(--r-xl)', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative', minHeight: 430 }}>
            <div style={{ flex: 1, position: 'relative', display: 'grid', placeItems: 'center' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 42%, #1D2229, #0C0E11 72%)' }} />
              <div style={{ width: 176, height: 220, borderRadius: '50% 50% 46% 46%', border: '2px solid var(--primary)', position: 'relative', display: 'grid', placeItems: 'center' }}>
                <svg width="86" height="86" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="1.1"><circle cx="12" cy="9" r="4" /><path d="M4 21c0-4 3.6-6.6 8-6.6s8 2.6 8 6.6" /></svg>
                {[[0, 0, '2px 0 0 2px'], [1, 0, '0 2px 2px 0'], [0, 1, '2px 0 0 2px'], [1, 1, '0 2px 2px 0']].map(([x, y], i) => (
                  <span key={i} style={{ position: 'absolute', width: 22, height: 22, borderStyle: 'solid', borderColor: 'var(--primary)', borderWidth: [i === 0 || i === 2 ? '2px' : '0', i === 1 || i === 3 ? '2px' : '0', i === 2 || i === 3 ? '2px' : '0', i === 0 || i === 2 ? '2px' : '0'].join(' '), [y ? 'bottom' : 'top']: -2, [x ? 'right' : 'left']: -2, borderRadius: y ? (x ? '0 0 8px 0' : '0 0 0 8px') : (x ? '0 8px 0 0' : '8px 0 0 0') }} />
                ))}
              </div>
              <div style={{ position: 'absolute', top: 15, left: 15, right: 15, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span className="tag" style={{ '--c': '#4FD8CB', background: 'rgba(0,0,0,.5)' }}><span className="tag__dot" />Face detected</span>
                {inAt
                  ? <span className="tag" style={{ '--c': '#4FD8CB', background: 'rgba(0,0,0,.5)' }}>Clocked in {inAt}</span>
                  : <span className="tag" style={{ '--c': '#E8B45C', background: 'rgba(0,0,0,.5)' }}>{I.clock} Offline</span>}
              </div>
              <div style={{ position: 'absolute', bottom: 14, left: 15, right: 15, textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 42, color: '#fff', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>09:04</div>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.6)', marginTop: 3 }}>Thursday 25 Jul · गुरुवार</div>
              </div>
            </div>
            <div style={{ padding: 13, display: 'flex', flexDirection: 'column', gap: 8, background: '#12151A' }}>
              {inAt && (
                <div className="between" style={{ padding: '8px 11px', background: 'rgba(255,255,255,.07)', borderRadius: 'var(--r-sm)' }}>
                  <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,.6)' }}>Hours today</span>
                  <b className="mono" style={{ fontSize: 15, color: '#fff' }}>4:18</b>
                </div>
              )}
              {inAt
                ? <button className="btn btn--lg" style={{ width: '100%', minHeight: 52, fontSize: 15, background: '#E8B45C', color: '#2A1D05' }} onClick={() => setInAt(null)}>Clock out</button>
                : <button className="btn btn--fill btn--lg" style={{ width: '100%', minHeight: 52, fontSize: 15 }} onClick={() => setInAt('09:04')}>Clock in</button>}
              <div className="rowflex" style={{ gap: 7, justifyContent: 'center', fontSize: 11.5, color: 'rgba(255,255,255,.5)' }}>
                {I.hub}<span>Bandra Kurla Complex — inside geo-fence</span>
              </div>
            </div>
          </div>

          <div className="col">
            <Card title="Today" hi="आज">
              <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))' }}>
                <Stat lbl="Shift" hi="पारी" v="09:00" sub="General · 5m grace" />
                <Stat kind="ok" lbl="Clocked in" hi="प्रवेश" v={inAt || '—'} sub={inAt ? 'on time' : 'not yet'} />
                <Stat lbl="Hours today" hi="घंटे" v={inAt ? '4.3' : '0.0'} />
              </div>
            </Card>
            <Card title="Face registration" hi="पंजीकरण" right={<Tag c="#04837A">Complete</Tag>}>
              <div className="rowflex" style={{ gap: 8 }}>
                {['Front', 'Left', 'Right', 'Up', 'Down'].map((a, i) => (
                  <div key={a} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ aspectRatio: '3/4', borderRadius: 'var(--r-sm)', background: i < 5 ? 'var(--primary-container)' : 'var(--s-container)', display: 'grid', placeItems: 'center', color: 'var(--on-primary-container)', fontSize: 15 }}>{i < 5 ? '✓' : ''}</div>
                    <div className="mute" style={{ fontSize: 10.5, marginTop: 3 }}>{a}</div>
                  </div>
                ))}
              </div>
              <div className="rowflex" style={{ gap: 9, marginTop: 12, padding: '10px 12px', background: 'var(--ok-container)', borderRadius: 'var(--r-sm)', fontSize: 12, lineHeight: 1.5, alignItems: 'flex-start' }}>
                {I.check}<span><b>Your face data stays on this device.</b> Only a match result is sent — never the image.</span>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'my attendance' && (
        <div className="two">
          <Card title={MONTH.label} hi="मासिक" right={<div className="chips">{Object.entries(ATT).map(([k, [l, c]]) => <span key={k} className="tag" style={{ '--c': c }}>{l}</span>)}</div>}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 5 }}>
              {['सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि', 'रवि'].map(d => <div key={d} className="hi" style={{ textAlign: 'center', fontSize: 11, color: 'var(--on-surface-3)', paddingBottom: 3 }}>{d}</div>)}
              {Array.from({ length: LEAD }, (_, i) => <span key={'lead' + i} />)}
              {EMP_MONTH.map((s, i) => {
                const [lbl, c] = ATT[s];
                return (
                  <button key={i} title={(i + 1) + ' ' + MONTH.label + ' · ' + lbl} style={{ aspectRatio: '1', borderRadius: 'var(--r-sm)', background: 'color-mix(in srgb, ' + c + ' 20%, transparent)', color: c, display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: 600, border: i + 1 === 25 ? '2px solid var(--primary)' : '1px solid transparent' }}
                    onClick={() => open('att-day', { d: i + 1, s })}>{i + 1}</button>
                );
              })}
            </div>
          </Card>
          <div className="col">
            <div className="stats" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Stat kind="ok" lbl="Present" hi="उपस्थित" v={PRESENT} sub={'of ' + WORKING + ' working days'} />
              <Stat kind="warn" lbl="Late" hi="विलंब" v="2" sub="beyond 5m grace" />
              <Stat kind="p" lbl="Avg hours" hi="औसत" v="8.4" />
              <Stat kind="t" lbl="Overtime" hi="अतिरिक्त" v="6.5" sub="hours" />
            </div>
            <Card title="Yesterday" hi="विवरण">
              <div className="props">
                <div className="prop"><span className="prop__l"><span>Clock in</span></span><span className="prop__v mono">09:02</span></div>
                <div className="prop"><span className="prop__l"><span>Clock out</span></span><span className="prop__v mono">18:40</span></div>
                <div className="prop"><span className="prop__l"><span>Break</span></span><span className="prop__v mono">0:42</span></div>
                <div className="prop"><span className="prop__l"><span>Net</span></span><span className="prop__v mono">8:56</span></div>
              </div>
              <div className="divider" style={{ margin: '13px 0' }} />
              <div className="rowflex" style={{ gap: 11 }}>
                <div style={{ width: 52, height: 52, borderRadius: 'var(--r-sm)', background: 'var(--s-container)', display: 'grid', placeItems: 'center', color: 'var(--on-surface-3)', flexShrink: 0 }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="12" cy="9" r="4" /><path d="M4 21c0-4 3.6-6.6 8-6.6s8 2.6 8 6.6" /></svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>Verified · 98% match</div>
                  <div className="mute" style={{ fontSize: 11.5 }}>Bandra Kurla Complex · inside fence</div>
                </div>
                <div style={{ width: 64, height: 52, borderRadius: 'var(--r-sm)', background: 'var(--secondary-container)', display: 'grid', placeItems: 'center', color: 'var(--on-secondary-container)', flexShrink: 0 }}>{I.hub}</div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'today' && (
        <>
          <div className="stats">
            <Stat kind="ok" lbl="Present" hi="उपस्थित" v="4" sub="of 6" />
            <Stat kind="warn" lbl="Late" hi="विलंब" v="1" sub="Priya · 09:14" />
            <Stat kind="danger" lbl="Absent" hi="अनुपस्थित" v="0" />
            <Stat kind="t" lbl="On leave" hi="अवकाश" v="1" sub="Rohan · till Fri" />
            <Stat lbl="Not clocked out" hi="शेष" v="2" />
          </div>
          <div className="tbl">
            <div className="tbl__scroll">
              <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.4fr) 104px 96px 96px 128px 90px' }}>
                <span>Employee</span><span>Status</span><span>In</span><span>Out</span><span>Location</span><span></span>
              </div>
              {[['Keval Shah', 'P', '08:54', '—', 'BKC · inside', 0], ['Aanya Mehta', 'P', '09:01', '—', 'BKC · inside', 0],
                ['Priya Nair', 'H', '09:14', '13:02', 'Bengaluru · outside', 1], ['Rohan Iyer', 'L', '—', '—', '—', 0],
                ['Arjun Desai', 'P', '08:47', '18:22', 'BKC · inside', 0], ['Fatima Sheikh', 'P', '09:06', '—', 'Hyderabad · no fence', 1]].map(([n, s, i, o, loc, flag]) => {
                const [lbl, c] = ATT[s];
                return (
                  <div key={n} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.4fr) 104px 96px 96px 128px 90px' }}>
                    <span className="tbl__c"><Av n={n} s={28} /><span className="tbl__t">{n}</span></span>
                    <span className="tbl__c"><Tag c={c}>{lbl}</Tag></span>
                    <span className="tbl__c"><span className="mono" style={{ fontSize: 12.5, color: i === '09:14' ? 'var(--warn)' : 'inherit' }}>{i}</span></span>
                    <span className="tbl__c"><span className="mono" style={{ fontSize: 12.5, color: 'var(--on-surface-3)' }}>{o}</span></span>
                    <span className="tbl__c"><span className="tbl__s" style={{ color: flag ? 'var(--warn)' : undefined }}>{loc}</span></span>
                    <span className="tbl__c">{flag ? <button className="btn btn--out btn--sm">Review</button> : <span className="mute" style={{ fontSize: 11.5 }}>—</span>}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {tab === 'bulk grid' && (
        <>
          <div className="between">
            <div className="chips">{Object.entries(ATT).map(([k, [l, c]]) => <span key={k} className="tag" style={{ '--c': c }}>{k} · {l}</span>)}</div>
            <span className="mute" style={{ fontSize: 11.5 }}>Click a cell to change it. Sticky first column — scales past 100 employees.</span>
          </div>
          <div className="tbl">
            <div className="tbl__scroll">
              <div style={{ display: 'grid', gridTemplateColumns: '148px repeat(31, 30px)', minWidth: 'max-content' }}>
                <div style={{ position: 'sticky', left: 0, zIndex: 3, background: 'var(--s-low)', borderBottom: '1px solid var(--outline-variant)', borderRight: '1px solid var(--outline-variant)', padding: '9px 12px', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--on-surface-3)' }}>Employee</div>
                {Array.from({ length: 31 }, (_, i) => (
                  <div key={i} style={{ background: 'var(--s-low)', borderBottom: '1px solid var(--outline-variant)', textAlign: 'center', padding: '9px 0', fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--on-surface-3)' }}>{i + 1}</div>
                ))}
                {TEAM.map((m, r) => (
                  <React.Fragment key={m.n}>
                    <div style={{ position: 'sticky', left: 0, zIndex: 2, background: 'var(--surface)', borderRight: '1px solid var(--outline-variant)', borderBottom: '1px solid color-mix(in srgb, var(--outline-variant) 55%, transparent)', padding: '0 12px', display: 'flex', alignItems: 'center', gap: 8, minHeight: 34 }}>
                      <Av n={m.n} s={20} /><span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.n.split(' ')[0]}</span>
                    </div>
                    {Array.from({ length: 31 }, (_, i) => {
                      const s = EMP_MONTH[(i + r * 3) % EMP_MONTH.length], [lbl, c] = ATT[s];
                      return <button key={i} title={m.n + ' · ' + (i + 1) + ' Jul · ' + lbl} style={{ borderBottom: '1px solid color-mix(in srgb, var(--outline-variant) 55%, transparent)', background: 'color-mix(in srgb, ' + c + ' 17%, transparent)', color: c, fontSize: 10, fontWeight: 700, minHeight: 34 }}>{s}</button>;
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'shifts' && (
        <div className="grid">
          {[['General', 'सामान्य', '09:00', '18:00', '5 min', 'Sat, Sun'], ['Early', 'प्रातः', '07:00', '16:00', '10 min', 'Sun'], ['Night', 'रात्रि', '22:00', '07:00', '15 min', 'Sun']].map(([n, hi, s, e, g, off]) => (
            <div key={n} className="card" style={{ padding: 'var(--pad-card)' }}>
              <div className="between"><span className="rowflex" style={{ gap: 8 }}><b style={{ fontSize: 14 }}>{n}</b><span className="hi mute" style={{ fontSize: 13 }}>{hi}</span></span><button className="icobtn">{I.dots}</button></div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, marginTop: 8 }}>{s} <span style={{ color: 'var(--on-surface-faint)' }}>→</span> {e}</div>
              <div className="divider" style={{ margin: '11px 0' }} />
              <div className="col" style={{ gap: 5, fontSize: 12 }}>
                <div className="between"><span className="mute">Grace period</span><b className="mono">{g}</b></div>
                <div className="between"><span className="mute">Weekly off</span><b>{off}</b></div>
                <div className="between"><span className="mute">Half day under</span><b className="mono">4h</b></div>
              </div>
            </div>
          ))}
          <button className="card" style={{ padding: 'var(--pad-card)', borderStyle: 'dashed', display: 'grid', placeItems: 'center', minHeight: 150, color: 'var(--on-surface-3)' }}>{I.plus} New shift</button>
        </div>
      )}

      {tab === 'anomalies' && (
        <div className="col" style={{ gap: 10 }}>
          {[['Face mismatch', 'Priya Nair · 25 Jul 09:14', '62% match — below the 85% threshold', '#B42318'],
            ['Outside geo-fence', 'Fatima Sheikh · 25 Jul 09:06', 'Hyderabad — no fence configured for this location', '#A66207'],
            ['Duplicate punch', 'Arjun Desai · 24 Jul 08:47', 'Two clock-ins 40 seconds apart', '#A66207']].map(([t, who, why, c]) => (
            <div key={t} className="card" style={{ padding: 'var(--pad-card)', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 13, alignItems: 'center', borderLeft: '3px solid ' + c }}>
              <div style={{ width: 40, height: 40, borderRadius: 'var(--r-sm)', background: 'color-mix(in srgb, ' + c + ' 15%, transparent)', display: 'grid', placeItems: 'center', color: c }}>{I.clock}</div>
              <div style={{ minWidth: 0 }}>
                <b style={{ fontSize: 13.5 }}>{t}</b>
                <div className="mute" style={{ fontSize: 12, marginTop: 2 }}>{who} · {why}</div>
              </div>
              <div className="rowflex" style={{ gap: 7, flexShrink: 0 }}>
                <button className="btn btn--out btn--sm">Reject</button>
                <button className="btn btn--fill btn--sm">Accept</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'geo-fence' && (
        <div className="two">
          <Card title="Allowed locations" hi="स्थान" flush right={<button className="btn btn--out btn--sm">{I.plus} Add</button>}>
            <div style={{ height: 260, background: 'var(--s-container)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(var(--outline-variant) 1px, transparent 1px), linear-gradient(90deg, var(--outline-variant) 1px, transparent 1px)', backgroundSize: '34px 34px', opacity: .5 }} />
              <div style={{ position: 'absolute', left: '38%', top: '42%', width: 128, height: 128, marginLeft: -64, marginTop: -64, borderRadius: '50%', background: 'color-mix(in srgb, var(--primary) 18%, transparent)', border: '2px solid var(--primary)' }} />
              <div style={{ position: 'absolute', left: '38%', top: '42%', width: 11, height: 11, margin: '-5px 0 0 -5px', borderRadius: '50%', background: 'var(--primary)', boxShadow: '0 0 0 3px var(--surface)' }} />
              <span className="tag" style={{ '--c': '#04837A', position: 'absolute', left: '38%', top: '42%', transform: 'translate(14px, -34px)', background: 'var(--surface)' }}>BKC · 200m</span>
            </div>
            <div style={{ padding: 'var(--pad-card)' }}>
              <div className="fld"><div className="between"><span className="fld__l">Radius</span><span className="mono" style={{ fontSize: 11 }}>200 m</span></div><input className="sld" type="range" min="50" max="1000" step="50" defaultValue="200" /></div>
            </div>
          </Card>
          <Card title="Locations" hi="सूची" flush>
            {[['Bandra Kurla Complex', 'Mumbai · 200m', 4], ['Bengaluru office', 'Koramangala · 150m', 1], ['Hyderabad', 'not configured', 0]].map(([n, d, c], i) => (
              <div key={n} className="between" style={{ padding: '12px var(--pad-card)', borderBottom: i < 2 ? '1px solid var(--outline-variant)' : 0 }}>
                <span style={{ minWidth: 0 }}><b style={{ fontSize: 13, display: 'block' }}>{n}</b><span className="mute" style={{ fontSize: 11.5, color: c ? undefined : 'var(--warn)' }}>{d}</span></span>
                <span className="rowflex" style={{ gap: 8 }}>{c > 0 ? <span className="tag" style={{ '--c': '#04837A' }}>{c} staff</span> : <button className="btn btn--out btn--sm">Set up</button>}</span>
              </div>
            ))}
          </Card>
        </div>
      )}

      {tab === 'regularization' && (
        <div className="col" style={{ gap: 10 }}>
          {[['Arjun Desai', '22 Jul', 'Missed punch-out', 'Client meeting ran late, left directly from site', 'pending'],
            ['Priya Nair', '18 Jul', 'Wrong location', 'Worked from the Bengaluru office, no fence set', 'pending']].map(([n, d, kind, why, st]) => (
            <div key={n + d} className="card" style={{ padding: 'var(--pad-card)', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 13, alignItems: 'center' }}>
              <Av n={n} s={36} />
              <div style={{ minWidth: 0 }}>
                <span className="rowflex" style={{ gap: 8 }}><b style={{ fontSize: 13.5 }}>{n}</b><span className="tag" style={{ '--c': '#A66207' }}>{kind}</span><span className="mute mono" style={{ fontSize: 11 }}>{d}</span></span>
                <div className="mute" style={{ fontSize: 12, marginTop: 3 }}>{why}</div>
              </div>
              <div className="rowflex" style={{ gap: 7, flexShrink: 0 }}>
                <button className="btn btn--out btn--sm">Decline</button>
                <button className="btn btn--fill btn--sm">{I.check} Approve</button>
              </div>
            </div>
          ))}
          <Card title="Flows into" hi="संबंध">
            <div className="rowflex" style={{ gap: 9, flexWrap: 'wrap' }}>
              <span className="tag" style={{ '--c': '#04837A' }}><span className="hi">मानव</span> Leave balance</span>
              <span className="tag" style={{ '--c': '#0082c6' }}><span className="hi">वेतन</span> Payroll days</span>
              <span className="mute" style={{ fontSize: 12 }}>Approving a regularization recalculates both — nothing is entered twice.</span>
            </div>
          </Card>
        </div>
      )}

      {tab === 'reports' && (
        <>
          <div className="rowflex" style={{ gap: 9 }}>
            <div className="fld" style={{ flex: '0 1 150px' }}><span className="fld__l">From</span><input className="inp" type="date" defaultValue="2026-07-01" /></div>
            <div className="fld" style={{ flex: '0 1 150px' }}><span className="fld__l">To</span><input className="inp" type="date" defaultValue="2026-07-31" /></div>
            <div className="fld" style={{ flex: '0 1 170px' }}><span className="fld__l">Department</span><select className="inp"><option>All departments</option><option>Finance</option><option>Legal</option></select></div>
            <button className="btn btn--fill btn--sm" style={{ alignSelf: 'flex-end' }}>Run</button>
          </div>
          <div className="tbl">
            <div className="tbl__scroll">
              <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.4fr) 84px 84px 84px 96px 104px' }}>
                <span>Employee</span><span className="tbl__c--num">Present</span><span className="tbl__c--num">Absent</span><span className="tbl__c--num">Late</span><span className="tbl__c--num">Avg hrs</span><span className="tbl__c--num">Overtime</span>
              </div>
              {TEAM.map((m, i) => (
                <div key={m.n} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.4fr) 84px 84px 84px 96px 104px' }}>
                  <span className="tbl__c"><Av n={m.n} s={26} /><span className="tbl__t">{m.n}</span></span>
                  <span className="tbl__c tbl__c--num">{[19, 21, 17, 20, 22, 18][i]}</span>
                  <span className="tbl__c tbl__c--num" style={{ color: i === 2 ? 'var(--danger)' : undefined }}>{[1, 0, 3, 1, 0, 2][i]}</span>
                  <span className="tbl__c tbl__c--num" style={{ color: 'var(--warn)' }}>{[2, 0, 4, 1, 0, 1][i]}</span>
                  <span className="tbl__c tbl__c--num">{[8.4, 8.9, 7.6, 8.2, 9.1, 8.0][i]}</span>
                  <span className="tbl__c tbl__c--num">{[6.5, 12.0, 0, 3.5, 14.5, 1.0][i]}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

Object.assign(window, { ATT, MONTH, EMP_MONTH, PAH_TABS, ScreenPahchan });
