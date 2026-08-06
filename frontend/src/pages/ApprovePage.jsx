/**
 * ApprovePage.jsx — public magic-link approval landing.
 * Route: /approve?token=<jwt> — NO <Protected> wrapper, NO session.
 *
 * This is a client's OWN customer, arriving from an email, usually on a phone,
 * with no account and no org branding loaded. Everything below therefore has to
 * stand up with nothing in localStorage and nothing in context.
 *
 * `/approve` is in PUBLIC_PATHS (lib/api.js), so a 401 here does not call
 * endSession() and does not redirect to /login. Nothing in this file may
 * reintroduce that: a visitor bounced to a login form they cannot satisfy has
 * lost the ability to approve the work.
 *
 * WHAT CHANGED, and why it was not cosmetic:
 *
 *   · 52 raw inline styles on the RETIRED token vocabulary (`--ink`, `--rule`,
 *     `--k-primary`, `.k-card`, `.k-btn`). SigningPage — the other public page,
 *     reached from the same kind of email — had already moved to the current
 *     one. The two disagreed about what a card, a rule and body text look like.
 *     Now both render `pub-*` from styles/public.css and the shared primitives.
 *
 *   · Loading, empty and ERROR were not three states. `.catch()` collapsed every
 *     failure into the single string "Invalid or expired approval link", so a
 *     dead network, a 500 and a genuinely expired token were reported
 *     identically — and the first two were reported as a LIE. A visitor on a
 *     train told their link is expired stops trying; the link is fine. errorKind()
 *     classifies the rejection and ErrorState names the one correct action.
 *
 *   · `approval.notes` was read from the top level of the response. The backend
 *     (approvals_router.py:548) returns `{task, already_decided, requester_name,
 *     requested_at}` with `approval_notes AS notes` INSIDE the task row, so the
 *     requester's note has never rendered. It is `task.notes`.
 *
 *   · An attachments block rendered `task.attachments`. That endpoint's SELECT
 *     (approvals_router.py:529-536) returns nine named columns and no
 *     attachments; the word does not appear anywhere in the router. The branch
 *     was dead and is gone rather than being restyled.
 *
 * The response is a BARE OBJECT, not `{"data": …}` — hence body(), not rows().
 */
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, body } from '../lib/api';
import { priorityColor } from '../lib/utils';
import { KLogo, KWordmark } from '../lib/brand';
import Button from '../components/ui/Button';
import { Card, CardHead, CardBody } from '../components/ui/Card';
import { ErrorState, errorKind } from '../components/ui/ErrorState';
import { SkeletonText } from '../components/ui/Skeleton';
import { Secondary } from '../components/Bilingual';

/**
 * Follow the OS theme for a visitor who has never expressed a preference.
 *
 * Identical to SigningPage's effect and for the identical reason: this viewer is
 * a stranger to the product with no stored prefs, so every token would resolve
 * to the light palette no matter what their machine asks for.
 *
 * The guard is `k_prefs`, NOT the presence of [data-theme]. index.html runs a
 * blocking bootstrap that ALWAYS stamps [data-theme] before paint (falling back
 * to 'light'), so testing the attribute would bail on every visitor and this
 * would never do anything. `k_prefs` is the key CustomizePanel.applyPrefs
 * writes, so its presence is the only honest signal a human chose a theme — a
 * signed-in user who opens an approval link keeps the one they picked, and a
 * stranger gets their OS setting.
 *
 * Restored rather than removed on unmount: the bootstrap's value is what the
 * rest of the app expects to find on <html> when this route is left.
 *
 * ACCENT, and why flipping the attribute alone was not enough:
 *
 * `applyPrefs` (CustomizePanel.jsx) writes FOUR theme-dependent accent tokens
 * as INLINE styles on <html> — `--primary`, `--primary-hover`, `--primary-text`
 * and `--on-primary` — choosing each by the theme it saw at the time. Its own
 * comment says it "must re-run on theme change, not only on preference change".
 * `DEFAULT_PREFS.mode` is `'light'` and index.html's bootstrap defaults to
 * `'light'` too, so for a stranger applyPrefs runs once with dark === false and
 * writes the LIGHT values. Flipping data-theme afterwards moved the surfaces to
 * the dark palette and left those four inline values behind — and an inline
 * style beats the `[data-theme="dark"]` block in kartavaya-design.css that
 * exists to correct exactly them.
 *
 * Measured on this page before the fix, on a dark-OS visitor:
 *   `by Aekam Inc`  #005650 on #0C0E11 → 2.25:1   (needs 4.5)
 *   `अनुमोदन`        #005650 on #12151A → 2.13:1   (needs 4.5)
 * The Devanagari half of the bilingual pair was effectively invisible on the
 * page a client's own customer uses to approve work.
 *
 * REMOVING them is the correct repair rather than recomputing them: this branch
 * is only ever reached when `k_prefs` is absent, i.e. the visitor has chosen no
 * accent, so there is no user preference to preserve and the stylesheet's own
 * per-theme values — which are the measured ones — are what should apply.
 */
