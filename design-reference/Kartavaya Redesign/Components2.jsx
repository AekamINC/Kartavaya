const SP = [
  ['--sp-1', 4, 'Icon to its label inside a chip · badge padding'],
  ['--sp-2', 8, 'Sibling controls in a row · chip to chip · avatar to name'],
  ['--sp-3', 12, 'Label to field · internal padding of a list row'],
  ['--sp-4', 16, 'Field to field · groups inside one card'],
  ['--sp-5', 20, 'Card to card in a grid'],
  ['--sp-6', 24, 'Form section to form section'],
  ['--sp-7', 32, 'Page section to page section'],
  ['--sp-8', 44, 'Hero to content · major page break'],
];
const DN = [
  ['--row-h', '44 / 38', 'Table and list row height'],
  ['--pad-page', '28 / 16', 'Page gutter'],
  ['--pad-card', '18 / 14', 'Card interior'],
  ['--gap-section', '22 / 16', 'Between stacked page blocks'],
  ['--gap-tight', '10 / 8', 'Inside a dense cluster'],
];

// ── 2 · Spacing ──────────────────────────────────────────────────────────────
function SecSpacing() {
  return (
    <Sec n="02" t="Spacing" hi="अवकाश" note={<>There are <strong>two scales, and that is deliberate</strong> — but nothing said so, which is why a literal <code>gap: 14px</code> was a reasonable guess. 14 is on neither scale.</>}>
      <div className="cb__two">
        <div className="cb__panel">
          <p className="cb__note"><strong>The fixed ramp — <code>--sp-1</code> … <code>--sp-8</code>.</strong> Structural. Does not move with density. Use inside a component, where the relationship between two elements is a fact about the component rather than a preference.</p>
          <div className="rmp">{SP.map(([t, v, u]) => (
            <div className="rmp__row" key={t}><span className="rmp__t">{t}</span><span className="rmp__v">{v}px</span><span className="rmp__b" style={{ width: v * 2.4 }} /><span className="rmp__u">{u}</span></div>
          ))}</div>
        </div>
        <div className="cb__panel">
          <p className="cb__note"><strong>The density-responsive set.</strong> Two values each — cozy / compact. Use for anything that <em>should</em> breathe differently when a user picks Compact. A page whose gutters are <code>--sp-7</code> ignores the density control entirely.</p>
          <div className="rmp" style={{ marginBottom: 18 }}>{DN.map(([t, v, u]) => (
            <div className="rmp__row" key={t}><span className="rmp__t">{t}</span><span className="rmp__v">{v}</span><span className="rmp__b" style={{ width: parseInt(v) * 2.4, opacity: .5 }} /><span className="rmp__u">{u}</span></div>
          ))}</div>
          <p className="cb__note" style={{ marginBottom: 0 }}><strong>The test:</strong> would a user who chose Compact want this gap smaller? Yes → density token. No → <code>--sp-*</code>. A stack of page sections wants to tighten, so <code>.stack</code> is <code>gap: var(--gap-section)</code>. The 6px between a priority dot and its label does not, so it is <code>--sp-1</code>.</p>
        </div>
      </div>
      <p className="cb__note" style={{ marginTop: 17 }}>Neither scale contains 10, 14 or 22 — yet <code>--gap-tight</code> is 10 and <code>--gap-section</code> is 22. That is the density set living on its own rhythm, which is fine, but it means <strong>a literal <code>14px</code> is always wrong</strong>: it is neither. Round to <code>--sp-3</code> if it belongs to the component, or reach for <code>--gap-tight</code> if it should compress.</p>
    </Sec>
  );
}

