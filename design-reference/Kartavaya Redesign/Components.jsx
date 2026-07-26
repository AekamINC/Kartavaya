const { useState, useRef } = React;
const S = window.CB_ICONS = {
  warn: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9.5" /><path d="M12 7.5v5.5M12 16.4v.1" /></svg>,
  ok: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9.5" /><path d="M8 12.4l2.7 2.7L16 9.6" /></svg>,
  err: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="9.5" /><path d="M15 9l-6 6M9 9l6 6" /></svg>,
  inf: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9.5" /><path d="M12 11v5.5M12 7.6v.1" /></svg>,
  wf: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 3.5L2.5 20h19z" /><path d="M12 10v4.2M12 17.2v.1" /></svg>,
  tick: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>,
  off: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"><path d="M2 8.8a17 17 0 0120 0M5.5 12.6a12 12 0 0113 0M9 16.3a7 7 0 016 0M12 20v.1" /><path d="M3 3l18 18" /></svg>,
};

function Sec({ n, t, hi, note, children }) {
  return (
    <section className="cb__sec">
      <div className="cb__sh"><span className="cb__sn">{n}</span><h2 className="cb__st">{t}</h2>{hi && <span className="cb__shi">{hi}</span>}</div>
      {note && <p className="cb__note">{note}</p>}
      {children}
    </section>
  );
}
function Cell({ c, n, wide, children }) {
  return <div className={'cb__cell' + (wide ? ' cb__wide' : '')}><span className="cb__cl">{c}</span><div className="cb__cd">{children}</div>{n && <span className="cb__cn">{n}</span>}</div>;
}

// ── 3 · Buttons ──────────────────────────────────────────────────────────────
// Specimens are ENUMERATED FROM THE STYLESHEET, not typed. A hand-written list
// let 'btn--pri' — a class defined nowhere — be demonstrated for a full batch
// while six real variants went unshown, and let the prose miscount its own grid
// in both directions. Reading the rules makes those failures structurally
// impossible: a variant that does not exist cannot appear, and one that does
// cannot be forgotten.
function btnVariants() {
  const found = new Set();
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) {
      if (!r.selectorText) continue;
      for (const m of r.selectorText.matchAll(/\.btn--([a-z]+)/g)) found.add(m[1]);
    }
  }
  // Alphabetical is not neutral — it put the destructive variant first and the
  // primary action second. Sort by declared semantic order; anything the
  // stylesheet has that this list does not goes to the END, so a new variant
  // still surfaces loudly but lands in a position that reads "unclassified"
  // rather than silently taking the lead.
  const ORDER = ['fill', 'out', 'tonal', 'ghost', 'text', 'danger', 'sm', 'lg'];
  return [...found].sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
}
const BTN_LABEL = { fill: 'Save changes', out: 'Cancel', tonal: 'Assign', ghost: 'Skip', text: 'Learn more', danger: 'Delete task' };
const BTN_SIZE = new Set(['sm', 'lg']);

function SecButtons() {
  const all = btnVariants();
  const appearance = all.filter(v => !BTN_SIZE.has(v));
  const sizes = all.filter(v => BTN_SIZE.has(v));
  const V = [...appearance.map(v => ['btn btn--' + v, BTN_LABEL[v] || v]), ['icobtn', null]];
  const STATES = ['default', ':hover', ':focus-visible', '[disabled]', '.is-loading'];
  const ico = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
  const n = w => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][w] || w;
  const N = w => { const x = n(w) + ''; return x[0].toUpperCase() + x.slice(1); };
  return (
    <Sec n="03" t="Buttons" hi="बटन" note={<>{N(appearance.length)} appearance variants and {n(sizes.length)} size modifiers, at {n(STATES.length)} states each — <strong>counted from the stylesheet at render, not typed into this sentence</strong>, because a hand-written grid demonstrated a variant that did not exist while omitting six that did. <strong>Hover and focus are never combined into one rule</strong> — <code>:focus-visible</code> must stay visible while the pointer is elsewhere, which a shared <code>:hover, :focus</code> selector destroys. Disabled uses the real <code>disabled</code> attribute, never a class, so it is announced and unfocusable for free.</>}>
      <div className="cb__grid">
        {V.map(([c, l]) => <React.Fragment key={c}>
          <Cell c={c} n="default"><button className={c}>{l || ico}</button></Cell>
          <Cell c={c + ' :hover'} n="pointer over"><button className={c} style={{ filter: 'brightness(.94)' }}>{l || ico}</button></Cell>
          <Cell c={c + ' :focus-visible'} n="keyboard only"><button className={c} style={{ outline: '2px solid var(--primary)', outlineOffset: 3 }}>{l || ico}</button></Cell>
          <Cell c={c + ' [disabled]'} n="attribute, not class"><button className={c} disabled>{l || ico}</button></Cell>
          <Cell c={c + ' .is-loading'} n="label stays — width must not jump"><button className={c + ' is-loading'}><span className="spin" />{l || ico}</button></Cell>
        </React.Fragment>)}
      </div>
      <div className="cb__grid" style={{ marginTop: 14 }}>
        {sizes.map(z => <Cell key={z} c={'.btn--fill.btn--' + z} n={z === 'sm' ? 'table rows, chip actions' : 'empty states, primary CTA'}>
          <button className={'btn btn--fill btn--' + z}>Save changes</button>
        </Cell>)}
        <Cell c=".btn--out.btn--sm" n="composes with any appearance"><button className="btn btn--out btn--sm">Cancel</button></Cell>
      </div>
    </Sec>
  );
}

