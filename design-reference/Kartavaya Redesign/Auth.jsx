// Auth shell — branding panel + M3 tonal form primitives.
// Staging AuthShell.jsx is a cold-blue 420px dark panel on #f4fafd; this rebuilds
// it on the warm-earthy fusion palette and adds the states staging has none of:
// inline validation, password strength, loading, error shake, success.
const AUTH_ROTATE = [
  {
    kind: 'module', hi: 'गणित', en: 'Ganit · Finance',
    line: 'GST-ready invoices, e-way bills and TDS in the same ledger your CA already understands.',
    foot: 'One of 15 modules. Turn on only what you need.',
  },
  {
    kind: 'stat', big: '₹0', small: 'per extra seat',
    line: 'Flat pricing for the whole organisation. Adding your ninth person costs the same as your first.',
    foot: 'No per-seat maths at renewal.',
  },
  {
    kind: 'quote',
    line: 'We replaced four tools and a WhatsApp group. Placeholder testimonial — swap for a real customer quote before launch.',
    who: 'Placeholder Name', role: 'Partner, placeholder CA firm · Mumbai',
    foot: 'Placeholder — needs a real reference.',
  },
];

function BrandPanel({ compact }) {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setI(x => (x + 1) % AUTH_ROTATE.length), 7000);
    return () => clearInterval(t);
  }, []);
  const r = AUTH_ROTATE[i];
  if (compact) return (
    <div className="au-brandm">
      <Mark size={34} />
      <div>
        <div className="au-brandm__n">Kartavaya</div>
        <div className="au-brandm__hi">कर्तव्य · one platform for the whole business</div>
      </div>
    </div>
  );
  return (
    <aside className="au-brand">
      <span className="au-brand__wm" aria-hidden="true">कर्तव्य</span>
      <span className="au-brand__glow au-brand__glow--1" />
      <span className="au-brand__glow au-brand__glow--2" />
      <div className="au-brand__top">
        <Mark size={36} />
        <div>
          <div className="au-brand__wordmark">Kartavaya</div>
          <div className="au-brand__sub">by Aekam Inc</div>
        </div>
      </div>
      <div className="au-brand__mid">
        <h2 className="au-brand__h">
          Your business,<br /><em>one platform.</em>
        </h2>
        <p className="au-brand__p">आपका व्यापार, एक ही जगह — projects, clients, money, people and messaging, without stitching five tools together.</p>
      </div>
      <div className="au-brand__rot" key={i}>
        <div className="au-brand__rot-k">{r.kind === 'module' ? 'Module' : r.kind === 'stat' ? 'Pricing' : 'Customer'}</div>
        {r.kind === 'module' && <div className="au-brand__rot-t"><span className="hi">{r.hi}</span><span>{r.en}</span></div>}
        {r.kind === 'stat' && <div className="au-brand__rot-s"><b>{r.big}</b><span>{r.small}</span></div>}
        <p className="au-brand__rot-l">{r.kind === 'quote' ? <>“{r.line}”</> : r.line}</p>
        {r.kind === 'quote' && <div className="au-brand__rot-w"><Av n={r.who} s={26} /><span><b>{r.who}</b><i>{r.role}</i></span></div>}
        <div className="au-brand__rot-f">{r.foot}</div>
      </div>
      <div className="au-brand__dots">
        {AUTH_ROTATE.map((_, n) => <button key={n} className={'au-dot' + (n === i ? ' on' : '')} onClick={() => setI(n)} aria-label={'Panel ' + (n + 1)} />)}
      </div>
    </aside>
  );
}

// ── M3 tonal field with a floating label ───────────────────────────────
function AField({ label, hi, type = 'text', value, set, err, hint, ok, autoFocus, right, id, ...rest }) {
  const [foc, setFoc] = React.useState(false);
  const up = foc || !!value;
  const fid = id || 'f-' + label.replace(/\W/g, '');
  return (
    <div className={'au-f' + (foc ? ' foc' : '') + (err ? ' err' : '') + (ok ? ' ok' : '')}>
      <div className="au-f__box">
        <label className={'au-f__l' + (up ? ' up' : '')} htmlFor={fid}>{label}{hi && <span className="hi">{hi}</span>}</label>
        <input id={fid} className="au-f__i" type={type} value={value} autoFocus={autoFocus}
          onChange={e => set(e.target.value)} onFocus={() => setFoc(true)} onBlur={() => setFoc(false)}
          aria-invalid={!!err} aria-describedby={err ? fid + '-e' : undefined} {...rest} />
        {right && <span className="au-f__r">{right}</span>}
        <span className="au-f__line" />
      </div>
      {err ? <span className="au-f__err" id={fid + '-e'} role="alert">{SI.alert} {err}</span>
        : hint ? <span className="au-f__hint">{hint}</span> : null}
    </div>
  );
}