// ── 8 · Display ──────────────────────────────────────────────────────────────
function SecDisplay() {
  return (
    <Sec n="08" t="Chips, badges, avatars" hi="प्रदर्श" note={<>Chips are read-only unless they carry a dismiss affordance. <strong>A chip that is clickable but looks identical to one that is not</strong> is the most common source of dead clicks in the current build — the filter chips and the status chips are visually the same object.</>}>
      <div className="cb__grid">
        <Cell c=".chip" n="read-only — status, label"><span className="chip">In progress</span><span className="chip" style={{ background: 'var(--ok-container)', color: 'var(--on-surface)' }}>Done</span></Cell>
        <Cell c=".chip[role=button]" n="interactive — cursor + hover; must differ"><button className="chip" style={{ cursor: 'pointer', borderStyle: 'dashed' }}>Due this week</button></Cell>
        <Cell c=".chip .x" n="dismissible — applied filter"><span className="chip" style={{ paddingRight: 5, gap: 5 }}>Assignee: Priya<button style={{ border: 0, background: 'none', cursor: 'pointer', color: 'inherit', opacity: .6, padding: 0, lineHeight: 1, fontSize: 13 }}>×</button></span></Cell>
        <Cell c=".badge" n="count — mono so digits don't shift"><span className="badge">7</span><span className="badge badge--n">24</span><span className="badge" style={{ width: 7, height: 7, padding: 0 }} /></Cell>
        <Cell c=".pdot" n="priority / category — never alone"><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="pdot" style={{ background: 'var(--pr-urgent)' }} />Urgent</span></Cell>
        <Cell c="Av" n="deterministic colour from the name hash"><Av n="Rahul Mehta" sz={28} /><Av n="Priya Shah" sz={28} /><Av n="Ananya Iyer" sz={28} /></Cell>
        <Cell c="AvStack" n="3 max, then +n"><AvStack ids={['r', 'p', 'a']} items={PEOPLE} /></Cell>
        <Cell c=".prg" n="determinate 68%"><div className="prg"><div className="prg__f" style={{ width: '68%' }} /></div></Cell>
        <Cell c=".prg--ind" n="indeterminate — unknown duration only"><div className="prg prg--ind"><div className="prg__f" /></div></Cell>
      </div>
      <p className="cb__note" style={{ marginTop: 17 }}>A colour dot is never the only carrier of meaning. <code>.pdot</code> always has a text label beside it or an <code>aria-label</code> on its parent — roughly 1 in 12 men reads red and green as the same value, and priority is exactly the field where that matters.</p>
    </Sec>
  );
}

// ── 9 · Overlays ─────────────────────────────────────────────────────────────
function SecOverlay() {
  return (
    <Sec n="09" t="Overlays" hi="आवरण" note={<>Four surfaces, one z-order. <code>200</code> drawer · <code>340</code> picker and menu · <code>420</code> modal · <code>520</code> toast · <code>620</code> mobile sheet. <strong>Every hardcoded z-index in the current build is replaced by this ladder</strong> — the subtask picker at <code>300</code> and the drawer at <code>200</code> currently work only because nobody has opened a menu over a modal.</>}>
      <div className="cb__grid">
        <Cell c=".tip" n="300ms delay in, none out"><span className="tip">Mark complete · ⌘↵</span></Cell>
        <Cell c=".tst--ok" wide n="success — 4s, hover pauses"><div className="tst tst--ok">{S.ok && <span className="tst__i">{S.ok}</span>}<span className="tst__b"><span className="tst__t">Task moved to Review</span></span></div></Cell>
        <Cell c=".tst--err" wide n="error — no auto-dismiss, ever"><div className="tst tst--err"><span className="tst__i">{S.err}</span><span className="tst__b"><span className="tst__t">Couldn't save the description</span><span className="tst__s">Your text is still here. Try again when you're back online.</span></span><button className="tst__a">Retry</button></div></Cell>
        <Cell c=".tst + undo" wide n="reversible — the undo window IS the confirm"><div className="tst tst--info"><span className="tst__i">{S.inf}</span><span className="tst__b"><span className="tst__t">Comment deleted</span></span><button className="tst__a">Undo</button></div></Cell>
        <Cell c=".offb" wide n="persistent banner, not a toast"><div className="offb">{S.off}You're offline. 3 changes will sync when you reconnect.</div></Cell>
      </div>
      <p className="cb__note" style={{ marginTop: 17 }}><strong>Error toasts never auto-dismiss.</strong> A 4-second success message is a courtesy; a 4-second failure message is a bug report the user didn't get to read. Success and info dismiss at 4s, warning at 7s, error waits for a click.</p>
    </Sec>
  );
}

