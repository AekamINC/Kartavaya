/**
 * SigningPage.jsx — public signer view. Route: /sign/:token, NO <Protected>.
 *
 * `13-module-pages.md` §191 is the whole spec for this page: "Public signer
 * view — unauthenticated, needs its own minimal chrome." (`20-search-palette.md`
 * :170 claims it appears in no handover file; `_SOURCE-MAP.md` already records
 * that as a spec defect.) There is no SigningPage in
 * `design-reference/Kartavaya Redesign/` — the eSign reference screen is
 * `ScreensThin.jsx` `EsignCreate`, which is the FIRM's create flow, not the
 * signer's. So the chrome here is `02-common-components.md` §1 as the reference
 * implementation renders it: `.card`, `.btn`, `.fldx`, `.chip`, via the
 * components in `components/ui/` rather than a private set of inline styles
 * that merely reference the same tokens. A hand-rolled button reading the right
 * variables still has the wrong padding and weight, no `:active` scale and no
 * hover — and this page is the commercial face of the product: it is what a
 * client's client sees.
 *
 * Layout follows the standing owner rule in `_SOURCE-MAP.md` ("all pages fluid
 * and left-aligned, no fixed-width centring"), which overrides any spec. The
 * reference's own public auth surface centres a 392px card (`auth.css` `.au--m`,
 * `.au-form`) and `ApprovePage.jsx` copies that — both are in the same position
 * and are recorded in the report, not silently followed here. Prose blocks take
 * a `ch` measure, which is a typographic limit on line length, not a page width,
 * and does not centre anything.
 */
import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { KLogo, KWordmark } from '../lib/brand';
import Button from '../components/ui/Button';
import { Card, CardHead, CardBody } from '../components/ui/Card';
import { Chip, ChipRow } from '../components/ui/Chip';
import { ErrorState, errorKind } from '../components/ui/ErrorState';
import ConfirmDialog from '../components/ui/ConfirmDialog';

const API = `${import.meta.env.VITE_BACKEND_URL}/api`;

const ax = axios.create({ baseURL: API });

/* The signature canvas is the one place on this page that is NOT theme-aware,
   and deliberately so. `toDataURL` ships these exact pixels into the signed
   PDF, which is rendered on white paper by every viewer that opens it — ink
   drawn in a dark-theme foreground would arrive as a near-white smudge on a
   white page, i.e. an invisible signature on a legal document. So the drawing
   area is pinned to the LIGHT palette's values in both themes: it is paper,
   not chrome. The literals below are `--s-lowest` and `--on-surface` as the
   light theme declares them (kartavaya-design.css §7), copied rather than
   referenced because a canvas 2D context cannot read a CSS custom property.
   The typed-signature path has no such constraint — it submits a string, not
   an image — so its preview is fully tokenised. */
const PAPER = '#FFFEFB';
const INK   = '#1B1D1A';

/* Prose measure. A limit on line length, not on page width — the block is
   still left-aligned and the page is still fluid. */
const MEASURE = { maxWidth: '64ch' };

