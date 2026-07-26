/**
 * ApprovePage.jsx — public magic-link approval landing.
 * Route: /approve?token=<jwt>  — NO <Protected> wrapper.
 * Validates token, renders the editorial approval card, two big buttons.
 */
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { priorityColor } from '../lib/utils';

function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="8" fill="url(#kg)" />
        <defs>
          <linearGradient id="kg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop stopColor="#0082c6" /><stop offset="1" stopColor="#05b7aa" />
          </linearGradient>
        </defs>
        <text x="16" y="22" textAnchor="middle" fill="white" fontSize="16" fontWeight="700" fontFamily="var(--font-hindi)">क</text>
      </svg>
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 500, color: 'var(--ink)', letterSpacing: '-0.01em' }}>Kartavaya</div>
        <div style={{ fontFamily: 'var(--font-hindi)', fontSize: 12, color: 'var(--ink-3)' }}>कर्तव्य</div>
      </div>
    </div>
  );
}

export default function ApprovePage() {
  const [state,    setState]    = useState('loading'); // loading | ready | deciding | approved | rejected | error
  const [approval, setApproval] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [showReject, setShowReject] = useState(false);

  const [searchParams] = useSearchParams();
  const token  = searchParams.get('token');
  const action = searchParams.get('action'); // ?action=reject from email

  useEffect(() => {
    if (!token) { setState('error'); setErrorMsg('No approval token in URL.'); return; }
    api.get(`/approvals/by-token/${token}`)
      .then(r => {
        setApproval(r.data);
        if (r.data.already_decided) {
          const s = r.data.task?.approval_status;
          setState(s === 'approved' ? 'approved' : s === 'rejected' ? 'rejected' : 'ready');
        } else {
          setState('ready');
          if (action === 'reject') setShowReject(true);
        }
      })
      .catch(e => {
        const msg = e?.response?.data?.detail || 'Invalid or expired approval link.';
        setState('error'); setErrorMsg(msg);
      });
  }, [token, action]);

  const decide = async (act, notes = '') => {
    setState('deciding');
    try {
      await api.post(`/approvals/by-token/${token}/${act}`, { notes });
      setState(act === 'approve' ? 'approved' : 'rejected');
    } catch (e) {
      setErrorMsg(e?.response?.data?.detail || 'Action failed. Please try again.');
      setState('error');
    }
  };

  const task = approval?.task || {};

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '32px 16px',
      fontFamily: 'var(--font-ui)',
    }}>
      <div style={{ width: '100%', maxWidth: 540 }}>
        <Logo />

        {/* Loading */}
        {state === 'loading' && (
          <div style={{ textAlign: 'center', color: 'var(--ink-3)', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 18 }}>
            Verifying approval link…
          </div>
        )}

        {/* Error */}
        {state === 'error' && (
          <div className="k-card" style={{ textAlign: 'center', padding: '32px 28px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚠</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 500, color: 'var(--ink)', marginBottom: 8 }}>Link invalid</div>
            <div style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6 }}>{errorMsg}</div>
          </div>
        )}

        {/* Ready */}
        {(state === 'ready' || state === 'deciding') && approval && (
          <div className="k-card" style={{ padding: 0, overflow: 'hidden' }}>
            {/* Header */}
            <div style={{
              padding: '22px 28px 18px',
              borderBottom: '1px solid var(--rule)',
              background: 'radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--k-primary) 8%, transparent), transparent 50%), var(--surface)',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--k-primary)', marginBottom: 4 }}>
                APPROVAL REQUEST · <span style={{ fontFamily: 'var(--font-hindi)', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>अनुमोदन</span>
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2, marginBottom: 4 }}>
                {task.title || 'Task approval'}
              </div>
              {approval.requester_name && (
                <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                  Requested by <strong style={{ color: 'var(--ink-2)' }}>{approval.requester_name}</strong>
                  {approval.requested_at && <> · {new Date(approval.requested_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</>}
                </div>
              )}
            </div>

            {/* Task details */}
            <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--rule-soft)' }}>
              {task.description && (
                <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}>{task.description}</p>
              )}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {task.priority && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: priorityColor(task.priority), display: 'inline-block' }} />
                    <span style={{ color: 'var(--ink-3)' }}>Priority:</span>
                    <span style={{ color: priorityColor(task.priority), fontWeight: 600, textTransform: 'capitalize' }}>{task.priority}</span>
                  </div>
                )}
                {task.due_at && (
                  <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    Due: <strong style={{ color: 'var(--ink-2)' }}>{new Date(task.due_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</strong>
                  </div>
                )}
              </div>

              {/* Attachments (read-only) */}
              {(task.attachments || []).length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>Attachments</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {task.attachments.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-2)' }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M13 10l-5 5-5-5M8 15V1"/></svg>
                        <span>{f.name || f.url}</span>
                        {f.url && (
                          <a href={f.url} target="_blank" rel="noreferrer" style={{ color: 'var(--k-primary)', fontSize: 11, marginLeft: 'auto' }}>Download</a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {approval.notes && (
                <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--bg-soft)', borderRadius: 'var(--r-md)', borderLeft: '2px solid var(--k-primary)', fontSize: 13, color: 'var(--ink-2)', fontStyle: 'italic' }}>
                  {approval.notes}
                </div>
              )}
            </div>

            {/* Action buttons */}
            {!showReject ? (
              <div style={{ padding: '20px 28px', display: 'flex', gap: 12 }}>
                <button
                  className="k-btn k-btn--primary"
                  onClick={() => decide('approve')}
                  disabled={state === 'deciding'}
                  style={{ flex: 1, justifyContent: 'center', fontSize: 15, padding: '12px 0' }}
                >
                  {state === 'deciding' ? 'Processing…' : '✓ Approve'}
                </button>
                <button
                  className="k-btn k-btn--ghost"
                  onClick={() => setShowReject(true)}
                  disabled={state === 'deciding'}
                  style={{ flex: 1, justifyContent: 'center', fontSize: 15, padding: '12px 0', color: 'var(--k-danger)' }}
                >
                  ✕ Reject
                </button>
              </div>
            ) : (
              <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <textarea
                  value={rejectNote}
                  onChange={e => setRejectNote(e.target.value)}
                  placeholder="Reason for rejection (required)…"
                  rows={3}
                  style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid var(--rule)', borderRadius: 'var(--r-md)', fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    className="k-btn k-btn--ghost"
                    onClick={() => setShowReject(false)}
                    disabled={state === 'deciding'}
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    ← Back
                  </button>
                  <button
                    className="k-btn k-btn--ghost"
                    onClick={() => rejectNote.trim() && decide('reject', rejectNote.trim())}
                    disabled={state === 'deciding' || !rejectNote.trim()}
                    style={{ flex: 2, justifyContent: 'center', fontSize: 15, padding: '12px 0', color: 'var(--k-danger)', borderColor: 'var(--k-danger)' }}
                  >
                    {state === 'deciding' ? 'Processing…' : '✕ Confirm Reject'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Approved */}
        {state === 'approved' && (
          <div className="k-card" style={{ textAlign: 'center', padding: '40px 28px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 500, color: 'var(--ink)', marginBottom: 8 }}>Approved</div>
            <div style={{ fontFamily: 'var(--font-hindi)', fontSize: 18, color: 'var(--k-primary)', marginBottom: 16 }}>स्वीकृत</div>
            <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6 }}>
              The task has been approved and moved to the queue.<br />The requester has been notified.
            </p>
          </div>
        )}

        {/* Rejected */}
        {state === 'rejected' && (
          <div className="k-card" style={{ textAlign: 'center', padding: '40px 28px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✕</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 500, color: 'var(--ink)', marginBottom: 8 }}>Rejected</div>
            <div style={{ fontFamily: 'var(--font-hindi)', fontSize: 18, color: 'var(--ink-3)', marginBottom: 16 }}>अस्वीकृत</div>
            <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6 }}>
              The request has been rejected.<br />The requester has been notified.
            </p>
          </div>
        )}

        <div style={{ marginTop: 24, textAlign: 'center', fontSize: 11, color: 'var(--ink-faint)' }}>
          Kartavaya by Aekam Inc · <span style={{ fontFamily: 'var(--font-hindi)' }}>कर्तव्य</span>
        </div>
      </div>
    </div>
  );
}
