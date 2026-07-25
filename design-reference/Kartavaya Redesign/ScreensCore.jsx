// Dashboard + Graha (CRM) — the two deep screens
const WEEK_HI = ['सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि', 'रवि'];

function ScreenDash({ open }) {
  const now = new Date();
  const week = Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + i); return d; });
  const todayIdx = week.findIndex(d => d.toDateString() === now.toDateString());
  return (
    <div className="screen">
      <PH kick="Thursday · गुरुवार · विक्रम संवत् 2083" hi="नमस्ते, केवल" en="Dashboard"
        lede="Four tasks need you today. Receivables are ₹4.2 L overdue — Tata Steel is the big one."
        right={<><button className="btn btn--out btn--sm">{I.filter} This week</button><button className="btn btn--fill btn--sm" onClick={() => open('task')}>{I.plus} New task</button></>} />

      <div className="stats">
        <Stat kind="p" lbl="Pipeline" hi="प्रवाह" v={lakh(12270000)} trend={8} sub="9 open deals" />
        <Stat kind="warn" lbl="Receivables" hi="प्राप्य" v={lakh(1990000)} sub="₹4.2 L overdue" />
        <Stat kind="ok" lbl="Collected MTD" hi="संग्रह" v={lakh(3120000)} trend={14} />
        <Stat kind="danger" lbl="GST due" hi="कर" v="20 Aug" sub="GSTR-3B · ₹3.4 L" />
        <Stat lbl="Team in today" hi="उपस्थित" v="4/6" sub="1 leave · 1 WFH" />
      </div>

      <div className="rowflex" style={{ gap: 6 }}>
        {week.map((d, i) => (
          <button key={i} className={'chip' + (i === todayIdx ? ' on' : '')} style={{ flexDirection: 'column', gap: 2, padding: '8px 14px', minWidth: 62 }}>
            <span className="hi" style={{ fontSize: 12 }}>{WEEK_HI[i]}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 17, lineHeight: 1 }}>{d.getDate()}</span>
            <span style={{ display: 'flex', gap: 2, height: 4 }}>{Array.from({ length: i === todayIdx ? 3 : i < todayIdx ? 1 : 2 }).map((_, j) => <i key={j} style={{ width: 3, height: 3, borderRadius: 9, background: 'currentColor', opacity: .5 }} />)}</span>
          </button>
        ))}
      </div>

      <div className="two">
        <div className="col">
          <Card title="Needs you today" hi="आज के कार्य" flush right={<button className="btn btn--text btn--sm">View all</button>}>
            <div className="tbl__scroll">
              <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,2.6fr) 130px 100px 96px', background: 'transparent', border: 0 }}>
                <span>Task</span><span>Project</span><span>Owner</span><span>Due</span>
              </div>
              {TASKS.slice(0, 4).map(t => (
                <button key={t.id} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,2.6fr) 130px 100px 96px' }} onClick={() => open('task', t)}>
                  <span className="tbl__c"><i className="pdot" style={{ background: PRIO[t.p] }} /><span className="tbl__id">{t.id}</span><span className="tbl__t">{t.t}</span></span>
                  <span className="tbl__c"><i className="chip__dot" style={{ background: t.pc }} /><span className="tbl__s">{t.proj}</span></span>
                  <span className="tbl__c"><Avs list={t.a} max={2} s={22} /></span>
                  <span className="tbl__c"><Tag c={t.dv === 'danger' ? '#B42318' : t.dv === 'warn' ? '#A66207' : '#74786F'}>{t.due}</Tag></span>
                </button>
              ))}
            </div>
          </Card>

          <Card title="Cash position" hi="नकदी" right={<Seg opts={[{ id: 'm', l: '30d' }, { id: 'q', l: 'Quarter' }]} val="m" set={() => { }} />}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 128, padding: '4px 0' }}>
              {[42, 55, 38, 61, 74, 58, 82, 69, 91, 77, 64, 88].map((h, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 2, height: '100%' }}>
                  <div style={{ height: h + '%', background: i === 11 ? 'var(--primary)' : 'var(--primary-container)', borderRadius: 'var(--r-xs) var(--r-xs) 2px 2px' }} />
                  <div style={{ height: (h * .34) + '%', background: 'var(--tertiary-container)', borderRadius: '2px 2px var(--r-xs) var(--r-xs)' }} />
                </div>
              ))}
            </div>
            <div className="between" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--outline-variant)' }}>
              <span className="rowflex" style={{ fontSize: 12 }}><i className="chip__dot" style={{ background: 'var(--primary)' }} /> Inflow <b className="mono">{lakh(3120000)}</b></span>
              <span className="rowflex" style={{ fontSize: 12 }}><i className="chip__dot" style={{ background: 'var(--tertiary-container)' }} /> Outflow <b className="mono">{lakh(1080000)}</b></span>
              <span className="mute" style={{ fontSize: 12 }}>Net <b className="mono" style={{ color: 'var(--ok)' }}>+{lakh(2040000)}</b></span>
            </div>
          </Card>
        </div>

        <div className="col">
          <Card title="Approvals" hi="सम्मति" flush right={<span className="tag" style={{ '--c': '#A66207' }}><span className="tag__dot" />3 waiting</span>}>
            {[['Diwali campaign budget', 'Priya Nair', '₹1.8 L'], ['Vendor agreement v2', 'Rohan Iyer', 'Legal'], ['July payroll run', 'Aanya Mehta', '₹8.4 L']].map(([t, who, meta], i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'center', padding: '11px var(--pad-card)', borderBottom: i < 2 ? '1px solid var(--outline-variant)' : 0 }}>
                <Av n={who} s={26} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</div>
                  <div className="mute" style={{ fontSize: 11 }}>{who} · {meta}</div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn--tonal btn--sm" style={{ padding: '5px 9px' }}>{I.check}</button>
                  <button className="btn btn--out btn--sm" style={{ padding: '5px 9px' }}>{I.x}</button>
                </div>
              </div>
            ))}
          </Card>

          <Card title="Activity" hi="गतिविधि">
            <div className="col" style={{ gap: 13 }}>
              {[['Aanya Mehta', 'closed', 'Asian Paints — ₹15.6 L', '2h'], ['Priya Nair', 'scheduled', '4 Diwali posts', '4h'], ['Rohan Iyer', 'flagged', 'Nirmal Exports as stale', '6h'], ['Fatima Sheikh', 'approved', 'PF challan for July', 'Yesterday']].map(([w, act, what, when], i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10 }}>
                  <Av n={w} s={24} />
                  <div>
                    <div style={{ fontSize: 12.5, color: 'var(--on-surface-2)', lineHeight: 1.45 }}><b style={{ color: 'var(--on-surface)' }}>{w}</b> {act} <span style={{ color: 'var(--on-surface)' }}>{what}</span></div>
                    <div className="mute mono" style={{ fontSize: 10.5, marginTop: 1 }}>{when}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className="card card--tonal" style={{ padding: 'var(--pad-card)', borderLeft: '3px solid var(--primary)' }}>
            <div className="hi" style={{ fontSize: 16, lineHeight: 1.55 }}>कर्मण्येवाधिकारस्ते मा फलेषु कदाचन</div>
            <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 12.5, color: 'var(--on-surface-3)', marginTop: 7 }}>— Bhagavad Gita 2.47</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Graha (CRM) — pipeline-first, per research ──────────────────────────
