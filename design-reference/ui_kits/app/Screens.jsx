
const WEEK_HI = ['सोम','मंगल','बुध','गुरु','शुक्र','शनि','रवि'];
const PRI = { urgent: '#C0392B', high: '#B06A00', medium: '#0082c6', low: '#6E7B91' };
const COLORS = ['#0082c6','#03a1b6','#05b7aa','#d97706','#6366f1','#C0392B','#0A7A6E','#a78bfa'];
function ini(n){ return (n||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(); }

// ── Dashboard ───────────────────────────────────────────────────
function ScreenToday({ onOpenDrawer }) {
  const now = new Date();
  const weekDates = Array.from({length:7}, (_,i) => {
    const d = new Date(now); d.setDate(d.getDate() - d.getDay() + 1 + i); return d;
  });
  const todayIdx = weekDates.findIndex(d => d.toDateString() === now.toDateString());
  const dotsByDay = {};
  weekDates.forEach((d,i) => { if(i===todayIdx) dotsByDay[d.toDateString()]=2; else if(i<todayIdx) dotsByDay[d.toDateString()]=1; });

  return (
    <div className="k-screen">
      <section className="k-hero">
        <div className="k-hero__watermark" aria-hidden="true">कर्तव्य</div>
        <div className="k-hero__inner">
          <div className="k-hero__meta">
            <span className="k-hero__date">{now.toLocaleDateString('en-US',{weekday:'long'}).toUpperCase()} · गुरुवार</span>
            <span className="k-hero__sep">·</span>
            <span className="k-hero__date">{now.toLocaleDateString('en-US',{day:'numeric',month:'short',year:'numeric'}).toUpperCase()}</span>
            <span className="k-hero__sep">·</span>
            <span className="k-hero__samvat">विक्रम संवत् 2083</span>
          </div>
          <h1 className="k-hero__h1"><span className="k-hero__greet">नमस्ते,</span><span className="k-hero__name"> Keval.</span></h1>
          <p className="k-hero__lede">You have <b>4 open tasks</b>, 1 due today, 0 running late. करणीयं कुरु — <em>Do what must be done.</em></p>
          <div className="k-hero__weekstrip">
            {weekDates.map((d,i) => (
              <div key={i} className={'k-wday'+(i===todayIdx?' is-today':'')}>
                <div className="k-week__hi">{WEEK_HI[i]}</div>
                <div className="k-week__num">{d.getDate()}</div>
                <div className="k-week__dots">{Array.from({length:Math.min(dotsByDay[d.toDateString()]||0,4)}).map((_,j)=><i key={j}/>)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="k-stats">
        <div className="k-stat k-stat--blue"><div className="k-stat__lbl"><span>DUE TODAY</span><span className="k-stat__hi">आज</span></div><div className="k-stat__val">1</div><div className="k-stat__sub">stay focused</div></div>
        <div className="k-stat k-stat--teal"><div className="k-stat__lbl"><span>IN PROGRESS</span><span className="k-stat__hi">चालू</span></div><div className="k-stat__val">3</div><div className="k-stat__sub">across 2 projects</div></div>
        <div className="k-stat k-stat--amber"><div className="k-stat__lbl"><span>IN REVIEW</span><span className="k-stat__hi">समीक्षा</span></div><div className="k-stat__val">2</div><div className="k-stat__sub">awaiting approval</div></div>
        <div className="k-stat k-stat--red"><div className="k-stat__lbl"><span>OVERDUE</span></div><div className="k-stat__val">0</div><div className="k-stat__sub">all clear</div></div>
      </div>

      <div className="k-twocol">
        <div className="k-col">
          <section className="k-card">
            <header className="k-card__head"><div className="k-card__titles"><h3 className="k-card__title">My tasks today</h3><span className="k-card__sans">आज के कार्य</span></div></header>
            <div className="k-card__body">
              <div className="k-tasklist">
                {[{id:'KAR-582',t:'Tata Steel — Mumbai office review',p:'urgent',proj:{n:'Mumbai client',c:'#C0392B'}},
                  {id:'KAR-184',t:'Compile Q1 GSTR-3B working notes',p:'high',proj:{n:'Quarterly GST',c:'#0082c6'}},
                  {id:'KAR-112',t:'CA Sharma — share draft for review',p:'medium',proj:{n:'Quarterly GST',c:'#0082c6'}},
                  {id:'KAR-411',t:'Vendor agreement template update',p:'low',proj:{n:'Vendor onboarding',c:'#6366f1'}}
                ].map(t=>(
                  <button key={t.id} className="k-taskrow" onClick={()=>onOpenDrawer?.(t)}>
                    <span className="k-pdot" style={{width:8,height:8,background:PRI[t.p]}}/>
                    <span className="k-taskrow__id" style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--ink-3)'}}>{t.id}</span>
                    <span className="k-taskrow__title" style={{fontSize:'13.5px',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>{t.t}</span>
                    <span className="k-ptag"><span className="k-ptag__dot" style={{background:t.proj.c}}/><span className="k-ptag__name">{t.proj.n}</span></span>
                    <span className="k-avstack"><span className="k-avatar k-avatar--ring" style={{width:22,height:22,fontSize:9,background:COLORS[0]}}>KS</span></span>
                    <span className={'k-due k-due--'+(t.p==='urgent'?'danger':'warn')}>{t.p==='urgent'?'Today':'Tomorrow'}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
          <section className="k-card">
            <header className="k-card__head"><div className="k-card__titles"><h3 className="k-card__title">Project status</h3><span className="k-card__sans">परियोजना स्थिति</span></div></header>
            <div className="k-card__body">
              <div className="k-stackbar">
                <div className="k-stackbar__seg" style={{flex:3,background:'#94a3b8',borderRadius:'99px 0 0 99px'}}/>
                <div className="k-stackbar__seg" style={{flex:5,background:'#0082c6'}}/>
                <div className="k-stackbar__seg" style={{flex:2,background:'#a78bfa'}}/>
                <div className="k-stackbar__seg" style={{flex:4,background:'#05b7aa',borderRadius:'0 99px 99px 0'}}/>
              </div>
              <div className="k-statuslegend">
                {[{l:'To Do',h:'कार्य',c:'#94a3b8',n:3},{l:'In Progress',h:'चालू',c:'#0082c6',n:5},{l:'In Review',h:'समीक्षा',c:'#a78bfa',n:2},{l:'Done',h:'सम्पन्न',c:'#05b7aa',n:4}].map(s=>(
                  <div key={s.l} className="k-statuslegend__row"><span className="k-statuslegend__dot" style={{background:s.c}}/><span>{s.l}</span><span className="k-statuslegend__hi">{s.h}</span><span className="k-statuslegend__count">{s.n}</span></div>
                ))}
              </div>
              <div className="k-meter" style={{marginTop:16,paddingTop:16,borderTop:'1px dashed var(--rule-soft)'}}><div className="k-meter__bar"><div className="k-meter__fill" style={{width:'62%'}}/></div><div className="k-meter__lbl" style={{marginTop:8,fontSize:12,color:'var(--ink-3)'}}>Quarter on track — 62%</div></div>
            </div>
          </section>
        </div>
        <div className="k-col">
          <section className="k-card">
            <header className="k-card__head"><div className="k-card__titles"><h3 className="k-card__title">Upcoming this week</h3><span className="k-card__sans">आगामी सप्ताह</span></div></header>
            <div className="k-card__body">
              <div className="k-upcoming">
                {[{day:'Wed',t:'Client presentation — Saraswati Co.',due:'In 2d'},{day:'Thu',t:'GST filing deadline',due:'In 3d'},{day:'Fri',t:'Team standup notes',due:'In 4d'}].map((u,i)=>(
                  <div key={i} className="k-upcoming__row"><span style={{fontSize:12,color:'var(--ink-3)',fontFamily:'var(--font-mono)'}}>{u.day}</span><div className="k-upcoming__body"><div className="k-upcoming__title">{u.t}</div></div><span className="k-due k-due--normal" style={{fontSize:10}}>{u.due}</span></div>
                ))}
              </div>
            </div>
          </section>
          <section className="k-card">
            <header className="k-card__head"><div className="k-card__titles"><h3 className="k-card__title">Recent activity</h3><span className="k-card__sans">हाल की गतिविधि</span></div></header>
            <div className="k-card__body">
              <div className="k-activity">
                {[{who:'Aanya Mehta',what:'completed',subj:'Reconcile input tax credit',when:'2h ago'},{who:'Rohan Iyer',what:'commented on',subj:'Vendor agreement template',when:'4h ago'},{who:'Keval Shah',what:'created',subj:'Mumbai office review',when:'yesterday'}].map((a,i)=>(
                  <div key={i} className="k-activity__row">
                    <span className="k-avatar" style={{width:24,height:24,fontSize:9,background:COLORS[i+1]}}>{ini(a.who)}</span>
                    <div className="k-activity__body"><div className="k-activity__line"><b>{a.who}</b> {a.what} <span className="k-activity__what">{a.subj}</span></div><div className="k-activity__when">{a.when}</div></div>
                  </div>
                ))}
              </div>
            </div>
          </section>
          <div className="k-citation"><div className="k-citation__sans">कर्मण्येवाधिकारस्ते मा फलेषु कदाचन</div><div className="k-citation__src">— Bhagavad Gita 2.47 · <em>Do what must be done</em></div></div>
        </div>
      </div>
    </div>
  );
}

// ── Tasks ────────────────────────────────────────────────────────
function ScreenTasks({ onOpenDrawer }) {
  const [tab, setTab] = React.useState('mine');
  const tasks = [
    {id:'KAR-582',t:'Tata Steel — Mumbai office review',p:'urgent',proj:{n:'Mumbai client review',c:'#C0392B'},a:[{n:'Keval Shah'},{n:'Aanya Mehta'}],due:'Tomorrow',dv:'warn',st:'In review'},
    {id:'KAR-184',t:'Compile Q1 GSTR-3B working notes',p:'high',proj:{n:'Quarterly GST filing',c:'#0082c6'},a:[{n:'Keval Shah'},{n:'Aanya Mehta'}],due:'Tomorrow',dv:'warn',st:'In progress'},
    {id:'KAR-112',t:'CA Sharma — share draft for review',p:'medium',proj:{n:'Quarterly GST filing',c:'#0082c6'},a:[{n:'Keval Shah'}],due:'In 3d',dv:'normal',st:'To Do'},
    {id:'KAR-411',t:'Vendor agreement template update',p:'low',proj:{n:'Vendor onboarding v2',c:'#6366f1'},a:[{n:'Priya Nair'}],due:'25 Oct',dv:'muted',st:'To Do'},
  ];
  const groups = [
    {title:'Urgent',sans:'अत्यावश्यक',c:'#C0392B',tasks:tasks.filter(t=>t.p==='urgent')},
    {title:'High',sans:'उच्च',c:'#B06A00',tasks:tasks.filter(t=>t.p==='high')},
    {title:'Medium',sans:'मध्यम',c:'#0082c6',tasks:tasks.filter(t=>t.p==='medium')},
    {title:'Low',sans:'न्यून',c:'#6E7B91',tasks:tasks.filter(t=>t.p==='low')},
  ];

  return (
    <div className="k-screen">
      <header className="k-pageh"><div className="k-pageh__txt"><div className="k-pageh__kicker">WORKSPACE</div><h1 className="k-pageh__h1">Tasks <span className="k-pageh__sans">कर्तव्य</span></h1><p className="k-pageh__lede">The list of what's worth doing today.</p></div></header>
      <div className="k-filterbar">
        <div className="k-segctrl">
          {[{id:'mine',l:'Mine',c:4},{id:'all',l:'All open',c:11},{id:'overdue',l:'Overdue',c:0},{id:'done',l:'Done',c:2}].map(o=>(
            <button key={o.id} className={'k-segctrl__btn'+(tab===o.id?' is-active':'')} onClick={()=>setTab(o.id)}>{o.l} <span className="k-segctrl__count">{o.c}</span></button>
          ))}
        </div>
        <div style={{display:'flex',gap:12}}>
          <div className="k-fld"><span className="k-fld__lbl">Group by</span><select className="k-fld__sel"><option>Priority</option></select></div>
        </div>
      </div>
      <div className="k-tablewrap">
        <div className="k-table__head"><span>TASK</span><span>PROJECT</span><span>ASSIGNEES</span><span>DUE</span><span>STATUS</span></div>
        {groups.filter(g=>g.tasks.length>0).map(g=>(
          <div key={g.title} className="k-group">
            <div className="k-group__head" style={{'--group-color':g.c}}><div className="k-group__bar"/><span className="k-group__title">{g.title}</span><span className="k-group__sans">{g.sans}</span><span className="k-group__count">{g.tasks.length}</span></div>
            {g.tasks.map(t=>(
              <button key={t.id} className="k-trow" onClick={()=>onOpenDrawer?.(t)}>
                <div className="k-trow__cell k-c-task"><span className="k-pdot" style={{width:8,height:8,background:PRI[t.p]}}/><span className="k-trow__id">{t.id}</span><span className="k-trow__title">{t.t}</span></div>
                <div className="k-trow__cell k-c-project"><span className="k-ptag"><span className="k-ptag__dot" style={{background:t.proj.c}}/><span className="k-ptag__name">{t.proj.n}</span></span></div>
                <div className="k-trow__cell"><span className="k-avstack">{t.a.slice(0,2).map((u,i)=><span key={i} className="k-avatar k-avatar--ring" style={{width:22,height:22,fontSize:9,background:COLORS[i]}}>{ini(u.n)}</span>)}</span></div>
                <div className="k-trow__cell"><span className={'k-due k-due--'+t.dv}>{t.due}</span></div>
                <div className="k-trow__cell"><span className="k-statuschip" style={{'--c':t.st==='In progress'?'#0082c6':t.st==='In review'?'#a78bfa':'#94a3b8'}}><span className="k-statuschip__dot"/>{t.st}</span></div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Boards ───────────────────────────────────────────────────────
function ScreenBoards() {
  const cols = [
    {title:'To do',sans:'कार्य',c:'#94a3b8',tasks:[]},
    {title:'In progress',sans:'चालू',c:'#0082c6',tasks:[{id:'KAR-184',t:'Compile Q1 GSTR-3B working notes',p:'high',due:'Tomorrow',dv:'warn',cm:4,at:2,a:[{n:'Keval Shah'},{n:'Aanya Mehta'}]}]},
    {title:'In review',sans:'समीक्षा',c:'#a78bfa',tasks:[{id:'KAR-582',t:'Tata Steel — Mumbai office review',p:'urgent',due:'Today',dv:'danger',cm:2,at:1,a:[{n:'Keval Shah'}]}]},
    {title:'Done',sans:'सम्पन्न',c:'#05b7aa',tasks:[{id:'KAR-090',t:'Setup quarterly filing template',p:'medium',due:'Done',dv:'muted',cm:0,at:0,a:[{n:'Priya Nair'}]}]},
  ];
  return (
    <div className="k-screen">
      <header className="k-pageh"><div className="k-pageh__txt"><div className="k-pageh__kicker">AEKAM INC · राजस्व</div><h1 className="k-pageh__h1">Quarterly GST filing</h1><p className="k-pageh__lede">Move work across the board. Click any card to open.</p></div></header>
      <div className="k-board">
        {cols.map(col=>(
          <div key={col.title} className="k-bcol">
            <div className="k-bcol__head"><div className="k-bcol__bar" style={{background:col.c}}/><span className="k-bcol__title">{col.title}</span><span className="k-bcol__sans">{col.sans}</span><span className="k-bcol__count">{col.tasks.length}</span><button className="k-bcol__add">+</button></div>
            <div className="k-bcol__body">
              {col.tasks.map(t=>(
                <button key={t.id} className="k-bcard">
                  <div className="k-bcard__top"><span className="k-pdot" style={{width:7,height:7,background:PRI[t.p]}}/><span className="k-bcard__id">{t.id}</span><span className="k-bcard__priolbl">{t.p}</span></div>
                  <div className="k-bcard__title">{t.t}</div>
                  <div className="k-bcard__foot"><span className={'k-due k-due--'+t.dv} style={{fontSize:10}}>{t.due}</span><div className="k-bcard__meta">{t.cm>0&&<span>💬{t.cm}</span>}{t.at>0&&<span>📎{t.at}</span>}</div><span className="k-avstack">{t.a.slice(0,2).map((u,i)=><span key={i} className="k-avatar k-avatar--ring" style={{width:22,height:22,fontSize:9,background:COLORS[i]}}>{ini(u.n)}</span>)}</span></div>
                </button>
              ))}
              {col.tasks.length===0&&<div className="k-bcol__empty">Nothing here</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Projects ────────────────────────────────────────────────────
function ScreenProjects() {
  const projects = [
    {n:'Quarterly GST filing',s:'राजस्व',cl:'AEKAM INC',c:'#0082c6',tasks:4,done:1,days:30,prog:.62},
    {n:'Diwali campaign',s:'विपणन',cl:'SARASWATI CO.',c:'#d97706',tasks:3,done:0,days:45,prog:.34},
    {n:'Bengaluru office fit-out',s:'कार्यालय',cl:'AEKAM INC',c:'#05b7aa',tasks:6,done:3,days:12,prog:.50},
    {n:'Vendor onboarding v2',s:'सहयोग',cl:'AEKAM INC',c:'#6366f1',tasks:5,done:2,days:60,prog:.40},
    {n:'Mumbai client review',s:'समीक्षा',cl:'TATA STEEL',c:'#C0392B',tasks:2,done:0,days:5,prog:.10},
  ];
  return (
    <div className="k-screen">
      <header className="k-pageh"><div className="k-pageh__txt"><div className="k-pageh__kicker">WORKSPACE</div><h1 className="k-pageh__h1">Projects <span className="k-pageh__sans">योजनाएँ</span></h1><p className="k-pageh__lede">Everything in flight at Aekam right now.</p></div></header>
      <div className="k-pgrid">
        {projects.map(p=>(
          <button key={p.n} className="k-pcard">
            <div className="k-pcard__head"><div className="k-pcard__bar" style={{background:p.c}}/><div className="k-pcard__titles"><div className="k-pcard__sans">{p.s}</div><div className="k-pcard__name">{p.n}</div><div className="k-pcard__client">{p.cl}</div></div></div>
            <div className="k-pcard__body"><div className="k-pcard__stat"><b>{p.tasks}</b><span>TASKS</span></div><div className="k-pcard__stat"><b>{p.done}</b><span>DONE</span></div><div className="k-pcard__stat"><b>{p.days}</b><span>DAYS</span></div></div>
            <div><div className="k-pcard__bar2"><i style={{width:(p.prog*100)+'%',background:p.c}}/></div><div className="k-pcard__meter-row"><span>{Math.round(p.prog*100)}% complete</span><span className="k-due k-due--muted" style={{fontSize:10}}>{p.days>30?'Oct':'Jun'}</span></div></div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Team ─────────────────────────────────────────────────────────
function ScreenTeam() {
  const members = [
    {n:'Keval Shah',r:'admin',tz:'IST',c:'#0082c6',open:4,done:0,avg:'13H',tasks:[{t:'Compile Q1 GSTR-3B working…',id:'KAR-184',p:'high'},{t:'CA Sharma — share draft for r…',id:'KAR-112',p:'medium'},{t:'Vendor agreement template …',id:'KAR-411',p:'low'}]},
    {n:'Aanya Mehta',r:'member',tz:'IST',c:'#03a1b6',open:2,done:0,avg:'10H',tasks:[{t:'Compile Q1 GSTR-3B working…',id:'KAR-184',p:'high'},{t:'Reconcile input tax credit — …',id:'KAR-188',p:'medium'}]},
    {n:'Rohan Iyer',r:'member',tz:'IST',c:'#05b7aa',open:3,done:1,avg:'8H',tasks:[{t:'Vendor agreement template …',id:'KAR-411',p:'low'},{t:'Setup quarterly filing template',id:'KAR-090',p:'medium'}]},
    {n:'Priya Nair',r:'member',tz:'IST',c:'#d97706',open:1,done:2,avg:'6H',tasks:[{t:'Diwali campaign brief',id:'KAR-301',p:'medium'}]},
  ];
  const ROLE_CLS = {admin:'k-rolebadge--admin',member:'k-rolebadge--member',client:'k-rolebadge--client'};
  return (
    <div className="k-screen">
      <header className="k-pageh"><div className="k-pageh__txt"><div className="k-pageh__kicker">WORKSPACE</div><h1 className="k-pageh__h1">Team <span className="k-pageh__sans">सहयोगी</span></h1><p className="k-pageh__lede">Aekam Inc · {members.length} members across Mumbai and Bengaluru.</p></div></header>
      <div className="k-teamgrid">
        {members.map(m=>(
          <div key={m.n} className="k-mcard">
            <div className="k-mcard__head">
              <span className="k-avatar" style={{width:38,height:38,fontSize:14,background:m.c}}>{ini(m.n)}</span>
              <div><div className="k-mcard__name">{m.n}</div><div className="k-mcard__role"><span className={'k-rolebadge '+(ROLE_CLS[m.r]||ROLE_CLS.member)}>{m.r}</span><span className="k-mcard__tz">{m.tz}</span></div></div>
            </div>
            <div className="k-mcard__stats"><div><b>{m.open}</b><span>OPEN</span></div><div><b>{m.done}</b><span>DONE</span></div><div><b>{m.avg}</b><span>EST</span></div></div>
            <div className="k-mcard__work">
              {m.tasks.slice(0,3).map((t,i)=>(
                <div key={i} className="k-mcard__row"><span className="k-pdot" style={{width:8,height:8,background:PRI[t.p]||'#6E7B91'}}/><span className="k-mcard__tt">{t.t}</span><span className="k-mcard__id">{t.id}</span></div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { ScreenToday, ScreenTasks, ScreenBoards, ScreenProjects, ScreenTeam });
