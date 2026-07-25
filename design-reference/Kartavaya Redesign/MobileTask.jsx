/* Mobile task detail — grounded in mobile/src/screens/TaskDetailScreen.tsx +
   screens/taskdetail/{styles.ts,Section,SubtaskRow,CommentRow,ApprovalBanner}.
   Staging values kept: title 22/800 lh30, section label 10/800 ls1.5,
   checkbox 20 r5 bw1.5, comment bubble r14 p11 max85%, composer input r20,
   send 36 r18, sheet r24 handle 36x4. */
const { useState: uT, useRef: rT, useEffect: eT } = React;

const TI = {
  chevL: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>,
  more: <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>,
  check: <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>,
  plus: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
  x: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>,
  shield: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>,
  ok: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></svg>,
  no: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></svg>,
  send: <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M3.4 20.4l17.5-7.5a1 1 0 000-1.84L3.4 3.6a.8.8 0 00-1.1.98L4.6 11 13 12l-8.4 1 -2.3 6.42a.8.8 0 001.1.98z" /></svg>,
  clip: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21.4 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3.5 3.5 0 014.95 4.95l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></svg>,
  doc: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>,
  clock: <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3.2 2" /></svg>,
  cal: <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="2.4" /><path d="M3 10h18M8 3v3M16 3v3" /></svg>,
  flag: <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M5 21V4h13l-2.2 4.5L18 13H5" /></svg>,
  chevR: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>,
  edit: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" /></svg>,
  trash: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>,
};

const AV = ['#0d9488', '#b45309', '#6d28d9', '#0369a1', '#be123c'];
const iniT = n => n.split(' ').map(w => w[0]).slice(0, 2).join('');
const AvT = ({ n, s = 30 }) => <span className="mavt" style={{ width: s, height: s, fontSize: Math.round(s * .38), background: AV[n.charCodeAt(0) % AV.length] }}>{iniT(n)}</span>;

/* Approval state machine — labels + colours are staging's, mapped to tokens */
const APV = {
  pending: { l: 'Awaiting internal review', c: 'var(--warn)' },
  pending_client: { l: 'Awaiting client approval', c: '#7c3aed' },
  approved: { l: 'Approved', c: 'var(--ok)' },
  rejected: { l: 'Rejected', c: 'var(--danger)' },
};

const T0 = {
  title: 'File GSTR-3B for July 2026',
  code: 'GST-114', proj: 'Quarterly GST · Aekam Inc',
  status: 'in_progress', pri: 'high', due: '20 Aug',
  desc: 'Reconcile 47 outward invoices against GSTR-2B, compute the 3.1 table, then file. Two purchase invoices are held back — HSN missing on both, chase Nirmal before the 18th.',
  ass: ['Aanya Mehta', 'Rohit Shah'],
  subs: [{ t: 'Pull outward register from Ganit', d: true, a: 'Aanya Mehta' }, { t: 'Reconcile against 2B', d: true, a: 'Aanya Mehta' }, { t: 'Chase Nirmal for HSN codes', d: false, a: 'Rohit Shah' }, { t: 'Compute 3.1 + ITC tables', d: false, a: null }, { t: 'File and save ARN', d: false, a: null }],
  files: [{ n: 'GSTR-2B-Jul26.json', s: '284 KB' }, { n: 'outward-register.xlsx', s: '1.2 MB' }],
  cmts: [
    { u: 'Rohit Shah', b: 'Nirmal says HSN will come by Friday. Do we file without those two?', t: '11:04', mine: false },
    { u: 'You', b: 'No — file complete or we amend next month. Amendment is worse.', t: '11:20', mine: true },
    { u: 'Aanya Mehta', b: '@You noted. 3.1 and ITC are done, waiting on the two invoices only.', t: '12:38', mine: false },
  ],
  logged: '6h 20m', est: '8h',
};

const STATUSES = [['todo', 'To do'], ['in_progress', 'In progress'], ['in_review', 'In review'], ['blocked', 'Blocked'], ['done', 'Done']];
const SC = { todo: 'var(--on-surface-3)', in_progress: 'var(--primary)', in_review: 'var(--warn)', blocked: 'var(--danger)', done: 'var(--ok)' };
const MEMBERS = ['Aanya Mehta', 'Rohit Shah', 'Priya Nair', 'Vikram Desai', 'Sneha Kulkarni'];

function MSheet({ title, onClose, children, foot }) {
  return (
    <div className="msheet__ov" onClick={onClose}>
      <div className="msheet" onClick={e => e.stopPropagation()}>
        <i className="msheet__h" />
        {title && <div className="msheet__t">{title}</div>}
        {children}
        {foot}
      </div>
    </div>
  );
}