// ── 4 · Inputs ───────────────────────────────────────────────────────────────
function SecInputs() {
  const [v, setV] = useState('27AAFCK1234M1Z5');
  return (
    <Sec n="04" t="Text input" hi="निवेश" note={<>One field component. The wrapper <code>.fldx</code> carries the state; the <code>&lt;input&gt;</code> never does. That is what lets label, hint and error all respond to <code>.is-error</code> without four coordinated class changes.</>}>
      <div className="cb__grid">
        <Cell c=".fldx" n="default"><div className="fldx"><span className="fldx__lbl"><span>GSTIN</span></span><input className="fldx__in" placeholder="15 characters" /></div></Cell>
        <Cell c=".fldx__in:hover" n="border darkens only"><div className="fldx"><span className="fldx__lbl"><span>GSTIN</span></span><input className="fldx__in" placeholder="15 characters" style={{ borderColor: 'var(--on-surface-3)' }} /></div></Cell>
        <Cell c=".fldx__in:focus" n="ring, not just border"><div className="fldx"><span className="fldx__lbl"><span>GSTIN</span></span><input className="fldx__in" defaultValue={v} style={{ borderColor: 'var(--primary)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--primary) 17%, transparent)' }} /></div></Cell>
        <Cell c=".fldx.is-error" n="hint stays, error adds"><div className="fldx is-error"><span className="fldx__lbl"><span>GSTIN</span></span><input className="fldx__in" defaultValue="27AAFCK1234" /><span className="fldx__hint">15 characters — state code, PAN, entity digit</span><span className="fldx__err">{S.warn}Must be 15 characters. This is 11.</span></div></Cell>
        <Cell c=".fldx.is-loading" n="verifying against the GST portal"><div className="fldx is-loading"><span className="fldx__lbl"><span>GSTIN</span></span><input className="fldx__in" defaultValue={v} readOnly /><span className="fldx__hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="spin" style={{ width: 10, height: 10 }} />Checking with the portal…</span></div></Cell>
        <Cell c=".fldx [disabled]" n="inherited from org profile"><div className="fldx"><span className="fldx__lbl"><span>GSTIN</span></span><input className="fldx__in" defaultValue={v} disabled /><span className="fldx__hint">Set in Organisation settings</span></div></Cell>
        <Cell c=".fldx textarea" n="min 74px, resize vertical only"><div className="fldx"><span className="fldx__lbl"><span>Notes</span></span><textarea className="fldx__in" placeholder="Optional context…" /></div></Cell>
        <Cell c=".fldx--amt" n="mono, right-aligned, 120px cap"><div className="fldx fldx--amt"><span className="fldx__lbl"><span>Amount</span></span><input className="fldx__in" defaultValue="48,200.00" /></div></Cell>
      </div>
    </Sec>
  );
}