const THEMED_ACCENT = ['--primary', '--primary-hover', '--primary-text', '--on-primary'];

function useOsThemeForStrangers() {
  useEffect(() => {
    const root = document.documentElement;
    let chosen = null;
    try { chosen = window.localStorage?.getItem('k_prefs'); } catch { chosen = null; }
    if (chosen) return undefined;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const prev = root.getAttribute('data-theme');
    // Captured so unmount can hand the app back exactly what it had.
    const prevAccent = THEMED_ACCENT.map((p) => [p, root.style.getPropertyValue(p)]);
    const apply = () => root.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
    apply();
    THEMED_ACCENT.forEach((p) => root.style.removeProperty(p));
    mq.addEventListener?.('change', apply);
    return () => {
      mq.removeEventListener?.('change', apply);
      prevAccent.forEach(([p, v]) => { if (v) root.style.setProperty(p, v); });
      if (prev === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', prev);
    };
  }, []);
}

const DATE = { day: 'numeric', month: 'short', year: 'numeric' };

/* Outcome art. Deliberately an inline SVG rather than the ✓ / ✕ text glyphs the
   previous version rendered at 48px: those are font-dependent, and on a phone
   without the expected face they fall back to a tofu box on the one screen that
   confirms a legal decision was recorded. */
const MARK = {
  approved: <path d="M4 10.5l4 4 8-9" />,
  rejected: <><path d="M5 5l10 10" /><path d="M15 5L5 15" /></>,
};

function Outcome({ kind }) {
  const approved = kind === 'approved';
  return (
    <Card className="pub__card">
      <CardBody>
        <div className="ap__outcome">
          {/* --c is a per-instance custom property feeding public.css, which is
              the one inline form this codebase allows (the Tag contract). */}
          <span className="ap__mark" style={{ '--c': approved ? 'var(--ok)' : 'var(--danger)' }} aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {MARK[approved ? 'approved' : 'rejected']}
            </svg>
          </span>
          <p className="ap__outcome-t">{approved ? 'Approved' : 'Rejected'}</p>
          <Secondary className="ap__outcome-hi" style={{ '--c': approved ? 'var(--ok)' : 'var(--on-surface-3)' }} as="p" value={approved ? 'स्वीकृत' : 'अस्वीकृत'} />
          <p className="pub__lede">
            {approved
              ? 'This task has been approved and moved to the queue. The requester has been notified.'
              : 'This request has been rejected. The requester has been notified.'}
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

export default function ApprovePage() {
  // loading | ready | deciding | approved | rejected | error
  const [state, setState] = useState('loading');
  const [approval, setApproval] = useState(null);
  const [errMsg, setErrMsg] = useState('');
  const [errKind, setErrKind] = useState('missing');
  const [rejectNote, setRejectNote] = useState('');
  const [showReject, setShowReject] = useState(false);

  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const action = searchParams.get('action'); // ?action=reject, straight from the email

  useOsThemeForStrangers();

  useEffect(() => {
    if (!token) {
      setState('error');
      setErrKind('missing');
      setErrMsg('This link is missing its approval token. Open the link from your email again.');
      return;
    }
    let live = true;
    api.get(`/approvals/by-token/${token}`)
      .then((r) => {
        if (!live) return;
        const d = body(r);
        setApproval(d);
        if (d.already_decided) {
          const s = d.task?.approval_status;
          setState(s === 'approved' ? 'approved' : s === 'rejected' ? 'rejected' : 'ready');
        } else {
          setState('ready');
          if (action === 'reject') setShowReject(true);
        }
      })
      .catch((e) => {
        if (!live) return;
        // Four kinds, not one string. A 404 is a dead link; no response at all is
        // the visitor's network and resolves by waiting. Telling them apart is
        // the difference between "give up" and "try again in a minute".
        setErrKind(errorKind(e));
        setErrMsg(e?.response?.data?.detail || '');
        setState('error');
      });
    return () => { live = false; };
  }, [token, action]);

  const decide = async (act, notes = '') => {
    setState('deciding');
    try {
      await api.post(`/approvals/by-token/${token}/${act}`, { notes });
      setState(act === 'approve' ? 'approved' : 'rejected');
    } catch (e) {
      setErrKind(errorKind(e));
      setErrMsg(e?.response?.data?.detail || '');
      setState('error');
    }
  };

  const task = approval?.task || {};
  const busy = state === 'deciding';

  return (
    <div className="pub">
      <header className="pub__brand">
        <KLogo size={36} />
        <div>
          <KWordmark />
          <p className="pub__kick">Approval request · <Secondary  value="अनुमोदन" /></p>
        </div>
      </header>

      <div className="pub__body">
        {/* ── Loading. A skeleton in the shape of the card that is coming, not a
            line of italic prose: the visitor should see the page arriving. ── */}
        {state === 'loading' && (
          <Card className="pub__card">
            <CardBody>
              <div className="pub__pad pub__stack" aria-busy="true" aria-label="Checking this approval link">
                <SkeletonText width="45%" height={11} />
                <SkeletonText width="80%" height={22} />
                <SkeletonText width="60%" height={12} />
                <SkeletonText width="100%" height={12} />
                <SkeletonText width="90%" height={12} />
              </div>
            </CardBody>
          </Card>
        )}

        {/* ── Error. Distinct from both loading and the decided outcomes. ── */}
        {state === 'error' && (
          <Card className="pub__card">
            <CardBody>
              <div className="pub__pad">
                <ErrorState kind={errKind} detail={errMsg || undefined} />
              </div>
            </CardBody>
          </Card>
        )}

        {/* ── Ready ── */}
        {(state === 'ready' || busy) && approval && (
          <Card className="pub__card">
            <CardHead title={task.title || 'Task approval'} sanskrit="अनुमोदन" />
            <CardBody>
              <div className="pub__stack">
                {approval.requester_name && (
                  <p className="ap__by">
                    Requested by <strong>{approval.requester_name}</strong>
                    {approval.requested_at
                      && ` · ${new Date(approval.requested_at).toLocaleDateString('en-IN', DATE)}`}
                  </p>
                )}

                {task.description && <p className="pub__lede">{task.description}</p>}

                {(task.priority || task.due_at) && (
                  <div className="ap__meta">
                    {task.priority && (
                      <span className="ap__fact">
                        <i className="ap__dot" style={{ '--c': priorityColor(task.priority) }} aria-hidden="true" />
                        <span className="ap__fact-l">Priority</span>
                        <span className="ap__prio" style={{ '--c': priorityColor(task.priority) }}>
                          {task.priority}
                        </span>
                      </span>
                    )}
                    {task.due_at && (
                      <span className="ap__fact">
                        <span className="ap__fact-l">Due</span>
                        <span className="ap__fact-v">
                          {new Date(task.due_at).toLocaleDateString('en-IN', DATE)}
                        </span>
                      </span>
                    )}
                  </div>
                )}

                {/* task.notes, not approval.notes — see the docblock. */}
                {task.notes && <p className="ap__note">{task.notes}</p>}

                {!showReject ? (
                  <div className="pub__actions">
                    <Button variant="fill" size="lg" loading={busy} onClick={() => decide('approve')}>
                      {busy ? 'Recording your approval…' : 'Approve'}
                    </Button>
                    <Button variant="danger" size="lg" disabled={busy} onClick={() => setShowReject(true)}>
                      Reject
                    </Button>
                  </div>
                ) : (
                  <div className="pub__stack">
                    <div className="fldx ap__reason">
                      <label className="fldx__lbl" htmlFor="ap-reason">
                        <span>Reason for rejection</span>
                      </label>
                      <textarea
                        id="ap-reason"
                        className="fldx__in"
                        rows={3}
                        value={rejectNote}
                        autoFocus
                        onChange={(e) => setRejectNote(e.target.value)}
                        placeholder="Tell them what needs to change…"
                      />
                    </div>
                    <div className="pub__actions">
                      <Button variant="out" size="lg" disabled={busy} onClick={() => setShowReject(false)}>
                        Back
                      </Button>
                      <Button
                        variant="dangerfill"
                        size="lg"
                        loading={busy}
                        disabled={!rejectNote.trim()}
                        onClick={() => rejectNote.trim() && decide('reject', rejectNote.trim())}
                      >
                        {busy ? 'Recording…' : 'Confirm rejection'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </CardBody>
          </Card>
        )}

        {(state === 'approved' || state === 'rejected') && <Outcome kind={state} />}
      </div>

      <p className="pub__foot">
        Kartavaya by Aekam Inc · <Secondary  value="कर्तव्य" />
      </p>
    </div>
  );
}
