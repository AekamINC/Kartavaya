// Concrete in/out pairs. The principle was written; the numbers were not.
const KF = [
  { n: 'dmFade', o: 'dmFadeOut', inD: '--dur-base', outD: '--dur-fast', inE: '--ease-enter', outE: '--ease-exit',
    from: 'opacity: 0', to: 'opacity: 1', ofrom: 'opacity: 1', oto: 'opacity: 0',
    use: 'Scrims · save badges · toast body · tab panel swap', why: 'No transform at all. A scrim that also moves reads as a second object arriving.' },
  { n: 'dmDrawerIn', o: 'dmDrawerOut', inD: '--dur-slow', outD: '--dur-base', inE: '--ease-enter', outE: '--ease-exit',
    from: 'opacity: .3; transform: translateX(28px)', to: 'opacity: 1; transform: none', ofrom: 'opacity: 1; transform: none', oto: 'opacity: 0; transform: translateX(16px)',
    use: 'Task drawer · any right-anchored panel', why: 'In from 28px, out to 16px. Enters at .3 opacity not 0 — it is already a solid object sliding in, not one materialising.' },
  { n: 'dmSheetIn', o: 'dmSheetOut', inD: '--dur-slow', outD: '--dur-base', inE: '--ease-enter', outE: '--ease-exit',
    from: 'transform: translateY(100%)', to: 'transform: none', ofrom: 'transform: none', oto: 'transform: translateY(100%)',
    use: 'Every mobile sheet · mobile picker', why: 'The one symmetric pair. A sheet that exits partway looks like it stuck — it must clear the viewport.' },
  { n: 'dmPop', o: 'dmPopOut', inD: '--dur-base', outD: '--dur-fast', inE: '--ease-enter', outE: '--ease-exit',
    from: 'opacity: 0; transform: scale(.97) translateY(-4px)', to: 'opacity: 1; transform: none', ofrom: 'opacity: 1; transform: none', oto: 'opacity: 0; transform: scale(.98)',
    use: 'Menus · popovers · all four picker modes', why: 'In travels 4px and scales .97; out only scales .98 and does not travel. Set transform-origin per placement or it grows from the wrong corner.' },
  { n: 'dmTip', o: null, inD: '--dur-fast', outD: null, inE: '--ease-enter', outE: null,
    from: 'opacity: 0; transform: scale(.94)', to: 'opacity: 1; transform: none', ofrom: null, oto: null,
    use: 'Tooltips', why: 'No exit. A tooltip that fades out follows the cursor to the next control and reads as lag. 300ms delay in, instant unmount.' },
  { n: 'dmSpin', o: null, inD: '640ms linear infinite', outD: null, inE: null, outE: null,
    from: 'transform: rotate(0)', to: 'transform: rotate(360deg)', ofrom: null, oto: null,
    use: 'Every spinner', why: 'Linear, never eased — an eased spin looks like it is struggling. 640ms is one turn; faster reads as panic.' },
  { n: 'ixflash', o: null, inD: 'calc(var(--dur-slow) * 1.4)', outD: null, inE: '--ease-exit', outE: null,
    from: 'background: color-mix(in srgb, var(--primary) 34%, transparent)', to: 'background: transparent', ofrom: null, oto: null,
    use: 'One-shot "this just changed" on a row someone else edited', why: 'Fires once on the element, never on a container. A whole flashing card is an alarm; a flashing cell is information.' },
];

