// Pahchan — clock in/out (immersive camera), the two-tab shell, and consent.
const { useState, useEffect, useRef } = React;

// ── Clock: ready → framing → flash → review → sending → done ────────────────
function PhClock({ dir = 'in', start = 'ready', gps = 'ok', net = 'ok', noRef = false, onDone }) {
  const [st, setSt] = useState(start);
  const [framed, setFramed] = useState(false);
  const [flash, setFlash] = useState(false);
  const [tries, setTries] = useState(0);
  const timers = useRef([]);
  const after = (ms, fn) => timers.current.push(setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // A framing guide that never resolves is decoration. It settles on its own
  // here; in the build it is driven by the face-bounds callback.
  useEffect(() => {
    if (st !== 'ready') return;
    const t = setTimeout(() => setFramed(true), 1400);
    return () => clearTimeout(t);
  }, [st]);

  const shoot = () => {
    if (!framed) return;
    setFlash(true);
    after(340, () => { setFlash(false); setSt('review'); });
  };
  const send = () => {
    setSt('sending');
    after(900, () => { setSt(net === 'off' ? 'queued' : 'done'); onDone && onDone(); });
  };
  const retake = () => { setTries(t => t + 1); setSt('ready'); setFramed(false); };
  const out = dir === 'out';
  const atLimit = tries >= 3;

  return (
    <div className="pc">
      <div className={'pc__cam' + (st === 'review' || st === 'sending' ? ' pc__cam--off' : '')} />
      {(st === 'review' || st === 'sending') && <div className="pc__shot" />}
      <div className={'pc__flash' + (flash ? ' on' : '')} />

      <div className="pc__stat"><span>9:41</span><span>▮▮▮ 5G ▮</span></div>

      <div className="pc__top">
        <button className="pc__x" aria-label="Close">{PH_ICON.x}</button>
        <div>
          <div className="pc__ttl">{out ? 'Clock out' : 'Clock in'} <span style={{ fontFamily: 'var(--font-indic)', opacity: .72, marginLeft: 4 }}>{out ? 'प्रस्थान' : 'उपस्थिति'}</span></div>
          <div className="pc__sub">Fri 26 Jul · Aekam Inc</div>
        </div>
      </div>

      {st !== 'done' && st !== 'queued' && (
        <div className="pc__chips">
          <span className={'pc__chip ' + (gps === 'ok' ? 'pc__chip--ok' : gps === 'weak' ? 'pc__chip--warn' : 'pc__chip--off')}>
            {PH_ICON.gps}{gps === 'ok' ? <>Location <b>±8m</b></> : gps === 'weak' ? <>Location <b>±184m</b></> : 'Location off'}
          </span>
          <span className="pc__chip pc__chip--ok">{PH_ICON.cam}Camera</span>
          <span className={'pc__chip ' + (net === 'ok' ? 'pc__chip--ok' : 'pc__chip--warn')}>
            {net === 'ok' ? PH_ICON.wifi : PH_ICON.off}{net === 'ok' ? 'Online' : 'Offline'}
          </span>
        </div>
      )}

      {(st === 'ready') && <>
        <div className={'pc__oval' + (framed ? ' pc__oval--good' : '')} />
        <div className="pc__hint">{framed
          ? <>Hold still — <b>tap to capture</b></>
          : <>Move your face inside the outline</>}</div>
      </>}

      <div className="pc__foot">
        {gps === 'off' && <div className="pc__note">{PH_ICON.warn}<span><b>Location is off.</b> Your punch will still be recorded and will be flagged for review. Turn it on in Settings to avoid the flag.</span></div>}
        {gps === 'weak' && st === 'ready' && <div className="pc__note">{PH_ICON.warn}<span>Weak GPS — <b>±184m</b>. Common indoors. The punch will go through and will be flagged.</span></div>}
        {net === 'off' && st === 'ready' && <div className="pc__note">{PH_ICON.warn}<span><b>No connection.</b> Your punch is saved on this phone and sends itself when you are back online.</span></div>}
        {noRef && st === 'ready' && <div className="pc__note">{PH_ICON.warn}<span><b>No reference photos yet.</b> Punch now — HR will ask you to add them before this month closes.</span></div>}
        {atLimit && st === 'ready' && <div className="pc__note">{PH_ICON.warn}<span>Three retakes used. This next one is <b>the one that is sent</b>.</span></div>}

        {st === 'ready' && <>
          <button className={'pc__shut' + (out ? ' pc__shut--out' : '')} onClick={shoot} disabled={!framed} aria-label={out ? 'Capture and clock out' : 'Capture and clock in'}><i /></button>
          <div className="pc__lbl">{out ? 'Clock out' : 'Clock in'}<i>{framed ? 'one tap' : 'framing…'}</i></div>
        </>}

        {st === 'review' && <>
          <div className="pc__note" style={{ background: 'rgba(255,255,255,.1)' }}>{PH_ICON.cam}<span>This is what HR will compare against your reference photos. {tries < 3 ? `${3 - tries} retakes left.` : 'No retakes left.'}</span></div>
          <div className="pc__act">
            {tries < 3 && <button className="re" onClick={retake}>Retake</button>}
            <button className={'go' + (out ? ' go--out' : '')} onClick={send}>{out ? 'Send clock-out' : 'Send clock-in'}</button>
          </div>
        </>}

        {st === 'sending' && <div className="pc__lbl" style={{ paddingBottom: 26 }}>Sending…<i>do not close</i></div>}
      </div>

      {(st === 'done' || st === 'queued') && (
        <div className="pc__done">
          <div className="pc__tick" style={st === 'queued' ? { background: 'color-mix(in srgb,#E8A33D 22%,transparent)', color: '#E8A33D' } : undefined}>
            {st === 'queued' ? PH_ICON.clock : PH_ICON.tick}
          </div>
          <h3>{st === 'queued' ? 'Saved on this phone' : out ? 'Clocked out' : 'Clocked in'}</h3>
          <p>{st === 'queued'
            ? 'It sends by itself the moment you have signal. You do not need to open the app again.'
            : out ? 'Your day is closed. Hours go to your monthly register.' : 'Have a good day.'}</p>
          <div className="pc__stamp">
            <span>{out ? '18:12' : '09:41'} · Fri 26 Jul 2026</span>
            <span>{gps === 'off' ? 'Location unavailable' : gps === 'weak' ? '18.9358, 72.8302 · ±184m' : '18.9334, 72.8337 · ±8m'}</span>
            {st === 'queued' && <span style={{ color: '#E8A33D' }}>Queued — 1 punch waiting</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Two-tab shell — for someone whose whole job in Kartavaya is attendance ──
function PhMini({ tab: t0 = 'clock' }) {
  const [tab, setTab] = useState(t0);
  const [inAt, setInAt] = useState('09:41');
  return (
    <div className="pm">
      <div className="pm__b">
        {tab === 'clock' ? <>
          <div className="pm__h"><h2>Today<span>आज</span></h2><p>Friday, 26 July</p></div>
          <div className="pm-card pm-big">
            <div className="pm-big__t">{inAt ? '8h 31m' : '—'}</div>
            <div className="pm-big__s">{inAt ? `Since ${inAt}` : 'Not clocked in'}</div>
            <button className={'pm-btn' + (inAt ? ' pm-btn--out' : '')} onClick={() => setInAt(inAt ? '' : '09:41')}>
              {PH_ICON.cam}{inAt ? 'Clock out' : 'Clock in'}
            </button>
          </div>
          <div className="pm-card">
            <div className="pm-tl"><span className="pm-tl__d" /><div className="pm-tl__b"><div className="pm-tl__t">Clocked in</div><div className="pm-tl__m">09:41 · Fort, Mumbai · ±8m</div></div></div>
            <div className="pm-tl"><span className="pm-tl__d pm-tl__d--out" /><div className="pm-tl__b"><div className="pm-tl__t">Break</div><div className="pm-tl__m">13:20 – 13:58 · 38m</div></div></div>
          </div>
          <div className="pm-card">
            <div className="pm-row"><span className="pm-row__k">This week</span><span className="pm-row__v">37h 10m</span></div>
            <div className="pm-row"><span className="pm-row__k">This month</span><span className="pm-row__v">142h 45m</span></div>
            <div className="pm-row"><span className="pm-row__k">Days present</span><span className="pm-row__v">18 / 21</span></div>
          </div>
        </> : <>
          <div className="pm__h"><h2>Me<span>मैं</span></h2><p>Priya Deshmukh · Accounts</p></div>
          <div className="pm-card">
            <div className="ph-card__t" style={{ fontSize: 13 }}>Reference photos</div>
            <p className="ph-card__d" style={{ margin: '4px 0 10px' }}>Captured 14 Mar 2026. HR compares your punch selfie against these.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="rv__f" style={{ width: 62, height: 78 }} />
              <div className="rv__f rv__f--ang" style={{ width: 62, height: 78 }} />
              <div style={{ flex: 1, fontSize: 11, color: 'var(--on-surface-3)', lineHeight: 1.55 }}>Straight-on and three-quarter. Ask HR to retake if your appearance has changed.</div>
            </div>
          </div>
          <div className="pm-card">
            <div className="pm-row"><span className="pm-row__k">Monthly register</span><span className="pm-row__v">{PH_ICON.chev}</span></div>
            <div className="pm-row"><span className="pm-row__k">What we store</span><span className="pm-row__v">{PH_ICON.chev}</span></div>
            <div className="pm-row"><span className="pm-row__k">Language · भाषा</span><span className="pm-row__v">EN</span></div>
          </div>
          <div className="pm-card" style={{ background: 'var(--s-low)' }}>
            <p style={{ fontSize: 11.5, lineHeight: 1.65, color: 'var(--on-surface-2)', margin: 0 }}>
              Punch selfies are deleted after <b>90 days</b>. Reference photos are deleted 45 days after you leave. Aekam, who runs Kartavaya, cannot see your photos, times or location.
            </p>
          </div>
        </>}
      </div>
      <div className="pm__nav">
        {[['clock', 'Clock', 'समय', PH_ICON.clock], ['me', 'Me', 'मैं', PH_ICON.user]].map(([k, en, hi, ic]) => (
          <button key={k} className={'pm__nb' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>
            <span className="pm__ni" style={{ width: 52, height: 29 }}><span style={{ width: 19, height: 19, display: 'block' }}>{ic}</span></span>
            {en}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Consent / notice ───────────────────────────────────────────────────────
function PhNotice() {
  const [open, setOpen] = useState(null);
  const L = [
    ['What is captured', 'A photo of your face each time you clock in or out, the time, and your location at that moment.'],
    ['Why', 'To confirm that the person marking attendance is you. Your employer needs an accurate attendance register — it is a record they are required by law to keep.'],
    ['Who sees it', 'Your HR admin and the owner of your organisation. Nobody else. Aekam, who runs Kartavaya, cannot see your photos, times or location — only how many people at your organisation use attendance.'],
    ['How long', 'Punch photos are deleted after 90 days. Your two reference photos are deleted 45 days after you leave. The attendance record itself — dates and hours, no photo — is kept for as long as the law requires your employer to keep it.'],
    ['Face recognition', 'Not used. A person compares the photos. If your employer ever turns on automatic face matching, you will be asked separately and you can say no.'],
    ['Your rights', 'You can ask to see everything held about you, ask for a correction, and complain to the Data Protection Board of India. Contact your HR admin first.'],
  ];
  return (
    <div className="ph-card" style={{ maxWidth: 520 }}>
      <div className="ph-card__t">Attendance — what we record</div>
      <p style={{ fontFamily: 'var(--font-indic)', fontSize: 13, color: 'var(--primary-text)', margin: '2px 0 10px' }}>उपस्थिति — हम क्या दर्ज करते हैं</p>
      <p className="ph-card__d">Six lines. Tap any one to see the detail.</p>
      {L.map(([k, v], i) => (
        <div key={k} style={{ borderTop: '1px solid var(--outline-variant)' }}>
          <button onClick={() => setOpen(open === i ? null : i)} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '11px 0', textAlign: 'left', fontSize: 13, fontWeight: 500 }}>
            <span style={{ flex: 1 }}>{k}</span>
            <span style={{ width: 15, height: 15, color: 'var(--on-surface-3)', transform: open === i ? 'rotate(90deg)' : 'none', transition: 'transform var(--dur-base) var(--ease-standard)' }}>{PH_ICON.chev}</span>
          </button>
          {open === i && <p style={{ fontSize: 12, lineHeight: 1.72, color: 'var(--on-surface-2)', margin: '0 0 13px', paddingRight: 24, textWrap: 'pretty' }}>{v}</p>}
        </div>
      ))}
      <div style={{ borderTop: '1px solid var(--outline-variant)', paddingTop: 13, marginTop: 2 }}>
        <button className="btn btn--fill" style={{ width: '100%' }}>I have read this</button>
        <p style={{ fontSize: 10.5, color: 'var(--on-surface-3)', margin: '9px 0 0', lineHeight: 1.6, textAlign: 'center' }}>
          This is a notice, not a consent form. Attendance is processed as a legitimate use for employment.
        </p>
      </div>
    </div>
  );
}

Object.assign(window, { PhClock, PhMini, PhNotice });