// ── 10 · Feedback ────────────────────────────────────────────────────────────
function SecFeedback() {
  return (
    <Sec n="10" t="Empty, loading, error" hi="स्थिति" note={<>The three states a component spends most of its life in, and the three the current build renders as a blank div. <strong>Empty is not an error and must not look like one.</strong></>}>
      <div className="cb__grid">
        <Cell c=".sk" wide n="skeleton — shaped like the content, not a grey box">
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 9 }}>
            {[92, 74, 58].map((w, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div className="sk" style={{ width: 26, height: 26, borderRadius: '50%' }} /><div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}><div className="sk" style={{ width: w + '%', height: 9 }} /><div className="sk" style={{ width: (w - 34) + '%', height: 7 }} /></div></div>)}
          </div>
        </Cell>
        <Cell c=".empty" wide n="no data yet — offers the next action">
          <div className="empty" style={{ width: '100%' }}><span className="empty__ic">◇</span><span className="empty__t">No tasks in Review</span><span className="empty__s">Tasks land here when someone marks them ready.</span></div>
        </Cell>
        <Cell c=".empty (filtered)" wide n="different copy — data exists, the filter hides it">
          <div className="empty" style={{ width: '100%' }}><span className="empty__ic">⌕</span><span className="empty__t">No tasks match these filters</span><span className="empty__s">4 filters applied. <button style={{ border: 0, background: 'none', color: 'var(--primary-text)', font: 'inherit', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Clear all</button></span></div>
        </Cell>
        <Cell c=".empty (denied)" wide n="not empty — you can't see it. Never say 'no data'">
          <div className="empty" style={{ width: '100%' }}><span className="empty__ic">⊘</span><span className="empty__t">Payroll is restricted</span><span className="empty__s">Vetana needs an explicit grant. Ask an owner — this isn't something an admin role includes.</span></div>
        </Cell>
        <Cell c=".empty (error)" wide n="failed — retry, and say what survived">
          <div className="empty" style={{ width: '100%' }}><span className="empty__ic" style={{ color: 'var(--danger)' }}>{S.wf}</span><span className="empty__t">Couldn't load this board</span><span className="empty__s">The request timed out. Nothing was lost. <button style={{ border: 0, background: 'none', color: 'var(--primary-text)', font: 'inherit', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Try again</button></span></div>
        </Cell>
      </div>
      <p className="cb__note" style={{ marginTop: 17 }}>Four empties, four different messages. The one that matters most is <strong>denied</strong> — rendering “No data” to a user who lacks the grant teaches them the record doesn't exist, and they escalate to an owner who can see it plainly. Say it's restricted and name who can lift it.</p>
    </Sec>
  );
}

// ── 11 · Legacy ──────────────────────────────────────────────────────────────
const LEG = [
  ['.k-mcard', 'Absorb', '.card', 'It is a card. Padding, radius, border and shadow already match within 1px — it was written before .card existed.'],
  ['.k-rolebadge', 'Absorb', '.chip', 'It is a chip with a fixed colour map. The map moves to --st-* and the class goes.'],
  ['.k-teamgrid', 'Keep', '—', 'Page-specific layout with no counterpart. Renaming it to .grid buys nothing and loses the name that says what it holds.'],
  ['.k-pbar', 'Absorb', '.prg', 'Duplicate of the progress bar, 1px taller.'],
  ['.k-bar__lbl', 'Keep', '—', 'Local to one chart. No component claims it.'],
];
function SecLegacy() {
  return (
    <Sec n="11" t="Legacy classes" hi="विरासत" note={<>The rule, so this decides itself for the other 41 pages: <strong>if a class has a counterpart in this inventory, it is absorbed. If it is page-specific layout with no counterpart, it keeps its name and its <code>k-</code> prefix.</strong> The prefix stops being a legacy marker and starts meaning “local to one page”, which is worth keeping.</>}>
      <div className="cb__panel" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="tbl" style={{ width: '100%' }}>
          <thead><tr><th>Class</th><th>Verdict</th><th>Becomes</th><th>Why</th></tr></thead>
          <tbody>{LEG.map(([c, v, b, w]) => <tr key={c}><td><code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{c}</code></td><td><span className="chip" style={{ background: v === 'Keep' ? 'var(--s-high)' : 'var(--primary-container)', color: v === 'Keep' ? 'var(--on-surface-2)' : 'var(--on-primary-container)' }}>{v}</span></td><td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--on-surface-3)' }}>{b}</td><td style={{ fontSize: 12.5, color: 'var(--on-surface-2)', lineHeight: 1.5 }}>{w}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="cb__note" style={{ marginTop: 17 }}>Absorbing is not free — it is a real diff on every page that uses the class. Do it <strong>when you are already editing that page</strong>, never as a standalone sweep. A commit that renames 200 classes and changes no behaviour is unreviewable, and it is the change most likely to quietly break a selector something else depends on.</p>
    </Sec>
  );
}

Object.assign(window, { SecSpacing, SecDisplay, SecOverlay, SecFeedback, SecLegacy, SP, DN });