// ── 5 · Form layout ──────────────────────────────────────────────────────────
function SecForm() {
  return (
    <Sec n="05" t="Form layout" hi="प्रपत्र" note={<>Three rules, and they are not preferences — each falls out of something specific about this product.</>}>
      <div className="cb__two">
        <div className="cb__panel">
          <div className="form">
            <p className="cb__note" style={{ marginBottom: 2 }}><strong>1 · The label sits above. Always.</strong> Never beside. A beside-label column has to be sized for the longest string in it, and every label here is an English/Devanagari pair of unpredictable width — “Registered address / पंजीकृत पता” against “PAN”. Sizing for the worst case wastes the gutter on every other row, and switching to Gujarati resizes the whole form.</p>
            <div className="form__row">
              <div className="fldx"><span className="fldx__lbl"><span>Legal name</span><span className="hi">विधिक नाम</span></span><input className="fldx__in" defaultValue="Saraswati Textiles Pvt Ltd" /></div>
              <div className="fldx"><span className="fldx__lbl"><span>PAN</span></span><input className="fldx__in" defaultValue="AAFCK1234M" /></div>
            </div>
            <div className="form__row form__row--21">
              <div className="fldx"><span className="fldx__lbl"><span>Address</span><span className="hi">पता</span><span className="fldx__opt">optional</span></span><input className="fldx__in" placeholder="Street, city" /></div>
              <div className="fldx"><span className="fldx__lbl"><span>PIN</span></span><input className="fldx__in" placeholder="380015" /></div>
            </div>
            <div className="fldc"><button className="tgl on" aria-pressed="true" /><span className="fldc__b"><span className="fldc__t">Composition scheme</span><span className="fldc__s">The one inversion — a switch's label reads as a sentence to its right, not a caption above it.</span></span></div>
          </div>
        </div>
        <div className="cb__panel">
          <p className="cb__note"><strong>2 · Hint above error, and the hint never leaves.</strong> The common pattern swaps them — error replaces hint. That deletes the format instruction at the exact moment the user has proven they need it. Both stay; the error stacks below.</p>
          <div className="fldx is-error" style={{ marginBottom: 20 }}>
            <span className="fldx__lbl"><span>IFSC</span></span><input className="fldx__in" defaultValue="HDFC000" />
            <span className="fldx__hint">Four letters, a zero, then six characters</span>
            <span className="fldx__err">{S.warn}Not a valid IFSC — check the last six.</span>
          </div>
          <p className="cb__note"><strong>3 · Optional is marked. Required is not.</strong> The asterisk convention marks the majority, which is noise on every row. Here most fields are required, so the exception carries the mark — and it sits right-aligned in the label row where it reads as an aside rather than part of the name.</p>
          <p className="cb__note" style={{ marginBottom: 0 }}>Field width fills its grid column. The four exceptions with known value length: <code>--date 140px</code>, <code>--time 100px</code>, <code>--amt 120px</code>, <code>--otp 210px</code>. Nothing else gets a fixed width — a 300px input inside a 520px card is a decision that breaks the moment the card is used somewhere narrower.</p>
        </div>
      </div>
    </Sec>
  );
}

// ── 6 · Toggles ──────────────────────────────────────────────────────────────
function SecToggle() {
  const [sw, setSw] = useState(true), [cb, setCb] = useState(true), [rd, setRd] = useState('m'), [sg, setSg] = useState('board');
  return (
    <Sec n="06" t="Selection controls" hi="चयन" note={<>The state class is <code>.on</code> — already in 40+ places, kept rather than renamed to <code>.is-selected</code>. Renaming it would touch every file and change nothing a user sees. <strong>Every control here also carries the matching ARIA</strong>: <code>aria-pressed</code> on the switch, <code>aria-checked</code> on checkbox and radio, <code>aria-selected</code> in the segmented group — a <code>div</code> with a class is invisible to a screen reader.</>}>
      <div className="cb__grid">
        <Cell c=".tgl" n="off"><button className="tgl" aria-pressed="false" /></Cell>
        <Cell c=".tgl.on" n="on — live, click it"><button className={'tgl' + (sw ? ' on' : '')} aria-pressed={sw} onClick={() => setSw(!sw)} /></Cell>
        <Cell c=".tgl [disabled]" n="locked by role"><button className="tgl on" disabled /></Cell>
        <Cell c=".cbx" n="unchecked"><button className="cbx" aria-checked="false" role="checkbox" />&nbsp;<button className={'cbx' + (cb ? ' on' : '')} role="checkbox" aria-checked={cb} onClick={() => setCb(!cb)}>{S.tick}</button></Cell>
        <Cell c=".cbx.mixed" n="header checkbox, partial page"><button className="cbx mixed" role="checkbox" aria-checked="mixed" /></Cell>
        <Cell c=".rdo" n="single choice">{['s', 'm', 'l'].map(k => <button key={k} className={'rdo' + (rd === k ? ' on' : '')} role="radio" aria-checked={rd === k} onClick={() => setRd(k)} />)}</Cell>
        <Cell c=".seg" wide n="segmented — the roving-tabindex case: one tab stop, arrows move within">
          <div className="seg" role="tablist">{['Board', 'Table', 'Calendar', 'Timeline'].map(t => <button key={t} role="tab" aria-selected={sg === t.toLowerCase()} tabIndex={sg === t.toLowerCase() ? 0 : -1} className={sg === t.toLowerCase() ? 'on' : ''} onClick={() => setSg(t.toLowerCase())}>{t}</button>)}</div>
        </Cell>
      </div>
    </Sec>
  );
}

