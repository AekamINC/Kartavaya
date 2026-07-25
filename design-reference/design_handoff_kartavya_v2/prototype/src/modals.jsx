// New-task modal + always-visible "Customize" panel.
// These are part of the design itself — not gated on the host's edit-mode
// toolbar — so anyone viewing the prototype can customize and create tasks.

// ── New Task modal ─────────────────────────────────────────────────────────

function NewTaskModal({ open, onClose, onCreate, defaults }) {
  const [title, setTitle]       = React.useState('');
  const [project, setProject]   = React.useState(defaults?.project || 'p1');
  const [column, setColumn]     = React.useState(defaults?.column  || 'c1');
  const [priority, setPriority] = React.useState('medium');
  const [due, setDue]           = React.useState('2026-05-20');
  const [est, setEst]           = React.useState(2);
  const [assignees, setAssignees] = React.useState(['u1']);
  const [desc, setDesc]         = React.useState('');

  // Reset on open
  React.useEffect(() => {
    if (open) {
      setTitle(''); setColumn(defaults?.column || 'c1');
      setProject(defaults?.project || 'p1'); setPriority('medium');
      setDue('2026-05-20'); setEst(2); setAssignees(['u1']); setDesc('');
    }
  }, [open, defaults?.project, defaults?.column]);

  // Close on ESC
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const toggleAssignee = (uid) => {
    setAssignees(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid]);
  };

  const submit = () => {
    if (!title.trim()) return;
    const newId = 'KAR-' + (600 + Math.floor(Math.random() * 99));
    onCreate({
      id: newId, title: title.trim(), project, column, priority,
      due, assignees, est: Number(est) || 1, updated: 'Just now',
      comments: 0, attachments: 0,
    });
    onClose();
  };

  return (
    <>
      <div className="k-modal-scrim" onClick={onClose} />
      <div className="k-modal" role="dialog" aria-modal="true">
        <div className="k-modal__head">
          <div>
            <div className="k-modal__kicker">New task · नया कार्य</div>
            <h2>What needs doing?</h2>
          </div>
          <button className="k-iconbtn" onClick={onClose} title="Close">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 3l10 10M13 3L3 13"/></svg>
          </button>
        </div>

        <div className="k-modal__body">
          <input
            className="k-modal__title"
            placeholder="Write a clear, action-first title…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />

          <div className="k-modal__grid">
            <div className="k-modal__field">
              <label className="k-modal__lbl">Project · परियोजना</label>
              <select className="k-input" value={project} onChange={(e) => setProject(e.target.value)}>
                {PROJECTS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="k-modal__field">
              <label className="k-modal__lbl">Status · स्थिति</label>
              <select className="k-input" value={column} onChange={(e) => setColumn(e.target.value)}>
                {COLUMNS.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>
            <div className="k-modal__field">
              <label className="k-modal__lbl">Priority · प्राथमिकता</label>
              <div className="k-modal__priogrp">
                {['low', 'medium', 'high', 'urgent'].map(p => (
                  <button key={p}
                          type="button"
                          className={'k-modal__prio' + (priority === p ? ' is-active' : '')}
                          style={{ '--c': PRIORITY_COLOR[p] }}
                          onClick={() => setPriority(p)}>
                    <span className="k-modal__prio-dot" />
                    {PRIORITY_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>
            <div className="k-modal__field">
              <label className="k-modal__lbl">Due · नियत तिथि</label>
              <input type="date" className="k-input" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            <div className="k-modal__field">
              <label className="k-modal__lbl">Estimate · अनुमान</label>
              <div className="k-modal__num">
                <input type="number" min="0" step="0.5" value={est}
                       onChange={(e) => setEst(e.target.value)} />
                <span>hours</span>
              </div>
            </div>
            <div className="k-modal__field k-modal__field--full">
              <label className="k-modal__lbl">Assignees · नियुक्त</label>
              <div className="k-modal__people">
                {TEAM.filter(u => u.role !== 'client').map(u => (
                  <button key={u.id}
                          type="button"
                          className={'k-modal__person' + (assignees.includes(u.id) ? ' is-active' : '')}
                          onClick={() => toggleAssignee(u.id)}>
                    <Avatar uid={u.id} size={22} />
                    <span>{u.name}</span>
                    {assignees.includes(u.id) && (
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8l3.5 3.5L13 5"/></svg>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div className="k-modal__field k-modal__field--full">
              <label className="k-modal__lbl">Description · विवरण</label>
              <textarea className="k-input k-modal__desc"
                        placeholder="Acceptance criteria, context, links…"
                        value={desc}
                        onChange={(e) => setDesc(e.target.value)} />
            </div>
            <div className="k-modal__field k-modal__field--full">
              <label className="k-modal__lbl">Attachments · संलग्न</label>
              <button type="button" className="k-modal__attach">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M10.5 3.5l-5 5a2.5 2.5 0 003.5 3.5l5-5a4 4 0 00-5.7-5.7L3 5"/>
                </svg>
                <span>Attach files</span>
                <span className="k-modal__attach-hint">PDF, DOCX, XLSX, PNG · max 5 MB each</span>
              </button>
            </div>
          </div>
        </div>

        <div className="k-modal__foot">
          <div className="k-modal__hint">
            <span className="k-kbd">↵</span> to create · <span className="k-kbd">Esc</span> to close
          </div>
          <div className="k-modal__actions">
            <button className="k-btn k-btn--ghost" onClick={onClose}>Cancel</button>
            <button className="k-btn k-btn--primary" onClick={submit} disabled={!title.trim()}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8l3.5 3.5L13 5"/></svg>
              Create task
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Inline Tweaks (always available to visitors) ──────────────────────────
// Lives inside the prototype itself — not gated on the host edit-mode toggle —
// so any reviewer can flip themes, fonts, density, and language live.

function InlineTweaks({ t, setTweak }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      {/* Floating launcher (always visible) */}
      <button
        className={'k-cust-launch' + (open ? ' is-open' : '')}
        onClick={() => setOpen(v => !v)}
        title="Customize this design"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M2.5 5h6M11 5h2.5M2.5 11h2.5M7.5 11h6"/>
          <circle cx="9.5" cy="5" r="1.8" fill="currentColor" stroke="none"/>
          <circle cx="6" cy="11" r="1.8" fill="currentColor" stroke="none"/>
        </svg>
        <span>Customize</span>
        <span className="k-cust-launch__hi">सजावट</span>
      </button>

      {open && (
        <div className="k-cust" role="dialog">
          <div className="k-cust__head">
            <div>
              <div className="k-cust__kicker">Customize · सजावट</div>
              <h3>Make it yours</h3>
            </div>
            <button className="k-iconbtn" onClick={() => setOpen(false)}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 3l10 10M13 3L3 13"/></svg>
            </button>
          </div>

          <div className="k-cust__body">
            <CustSection label="Theme" sans="रंग">
              <CustRow label="Mode">
                <div className="k-cust-seg">
                  {['light', 'dark'].map(m => (
                    <button key={m}
                            className={t.theme === m ? 'is-active' : ''}
                            onClick={() => setTweak('theme', m)}>
                      {m === 'light' ? '☀ Light' : '☾ Dark'}
                    </button>
                  ))}
                </div>
              </CustRow>
              <CustRow label="Accent">
                <div className="k-cust-accent">
                  {Object.entries(ACCENTS).map(([key, a]) => (
                    <button key={key}
                            className={'k-cust-accent__chip' + (t.accent === key ? ' is-active' : '')}
                            style={{ background: a.gradD }}
                            onClick={() => setTweak('accent', key)}
                            title={key}>
                      <span>{key}</span>
                    </button>
                  ))}
                </div>
              </CustRow>
            </CustSection>

            <CustSection label="Layout" sans="विन्यास">
              <CustRow label="Sidebar">
                <div className="k-cust-seg">
                  <button className={t.sidebarVariant === 'wide' ? 'is-active' : ''}
                          onClick={() => setTweak('sidebarVariant', 'wide')}>Wide</button>
                  <button className={t.sidebarVariant === 'rail' ? 'is-active' : ''}
                          onClick={() => setTweak('sidebarVariant', 'rail')}>Rail</button>
                </div>
              </CustRow>
              <CustRow label="Density">
                <div className="k-cust-seg">
                  <button className={t.density === 'compact' ? 'is-active' : ''}
                          onClick={() => setTweak('density', 'compact')}>Compact</button>
                  <button className={t.density === 'comfy' ? 'is-active' : ''}
                          onClick={() => setTweak('density', 'comfy')}>Comfy</button>
                </div>
              </CustRow>
            </CustSection>

            <CustSection label="Type & language" sans="भाषा">
              <CustRow label="Display font">
                <select className="k-input" value={t.font} onChange={(e) => setTweak('font', e.target.value)}>
                  <option value="newsreader">Newsreader · editorial</option>
                  <option value="spectral">Spectral · literary</option>
                  <option value="geist">Instrument Serif · modern</option>
                  <option value="inter">Inter · sans only</option>
                </select>
              </CustRow>
              <CustRow label="Language">
                <div className="k-cust-seg k-cust-seg--3">
                  {[
                    { v: 'en',  label: 'EN' },
                    { v: 'mix', label: 'EN + सं' },
                    { v: 'hi',  label: 'हिन्दी' },
                  ].map(o => (
                    <button key={o.v} className={t.lang === o.v ? 'is-active' : ''}
                            onClick={() => setTweak('lang', o.v)}>{o.label}</button>
                  ))}
                </div>
              </CustRow>
            </CustSection>

            <div className="k-cust__hint">
              <span className="hi-mute">यथारुचि — </span>
              <em>"as you wish."</em> Your choices persist as you click around.
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CustSection({ label, sans, children }) {
  return (
    <div className="k-cust-section">
      <div className="k-cust-section__head">
        <span>{label}</span>
        <span className="k-cust-section__sans">{sans}</span>
      </div>
      {children}
    </div>
  );
}

function CustRow({ label, children }) {
  return (
    <div className="k-cust-row">
      <div className="k-cust-row__lbl">{label}</div>
      <div className="k-cust-row__val">{children}</div>
    </div>
  );
}

Object.assign(window, { NewTaskModal, InlineTweaks });