function ScreenGraha({ open }) {
  const [tab, setTab] = React.useState('pipeline');
  const byStage = STAGES.map((s, i) => DEALS.filter(d => d.st === i));
  const total = DEALS.reduce((a, d) => a + d.v, 0);
  const weighted = DEALS.reduce((a, d) => a + d.v * STAGES[d.st].prob / 100, 0);
  const stale = DEALS.filter(d => d.rot).length;

  return (
    <div className="screen">
      <PH kick="Revenue · राजस्व" hi="ग्रह" en="CRM"
        lede="Every deal carries its next step. Two have none — they surface first."
        right={<><button className="btn btn--out btn--sm">{I.filter} Filters</button><button className="btn btn--fill btn--sm" onClick={() => open('deal')}>{I.plus} New deal</button></>} />

      <div className="between">
        <div style={{ flex: 1, minWidth: 0 }}><TabBar tabs={MODULE_TABS.graha} val={tab} set={setTab} counts={{ pipeline: DEALS.length, contacts: CONTACTS.length }} /></div>
        {stale > 0 && (
          <div className="rowflex" style={{ gap: 8, padding: '6px 12px', background: 'var(--warn-container)', borderRadius: 'var(--r-sm)', fontSize: 12.5, color: 'var(--on-surface)' }}>
            {I.clock}<b>{stale} deals have no next step</b><button className="btn btn--text btn--sm" style={{ padding: '2px 6px' }}>Fix</button>
          </div>
        )}
      </div>

      <div className="stats">
        <Stat kind="p" lbl="Open pipeline" hi="प्रवाह" v={lakh(total)} sub={DEALS.length + ' deals'} />
        <Stat lbl="Weighted forecast" hi="अनुमान" v={lakh(weighted)} sub="by stage probability" />
        <Stat kind="ok" lbl="Won this quarter" hi="विजित" v={lakh(1560000)} trend={22} />
        <Stat kind="warn" lbl="Avg cycle" hi="चक्र" v="34d" sub="target 28d" />
      </div>

      {tab === 'pipeline' && (
        <div className="pipe">
          {STAGES.map((s, i) => {
            const deals = byStage[i], sum = deals.reduce((a, d) => a + d.v, 0);
            return (
              <div key={s.en} className="pipe__col">
                <div className="pipe__head" style={{ borderTop: '3px solid ' + s.c }}>
                  <div className="pipe__t"><span>{s.en}</span><span className="pipe__hi">{s.hi}</span></div>
                  <div className="pipe__sum mono">{sum ? lakh(sum) : '—'}</div>
                  <div className="pipe__n">{deals.length} deals · {s.prob}% likely</div>
                </div>
                {deals.map(d => (
                  <button key={d.co} className="deal" onClick={() => open('deal', d)} style={d.rot ? { borderColor: 'color-mix(in srgb, var(--warn) 55%, var(--outline-variant))' } : undefined}>
                    <div className="between" style={{ gap: 6 }}>
                      <span className="deal__co">{d.co}</span>
                      {d.rot && <span title="No next step">{I.clock}</span>}
                    </div>
                    <div className="deal__v mono">{lakh(d.v)}</div>
                    {d.next
                      ? <div className="rowflex" style={{ gap: 6, fontSize: 11.5, color: 'var(--on-surface-3)' }}>{I.check}<span>{d.next}</span><b style={{ color: d.when === 'Today' ? 'var(--warn)' : 'inherit' }}>{d.when}</b></div>
                      : <div className="rowflex" style={{ gap: 6, fontSize: 11.5, color: 'var(--warn)', fontWeight: 600 }}>{I.clock} No next step</div>}
                    <div className="deal__foot">
                      <Av n={d.own} s={22} />
                      <span className="mute" style={{ fontSize: 11 }}>{d.own.split(' ')[0]}</span>
                    </div>
                  </button>
                ))}
                {!deals.length && <div className="bcol__empty">Empty</div>}
              </div>
            );
          })}
        </div>
      )}

      {!['pipeline', 'contacts', 'activities'].includes(tab) && <TabStub tab={tab} module="ग्रह CRM" />}

      {tab === 'contacts' && (
        <div className="tbl">
          <div className="tbl__scroll">
            <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1.3fr) 130px 160px 110px' }}>
              <span>Contact</span><span>Company</span><span>City</span><span>GSTIN</span><span style={{ textAlign: 'right' }}>Value</span>
            </div>
            {CONTACTS.map(c => (
              <button key={c.n} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1.3fr) 130px 160px 110px' }} onClick={() => open('contact', c)}>
                <span className="tbl__c"><Av n={c.n} s={28} /><span style={{ minWidth: 0 }}><span className="tbl__t" style={{ display: 'block' }}>{c.n}</span><span className="tbl__s">{c.role}</span></span></span>
                <span className="tbl__c"><span className="tbl__t">{c.co}</span></span>
                <span className="tbl__c"><span className="tbl__s">{c.city}</span></span>
                <span className="tbl__c"><span className="tbl__s mono" style={{ fontSize: 11 }}>{c.gst}</span></span>
                <span className="tbl__c tbl__c--num"><b style={{ fontSize: 13 }}>{lakh(c.val)}</b></span>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'activities' && (
        <Card flush>
          <div style={{ padding: 'var(--pad-card)' }}>
            <div className="col" style={{ gap: 0 }}>
              {[['Meera Joshi', 'Tata Steel', 'Call — discussed fit-out timeline, wants revised quote by Friday', '5h ago', '#0082c6'],
                ['Vikram Malhotra', 'Wipro Consumer', 'Email — contract sent to legal for review', 'Yesterday', '#04837A'],
                ['Sunita Reddy', 'Bharat Forge', 'Meeting — negotiated 8% volume discount, pending approval', '2d ago', '#A66207'],
                ['Ramesh Iyer', 'Saraswati Textiles', 'Discovery call scheduled for tomorrow 11:00', '3d ago', '#7c5cbf']].map(([who, co, what, when, c], i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 14, paddingBottom: 18, position: 'relative' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <Av n={who} s={30} c={c} />
                    {i < 3 && <div style={{ flex: 1, width: 1, background: 'var(--outline-variant)' }} />}
                  </div>
                  <div style={{ paddingTop: 3 }}>
                    <div className="rowflex" style={{ gap: 8 }}><b style={{ fontSize: 13 }}>{who}</b><span className="mute" style={{ fontSize: 12 }}>{co}</span><span className="mute mono" style={{ fontSize: 10.5, marginLeft: 'auto' }}>{when}</span></div>
                    <div style={{ fontSize: 12.5, color: 'var(--on-surface-2)', marginTop: 3, lineHeight: 1.5 }}>{what}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

Object.assign(window, { ScreenDash, ScreenGraha });