// ── 7 · The unified picker ───────────────────────────────────────────────────
const PEOPLE = [
  { id: 'r', name: 'Rahul Mehta', meta: 'Senior Associate' }, { id: 'p', name: 'Priya Shah', meta: 'Partner' },
  { id: 'a', name: 'Ananya Iyer', meta: 'Articled Clerk' }, { id: 'v', name: 'Vikram Desai', meta: 'Manager' },
  { id: 'n', name: 'Neha Kulkarni', meta: 'Associate' }, { id: 'k', name: 'Karan Bhatt', meta: 'Articled Clerk' },
  { id: 's', name: 'Sneha Rao', meta: 'Paralegal' },
];
const PRIO = [{ id: 'u', label: 'Urgent', color: 'var(--pr-urgent)' }, { id: 'h', label: 'High', color: 'var(--pr-high)' }, { id: 'm', label: 'Medium', color: 'var(--pr-medium)' }, { id: 'l', label: 'Low', color: 'var(--pr-low)' }];
const CATS = [{ id: 'gst', label: 'GST filing', color: '#0F6E66' }, { id: 'itr', label: 'Income tax', color: '#8A5A2B' }, { id: 'roc', label: 'ROC compliance', color: '#5B4A7C' }, { id: 'aud', label: 'Audit', color: '#2F6B4F' }];

function SecPicker() {
  const [p, setP] = useState('r'), [m, setM] = useState(['r', 'p']), [pr, setPr] = useState('h'), [c, setC] = useState(null), [d, setD] = useState(new Date());
  return (
    <Sec n="07" t="The picker" hi="चयनक" note={<>The drawer ships <strong>four independently-written pickers</strong> — assignee, date, priority, category. Four dismiss behaviours, two of which don't close on Escape; one hardcodes <code>z-index: 300</code>; none support arrow keys. This is the one component that replaces all four. <strong>Everything below is live — open them, type, arrow, press Escape.</strong></>}>
      <div className="cb__grid">
        <Cell c="mode='person'" n="avatar in trigger and rows; search appears above 6 items"><Picker mode="person" items={PEOPLE} value={p} onChange={setP} placeholder="Unassigned" /></Cell>
        <Cell c="mode='multi'" n="checkbox rows, stacked avatars, stays open"><Picker mode="multi" items={PEOPLE} value={m} onChange={setM} placeholder="Add assignees" /></Cell>
        <Cell c="mode='option'" n="colour dot, no search under 6"><Picker mode="option" items={PRIO} value={pr} onChange={setPr} placeholder="No priority" /></Cell>
        <Cell c="mode='option' onCreate" n="create typed value from the search box"><Picker mode="option" items={CATS} value={c} onChange={setC} placeholder="No category" onCreate={() => { }} createLabel="New category" /></Cell>
        <Cell c="mode='date'" n="quick row, then calendar; today dotted"><Picker mode="date" value={d} onChange={setD} /></Cell>
        <Cell c="field + [disabled]" n="same component, full-width form dress"><Picker mode="person" field items={PEOPLE} value={null} onChange={() => { }} placeholder="Reviewer" disabled /></Cell>
      </div>
      <p className="cb__note" style={{ marginTop: 18 }}>What the four shared: nothing. What they share now — <code>usePicker()</code> owns Escape, click-outside, arrow/Home/End roving focus, Enter to commit, and the 130ms exit animation before unmount. <strong>Below 768px every mode becomes a bottom sheet</strong> with a grab handle and 44px rows, in one media query rather than four hand-written mobile variants. Placement flips via <code>up</code> / <code>right</code> props, so the subtask picker that currently hardcodes <code>bottom: calc(100% + 4px)</code> passes <code>up</code> instead.</p>
    </Sec>
  );
}

Object.assign(window, { Sec, Cell, SecButtons, SecInputs, SecForm, SecToggle, SecPicker, PEOPLE, PRIO, CATS });
