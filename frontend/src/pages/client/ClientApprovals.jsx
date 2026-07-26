/**
 * ClientApprovals — the one screen that matters.
 *
 * Everything else in the portal is reference. This is the screen it exists for,
 * and its two rules from `19-client-portal.md` are behavioural, not cosmetic:
 *
 *   · **Approve is one click with no confirm.** The client already read the
 *     thing. A confirm dialog on a positive action teaches them to click through
 *     dialogs, which is exactly the habit you do not want when a destructive one
 *     appears.
 *   · **Request changes requires a note.** Submit stays disabled until there is
 *     text, and the disabled button says why. A bare rejection sends the firm
 *     back to a client conversation to ask what was wrong — which is the work
 *     the portal was supposed to remove.
 *
 * Both actions produce a written record with a timestamp in the client's own
 * view, not just a toast: six weeks later the question is "did I approve that?"
 * and a toast that dismissed itself in four seconds is not an answer. The
 * outcome region is `aria-live="polite"` so it is announced as well as shown.
 *
 * ── The endpoints
 *
 * 19 says "The two POSTs are new" and names them
 * `/api/client/approvals/:id/approve` and `.../request-changes`. They are not
 * new. `backend/approvals_router.py` already carries both, under different
 * paths and with the required-note rule already enforced server-side:
 *
 *   POST /tasks/{task_id}/client-approve   { notes? }   (approvals_router.py:395)
 *   POST /tasks/{task_id}/client-reject    { notes }    (approvals_router.py:605)
 *                                          → 400 "Rejection reason is required"
 *
 * Both write the decision to the task, notify the requester, and fan out to the
 * project. Standing up two more endpoints beside them would be a second way to
 * approve the same thing.
 */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { Button, EmptyState, useToast } from '../../components/ui';
import { relTime } from '../../lib/utils';
import { previewKind, stampLabel } from './clientShape';

function Preview({ file }) {
  const kind = previewKind(file.name, file.url);
  if (kind === 'image') {
    return <img className="cl-prev__img" src={file.url} alt={file.name} loading="lazy" />;
  }
  if (kind === 'pdf') {
    // The frame plus a link, not the frame alone. The URL is a signed R2 object
    // and the storage host decides whether it renders inline or downloads; when
    // it chooses the latter the frame paints nothing, and a client staring at a
    // blank rectangle has no way to read the thing they are approving.
    return (
      <>
        <iframe className="cl-prev__pdf" src={file.url} title={file.name} />
        <a className="cl-file__dl" href={file.url} target="_blank" rel="noreferrer noopener">
          Open {file.name}
        </a>
      </>
    );
  }
  return (
    <a className="cl-file__dl" href={file.url} target="_blank" rel="noreferrer noopener">
      {file.name}
    </a>
  );
}

/**
 * `outcome` is owned by the parent, not by the card.
 *
 * Deciding triggers a refresh, and a refresh drops the item from the pending
 * queue — which is correct, and which would also unmount the card and take the
 * written record with it. Holding the outcome one level up keeps the card and
 * its timestamp on screen until the client navigates away, which is the whole
 * point of writing it down.
 */