function MSec({ label, action, children }) {
  return (
    <div className="mtd__sec">
      <div className="mtd__sech"><span className="mtd__secl">{label}</span>{action}</div>
      {children}
    </div>
  );
}

function MTaskDetail({ back, os, offline, state }) {
  const [t, setT] = uT(T0);
  const [role, setRole] = uT('admin');
  const [apv, setApv] = uT(null);
  const [edT, setEdT] = uT(false);
  const [edD, setEdD] = uT(false);
  const [sheet, setSheet] = uT(null);
  const [rej, setRej] = uT('');
  const [nsub, setNsub] = uT('');
  const [cmt, setCmt] = uT('');
  const [sel, setSel] = uT(null);
  const [queued, setQueued] = uT([]);
  const body = rT(null);

  const done = t.subs.filter(s => s.d).length;
  const pct = Math.round(done / t.subs.length * 100);
  const canReview = role === 'admin';
  const isClient = role === 'client';

  const act = (k, note) => {
    if (k === 'request') setApv('pending');
    if (k === 'approve') { setApv('approved'); }
    if (k === 'reject') { setApv('rejected'); setT({ ...t, note }); }
    if (k === 'client') setApv('pending_client');
    if (k === 'client_approve') setApv('approved');
    if (k === 'client_reject') { setApv('rejected'); setT({ ...t, note }); }
    setSheet(null); setRej('');
  };
  const addSub = () => { if (!nsub.trim()) return; setT({ ...t, subs: [...t.subs, { t: nsub.trim(), d: false, a: null }] }); setNsub(''); };
  const send = () => {
    if (!cmt.trim()) return;
    const c = { u: 'You', b: cmt.trim(), t: 'now', mine: true, pend: offline };
    setT({ ...t, cmts: [...t.cmts, c] });
    if (offline) setQueued(q => [...q, c]);
    setCmt('');
    requestAnimationFrame(() => { if (body.current) body.current.scrollTop = body.current.scrollHeight; });
  };

  if (state === 'loading') return (
    <><div className="mtop" style={{ paddingTop: os === 'ios' ? 56 : 36 }}><button className="micon" onClick={back}>{TI.chevL}</button><span style={{ flex: 1 }} /></div>
      <div className="mbody" style={{ padding: 20, gap: 16 }}>
        <div className="msk" style={{ height: 26, width: '84%' }} /><div className="msk" style={{ height: 26, width: '52%' }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>{[64, 52, 70].map((w, i) => <div key={i} className="msk" style={{ height: 24, width: w, borderRadius: 99 }} />)}</div>
        <div className="msk" style={{ height: 1, margin: '8px 0' }} />
        {[92, 46, 118].map((h, i) => <div key={i} className="msk" style={{ height: h, borderRadius: 10 }} />)}
      </div></>
  );
  if (state === 'error') return (
    <><div className="mtop" style={{ paddingTop: os === 'ios' ? 56 : 36 }}><button className="micon" onClick={back}>{TI.chevL}</button><span style={{ flex: 1 }} /></div>
      <div className="mbody mempty"><span className="mempty__i" style={{ color: 'var(--danger)' }}>{TI.no}</span><b>Couldn't load this task</b><i>GST-114 didn't come back. It may have been deleted, or you may have lost access.</i><button className="mbtn" style={{ marginTop: 14 }}>Try again</button></div></>
  );

  return (
    <>
      <div className="mtop mtd__top" style={{ paddingTop: os === 'ios' ? 56 : 36 }}>
        <button className="micon" onClick={back}>{TI.chevL}</button>
        <span className="mtd__topt mono">{t.code}</span>
        <button className="micon" onClick={() => setSheet('menu')}>{TI.more}</button>
      </div>

      <div className="mbody mtd" ref={body}>
        {/* role switch — shows how the same screen degrades per role */}
        <div className="mtd__role">
          <span>Viewing as</span>
          {[['member', 'Member'], ['admin', 'Admin'], ['client', 'Client']].map(([k, l]) =>
            <button key={k} className={'mtd__roleb' + (role === k ? ' on' : '')} onClick={() => setRole(k)}>{l}</button>)}
        </div>

        {edT && role !== 'client'
          ? <textarea className="mtd__ti" autoFocus value={t.title} rows={2} onChange={e => setT({ ...t, title: e.target.value })} onBlur={() => setEdT(false)} />
          : <div className="mtd__t" onClick={() => role !== 'client' && setEdT(true)}>{t.title}</div>}
        <div className="mtd__proj">{t.proj}</div>

        <div className="mtd__meta">
          <button className="mtd__chip" style={{ '--c': SC[t.status] }} onClick={() => role !== 'client' && setSheet('status')}>
            <i /> {STATUSES.find(s => s[0] === t.status)[1]}
          </button>
          <span className="mtd__chip" style={{ '--c': 'var(--danger)' }}>{TI.flag} High</span>
          <span className="mtd__chip" style={{ '--c': 'var(--on-surface-3)' }}>{TI.cal} {t.due}</span>
        </div>

        {(apv || role !== 'client') && (
          <div className="mtd__sec">
            {!apv ? (
              <button className="mtd__apvrow" onClick={() => act('request')}>{TI.shield}<span>Request approval</span>{TI.chevR}</button>
            ) : (
              <div className="mtd__apv" style={{ '--c': APV[apv].c }}>
                <div className="mtd__apvh">{TI.shield}<b>{APV[apv].l}</b></div>
                {t.note && <p className="mtd__apvn">{t.note}</p>}
                {apv === 'pending' && canReview && (
                  <div className="mtd__apva">
                    <button className="mtd__apvb ok" onClick={() => act('approve')}>{TI.ok} Approve</button>
                    <button className="mtd__apvb no" onClick={() => setSheet('reject')}>{TI.no} Reject</button>
                    <button className="mtd__apvb cl" onClick={() => act('client')}>{TI.send} Send to client</button>
                  </div>
                )}
                {apv === 'pending' && !canReview && <p className="mtd__apvn">Rohit Shah and one other can approve this. You'll be notified.</p>}
                {apv === 'pending_client' && isClient && (
                  <div className="mtd__apva">
                    <button className="mtd__apvb ok" onClick={() => act('client_approve')}>{TI.ok} Approve</button>
                    <button className="mtd__apvb no" onClick={() => setSheet('reject')}>{TI.no} Request changes</button>
                  </div>
                )}
                {apv === 'pending_client' && !isClient && <p className="mtd__apvn">Sent to Nirmal Exports on 25 Jul. No reply yet.</p>}
              </div>
            )}
          </div>
        )}

        <div className="mtd__div" />
        <MSec label="DESCRIPTION" action={role !== 'client' && <button className="mtd__seca" onClick={() => setEdD(!edD)}>{TI.edit}</button>}>
          {edD
            ? <textarea className="mtd__di" autoFocus value={t.desc} rows={5} onChange={e => setT({ ...t, desc: e.target.value })} onBlur={() => setEdD(false)} />
            : <p className="mtd__d">{t.desc}</p>}
        </MSec>

        <div className="mtd__div" />
        <MSec label="ASSIGNEES">
          <div className="mtd__ass">
            {t.ass.map(a => <span key={a} className="mtd__assc"><AvT n={a} s={24} /><b>{a.split(' ')[0]}</b></span>)}
            {role !== 'client' && <button className="mtd__assadd" onClick={() => setSheet('ass')}>{TI.plus}</button>}
          </div>
        </MSec>

        <div className="mtd__div" />
        <MSec label={`SUBTASKS · ${done}/${t.subs.length}`}>
          <div className="mtd__prog"><i style={{ width: pct + '%' }} /></div>
          {t.subs.map((s, i) => (
            <div className="mtd__sub" key={i}>
              <button className={'mtd__cb' + (s.d ? ' on' : '')} onClick={() => { const n = [...t.subs]; n[i] = { ...s, d: !s.d }; setT({ ...t, subs: n }); }} disabled={isClient}>{s.d && TI.check}</button>
              <span className={'mtd__subt' + (s.d ? ' d' : '')}>{s.t}</span>
              {s.a && <AvT n={s.a} s={20} />}
              {role !== 'client' && <button className="mtd__subx" onClick={() => setT({ ...t, subs: t.subs.filter((_, j) => j !== i) })}>{TI.x}</button>}
            </div>
          ))}
          {role !== 'client' && (
            <div className="mtd__addrow">
              <input className="mtd__addi" placeholder="Add a subtask" value={nsub} onChange={e => setNsub(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSub()} />
              <button className="mtd__addb" onClick={addSub}>{TI.plus}</button>
            </div>
          )}
        </MSec>

        <div className="mtd__div" />
        <MSec label="FILES" action={role !== 'client' && <button className="mtd__seca">{TI.clip}</button>}>
          <div className="mtd__files">
            {t.files.map(f => <span key={f.n} className="mtd__file">{TI.doc}<b>{f.n}</b><i>{f.s}</i></span>)}
          </div>
        </MSec>

        {!isClient && <>
          <div className="mtd__div" />
          <MSec label="TIME">
            <div className="mtd__time">
              <span>{TI.clock}<b>{t.logged}</b><i>of {t.est} estimated</i></span>
              <button className="mtd__timeb">Start timer</button>
            </div>
          </MSec>
        </>}

        <div className="mtd__div" />
        <MSec label={`COMMENTS · ${t.cmts.length}`}>
          {t.cmts.map((c, i) => (
            <div key={i} className={'mtd__c' + (c.mine ? ' mine' : '')} onClick={() => c.mine && setSel(i)}>
              <AvT n={c.u} s={30} />
              <div className="mtd__cbub">
                {!c.mine && <b className="mtd__ca">{c.u}</b>}
                <p className="mtd__cbody">{c.b.split(/(@\w+)/).map((p, j) => p[0] === '@' ? <em key={j}>{p}</em> : p)}</p>
                <span className="mtd__ct">{c.pend ? 'Queued' : c.t}</span>
              </div>
            </div>
          ))}
        </MSec>
      </div>

      <div className="mtd__comp">
        {queued.length > 0 && <div className="mtd__qb">{queued.length} comment{queued.length > 1 ? 's' : ''} will send when you're back online</div>}
        <div className="mtd__comprow">
          <input className="mtd__compi" placeholder="Write a comment…" value={cmt} onChange={e => setCmt(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} />
          <button className="mtd__send" onClick={send} disabled={!cmt.trim()}>{TI.send}</button>
        </div>
      </div>

      {sheet === 'status' && <MSheet title="Status" onClose={() => setSheet(null)}>
        {STATUSES.map(([k, l]) => <button key={k} className="msheet__r" onClick={() => { setT({ ...t, status: k }); setSheet(null); }}>
          <i className="msheet__dot" style={{ background: SC[k] }} /><span>{l}</span>{t.status === k && <span style={{ color: 'var(--primary)' }}>{TI.check}</span>}
        </button>)}
      </MSheet>}

      {sheet === 'ass' && <MSheet title="Assignees" onClose={() => setSheet(null)}
        foot={<button className="msheet__done" onClick={() => setSheet(null)}>Done</button>}>
        {MEMBERS.map(m => {
          const on = t.ass.includes(m);
          return <button key={m} className="msheet__r" onClick={() => setT({ ...t, ass: on ? t.ass.filter(x => x !== m) : [...t.ass, m] })}>
            <AvT n={m} s={32} /><span style={{ flex: 1, textAlign: 'left' }}><b>{m}</b><i className="msheet__sub">{m.split(' ')[0].toLowerCase()}@aekam.co</i></span>
            <span className={'msheet__ck' + (on ? ' on' : '')}>{on && TI.check}</span>
          </button>;
        })}
      </MSheet>}

      {sheet === 'reject' && <MSheet onClose={() => setSheet(null)}>
        <div className="mtd__rej">
          <b>{isClient ? 'Request changes' : 'Reject this task'}</b>
          <span className="mtd__rejl">REASON — REQUIRED</span>
          <textarea className="mtd__reji" autoFocus rows={3} placeholder="What needs to change?" value={rej} onChange={e => setRej(e.target.value)} />
          <p className="mtd__rejn">Aanya Mehta will be notified with this reason.</p>
          <div className="mtd__reja">
            <button className="mbtn mbtn--out" onClick={() => setSheet(null)}>Cancel</button>
            <button className="mbtn mbtn--dgr" disabled={!rej.trim()} onClick={() => act(isClient ? 'client_reject' : 'reject', rej.trim())}>{isClient ? 'Request changes' : 'Reject'}</button>
          </div>
        </div>
      </MSheet>}

      {sheet === 'menu' && <MSheet onClose={() => setSheet(null)}>
        {[['Move to another board', TI.chevR], ['Duplicate task', TI.doc], ['Copy link', TI.clip]].map(([l, ic]) =>
          <button key={l} className="msheet__r" onClick={() => setSheet(null)}>{ic}<span>{l}</span></button>)}
        <button className="msheet__r dgr" onClick={() => setSheet(null)}>{TI.trash}<span>Delete task</span></button>
      </MSheet>}

      {sel !== null && <MSheet onClose={() => setSel(null)}>
        <button className="msheet__r" onClick={() => setSel(null)}>{TI.edit}<span>Edit comment</span></button>
        <button className="msheet__r dgr" onClick={() => { setT({ ...t, cmts: t.cmts.filter((_, j) => j !== sel) }); setSel(null); }}>{TI.trash}<span>Delete comment</span></button>
      </MSheet>}
    </>
  );
}

Object.assign(window, { MTaskDetail, MSheet, MSec, TI, AvT });
