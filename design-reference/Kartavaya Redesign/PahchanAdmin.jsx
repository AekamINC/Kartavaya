// Pahchan — enrollment (two slots), HR approval queue, policy, report + email.
const { useState: uS } = React;

// ── Two-slot capture ───────────────────────────────────────────────────────
// Two photos, not one: a straight-on and a three-quarter. One frontal shot
// gives v2 a single embedding and fails on anyone who turns their head. Two
// is the cheapest thing that survives the upgrade without re-enrolling
// every client's workforce.
function PhEnroll() {
  const [slots, setSlots] = uS([false, false]);
  const [live, setLive] = uS(0);
  const SPEC = [
    { t: 'Straight on', hi: 'सामने', d: 'Face square to the camera, eyes level, both ears visible.', ang: false },
    { t: 'Three-quarter', hi: 'तिरछा', d: 'Turned about 30° to one side. This is the one that makes v2 work on real punches.', ang: true },
  ];
  const CHK = [['Face fills 40–70% of frame', true], ['Both eyes visible', true], ['Even light, no strong backlight', true], ['No sunglasses, cap brim or mask', true]];
  return (
    <div className="en-grid">
      {SPEC.map((s, i) => (
        <div className="en-slot" key={s.t}>
          <div className={'en-slot__f' + (slots[i] ? ' en-slot__f--filled' : '')}>
            <span className="en-slot__badge">{i + 1} of 2</span>
            <span className={'en-oval' + (slots[i] || live === i ? ' en-oval--ok' : '') + (s.ang ? ' en-oval--ang' : '')} />
            {(slots[i] || live === i) && <span className="en-slot__pct">Face fills frame <b className={live === i && !slots[i] ? 'bad' : ''}>{slots[i] ? '58%' : '31%'}</b></span>}
          </div>
          <div className="en-slot__b">
            <div className="en-slot__t">{s.t}<span style={{ fontFamily: 'var(--font-indic)', fontSize: 11.5, color: 'var(--on-surface-3)', fontWeight: 400 }}>{s.hi}</span></div>
            <p className="en-slot__d">{s.d}</p>
            <div className="en-chk">
              {CHK.map(([c]) => <span key={c} className={'en-chk__i' + (slots[i] ? ' ok' : '')}>{slots[i] ? PH_ICON.tick : PH_ICON.clock}{c}</span>)}
            </div>
            <button className={'btn ' + (slots[i] ? 'btn--out' : 'btn--fill')} style={{ width: '100%' }}
              onClick={() => { setLive(i); setSlots(v => { const n = [...v]; n[i] = !n[i]; return n; }); }}>
              {slots[i] ? 'Retake' : 'Capture'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── HR approval queue ──────────────────────────────────────────────────────
function PhQueue() {
  const [st, setSt] = uS({});
  const Q = [
    ['e6', 'Vikram Joshi', 'Self-captured', '2 photos', 'today 08:14', 'Both frames pass the checks.'],
    ['e8', 'Arjun Pillai', 'Self-captured', '1 photo', 'today 09:02', 'Second frame missing — straight-on only.'],
    ['e4', 'Suresh Kulkarni', 'HR upload', '2 photos', 'yesterday', 'Uploaded by Fatima Shaikh from an ID scan.'],
  ];
  return (
    <div className="rv">
      <div className="rv__bar"><b style={{ fontSize: 13 }}>Waiting for approval</b><span className="rv__c">{Q.length - Object.keys(st).length} open</span></div>
      {Q.map(([id, n, src, cnt, when, note]) => (
        <div className="rv__r" key={id} style={{ gridTemplateColumns: '1fr 148px 118px 130px', cursor: 'default' }}>
          <span className="rv__who">
            <b>{n}</b><i>{note}</i>
          </span>
          <span className="rv__trip">
            <span className="rv__f" style={{ width: 42, height: 52 }} />
            {cnt === '2 photos' ? <span className="rv__f rv__f--ang" style={{ width: 42, height: 52 }} /> : <span className="rv__f rv__f--none" style={{ width: 42, height: 52 }} />}
          </span>
          <span className="rv__t" style={{ fontSize: 11 }}>{src}<i>{when}</i></span>
          <span className="rv__v">
            {st[id] ? <span className={'rv__flag ' + (st[id] === 'ok' ? 'rv__flag--ok' : 'rv__flag--noref')}>{st[id] === 'ok' ? 'Approved' : 'Sent back'}</span> : <>
              <button className="btn btn--ghost" style={{ fontSize: 11, height: 28, padding: '0 9px' }} onClick={() => setSt(s => ({ ...s, [id]: 'no' }))}>Send back</button>
              <button className="btn btn--fill" style={{ fontSize: 11, height: 28, padding: '0 11px' }} onClick={() => setSt(s => ({ ...s, [id]: 'ok' }))}>Approve</button>
            </>}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Policy ─────────────────────────────────────────────────────────────────
function PhPolicy() {
  return (
    <div className="ph-cols">
      {PH_POLICY.map(([grp, rows]) => (
        <div className="ph-card" key={grp}>
          <div className="ph-card__t">{grp}</div>
          <p className="ph-card__d">{rows.filter(r => r[2] === 'Editable').length} of {rows.length} configurable</p>
          {rows.map(([k, v, kind, why]) => (
            <div key={k} style={{ borderTop: '1px solid var(--outline-variant)', padding: '10px 0' }}>
              <div style={{ display: 'flex', gap: 9, alignItems: 'baseline' }}>
                <span style={{ fontSize: 12.5, fontWeight: 500, flex: 1 }}>{k}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--on-surface-2)' }}>{v}</span>
                <span className={'rv__flag ' + (kind === 'Fixed' ? 'rv__flag--noref' : 'rv__flag--ok')}>{kind}</span>
              </div>
              <p style={{ fontSize: 11.5, lineHeight: 1.65, color: 'var(--on-surface-3)', margin: '5px 0 0', textWrap: 'pretty' }}>{why}</p>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Monthly register + the email that carries no photos ────────────────────
function PhReport() {
  const DAYS = [['01 Wed', '09:38', '18:14', '8h 36m', ''], ['02 Thu', '09:44', '18:02', '8h 18m', ''], ['03 Fri', '10:21', '18:30', '8h 09m', 'Late'], ['06 Mon', '—', '—', '—', 'Absent'], ['07 Tue', '09:31', '19:48', '10h 17m', 'Overtime'], ['08 Wed', '09:40', '18:11', '8h 31m', 'Off site']];
  return (
    <div className="ph-cols" style={{ gridTemplateColumns: 'minmax(0,1.25fr) minmax(0,1fr)' }}>
      <div className="ph-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="rv__bar"><b style={{ fontSize: 13 }}>Priya Deshmukh — July 2026</b><span className="rv__c">Portal · photos visible</span></div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--on-surface-3)' }}>
            {['Date', 'In', 'Out', 'Hours', 'Note'].map((h, i) => <th key={h} style={{ textAlign: i > 0 && i < 4 ? 'right' : 'left', padding: '8px 14px', borderBottom: '1px solid var(--outline-variant)', fontWeight: 400 }}>{h}</th>)}
          </tr></thead>
          <tbody>{DAYS.map(d => <tr key={d[0]}>
            {d.map((c, i) => <td key={i} style={{ padding: '7px 14px', borderBottom: '1px solid var(--outline-variant)', textAlign: i > 0 && i < 4 ? 'right' : 'left', fontFamily: i > 0 && i < 4 ? 'var(--font-mono)' : 'inherit', color: c === 'Absent' ? 'var(--danger)' : i === 4 && c ? 'var(--warn)' : undefined }}>{c || '—'}</td>)}
          </tr>)}
          <tr style={{ background: 'var(--s-low)', fontWeight: 600 }}>
            <td style={{ padding: '9px 14px' }}>Total</td><td /><td />
            <td style={{ padding: '9px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>43h 51m</td>
            <td style={{ padding: '9px 14px', fontSize: 11, fontWeight: 400, color: 'var(--on-surface-3)' }}>1 absent · 1 late</td>
          </tr></tbody>
        </table>
        <p style={{ fontSize: 11, color: 'var(--on-surface-3)', padding: '11px 14px', margin: 0, lineHeight: 1.6 }}>
          Name, hours worked, arrival and departure — the columns a state Shops &amp; Establishments muster roll is required to carry. This view is the statutory artefact; the photo is not.
        </p>
      </div>

      <div className="ph-card" style={{ background: 'var(--s-low)' }}>
        <div className="ph-card__t">The monthly email</div>
        <p className="ph-card__d">Same figures, <b>no photographs</b>. A mailbox is not a place retention can be enforced — once an image leaves the portal, the 90-day deletion is a promise nobody can keep.</p>
        <div style={{ border: '1px solid var(--outline-variant)', borderRadius: 'var(--r-sm)', background: 'var(--s-lowest)', overflow: 'hidden' }}>
          <div style={{ padding: '11px 13px', borderBottom: '1px solid var(--outline-variant)', fontSize: 11.5 }}>
            <div style={{ color: 'var(--on-surface-3)' }}>To: priya@aekam.example</div>
            <div style={{ fontWeight: 600, marginTop: 3 }}>Your July attendance — 43h 51m over 21 days</div>
          </div>
          <div style={{ padding: '13px', fontSize: 11.5, lineHeight: 1.75, color: 'var(--on-surface-2)' }}>
            <p style={{ margin: '0 0 9px' }}>Priya — here is your July register.</p>
            {[['Days present', '20 of 21'], ['Hours worked', '43h 51m'], ['Late arrivals', '1'], ['Absent', '1 — Mon 06 Jul'], ['Overtime', '2h 06m']].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 10, padding: '3px 0' }}><span style={{ flex: 1 }}>{k}</span><b style={{ fontFamily: 'var(--font-mono)' }}>{v}</b></div>
            ))}
            <p style={{ margin: '11px 0 0' }}>Something wrong? Reply to this email or open the register.</p>
            <span className="btn btn--fill" style={{ display: 'inline-flex', marginTop: 11, fontSize: 12, height: 32 }}>Open register</span>
            <p style={{ fontSize: 10.5, color: 'var(--on-surface-3)', margin: '13px 0 0', lineHeight: 1.6 }}>Photographs are not attached to this email. They stay in Kartavaya, where they are deleted after 90 days.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { PhEnroll, PhQueue, PhPolicy, PhReport });