function ApprovalCard({ item, outcome, onDecide }) {
  const { pushToast } = useToast();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const noteEmpty = note.trim().length === 0;
  const noteId = `cl-note-${item.taskId}`;
  const whyId = `cl-why-${item.taskId}`;

  async function approve() {
    setBusy(true);
    try {
      await api.post(`/tasks/${item.taskId}/client-approve`, { notes: null });
      onDecide(item, { kind: 'approved', at: new Date().toISOString() });
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not record your approval', message: 'Please try again.' });
      setBusy(false);
    }
  }

  async function requestChanges() {
    if (noteEmpty) return;
    setBusy(true);
    try {
      await api.post(`/tasks/${item.taskId}/client-reject`, { notes: note.trim() });
      onDecide(item, { kind: 'changes', at: new Date().toISOString(), note: note.trim() });
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not send your note', message: 'Please try again.' });
      setBusy(false);
    }
  }

  return (
    <article className="cl-appr">
      <h3 className="cl-appr__t">{item.title}</h3>
      <p className="cl-appr__who">
        {item.requestedBy || 'Your team'}
        {item.requestedAt && ` · ${relTime(item.requestedAt)}`}
      </p>

      {item.ask && <blockquote className="cl-appr__ask">{item.ask}</blockquote>}

      {item.files.length > 0 && (
        <div className="cl-prev">
          {item.files.map(f => <Preview key={f.url} file={f} />)}
        </div>
      )}

      {/* The written record. Rendered in place of the actions once a decision
          exists, because the decision is the answer to the only question the
          card was asking. */}
      <div aria-live="polite">
        {outcome?.kind === 'approved' && (
          <p className="cl-out cl-out--ok">
            You approved this.
            <span className="cl-out__w">{stampLabel(outcome.at)}</span>
          </p>
        )}
        {outcome?.kind === 'changes' && (
          <p className="cl-out cl-out--chg">
            You asked for changes.
            <span className="cl-out__w">{stampLabel(outcome.at)}</span>
          </p>
        )}
      </div>

      {!outcome && !asking && (
        <div className="cl-appr__act">
          <Button variant="fill" onClick={approve} disabled={busy}>Approve</Button>
          <Button variant="out" onClick={() => setAsking(true)} disabled={busy}>Request changes</Button>
        </div>
      )}

      {!outcome && asking && (
        <div className="cl-ask">
          <div className="fld">
            <label className="fld__l" htmlFor={noteId}>What needs to change?</label>
            <textarea
              id={noteId}
              className="cl-note"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Tell them what to fix, in your own words."
              aria-describedby={noteEmpty ? whyId : undefined}
            />
            {/* The disabled button says why. An inert control with no
                explanation is the reason a client picks up the phone instead. */}
            {noteEmpty && (
              <p className="cl-why" id={whyId}>
                Add a note first — the team needs to know what to change.
              </p>
            )}
          </div>
          <div className="cl-appr__act">
            <Button variant="fill" onClick={requestChanges} disabled={busy || noteEmpty}>
              Send
            </Button>
            <Button variant="ghost" onClick={() => { setAsking(false); setNote(''); }} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * Decisions already made, read back from the task list. The in-card record above
 * survives only until the page reloads; this is where the six-weeks-later
 * question is actually answered.
 */
function DecisionLog({ tasks }) {
  const decided = tasks.filter(t => t.decision).slice(0, 20);
  if (!decided.length) return null;
  return (
    <section className="cl-sec">
      <header className="cl-sec__h">
        <h2 className="cl-sec__t">Your decisions</h2>
        <span className="cl-sec__hi" lang="hi">आपके निर्णय</span>
      </header>
      <ul className="cl-list" aria-label="Your decisions">
        {decided.map(t => (
          <li key={t.taskId} className="cl-item">
            <div className="cl-item__b">
              <div className="cl-item__t">{t.title}</div>
              <div className="cl-item__m">
                <span className="cl-item__id">{t.ref}</span>
                <span className="cl-item__sep">·</span>
                <span>
                  {t.decision.outcome === 'approved' ? 'You approved' : 'You asked for changes'}
                  {t.decision.at ? ` · ${stampLabel(t.decision.at)}` : ''}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ClientApprovals({ approvals, tasks, onDecided }) {
  // taskId → { item, outcome }. Cards decided in this session stay mounted with
  // their record even after the refresh has removed them from the queue.
  const [held, setHeld] = useState({});

  function decide(item, outcome) {
    setHeld(prev => ({ ...prev, [item.taskId]: { item, outcome } }));
    onDecided?.();
  }

  const pending = approvals.filter(a => !held[a.taskId]);
  // Sorted the same way `toClientApprovals` sorts, so a card that has just been
  // decided keeps its slot instead of jumping to the bottom when the refresh
  // removes it from the queue underneath it.
  const queue = [...pending, ...Object.values(held).map(h => h.item)]
    .sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0));

  return (
    <>
      <section className="cl-sec">
        <header className="cl-sec__h">
          <h2 className="cl-sec__t">Needs your approval</h2>
          <span className="cl-sec__hi" lang="hi">आपकी स्वीकृति</span>
          {pending.length > 0 && <span className="cl-sec__n">{pending.length}</span>}
        </header>

        {queue.length === 0 ? (
          // A real answer, not a blank panel — and a finished queue is not the
          // same state as an empty one, which is what `tone="ok"` carries.
          <EmptyState
            icon="check"
            tone="ok"
            title={{ en: 'Nothing needs your approval', hi: 'कुछ भी लंबित नहीं' }}
            description="When your team sends something for you to sign off, it appears here."
          />
        ) : (
          queue.map(item => (
            <ApprovalCard
              key={item.taskId}
              item={item}
              outcome={held[item.taskId]?.outcome || null}
              onDecide={decide}
            />
          ))
        )}
      </section>

      {/* Decisions from earlier sessions, read back from the task list. The
          in-card record above lives for one visit; this one survives a reload,
          which is the form the six-weeks-later question actually takes. */}
      <DecisionLog tasks={tasks.filter(t => !held[t.taskId])} />
    </>
  );
}
