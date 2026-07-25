// Kartavya transactional email designs (5) + /approve landing screen.
// All rendered inside DCArtboards in Email System.html.

function EmailShell({ children, kicker, h1, hi }) {
  return (
    <div className="em">
      <div className="em__envelope">
        <div className="em__brand">
          <div>
            <span className="em__brand-main">Kartavya</span>{' '}
            <span className="em__brand-hi">कर्तव्य</span>
          </div>
          <span className="em__brand-tag">By Aekam Inc</span>
        </div>
        {kicker && <div className="em__kicker">{kicker}</div>}
        {h1 && <h1 className="em__h1">{h1}</h1>}
        {hi && <div className="em__h1-sans">{hi}</div>}
        {children}
        <div className="em__foot">
          <div className="em__foot-row">
            <div>
              Kartavya — <em>do what must be done.</em><br/>
              Aekam Inc · Ahmedabad, IN
            </div>
            <div style={{textAlign:'right'}}>
              <a href="#">Open app</a> · <a href="#">Settings</a> · <a href="#">Unsubscribe</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Av({ name, color }) {
  const init = name.split(' ').map(s=>s[0]).slice(0,2).join('');
  return <div className="em__av" style={color ? { background: color } : null}>{init}</div>;
}

// ── 1. INVITE ──────────────────────────────────────────────────────
function EmailInvite() {
  return (
    <EmailShell
      kicker="YOU'RE INVITED"
      h1="Keval invited you to Aekam Workspace."
      hi="आपका स्वागत है"
    >
      <p className="em__lede">
        Hi Aanya, <b>Keval Shah</b> has invited you to collaborate on
        Kartavya — the task workspace where Aekam's team plans projects,
        files GST returns, and ships client work.
      </p>

      <div className="em__card">
        <div className="em__row">
          <span className="em__row-k">Workspace</span>
          <span className="em__row-v">Aekam Inc<span className="em__row-v-sans">मुख्य कार्यस्थल</span></span>
        </div>
        <div className="em__row">
          <span className="em__row-k">Invited by</span>
          <span className="em__row-v">Keval Shah · Admin</span>
        </div>
        <div className="em__row">
          <span className="em__row-k">Your role</span>
          <span className="em__row-v">Member</span>
        </div>
        <div className="em__row">
          <span className="em__row-k">Expires</span>
          <span className="em__row-v">May 21, 2026</span>
        </div>
      </div>

      <div className="em__cta-row">
        <a className="em__btn em__btn--primary" href="#">Accept invite</a>
        <a className="em__btn em__btn--ghost" href="#">View workspace</a>
      </div>

      <p className="em__small">
        The invite link expires in 7 days. If you weren't expecting this
        email, you can safely ignore it.
      </p>
    </EmailShell>
  );
}

// ── 2. WELCOME ─────────────────────────────────────────────────────
function EmailWelcome() {
  return (
    <EmailShell
      kicker="WELCOME ABOARD"
      h1="Glad to have you, Aanya."
      hi="कर्तव्य में आपका स्वागत है"
    >
      <p className="em__lede">
        Your account is live. Here's the shortest path to doing
        <em> what must be done</em> on day one.
      </p>

      <ol className="em__steps">
        <li className="em__step">
          <div className="em__step-num">१</div>
          <div>
            <div className="em__step-title">Open today's dashboard</div>
            <div className="em__step-body">See what's due, what's overdue, and what your team is working on right now.</div>
          </div>
        </li>
        <li className="em__step">
          <div className="em__step-num">२</div>
          <div>
            <div className="em__step-title">Browse projects</div>
            <div className="em__step-body">See every active engagement — internal work, client deliverables, deadlines, and progress at a glance.</div>
          </div>
        </li>
        <li className="em__step">
          <div className="em__step-num">३</div>
          <div>
            <div className="em__step-title">Create your first task</div>
            <div className="em__step-body">Hit the “+ New task” button in the top bar from any screen. Assign it, set a priority, add a due date.</div>
          </div>
        </li>
        <li className="em__step">
          <div className="em__step-num">४</div>
          <div>
            <div className="em__step-title">Enable notifications</div>
            <div className="em__step-body">Get pinged for mentions, assignments, and approvals. Configure in Settings → Notifications.</div>
          </div>
        </li>
      </ol>

      <div className="em__cta-row">
        <a className="em__btn em__btn--primary" href="#">Open Kartavya</a>
        <a className="em__btn em__btn--ghost" href="#">Read the quickstart</a>
      </div>

      <div className="em__cite">
        कर्तव्ये अधिकारस्ते मा फलेषु कदाचन।
        <span className="em__cite-src">Bhagavad Gita 2.47 — do your duty; don't fixate on the fruit.</span>
      </div>
    </EmailShell>
  );
}

// ── 3. APPROVAL REQUEST (to admin) ─────────────────────────────────
function EmailApprovalRequest() {
  return (
    <EmailShell
      kicker="APPROVAL NEEDED"
      h1="Tata Steel requested a new task."
      hi="अनुमोदन हेतु अनुरोध"
    >
      <div className="em__person">
        <Av name="Arjun Rao" color="#6366f1" />
        <div>
          <div className="em__person-name">Arjun Rao · Tata Steel</div>
          <div className="em__person-role">Client · submitted 12 minutes ago</div>
        </div>
        <span className="em__pill em__pill--requested" style={{marginLeft:'auto'}}>Requested</span>
      </div>

      <div className="em__card">
        <div className="em__row">
          <span className="em__row-k">Project</span>
          <span className="em__row-v">Mumbai client review<span className="em__row-v-sans">समीक्षा</span></span>
        </div>
        <div className="em__row">
          <span className="em__row-k">Title</span>
          <span className="em__row-v" style={{maxWidth:'58%'}}>Update invoice template — add CGST/SGST split</span>
        </div>
        <div className="em__row">
          <span className="em__row-k">Priority</span>
          <span className="em__row-v">High</span>
        </div>
        <div className="em__row">
          <span className="em__row-k">Needed by</span>
          <span className="em__row-v">May 22, 2026</span>
        </div>
      </div>

      <p style={{color:'var(--ink-2)', fontSize:14.5, lineHeight:1.6}}>
        <b>Note from Arjun:</b> "The CA flagged this in last month's review —
        please prioritise so we can file by month-end."
      </p>

      <div className="em__bigcta">
        <div className="em__bigcta-q">Move this into the team's queue?</div>
        <div className="em__cta-row" style={{margin:0}}>
          <a className="em__btn em__btn--approve" href="#">Approve & queue</a>
          <a className="em__btn em__btn--reject" href="#">Decline with reason</a>
        </div>
      </div>

      <p className="em__small">
        Approving moves this task to <b>To do</b> on the Mumbai client review
        board and notifies the assignees. Arjun gets an email either way.
      </p>
      <p className="em__small">
        Prefer the full context? <a href="#" style={{color:'var(--k-deep)'}}>Open in Kartavya</a>.
      </p>
    </EmailShell>
  );
}

// ── 4. APPROVED (to client) ────────────────────────────────────────
function EmailApproved() {
  return (
    <EmailShell
      kicker="REQUEST APPROVED"
      h1="Your request is in the queue."
      hi="अनुमोदन प्राप्त हुआ"
    >
      <p className="em__lede">
        Hi Arjun — <b>Keval Shah</b> approved your request. The team has
        picked it up and you'll see status updates in the Kartavya portal.
      </p>

      <div className="em__card">
        <div className="em__row">
          <span className="em__row-k">Task</span>
          <span className="em__row-v" style={{maxWidth:'58%'}}>Update invoice template — add CGST/SGST split</span>
        </div>
        <div className="em__row">
          <span className="em__row-k">Project</span>
          <span className="em__row-v">Mumbai client review<span className="em__row-v-sans">समीक्षा</span></span>
        </div>
        <div className="em__row">
          <span className="em__row-k">Status</span>
          <span className="em__row-v"><span className="em__pill em__pill--approved">To do</span></span>
        </div>
        <div className="em__row">
          <span className="em__row-k">Assigned to</span>
          <span className="em__row-v">Keval Shah, Vikram Joshi</span>
        </div>
        <div className="em__row">
          <span className="em__row-k">Target date</span>
          <span className="em__row-v">May 22, 2026</span>
        </div>
      </div>

      <p style={{color:'var(--ink-2)', fontSize:14.5}}>
        <b>What happens next:</b> work starts within one business day. You'll
        get another email when it's marked complete and ready for your review.
      </p>

      <div className="em__cta-row">
        <a className="em__btn em__btn--primary" href="#">View task</a>
        <a className="em__btn em__btn--ghost" href="#">Open portal</a>
      </div>
    </EmailShell>
  );
}

// ── 5. TASK DONE ───────────────────────────────────────────────────
function EmailTaskDone() {
  return (
    <EmailShell
      kicker="WORK COMPLETED"
      h1="Done — ready for your review."
      hi="कार्य सम्पन्न"
    >
      <p className="em__lede">
        Hi Arjun, <b>Vikram Joshi</b> just marked your task complete. Please
        take a look when you have a moment and approve, or send it back with
        notes.
      </p>

      <div className="em__card">
        <div className="em__row">
          <span className="em__row-k">Task</span>
          <span className="em__row-v" style={{maxWidth:'58%'}}>Update invoice template — add CGST/SGST split</span>
        </div>
        <div className="em__row">
          <span className="em__row-k">Project</span>
          <span className="em__row-v">Mumbai client review</span>
        </div>
        <div className="em__row">
          <span className="em__row-k">Status</span>
          <span className="em__row-v"><span className="em__pill em__pill--done">Done</span></span>
        </div>
        <div className="em__row">
          <span className="em__row-k">Completed by</span>
          <span className="em__row-v">Vikram Joshi</span>
        </div>
        <div className="em__row">
          <span className="em__row-k">Time spent</span>
          <span className="em__row-v">3h 20m across 2 sessions</span>
        </div>
      </div>

      <p style={{color:'var(--ink-2)', fontSize:14.5}}>
        <b>Vikram's note:</b> "Added the CGST/SGST split and tested with three
        sample invoices. Reconciled against last quarter's filing. See KAR-502
        for the final PDF."
      </p>

      <div className="em__bigcta">
        <div className="em__bigcta-q">Looks good?</div>
        <div className="em__cta-row" style={{margin:0}}>
          <a className="em__btn em__btn--approve" href="#">Approve & close</a>
          <a className="em__btn em__btn--ghost" href="#">Send back with notes</a>
        </div>
      </div>

      <p className="em__small">
        Two files attached to the task:{' '}
        <code>Invoice_v3.pdf</code>, <code>Reconciliation_Apr.xlsx</code>.
        Open the task to download.
      </p>
    </EmailShell>
  );
}

// ── /approve landing screen ────────────────────────────────────────
function ApproveScreen() {
  return (
    <div className="ap">
      <div className="ap__topbar">
        <div className="ap__brand">
          <span className="ap__brand-main">Kartavya</span>
          <span className="ap__brand-hi">कर्तव्य</span>
          <span className="ap__brand-sub">by Aekam Inc</span>
        </div>
        <div className="ap__topright">
          Signed in as <b>Keval Shah</b> · <a href="#" style={{color:'var(--k-deep)', textDecoration:'none'}}>Open dashboard</a>
        </div>
      </div>

      <div className="ap__main">
        <div className="ap__left">
          <div>
            <div className="ap__kicker">APPROVAL REQUEST</div>
            <h1 className="ap__h1">Tata Steel needs your sign-off.</h1>
            <div className="ap__h1-sans">अनुमोदन की प्रतीक्षा</div>
            <p className="ap__lede">
              Arjun Rao submitted a new task request on the Mumbai client
              review project. Approve to drop it into the team's queue, or
              decline with a reason — <em>either way</em> he gets notified.
            </p>
          </div>

          <div className="ap__card">
            <div className="ap__card-h">
              <h3>Request details</h3>
              <span className="sans">अनुरोध विवरण</span>
              <span className="ap__id">REQ-218 · KAR-pending</span>
            </div>

            <div className="ap__taskttl">
              Update invoice template — add CGST/SGST split
            </div>

            <div className="ap__props">
              <div>
                <div className="ap__prop-k">Project</div>
                <div className="ap__prop-v">
                  <i style={{width:8,height:8,background:'#ec4899',borderRadius:2,display:'inline-block'}}/>
                  Mumbai client review
                  <span className="ap__prop-v-sans">समीक्षा</span>
                </div>
              </div>
              <div>
                <div className="ap__prop-k">Priority</div>
                <div className="ap__prop-v">
                  <i style={{width:8,height:8,background:'#B06A00',borderRadius:'50%',display:'inline-block'}}/>
                  High
                </div>
              </div>
              <div>
                <div className="ap__prop-k">Requested by</div>
                <div className="ap__prop-v">Arjun Rao · Tata Steel</div>
              </div>
              <div>
                <div className="ap__prop-k">Submitted</div>
                <div className="ap__prop-v">12 minutes ago</div>
              </div>
              <div>
                <div className="ap__prop-k">Target date</div>
                <div className="ap__prop-v">May 22, 2026</div>
              </div>
              <div>
                <div className="ap__prop-k">Suggested assignee</div>
                <div className="ap__prop-v">Vikram Joshi</div>
              </div>
            </div>

            <div className="ap__desc">
              <b>Description.</b> The CA flagged this in last month's review —
              the current invoice template prints a single GST line. We need
              separate CGST and SGST lines so we can reconcile correctly with
              March's input tax credit and file GSTR-1 cleanly by month-end.
            </div>
            <div className="ap__desc" style={{marginTop:10}}>
              <b>Notes from Arjun.</b> Same fix should apply to the Saraswati
              Co. template if you have bandwidth — happy to open a second
              request if cleaner.
            </div>
          </div>
        </div>

        <div className="ap__right">
          <div className="ap__action">
            <div className="ap__action-q">Approve this request?</div>
            <div className="ap__action-sans">क्या आप अनुमोदन करते हैं?</div>
            <div className="ap__action-help">
              Approving moves the task to <b>To do</b> on Mumbai client review,
              notifies Vikram and the project owners, and emails Arjun a
              confirmation.
            </div>

            <button className="ap__bigbtn ap__bigbtn--approve">
              Approve and queue task
            </button>
            <button className="ap__bigbtn ap__bigbtn--reject">
              Decline with reason…
            </button>
          </div>

          <div className="ap__meta">
            <div className="ap__meta-row"><b>Link token</b><code style={{fontFamily:'var(--font-mono)',fontSize:11}}>tok_4f9…a82c</code></div>
            <div className="ap__meta-row"><b>Single-use</b>expires in 6 days</div>
            <div className="ap__meta-row"><b>Approver</b>Keval Shah · admin</div>
            <div className="ap__meta-row"><b>Source</b>email to keval@aekaminc.com</div>
            <div style={{marginTop:10,fontSize:12,color:'var(--ink-faint)'}}>
              This link verifies your identity from the email it was sent to.
              No password needed.
            </div>
          </div>
        </div>
      </div>

      <div className="ap__foot">
        <div>Kartavya — कर्तव्य · do what must be done.</div>
        <div><a href="#">Open in app</a> · <a href="#">Help</a> · <a href="#">Report a problem</a></div>
      </div>
    </div>
  );
}

// Export to window so the canvas script can pick them up
Object.assign(window, {
  EmailInvite, EmailWelcome, EmailApprovalRequest,
  EmailApproved, EmailTaskDone, ApproveScreen,
});
