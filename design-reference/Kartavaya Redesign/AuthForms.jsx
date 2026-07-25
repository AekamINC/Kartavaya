// Auth screens — every state. Login, signup (2 steps), forgot, reset, accept invite.
const INDUSTRIES = ['IT Services', 'Manufacturing', 'Retail & Trading', 'Agency', 'Consulting', 'CA / Legal practice', 'Other'];
const TEAM_SIZES = ['1–10', '11–50', '51–200', '200+'];

function LoginScreen({ go }) {
  const [email, setEmail] = React.useState('keval@aekam.co');
  const [pw, setPw] = React.useState('');
  const [remember, setRemember] = React.useState(true);
  const [err, setErr] = React.useState({});
  const [banner, setBanner] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [shake, setShake] = React.useState(false);
  const [tries, setTries] = React.useState(0);
  const [done, setDone] = React.useState(false);

  const submit = e => {
    e.preventDefault();
    const n = {};
    if (!email.trim()) n.email = 'Enter your email address';
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) n.email = 'That doesn’t look like an email address';
    if (!pw) n.pw = 'Enter your password';
    setErr(n);
    if (Object.keys(n).length) { setShake(true); setTimeout(() => setShake(false), 420); return; }
    setBanner(null); setLoading(true);
    setTimeout(() => {
      setLoading(false);
      if (tries === 0) {
        setTries(1); setBanner('bad');
        setShake(true); setTimeout(() => setShake(false), 420);
      } else { setDone(true); }
    }, 900);
  };

  if (done) return (
    <AuthPane kick="Signed in" h1={<>Welcome back,<br />Keval.</>} hi="स्वागत"
      lede="Placeholder success state. The dashboard is fetched behind this, then the page cross-fades in — no spinner screen.">
      <div className="au-done"><span className="au-done__ic">{I.check}</span>Session opened · redirecting to मुख्य Dashboard</div>
      <AButton onClick={() => { setDone(false); setTries(0); setPw(''); }}>Replay from the top</AButton>
    </AuthPane>
  );

  return (
    <AuthPane kick="Welcome back · पुनः स्वागत" h1={<>Sign in to<br /><em>Kartavaya</em></>} shake={shake}
      banner={banner === 'bad' && (
        <div className="au-banner au-banner--err" role="alert">
          {SI.alert}
          <span><b>Invalid email or password.</b> Two attempts left before a 15-minute cooldown. <span className="mute">Placeholder — try again to see the success state.</span></span>
        </div>
      )}
      foot={<>New to Kartavaya? <button className="au-link" onClick={() => go('signup')}>Create an account</button></>}>
      <form onSubmit={submit} className="au-fields">
        <AField label="Email" value={email} set={v => { setEmail(v); setErr(e => ({ ...e, email: null })); }} err={err.email} autoFocus />
        <APassword label="Password" value={pw} set={v => { setPw(v); setErr(e => ({ ...e, pw: null })); }} err={err.pw} />
        <div className="au-row">
          <label className="au-check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /><span className="au-check__b">{I.check}</span>Keep me signed in</label>
          <button type="button" className="au-link" onClick={() => go('forgot')}>Forgot password?</button>
        </div>
        <AButton loading={loading}>{loading ? 'Signing in…' : 'Log in'}</AButton>
      </form>
      <OrDivider />
      <div className="au-social"><GoogleBtn /><MagicBtn /></div>
      <p className="au-fine">Invited by a colleague? Use the link in your email — it links this device to their organisation.</p>
    </AuthPane>
  );
}

