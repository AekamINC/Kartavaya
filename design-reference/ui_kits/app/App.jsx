
function KartavyaApp() {
  const [screen, setScreen] = React.useState('today');
  const [drawerTask, setDrawerTask] = React.useState(null);

  const screenMap = {
    today: <ScreenToday onOpenDrawer={setDrawerTask} />,
    tasks: <ScreenTasks onOpenDrawer={setDrawerTask} />,
    boards: <ScreenBoards />,
    projects: <ScreenProjects />,
    team: <ScreenTeam />,
  };

  return (
    <div className="k-app">
      <AppSidebar active={screen} onNav={setScreen} />
      <div className="k-main">
        <AppTopbar screen={screen} />
        <main className="k-content">
          {screenMap[screen] || (
            <div className="k-screen">
              <header className="k-pageh">
                <div className="k-pageh__txt">
                  <div className="k-pageh__kicker">COMING SOON</div>
                  <h1 className="k-pageh__h1">{screen.charAt(0).toUpperCase() + screen.slice(1)}</h1>
                  <p className="k-pageh__lede">This screen is available in the full application.</p>
                </div>
              </header>
            </div>
          )}
        </main>
      </div>

      {drawerTask && (
        <>
          <div className="k-dr-scrim" onClick={() => setDrawerTask(null)} />
          <div className="k-dr">
            <div className="k-dr__head">
              <div className="k-dr__crumb">
                {drawerTask.proj && <><span className="k-dr__cdot" style={{background: drawerTask.proj.c}} /><span>{drawerTask.proj.n || drawerTask.proj.name}</span><span style={{color:'var(--ink-faint)',margin:'0 4px'}}>/</span></>}
                <span style={{color:'var(--ink)',fontWeight:600}}>{drawerTask.id}</span>
              </div>
              <div className="k-dr__head-actions">
                <button className="k-iconbtn" onClick={() => setDrawerTask(null)}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4l8 8M12 4l-8 8"/></svg>
                </button>
              </div>
            </div>
            <div className="k-dr__title">
              <div className="k-dr__id">{drawerTask.id}</div>
              <h2 style={{fontFamily:'var(--font-display)',fontSize:26,fontWeight:500,lineHeight:1.2,margin:'6px 0 0',color:'var(--ink)'}}>{drawerTask.t || drawerTask.title}</h2>
            </div>
            <div className="k-dr__props">
              <div className="k-prop"><div className="k-prop__lbl"><span>STATUS</span><span className="k-prop__sans">स्थिति</span></div><div className="k-prop__val"><span className="k-statuschip" style={{'--c':'#0082c6'}}><span className="k-statuschip__dot"/>In Progress</span></div></div>
              <div className="k-prop"><div className="k-prop__lbl"><span>PRIORITY</span><span className="k-prop__sans">प्राथमिकता</span></div><div className="k-prop__val"><span className="k-pdot" style={{width:8,height:8,background:drawerTask.p==='urgent'?'#C0392B':drawerTask.p==='high'?'#B06A00':'#0082c6'}}/><span style={{textTransform:'capitalize'}}>{drawerTask.p}</span></div></div>
              <div className="k-prop"><div className="k-prop__lbl"><span>ASSIGNEES</span><span className="k-prop__sans">सौंपा</span></div><div className="k-prop__val"><div className="k-dr__people"><span className="k-dr__person"><span className="k-avatar" style={{width:20,height:20,fontSize:8,background:'#0082c6'}}>KS</span>Keval Shah</span></div></div></div>
              <div className="k-prop"><div className="k-prop__lbl"><span>DUE</span><span className="k-prop__sans">अंतिम तिथि</span></div><div className="k-prop__val"><span className="k-due k-due--warn">Tomorrow</span></div></div>
            </div>
            <div className="k-dr__tabs">
              <button className="k-dr__tab is-active">Details <span className="k-dr__tab-sans">विवरण</span></button>
              <button className="k-dr__tab">Comments <span className="k-dr__tab-count">4</span></button>
              <button className="k-dr__tab">Files <span className="k-dr__tab-count">2</span></button>
              <button className="k-dr__tab">Activity</button>
            </div>
            <div className="k-dr__body">
              <div className="k-prose">
                <h4>Description</h4>
                <p>Compile all quarterly GSTR-3B working notes for the current filing period. Cross-reference with input tax credit reconciliation and vendor invoices.</p>
                <h4>Acceptance criteria</h4>
                <ul><li>All vendor invoices matched</li><li>ITC reconciliation complete</li><li>Draft shared with CA Sharma for review</li></ul>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<KartavyaApp />);
