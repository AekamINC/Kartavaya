// Side drawer for task detail. Slides in from the right when a task card is clicked.

function TaskDrawer({ task, onClose }) {
  const [tab, setTab] = React.useState('detail');

  if (!task) return null;
  const p = projectOf(task.project);
  const c = colOf(task.column);
  const due = relDue(task.due);

  return (
    <>
      <div className="k-dr-scrim" onClick={onClose} />
      <aside className="k-dr">
        <header className="k-dr__head">
          <div className="k-dr__crumb">
            <span className="k-dr__cdot" style={{ background: p.color }} />
            <span>{p.name}</span>
            <span className="k-mute">·</span>
            <span className="k-mute">{p.sanskrit}</span>
          </div>
          <div className="k-dr__head-actions">
            <button className="k-iconbtn" title="Subscribe">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M13 11l-2-2H5L3 11V4a1 1 0 011-1h8a1 1 0 011 1v7z"/></svg>
            </button>
            <button className="k-iconbtn" title="More">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="4" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="12" cy="8" r="1"/></svg>
            </button>
            <button className="k-iconbtn" onClick={onClose} title="Close">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 3l10 10M13 3L3 13"/></svg>
            </button>
          </div>
        </header>

        <div className="k-dr__title">
          <div className="k-dr__id">{task.id}</div>
          <h2>{task.title}</h2>
        </div>

        <div className="k-dr__props">
          <Prop label="Status" sans="स्थिति">
            <StatusChip cid={task.column} />
          </Prop>
          <Prop label="Priority" sans="प्राथमिकता">
            <span className="k-priochip" style={{ '--c': PRIORITY_COLOR[task.priority] }}>
              <span className="k-priochip__dot" />
              {PRIORITY_LABEL[task.priority]}
            </span>
          </Prop>
          <Prop label="Due" sans="नियत तिथि">
            <span className={'k-due k-due--' + due.tone}>{due.label}</span>
            <span className="k-mute"> · {new Date(task.due).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          </Prop>
          <Prop label="Estimate" sans="अनुमान">
            <span className="k-mono">{task.est}h</span>
          </Prop>
          <Prop label="Assignees" sans="नियुक्त">
            <div className="k-dr__people">
              {task.assignees.map(uid => {
                const u = userOf(uid);
                return (
                  <span key={uid} className="k-dr__person">
                    <Avatar uid={uid} size={22} />
                    <span>{u.name}</span>
                  </span>
                );
              })}
              <button className="k-dr__addperson">+ Add</button>
            </div>
          </Prop>
          <Prop label="Project" sans="परियोजना">
            <ProjectTag pid={task.project} />
          </Prop>
        </div>

        <div className="k-dr__tabs">
          {[
            { id: 'detail',   label: 'Description', sans: 'विवरण' },
            { id: 'comments', label: 'Comments',    sans: 'टिप्पणी', count: task.comments },
            { id: 'files',    label: 'Files',       sans: 'फ़ाइलें', count: task.attachments },
            { id: 'activity', label: 'Activity',    sans: 'गतिविधि' },
          ].map(t => (
            <button key={t.id} className={'k-dr__tab' + (tab === t.id ? ' is-active' : '')} onClick={() => setTab(t.id)}>
              <span>{t.label}</span>
              <span className="k-dr__tab-sans">{t.sans}</span>
              {t.count > 0 && <span className="k-dr__tab-count">{t.count}</span>}
            </button>
          ))}
        </div>

        <div className="k-dr__body">
          {tab === 'detail' && (
            <div className="k-prose">
              <p><b>Context.</b> Quarterly GST filing for Q1 FY 26-27. Working notes need to consolidate sales register, purchase register, and B2B invoice reconciliation before the 20th deadline.</p>
              <h4>Acceptance criteria</h4>
              <ul>
                <li>Sales register reconciled with GSTR-1</li>
                <li>Input tax credit matched against GSTR-2B</li>
                <li>Any mismatches over ₹5,000 flagged with vendor</li>
                <li>Working notes signed off by CA Sharma</li>
              </ul>
              <h4>Links</h4>
              <ul>
                <li>Drive · <a className="k-link">Q1_GST_Working_Notes_v2.xlsx</a></li>
                <li>Email · <a className="k-link">Re: CA Sharma — March ledger</a></li>
              </ul>
            </div>
          )}
          {tab === 'comments' && (
            <div className="k-thread">
              {[
                { who: 'u2', when: '2h ago', body: 'Got the March ledger from CA Sharma. Reconciliation is clean except 3 entries — Borivali print run, Saraswati FY ledger correction, and one office rent invoice from Feb that slipped in.' },
                { who: 'u1', when: '1h ago', body: 'Good catch on the rent invoice. Let\'s flag it and add a working note. @Vikram can you double-check the Borivali entry?' },
                { who: 'u5', when: '45m ago', body: 'On it. Will share by EOD.' },
              ].map((cm, i) => {
                const u = userOf(cm.who);
                return (
                  <div key={i} className="k-cm">
                    <Avatar uid={cm.who} size={28} />
                    <div className="k-cm__body">
                      <div className="k-cm__head"><b>{u.name}</b><span className="k-cm__when">{cm.when}</span></div>
                      <div className="k-cm__txt">{cm.body}</div>
                    </div>
                  </div>
                );
              })}
              <div className="k-cm-compose">
                <Avatar uid="u1" size={28} />
                <div className="k-cm-compose__field">
                  <textarea placeholder="Write a comment… · टिप्पणी लिखें…" />
                  <div className="k-cm-compose__actions">
                    <button className="k-cm-attach" title="Attach file">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M10.5 3.5l-5 5a2.5 2.5 0 003.5 3.5l5-5a4 4 0 00-5.7-5.7L3 5"/>
                      </svg>
                    </button>
                    <span className="k-cm-compose__hint">↵ to post · ⇧↵ for newline</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          {tab === 'files' && (
            <div className="k-files">
              {[
                { name: 'Q1_GST_Working_Notes_v2.xlsx', size: '184 KB', who: 'u2' },
                { name: 'CA_Sharma_March_Ledger.pdf',   size: '2.1 MB', who: 'u2' },
              ].map((f, i) => (
                <div key={i} className="k-file">
                  <div className="k-file__icon">XLS</div>
                  <div className="k-file__body">
                    <div className="k-file__name">{f.name}</div>
                    <div className="k-file__meta">{f.size} · uploaded by {userOf(f.who).name.split(' ')[0]}</div>
                  </div>
                  <button className="k-file__more" title="Download">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M8 2v9M4 7l4 4 4-4M2.5 13.5h11"/>
                    </svg>
                  </button>
                </div>
              ))}
              <button className="k-file-attach">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M10.5 3.5l-5 5a2.5 2.5 0 003.5 3.5l5-5a4 4 0 00-5.7-5.7L3 5"/>
                </svg>
                Attach file <span className="k-file-attach__sans">फ़ाइल जोड़ें</span>
                <span className="k-file-attach__hint">PDF, DOCX, XLSX, PNG · max 5 MB</span>
              </button>
            </div>
          )}
          {tab === 'activity' && (
            <div className="k-activity k-activity--full">
              {[
                { who: 'u5', verb: 'moved',     what: 'To "In progress"', when: '2h ago' },
                { who: 'u2', verb: 'attached',  what: 'CA_Sharma_March_Ledger.pdf', when: '3h ago' },
                { who: 'u1', verb: 'changed',   what: 'priority to High', when: 'Yesterday' },
                { who: 'u1', verb: 'created',   what: 'this task', when: '3 days ago' },
              ].map((a, i) => (
                <div key={i} className="k-activity__row">
                  <Avatar uid={a.who} size={22} />
                  <div className="k-activity__body">
                    <div className="k-activity__line"><b>{userOf(a.who).name.split(' ')[0]}</b> <span className="k-mute">{a.verb}</span> {a.what}</div>
                    <div className="k-activity__when">{a.when}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function Prop({ label, sans, children }) {
  return (
    <div className="k-prop">
      <div className="k-prop__lbl">
        <span>{label}</span>
        {sans && <span className="k-prop__sans">{sans}</span>}
      </div>
      <div className="k-prop__val">{children}</div>
    </div>
  );
}

Object.assign(window, { TaskDrawer });