export default function SigningPage() {
  const { token } = useParams();
  const [step, setStep] = useState('loading');
  const [data, setData] = useState(null);
  const [otp, setOtp] = useState('');
  const [sigType, setSigType] = useState('type');
  const [typedName, setTypedName] = useState('');
  const [error, setError] = useState('');
  const [errKind, setErrKind] = useState('missing');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [confirm, setConfirm] = useState(null);
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
        // `02` §Revision: four failure states, not one "Something went wrong".
        // A dead link and a dead network are different problems with different
        // correct actions, and only the second one resolves by waiting.
        setErrKind(errorKind(e));
        setError(e.response?.data?.detail || '');
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

  const doDecline = async () => {
    setBusy(true);
    try {
      await ax.post(`/v1/esign/verify/${token}/decline`, { reason: 'Declined by signer' });
      setStep('declined');
    } catch (e) { setError(e.response?.data?.detail || 'Failed to decline'); }
    finally { setBusy(false); }
  };

  /* `window.confirm` on the one irreversible action on the page, on the surface
     an external party judges the product by. ConfirmDialog exists precisely to
     replace it (02 §5) and gives this a real title, an intent and a focus trap. */
  const decline = () => setConfirm({
    title: 'Decline to sign?',
    message: 'The sender is told you declined. This cannot be undone from this link.',
    confirmLabel: 'Decline',
    intent: 'danger',
    onConfirm: doDecline,
  });

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

  const page = {
    minHeight: '100vh', background: 'var(--bg)', color: 'var(--on-surface)',
    fontFamily: 'var(--font-ui)', fontSize: 'var(--t-body)',
    padding: 'var(--pad-page)',
    display: 'flex', flexDirection: 'column', gap: 'var(--gap-section)',
    alignItems: 'flex-start',
  };
  const stack  = { display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' };
  const inline = { display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)' };
  const lede   = { ...MEASURE, margin: 0, fontSize: 'var(--t-body-sm)', color: 'var(--on-surface-2)', lineHeight: 1.6 };
  const muted  = { ...MEASURE, margin: 0, fontSize: 'var(--t-label)', color: 'var(--on-surface-3)', lineHeight: 1.6 };
  // width:100% so a card fills the fluid page rather than shrink-wrapping.
  const cardW  = { width: '100%' };

  return (
    <div style={page}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
        <KLogo size={36} />
        <div>
          <KWordmark />
          <p style={{ margin: '3px 0 0', fontSize: 'var(--t-micro)', letterSpacing: '.14em',
            textTransform: 'uppercase', fontWeight: 600, color: 'var(--on-surface-3)' }}>
            Secure document signing
          </p>
        </div>
      </header>

      {step === 'loading' && (
        <Card style={cardW}>
          <CardBody>
            <p style={{ ...lede, paddingTop: 'var(--pad-card)' }}>Checking this signing link…</p>
          </CardBody>
        </Card>
      )}

      {step === 'error' && (
        <Card style={cardW}>
          <CardBody>
            <div style={{ paddingTop: 'var(--pad-card)' }}>
              <ErrorState kind={errKind} detail={error || undefined} />
            </div>
          </CardBody>
        </Card>
      )}

      {step === 'otp_send' && data && (
        <Card style={cardW}>
          <CardHead title={`Sign: ${data.document_title}`} />
          <CardBody>
            <div style={stack}>
              {data.document_description && <p style={lede}>{data.document_description}</p>}
              <p style={lede}>
                Hi <strong>{data.signer_name}</strong>, you need to verify your identity before signing.
              </p>
              <p style={muted}>We&rsquo;ll send a 6-digit code to your email.</p>
              {data.file_url && (
                <a href={data.file_url} target="_blank" rel="noopener noreferrer"
                  style={{ alignSelf: 'flex-start', color: 'var(--primary-text)',
                    fontSize: 'var(--t-body-sm)', fontWeight: 600 }}>
                  View document (PDF)
                </a>
              )}
              {error && <span className="fldx__err" role="alert">{error}</span>}
              <div style={inline}>
                <Button variant="fill" size="lg" onClick={sendOtp} disabled={busy}>
                  {busy ? 'Sending…' : 'Send verification code'}
                </Button>
                <Button variant="out" size="lg" onClick={decline} disabled={busy}>Decline</Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {step === 'otp_verify' && (
        <Card style={cardW}>
          <CardHead title="Enter verification code" />
          <CardBody>
            <div style={stack}>
              <p style={lede}>
                Sent to {data?.maskedEmail || 'your email'}. Valid for 10 minutes.
              </p>
              {/* `.fldx--otp` is the system's OTP field — a 210px cap, because a
                  six-digit code in a full-width input reads as a text box. */}
              <div className={`fldx fldx--otp${error ? ' is-error' : ''}`}>
                <label className="fldx__lbl" htmlFor="sgn-otp"><span>Verification code</span></label>
                <input id="sgn-otp" className="fldx__in" value={otp} inputMode="numeric"
                  autoComplete="one-time-code" maxLength={6} autoFocus
                  onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  style={{ textAlign: 'center', letterSpacing: '.5em', fontFamily: 'var(--font-mono)' }}
                  placeholder="000000" />
                {error && <span className="fldx__err" role="alert">{error}</span>}
              </div>
              <div style={inline}>
                <Button variant="fill" size="lg" onClick={verifyOtp} disabled={busy}>
                  {busy ? 'Verifying…' : 'Verify'}
                </Button>
                <Button variant="out" size="lg" onClick={sendOtp} disabled={busy}>Resend code</Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {step === 'sign' && data && (
        <Card style={cardW}>
          <CardHead title={`Sign: ${data.document_title}`} />
          <CardBody>
            <div style={stack}>
              <p style={lede}>
                Signing as <strong>{data.signer_name}</strong> ({data.signer_email})
              </p>

              <ChipRow>
                {['type', 'draw'].map(t => (
                  <Chip key={t} on={sigType === t} onClick={() => setSigType(t)}>
                    {t === 'type' ? 'Type signature' : 'Draw signature'}
                  </Chip>
                ))}
              </ChipRow>

              {sigType === 'type' && (
                <div className="fldx" style={MEASURE}>
                  <label className="fldx__lbl" htmlFor="sgn-name"><span>Full name</span></label>
                  <input id="sgn-name" className="fldx__in" value={typedName} autoFocus
                    onChange={e => setTypedName(e.target.value)} placeholder="Type your full name" />
                  {typedName && (
                    /* PAPER/INK, not surface tokens — this is a preview of the
                       ink that goes onto the document, so it must read the same
                       here as it will on the page. Same exception as the canvas. */
                    <div style={{ marginTop: 'var(--sp-2)', padding: 'var(--sp-4)', background: PAPER,
                      border: '1px solid var(--outline-variant)', borderRadius: 'var(--r-sm)' }}>
                      <span style={{ fontFamily: "'Brush Script MT', 'Segoe Script', cursive",
                        fontSize: 32, color: INK }}>
                        {typedName}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {sigType === 'draw' && (
                <div style={MEASURE}>
                  <div style={{ border: '1px solid var(--outline)', borderRadius: 'var(--r-sm)',
                    overflow: 'hidden', background: PAPER }}>
                    <canvas ref={initCanvas} width={500} height={160}
                      style={{ width: '100%', height: 160, cursor: 'crosshair', display: 'block' }} />
                  </div>
                  <Button variant="text" size="sm" onClick={clearCanvas}
                    style={{ marginTop: 'var(--sp-2)' }}>Clear</Button>
                </div>
              )}

              {error && <span className="fldx__err" role="alert">{error}</span>}

              <p style={muted}>
                By pressing &ldquo;Sign document&rdquo; you agree that this electronic signature is
                legally binding and has the same effect as a handwritten signature under the
                IT Act, 2000.
              </p>

              <div style={inline}>
                <Button variant="fill" size="lg" onClick={submitSignature} disabled={busy}>
                  {busy ? 'Signing…' : 'Sign document'}
                </Button>
                <Button variant="out" size="lg" onClick={decline} disabled={busy}>Decline</Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {step === 'done' && (
        <Card style={cardW}>
          <CardHead title="Document signed" />
          <CardBody>
            <div style={stack}>
              <p style={{ ...lede, color: 'var(--ok)', fontWeight: 600 }}>
                {result?.signers_completed}/{result?.signers_total} signers have signed.
                {result?.document_status === 'completed' && ' All signatures collected.'}
              </p>
              <p style={muted}>
                You can close this window. A copy will be sent to your email when all parties
                have signed.
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {step === 'already_signed' && (
        <Card style={cardW}>
          <CardHead title="Already signed" />
          <CardBody>
            <p style={lede}>
              You have already signed this document
              {result?.signed_at ? ` on ${new Date(result.signed_at).toLocaleDateString()}` : ''}.
            </p>
          </CardBody>
        </Card>
      )}

      {step === 'declined' && (
        <Card style={cardW}>
          <CardHead title="Signing declined" />
          <CardBody>
            <p style={lede}>You have declined to sign this document.</p>
          </CardBody>
        </Card>
      )}

      <p style={{ margin: 0, fontSize: 'var(--t-micro)', color: 'var(--on-surface-3)' }}>
        Powered by Kartavaya &middot; Aekam Inc &middot; Secure e-signatures
      </p>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