function APassword({ label, hi, value, set, err, hint, strength, autoFocus, match }) {
  const [show, setShow] = React.useState(false);
  return (
    <>
      <AField label={label} hi={hi} type={show ? 'text' : 'password'} value={value} set={set} err={err} hint={hint}
        autoFocus={autoFocus} ok={match === true}
        right={
          <span className="rowflex" style={{ gap: 2 }}>
            {match === true && <span className="au-f__ok">{I.check}</span>}
            {match === false && <span className="au-f__no">{I.x}</span>}
            <button type="button" className="au-eye" onClick={() => setShow(s => !s)} tabIndex={-1}
              aria-label={show ? 'Hide password' : 'Show password'}>{show ? SI.eye : EYE_OFF}</button>
          </span>
        } />
      {strength && value && <Strength v={value} />}
    </>
  );
}
const EYE_OFF = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17.9 17.9A10 10 0 0112 20C5 20 1 12 1 12a18.5 18.5 0 015.1-5.9M9.9 4.2A9 9 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.2 3.2m-6.7-1.1a3 3 0 11-4.2-4.2" /><path d="M1 1l22 22" /></svg>;

function score(p) {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(s, 4);
}
const S_LBL = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
function Strength({ v }) {
  const s = score(v);
  return (
    <div className="au-str" data-s={s}>
      <div className="au-str__bars">{[0, 1, 2, 3].map(i => <span key={i} className={i < s ? 'on' : ''} />)}</div>
      <span className="au-str__l">{S_LBL[s]}{s < 2 && <span className="mute"> · 8+ characters, mixed case</span>}</span>
    </div>
  );
}

function AButton({ loading, children, kind = 'fill', ...rest }) {
  return (
    <button className={'au-btn au-btn--' + kind + (loading ? ' loading' : '')} disabled={loading} {...rest}>
      {loading && <span className="au-spin" />}
      <span>{children}</span>
    </button>
  );
}

function AuthPane({ kick, h1, hi, lede, children, foot, shake, banner }) {
  return (
    <div className="au-pane">
      <div className={'au-form' + (shake ? ' shake' : '')}>
        <div className="au-h">
          {kick && <div className="au-h__k">{kick}</div>}
          <h1 className="au-h__1">{h1}{hi && <span className="au-h__hi">{hi}</span>}</h1>
          {lede && <p className="au-h__l">{lede}</p>}
        </div>
        {banner}
        {children}
      </div>
      {foot && <div className="au-foot">{foot}</div>}
      <div className="au-pow"><span>Powered by</span><span className="au-pow__d" /><b>Aekam Inc</b></div>
    </div>
  );
}

function OrDivider({ label = 'or continue with' }) {
  return <div className="au-or"><span>{label}</span></div>;
}
function GoogleBtn({ label = 'Continue with Google' }) {
  return (
    <button className="au-btn au-btn--out" type="button">
      <svg width="16" height="16" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.8H9v3.5h4.8a4.1 4.1 0 01-1.8 2.7v2.2h2.9c1.7-1.5 2.7-3.8 2.7-6.6z" /><path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 009 18z" /><path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 010-3.4V5H.9a9 9 0 000 8l3-2.3z" /><path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 00.9 5l3 2.3C4.6 5.1 6.6 3.6 9 3.6z" /></svg>
      <span>{label}</span>
    </button>
  );
}
function MagicBtn() {
  return <button className="au-btn au-btn--out" type="button">{SI.file}<span>Email me a magic link</span></button>;
}

Object.assign(window, { BrandPanel, AField, APassword, Strength, score, AButton, AuthPane, OrDivider, GoogleBtn, MagicBtn, AUTH_ROTATE, EYE_OFF });
