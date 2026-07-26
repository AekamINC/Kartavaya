/**
 * SigningPage.jsx — public signer view. Route: /sign/:token, NO <Protected>.
 *
 * `13-module-pages.md` calls this "public signer view — unauthenticated, needs
 * its own minimal chrome", and `_REQUEST-2026-07-26.md` §4.1 confirms it has no
 * handover file of its own and "genuinely does inherit from `02`". So the
 * chrome below is `02-common-components.md` §1 verbatim — `.card`, `.btn`,
 * `.inp`, `.fld`, `.chip` — rather than a private set of inline styles that
 * happen to reference the same tokens. A hand-rolled button that reads the
 * right variables still gets the wrong padding, the wrong weight, no
 * `:active` scale and no hover, and this page is the commercial face of the
 * e-sign product: it is what a client's client sees.
 *
 * The brand mark is `lib/brand.jsx`'s KLogo + KWordmark, the same pair the
 * marketing nav and footer use. Its sub-line already reads "by Aekam Inc".
 */
import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { KLogo, KWordmark } from '../lib/brand';

const API = `${import.meta.env.VITE_BACKEND_URL}/api`;

const ax = axios.create({ baseURL: API });

/* The signature canvas is the one place on this page that is NOT theme-aware,
   and deliberately so. `toDataURL` ships these exact pixels into the signed
   PDF, which is rendered on white paper by every viewer that opens it — ink
   drawn in a dark-theme foreground would arrive as a near-white smudge on a
   white page, i.e. an invisible signature on a legal document. So the drawing
   area is pinned to the LIGHT palette's values in both themes: it is paper,
   not chrome. The literals below are `--s-lowest` and `--on-surface` as the
   light theme declares them, copied rather than referenced because a canvas
   2D context cannot read a CSS custom property.
   The typed-signature path has no such constraint — it submits a string, not
   an image — so its preview is fully tokenised. */
const PAPER = '#FFFEFB';
const INK   = '#1B1D1A';