function SignupScreen({ go }) {
  const [step, setStep] = React.useState(1);
  const [dir, setDir] = React.useState(1);
  const [f, setF] = React.useState({ name: '', email: '', pw: '' });
  const [err, setErr] = React.useState({});
  const [loading, setLoading] = React.useState(false);
  const [org, setOrg] = React.useState({ name: '', ind: '', size: '' });
  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); setErr(e => ({ ...e, [k]: null })); };

  const next = e => {
    e.preventDefault();
    const n = {};
    if (!f.name.trim()) n.name = 'We need a name to put on your account';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) n.email = 'Enter a valid email address';
    else if (f.email.trim().toLowerCase() === 'keval@aekam.co') n.email = 'exists';
    if (score(f.pw) < 2) n.pw = 'Use at least 8 characters with mixed case';
    setErr(n);
    if (Object.keys(n).length) return;
    setLoading(true);
    setTimeout(() => { setLoading(false); setDir(1); setStep(2); }, 800);
  };

  return (
    <AuthPane
      kick={<>Step {step} of 2 · <span className="au-steps">{[1, 2].map(n => <span key={n} className={'au-steps__d' + (n <= step ? ' on' : '')} />)}</span></>}
      h1={step === 1 ? <>Create your<br /><em>account</em></> : <>Set up your<br /><em>organisation</em></>}
      lede={step === 2 ? 'This becomes your workspace. Everyone you invite joins it, and every module is scoped to it.' : null}
      foot={step === 1
        ? <>Already have an account? <button className="au-link" onClick={() => go('login')}>Log in</button></>
        : <button className="au-link" onClick={() => { setDir(-1); setStep(1); }}>{I.chevL} Back to account details</button>}>
      <div className="au-slide" key={step} data-dir={dir}>
        {step === 1 ? (
          <>
            <form onSubmit={next} className="au-fields">
              <AField label="Full name" hi="नाम" value={f.name} set={v => set('name', v)} err={err.name} autoFocus />
              <AField label="Work email" value={f.email} set={v => set('email', v)}
                err={err.email === 'exists' ? null : err.email}
                hint={err.email !== 'exists' ? 'Used for invites, approvals and reset links.' : null} />
              {err.email === 'exists' && (
                <div className="au-banner au-banner--warn" role="alert">
                  {SI.alert}<span><b>keval@aekam.co is already registered.</b> <button className="au-link" onClick={() => go('login')}>Log in instead</button> or <button className="au-link" onClick={() => go('forgot')}>reset the password</button>.</span>
                </div>
              )}
              <APassword label="Password" value={f.pw} set={v => set('pw', v)} err={err.pw} strength />
              <AButton loading={loading}>{loading ? 'Creating…' : 'Create account'}</AButton>
            </form>
            <OrDivider label="or sign up with" />
            <div className="au-social"><GoogleBtn label="Sign up with Google" /></div>
            <p className="au-fine">By creating an account you agree to the <a href="#">Terms</a> and <a href="#">Privacy Policy</a>. Your data is stored in India.</p>
          </>
        ) : (
          <>
            <div className="au-fields">
              <AField label="Organisation name" hi="संस्था" value={org.name} set={v => setOrg(o => ({ ...o, name: v }))} autoFocus hint="Appears on invoices, quotations and the client portal." />
              <div className="au-fld">
                <span className="au-fld__l">Industry</span>
                <div className="au-chips">
                  {INDUSTRIES.map(x => <button key={x} className={'au-chip' + (org.ind === x ? ' on' : '')} onClick={() => setOrg(o => ({ ...o, ind: x }))}>{x}</button>)}
                </div>
                <span className="au-f__hint">We preselect the modules this industry usually needs. You change them in the next step.</span>
              </div>
              <div className="au-fld">
                <span className="au-fld__l">Team size</span>
                <div className="au-seg">
                  {TEAM_SIZES.map(x => <button key={x} className={'au-seg__b' + (org.size === x ? ' on' : '')} onClick={() => setOrg(o => ({ ...o, size: x }))}>{x}</button>)}
                </div>
              </div>
              <AButton onClick={() => go('onboard')}>Create organisation</AButton>
              <button className="au-link au-link--c" onClick={() => go('onboard')}>I’ll set this up later</button>
            </div>
          </>
        )}
      </div>
    </AuthPane>
  );
}