function SecMotion() {
  const [k, setK] = React.useState(0);
  const play = () => setK(x => x + 1);
  return (
    <Sec n="12" t="Keyframes" hi="गति" note={<>Seven pairs, with the numbers this time. <strong>The exit is never the reverse of the entrance</strong> — every out is one duration step faster and travels less than its in. Entering is the system responding to you and can afford to be gracious; leaving is a thing getting out of your way, and reluctance there reads as lag.</>}>
      <div style={{ display: 'flex', gap: 9, marginBottom: 17 }}><button className="btn btn--fill" onClick={play}>Replay all</button><span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--on-surface-3)' }}>Slow the review toggle in the topbar to inspect frame by frame.</span></div>
      <div className="cb__grid" key={k}>
        {KF.map(f => (
          <div className="cb__cell" key={f.n} style={{ minHeight: 132 }}>
            <span className="cb__cl">{f.n}{f.o && ' / ' + f.o}</span>
            <div className="cb__cd" style={{ minHeight: 42 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 11px', borderRadius: 'var(--r-sm)', background: 'var(--s-low)', border: '1px solid var(--outline-variant)', fontSize: 12.5, animation: f.n === 'dmSpin' ? 'none' : f.n + ' ' + (f.inD.startsWith('--') ? 'var(' + f.inD + ')' : f.inD) + ' ' + (f.inE ? 'var(' + f.inE + ')' : 'linear') + ' both' }}>
                {f.n === 'dmSpin' ? <><span className="spin" />Saving…</> : f.use.split(' · ')[0]}
              </span>
            </div>
            <span className="cb__cn" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--on-surface-3)', lineHeight: 1.55 }}>
              in&nbsp; {f.from} → {f.to}<br />{f.ofrom && <>out {f.ofrom} → {f.oto}<br /></>}
              <span style={{ color: 'var(--primary-text)' }}>{f.inD}{f.inE && ' · ' + f.inE}</span>{f.outD && <span style={{ color: 'var(--on-surface-3)' }}> / {f.outD} · {f.outE}</span>}
            </span>
            <span className="cb__cn">{f.why}</span>
          </div>
        ))}
      </div>
      <div className="cb__panel" style={{ marginTop: 19 }}>
        <p className="cb__note" style={{ marginBottom: 11 }}><strong>Duration ladder</strong> — every one is a multiple of <code>--ix</code>, which is what makes Animations = Reduced work with no per-component code.</p>
        <div className="rmp">
          {[['--dur-instant', 90, 'Colour-only change · chip fill'], ['--dur-fast', 140, 'Exits · hover'], ['--dur-base', 220, 'Standard enter · popover · fade'], ['--dur-slow', 360, 'Drawer · sheet · anything crossing the screen'], ['--dur-xslow', 520, 'Page transition · first-paint stagger']].map(([t, v, u]) => (
            <div className="rmp__row" key={t}><span className="rmp__t">{t}</span><span className="rmp__v">{v}ms</span><span className="rmp__b" style={{ width: v / 2.6 }} /><span className="rmp__u">{u}</span></div>
          ))}
        </div>
        <p className="cb__note" style={{ margin: '15px 0 0' }}>Every value is <code>calc(Nms * var(--ix))</code>. <code>--dur-xslow</code> and <code>--dur-instant</code> are declared in <code>motion.css</code> only — a page that loads <code>tokens.css</code> alone resolves them to nothing and the animation never fires. <strong>All five belong in <code>tokens.css</code>.</strong></p>
      </div>
    </Sec>
  );
}

// ── 01 · The vocabulary ──────────────────────────────────────────────────────
const VOC = [
  ['.on', 'Selected · active · current', 'Kept as-is. 40+ existing uses; renaming to .is-selected changes nothing a user sees.'],
  [':hover', 'Pointer over', 'Native. Never paired with :focus in one selector.'],
  [':focus-visible', 'Keyboard focus', 'Native. Never :focus — that rings on mouse click too, which is why people delete focus styles.'],
  ['[disabled]', 'Unavailable', 'The real attribute on real controls. .is-disabled only for div-based elements.'],
  ['.is-error', 'Invalid', 'On the wrapper, not the input — so label, hint and error all respond to one class.'],
  ['.is-loading', 'In flight', 'Sets pointer-events: none. The label stays; the width must not jump.'],
  ['.is-empty', 'No value / no data', 'On a trigger it mutes the placeholder. On a container it renders .empty.'],
];
function SecVocab() {
  return (
    <Sec n="01" t="State vocabulary" hi="अवस्था" note={<>Six words. The audit that started this found <strong>106 class roots and exactly one state modifier</strong> — <code>.on</code>. There was no disabled, no error, no loading anywhere in the system. Nothing here was overriding a decision the design had already made, because the design had not made one.</>}>
      <div className="cb__panel" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="tbl" style={{ width: '100%' }}>
          <thead><tr><th style={{ width: 148 }}>Selector</th><th style={{ width: 190 }}>Means</th><th>Rule</th></tr></thead>
          <tbody>{VOC.map(([s, m, r]) => <tr key={s}><td><code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--primary-text)' }}>{s}</code></td><td style={{ fontSize: 12.5 }}>{m}</td><td style={{ fontSize: 12.5, color: 'var(--on-surface-2)', lineHeight: 1.5 }}>{r}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="cb__note" style={{ marginTop: 17 }}>Two prefixes, and the split is the point: <code>.on</code> describes what the user chose, <code>.is-*</code> describes what the system is doing. A row can be <code>.on.is-loading</code> — selected, and saving that selection — and the two never fight for the same slot.</p>
    </Sec>
  );
}

Object.assign(window, { SecMotion, SecVocab, KF, VOC });