export default function SigningPage() {
  const { token } = useParams();
  const [step, setStep] = useState('loading');
  const [data, setData] = useState(null);
  const [otp, setOtp] = useState('');
  const [sigType, setSigType] = useState('type');
  const [typedName, setTypedName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);

  /* This page's viewer is a stranger to the product: a client's client, with no
     session and no stored prefs, so nothing here has ever expressed a theme
     preference and every token would resolve to the light palette regardless of
     what their machine asks for. Follow the OS instead.

     The guard is `k_prefs`, NOT the presence of [data-theme]. index.html runs a
     blocking bootstrap that ALWAYS stamps [data-theme] on <html> before paint —
     it falls back to 'light' when there are no stored prefs — so testing the
     attribute would bail on every single visitor and this effect would never do
     anything at all. `k_prefs` is the key CustomizePanel.applyPrefs writes, so
     its presence is the only honest signal that a human chose a theme: a
     signed-in user who opens a signing link keeps the one they picked, and a
     stranger gets their OS setting.

     Restored rather than removed on unmount — the bootstrap's value is what the
     rest of the app expects to find on <html> when this route is left. */
  useEffect(() => {
    const root = document.documentElement;
    let chosen = null;
    try { chosen = window.localStorage?.getItem('k_prefs'); } catch { chosen = null; }
    if (chosen) return undefined;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const prev = root.getAttribute('data-theme');
    const apply = () => root.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
    apply();
    mq.addEventListener?.('change', apply);
    return () => {
      mq.removeEventListener?.('change', apply);
      if (prev === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', prev);
    };
  }, []);

  useEffect(() => {
    ax.get(`/v1/esign/verify/${token}`)
      .then(r => {
        if (r.data.status === 'already_signed') {
          setStep('already_signed');
          setResult(r.data);
        } else {
          setData(r.data);
          setStep(r.data.otp_required ? 'otp_send' : 'sign');
        }
      })
      .catch(e => {
        const msg = e.response?.data?.detail || 'Invalid or expired signing link.';
        setError(msg);
        setStep('error');
      });
  }, [token]);

  const sendOtp = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await ax.post(`/v1/esign/verify/${token}/otp/send`);
      setData(d => ({ ...d, maskedEmail: r.data.email }));
      setStep('otp_verify');
    } catch (e) { setError(e.response?.data?.detail || 'Failed to send OTP'); }
    finally { setBusy(false); }
  };

  const verifyOtp = async () => {
    if (otp.length !== 6) { setError('Enter the 6-digit code'); return; }
    setBusy(true);
    setError('');
    try {
      await ax.post(`/v1/esign/verify/${token}/otp/verify`, { otp });
      setStep('sign');
    } catch (e) { setError(e.response?.data?.detail || 'Invalid OTP'); }
    finally { setBusy(false); }
  };

  const submitSignature = async () => {
    let sigData = '';
    if (sigType === 'type') {
      if (!typedName.trim()) { setError('Type your name to sign'); return; }
      sigData = typedName.trim();
    } else if (sigType === 'draw') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      sigData = canvas.toDataURL('image/png');
    }
    setBusy(true);
    setError('');
    try {
      const r = await ax.post(`/v1/esign/verify/${token}/sign`, {
        signature_data: sigData, signature_type: sigType,
      });
      setResult(r.data);
      setStep('done');
    } catch (e) { setError(e.response?.data?.detail || 'Failed to submit signature'); }
    finally { setBusy(false); }
  };

  const decline = async () => {
    if (!confirm('Are you sure you want to decline signing this document?')) return;
    setBusy(true);
    try {
      await ax.post(`/v1/esign/verify/${token}/decline`, { reason: 'Declined by signer' });
      setStep('declined');
    } catch (e) { setError(e.response?.data?.detail || 'Failed to decline'); }
    finally { setBusy(false); }
  };

  const initCanvas = (canvas) => {
    if (!canvas) return;
    canvasRef.current = canvas;
    const ctx = canvas.getContext('2d');
    // Paint the paper in, rather than leaving the canvas transparent: a
    // transparent PNG dropped onto a dark viewer background hides the ink just
    // as effectively as light ink would. See PAPER/INK above.
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const touch = e.touches?.[0];
      const x = (touch?.clientX || e.clientX) - rect.left;
      const y = (touch?.clientY || e.clientY) - rect.top;
      return [x * (canvas.width / rect.width), y * (canvas.height / rect.height)];
    };

    const start = (e) => { e.preventDefault(); drawingRef.current = true; ctx.beginPath(); ctx.moveTo(...getPos(e)); };
    const move = (e) => { if (!drawingRef.current) return; e.preventDefault(); ctx.lineTo(...getPos(e)); ctx.stroke(); };
    const end = () => { drawingRef.current = false; };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    // Repaint the paper, not clearRect — clearing back to transparent would
    // undo the fill laid down in initCanvas and reintroduce the invisible-ink
    // problem for anyone who draws, clears, and draws again.
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const box = {
    maxWidth: 560, margin: '0 auto', padding: 'var(--sp-7) var(--sp-6)',
    fontFamily: 'var(--font-ui)',
  };
  const card = {
    background: 'var(--surface)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-7)',
    border: '1px solid var(--outline-variant)', boxShadow: 'var(--shadow-2)',
  };
  // `--primary` is a FILL at 4.04:1 and pairs with `--on-primary`; it is correct
  // for the button face and wrong for anything reading as text. Primary-coloured
  // TEXT on this page uses `--primary-text` (5.2:1).
  const btn = (primary) => ({
    padding: '12px 32px', borderRadius: 'var(--r-sm)',
    border: primary ? '1px solid var(--primary)' : '1px solid var(--outline)',
    background: primary ? 'var(--primary)' : 'var(--surface)',
    color: primary ? 'var(--on-primary)' : 'var(--on-surface-2)',
    fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontSize: 14, opacity: busy ? 0.6 : 1,
  });
  const inp = {
    width: '100%', padding: '12px 16px', borderRadius: 'var(--r-sm)',
    border: '1px solid var(--outline)', background: 'var(--s-lowest)',
    color: 'var(--on-surface)',
    fontSize: 15, outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--on-surface)', ...box }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--primary-text)', margin: 0 }}>Kartavaya</h1>
        <p style={{ fontSize: 12, color: 'var(--on-surface-3)', margin: '4px 0 0' }}>Secure Document Signing</p>
      </div>

      {step === 'loading' && <div style={card}><p style={{ textAlign: 'center', color: 'var(--on-surface-2)' }}>Loading...</p></div>}

      {step === 'error' && (
        <div style={card}>
          <p style={{ textAlign: 'center', color: 'var(--danger)', fontSize: 15, fontWeight: 600 }}>{error}</p>
        </div>
      )}

      {step === 'otp_send' && data && (
        <div style={card}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', color: 'var(--on-surface)' }}>
            Sign: {data.document_title}
          </h2>
          {data.document_description && <p style={{ fontSize: 13, color: 'var(--on-surface-2)', margin: '0 0 16px' }}>{data.document_description}</p>}
          <p style={{ fontSize: 14, color: 'var(--on-surface-2)', margin: '0 0 8px' }}>
            Hi <strong>{data.signer_name}</strong>, you need to verify your identity before signing.
          </p>
          <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: '0 0 24px' }}>
            We'll send a 6-digit code to your email.
          </p>
          {data.file_url && (
            <a href={data.file_url} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-block', marginBottom: 24, color: 'var(--primary-text)', fontSize: 13, fontWeight: 600 }}>
              View Document (PDF)
            </a>
          )}
          {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={sendOtp} disabled={busy} style={btn(true)}>
              {busy ? 'Sending...' : 'Send Verification Code'}
            </button>
            <button onClick={decline} disabled={busy} style={btn(false)}>Decline</button>
          </div>
        </div>
      )}

      {step === 'otp_verify' && (
        <div style={card}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', color: 'var(--on-surface)' }}>Enter Verification Code</h2>
          <p style={{ fontSize: 13, color: 'var(--on-surface-2)', margin: '0 0 24px' }}>
            Sent to {data?.maskedEmail || 'your email'}. Valid for 10 minutes.
          </p>
          <input value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            style={{ ...inp, textAlign: 'center', fontSize: 28, letterSpacing: 8, fontWeight: 700 }}
            placeholder="000000" autoFocus />
          {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '12px 0 0' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            <button onClick={verifyOtp} disabled={busy} style={btn(true)}>
              {busy ? 'Verifying...' : 'Verify'}
            </button>
            <button onClick={sendOtp} disabled={busy} style={btn(false)}>Resend Code</button>
          </div>
        </div>
      )}

      {step === 'sign' && data && (
        <div style={card}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', color: 'var(--on-surface)' }}>
            Sign: {data.document_title}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--on-surface-2)', margin: '0 0 24px' }}>
            Signing as <strong>{data.signer_name}</strong> ({data.signer_email})
          </p>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {['type', 'draw'].map(t => (
              <button key={t} onClick={() => setSigType(t)} aria-pressed={sigType === t}
                style={{ padding: '6px 16px', borderRadius: 'var(--r-pill)', fontSize: 12, fontWeight: sigType === t ? 700 : 400,
                  background: sigType === t ? 'var(--primary-container)' : 'var(--s-container)',
                  color: sigType === t ? 'var(--on-primary-container)' : 'var(--on-surface-2)',
                  border: sigType === t ? '1px solid var(--primary)' : '1px solid var(--outline-variant)',
                  cursor: 'pointer' }}>
                {t === 'type' ? 'Type Signature' : 'Draw Signature'}
              </button>
            ))}
          </div>

          {sigType === 'type' && (
            <div>
              <input value={typedName} onChange={e => setTypedName(e.target.value)} style={inp}
                placeholder="Type your full name" autoFocus />
              {typedName && (
                <div style={{ marginTop: 12, padding: 16, background: 'var(--s-low)',
                  border: '1px solid var(--outline-variant)', borderRadius: 'var(--r-sm)', textAlign: 'center' }}>
                  <span style={{ fontFamily: "'Brush Script MT', 'Segoe Script', cursive", fontSize: 32, color: 'var(--on-surface)' }}>
                    {typedName}
                  </span>
                </div>
              )}
            </div>
          )}

          {sigType === 'draw' && (
            <div>
              {/* PAPER, not a surface token — see the note at the top of the
                  file. This block is the document, not the chrome. */}
              <div style={{ border: '1px solid var(--outline)', borderRadius: 'var(--r-sm)', overflow: 'hidden', background: PAPER }}>
                <canvas ref={initCanvas} width={500} height={160}
                  style={{ width: '100%', height: 160, cursor: 'crosshair', display: 'block' }} />
              </div>
              <button onClick={clearCanvas}
                style={{ marginTop: 8, fontSize: 12, color: 'var(--on-surface-2)', background: 'none', border: 'none', cursor: 'pointer' }}>
                Clear
              </button>
            </div>
          )}

          {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '12px 0 0' }}>{error}</p>}

          <p style={{ fontSize: 11, color: 'var(--on-surface-3)', margin: '16px 0' }}>
            By clicking "Sign Document" you agree that this electronic signature is legally binding
            and has the same effect as a handwritten signature under the IT Act, 2000.
          </p>

          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={submitSignature} disabled={busy} style={btn(true)}>
              {busy ? 'Signing...' : 'Sign Document'}
            </button>
            <button onClick={decline} disabled={busy} style={btn(false)}>Decline</button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div style={card}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16, color: 'var(--ok)' }}>&#10003;</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ok)', margin: '0 0 8px' }}>
              Document Signed Successfully
            </h2>
            <p style={{ fontSize: 14, color: 'var(--on-surface-2)' }}>
              {result?.signers_completed}/{result?.signers_total} signers have signed.
              {result?.document_status === 'completed' && ' All signatures collected!'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 16 }}>
              You can close this window. A copy will be sent to your email when all parties have signed.
            </p>
          </div>
        </div>
      )}

      {step === 'already_signed' && (
        <div style={card}>
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--on-surface)' }}>Already Signed</h2>
            <p style={{ fontSize: 13, color: 'var(--on-surface-2)' }}>
              You have already signed this document{result?.signed_at ? ` on ${new Date(result.signed_at).toLocaleDateString()}` : ''}.
            </p>
          </div>
        </div>
      )}

      {step === 'declined' && (
        <div style={card}>
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--danger)' }}>Signing Declined</h2>
            <p style={{ fontSize: 13, color: 'var(--on-surface-2)' }}>You have declined to sign this document.</p>
          </div>
        </div>
      )}

      <p style={{ textAlign: 'center', fontSize: 10, color: 'var(--on-surface-3)', marginTop: 32 }}>
        Powered by Kartavaya &middot; Aekam Inc &middot; Secure e-signatures
      </p>
    </div>
  );
}