function ForgotScreen({ go, sent: sent0 }) {
  const [email, setEmail] = React.useState('keval@aekam.co');
  const [err, setErr] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(!!sent0);
  const [cool, setCool] = React.useState(0);
  React.useEffect(() => {
    if (!sent) return;
    setCool(60);
    const t = setInterval(() => setCool(c => (c <= 1 ? (clearInterval(t), 0) : c - 1)), 1000);
    return () => clearInterval(t);
  }, [sent]);

  const submit = e => {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setErr('Enter a valid email address'); return; }
    if (email.trim().toLowerCase() === 'nobody@aekam.co') { setErr('No account found with this email'); return; }
    setErr(null); setLoading(true);
    setTimeout(() => { setLoading(false); setSent(true); }, 900);
  };

  if (sent) return (
    <AuthPane kick="Link sent" h1={<>Check your<br /><em>email</em></>} hi="ईमेल देखें">
      <div className="au-sent">
        <span className="au-sent__ic">{SI.file}</span>
        <p className="au-sent__p">We sent a reset link to <b>{email}</b>. It expires in <b>1 hour</b> and can only be used once.</p>
        <div className="au-sent__hint">Nothing after a minute? Check spam, or the address may not have an account — we don’t say which, on purpose.</div>
      </div>
      <div className="au-fields">
        <AButton kind="out" disabled={cool > 0} onClick={() => setCool(60)}>{cool > 0 ? `Resend in ${cool}s` : 'Resend the link'}</AButton>
        <button className="au-link au-link--c" onClick={() => go('login')}>{I.chevL} Back to log in</button>
      </div>
    </AuthPane>
  );

  return (
    <AuthPane kick="Password reset" h1={<>Forgot your<br /><em>password?</em></>}
      lede="Enter the email on your account and we’ll send a link to set a new password."
      foot={<button className="au-link" onClick={() => go('login')}>{I.chevL} Back to log in</button>}>
      <form onSubmit={submit} className="au-fields">
        <AField label="Email" value={email} set={v => { setEmail(v); setErr(null); }} err={err} autoFocus
          hint="Try nobody@aekam.co to see the not-found state." />
        <AButton loading={loading}>{loading ? 'Sending…' : 'Send reset link'}</AButton>
      </form>
    </AuthPane>
  );
}

function ResetScreen({ go, expired }) {
  const [pw, setPw] = React.useState('');
  const [c, setC] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const match = c ? pw === c : null;

  if (expired) return (
    <AuthPane kick="Link problem" h1={<>This link has<br /><em>expired.</em></>}>
      <div className="au-banner au-banner--err" role="alert">
        {SI.alert}<span>Reset links last <b>1 hour</b> and work once. This one was issued 3 days ago — placeholder.</span>
      </div>
      <div className="au-fields" style={{ marginTop: 14 }}>
        <AButton onClick={() => go('forgot')}>Request a new link</AButton>
        <button className="au-link au-link--c" onClick={() => go('login')}>Back to log in</button>
      </div>
    </AuthPane>
  );

  if (done) return (
    <AuthPane kick="Done" h1={<>Password<br /><em>updated.</em></>} hi="पूर्ण">
      <div className="au-done"><span className="au-done__ic">{I.check}</span>Every other session was signed out.</div>
      <AButton onClick={() => go('login')}>Log in</AButton>
    </AuthPane>
  );

  return (
    <AuthPane kick="New password" h1={<>Choose a new<br /><em>password</em></>}
      lede="Setting a new password signs out every other device on this account.">
      <form className="au-fields" onSubmit={e => { e.preventDefault(); if (match && score(pw) >= 2) { setLoading(true); setTimeout(() => { setLoading(false); setDone(true); }, 900); } }}>
        <APassword label="New password" value={pw} set={setPw} strength autoFocus />
        <APassword label="Confirm password" value={c} set={setC} match={match}
          err={match === false ? 'Passwords don’t match' : null}
          hint={match === true ? 'Matches' : null} />
        <AButton loading={loading} disabled={!match || score(pw) < 2}>{loading ? 'Updating…' : 'Reset password'}</AButton>
      </form>
    </AuthPane>
  );
}

function InviteScreen({ go, existing }) {
  const [name, setName] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  return (
    <AuthPane kick="Invitation"
      h1={existing ? <>Join<br /><em>Aekam Inc</em></> : <>You’ve been<br /><em>invited.</em></>}
      banner={
        <div className="au-invite">
          <span className="au-invite__logo"><Mark size={38} /></span>
          <div style={{ minWidth: 0 }}>
            <b style={{ fontSize: 14.5, display: 'block' }}>Aekam Inc</b>
            <span className="mute" style={{ fontSize: 12 }}>aekam.kartavaya.com · 6 members</span>
            <div className="au-invite__by">
              <Av n="Keval Shah" s={20} />
              <span><b>Keval Shah</b> invited you as <span className="tag" style={{ '--c': '#0082c6' }}><span className="tag__dot" />Member</span></span>
            </div>
            <div className="au-invite__g">
              With access to
              <span className="tag" style={{ '--c': '#04837A' }}><span className="hi">कर्तव्य</span> Editor</span>
              <span className="tag" style={{ '--c': '#6E747C' }}><span className="hi">गणित</span> Viewer</span>
            </div>
          </div>
        </div>
      }
      foot={<span className="mute" style={{ fontSize: 11.5 }}>Invitation expires in 7 days. Only this email address can accept it.</span>}>
      {existing ? (
        <div className="au-fields">
          <div className="au-banner">{I.check}<span>You’re signed in as <b>rohan@aekam.co</b>. Accepting links this organisation to your existing account — nothing else changes.</span></div>
          <AButton loading={loading} onClick={() => { setLoading(true); setTimeout(() => { setLoading(false); go('onboard'); }, 800); }}>Accept invitation</AButton>
          <button className="au-link au-link--c au-link--mute">Decline</button>
        </div>
      ) : (
        <form className="au-fields" onSubmit={e => { e.preventDefault(); setLoading(true); setTimeout(() => { setLoading(false); go('onboard'); }, 800); }}>
          <AField label="Your name" hi="नाम" value={name} set={setName} autoFocus />
          <APassword label="Create a password" value={pw} set={setPw} strength />
          <AButton loading={loading}>{loading ? 'Activating…' : 'Accept & create account'}</AButton>
          <button type="button" className="au-link au-link--c au-link--mute">Decline this invitation</button>
        </form>
      )}
    </AuthPane>
  );
}

// ── Harness ────────────────────────────────────────────────────────────
const AU_SCREENS = [
  ['login', 'Log in'], ['signup', 'Sign up'], ['forgot', 'Forgot'], ['sent', 'Link sent'],
  ['reset', 'Reset'], ['expired', 'Expired link'], ['invite', 'Invite · new'], ['invite2', 'Invite · existing'],
];
function AuthApp() {
  const [scr, setScr] = React.useState('login');
  const [surface, setSurface] = React.useState('mac');
  const [theme, setTheme] = React.useState('light');
  const mobile = surface === 'mweb' || surface === 'mapp';
  React.useEffect(() => {
    const r = document.documentElement;
    r.dataset.theme = theme; r.dataset.platform = mobile ? 'mac' : surface; r.dataset.surfaceKind = surface;
  }, [surface, theme, mobile]);

  const go = k => setScr(k === 'onboard' ? 'login' : k);
  const pane = {
    login: <LoginScreen go={go} />,
    signup: <SignupScreen go={go} />,
    forgot: <ForgotScreen go={go} />,
    sent: <ForgotScreen go={go} sent />,
    reset: <ResetScreen go={go} />,
    expired: <ResetScreen go={go} expired />,
    invite: <InviteScreen go={go} />,
    invite2: <InviteScreen go={go} existing />,
  }[scr];

  return (
    <div className="auwrap">
      <header className="ixbar">
        <span className="ixbar__t">Auth<span className="ixbar__hi">प्रवेश</span></span>
        <div className="tabs" style={{ border: 0, flex: 1, minWidth: 0 }}>
          <div className="tabs__scroll">
            {AU_SCREENS.map(([k, l]) => <button key={k} className={'tabs__b' + (scr === k ? ' on' : '')} onClick={() => setScr(k)}>{l}</button>)}
          </div>
        </div>
        <div className="seg">
          {[['mac', 'macOS'], ['win', 'Win'], ['mweb', 'M-web'], ['mapp', 'M-app']].map(([v, l]) => (
            <button key={v} className={'seg__b' + (surface === v ? ' on' : '')} onClick={() => setSurface(v)}>{l}</button>
          ))}
        </div>
        <button className="icobtn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? I.moon : I.sun}</button>
      </header>
      <div className={'auhost' + (mobile ? ' auhost--m' : '')}>
        <div className={'au' + (mobile ? ' au--m' : '')}>
          {mobile ? <BrandPanel compact /> : <BrandPanel />}
          {pane}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LoginScreen, SignupScreen, ForgotScreen, ResetScreen, InviteScreen, AuthApp });
