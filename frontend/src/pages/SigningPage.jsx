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
 * `.au-form`); ApprovePage used to copy that and has now been brought onto the
 * same fluid left-aligned frame as this page, so the two public routes no
 * longer disagree. Prose blocks take a `ch` measure, which is a typographic
 * limit on line length, not a page width, and does not centre anything.
 *
 * The chrome is shared with ApprovePage as `pub-*` in `styles/public.css`; the
 * signer-specific pieces are `sg-*`. This file previously held that layout as
 * six inline style OBJECTS (`page`, `stack`, `inline`, `lede`, `muted`, `cardW`)
 * plus per-element literals — token-driven, but invisible to the design gates,
 * unreachable from a media query, and impossible for the next page to reuse.
 * The narrow-viewport rule that stacks the action buttons could not have been
 * written against them at all.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { KLogo, KWordmark } from '../lib/brand';
import Button from '../components/ui/Button';
import { Card, CardHead, CardBody } from '../components/ui/Card';
import { Chip, ChipRow } from '../components/ui/Chip';
import { ErrorState, errorKind } from '../components/ui/ErrorState';
import { SkeletonText } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';

const API = `${import.meta.env.VITE_BACKEND_URL}/api`;

const ax = axios.create({ baseURL: API });

/* Same options object as ApprovePage. A bare toLocaleDateString('en-IN') gives
   "20/7/2026", which is both ambiguous to a reader who expects MM/DD and
   inconsistent with the other public page — the two are reached from the same
   kind of email by the same person, so they must not disagree about what a date
   looks like. This renders "20 Jul 2026". */
const DATE = { day: 'numeric', month: 'short', year: 'numeric' };

/* The signature canvas is the one place on this page that is NOT theme-aware,
   and deliberately so. `toDataURL` ships these exact pixels into the signed
   PDF, which is rendered on white paper by every viewer that opens it — ink
   drawn in a dark-theme foreground would arrive as a near-white smudge on a
   white page, i.e. an invisible signature on a legal document. So the drawing
   area is pinned to the LIGHT palette's values in both themes: it is paper,
   not chrome.

   Those values now live in ONE place — `.sg__paper` / `.sg__preview` in
   public.css declare `--sg-paper` and `--sg-ink` — and are read back here with
   getComputedStyle, because a canvas 2D context cannot consume a CSS custom
   property directly. Previously the same two hex literals existed in both the
   stylesheet's territory and this file, which is a divergence waiting to
   happen on the one artefact that is legally binding.

   The fallbacks are the light palette's --s-lowest and --on-surface
   (kartavaya-design.css §7). They are reached only where custom properties do
   not resolve at all — jsdom under test — and never in a browser. */
const PAPER_FALLBACK = '#FFFEFB';
const INK_FALLBACK   = '#1B1D1A';

function paperInk(el) {
  if (!el || typeof window === 'undefined' || !window.getComputedStyle) {
    return [PAPER_FALLBACK, INK_FALLBACK];
  }
  const cs = window.getComputedStyle(el);
  return [
    cs.getPropertyValue('--sg-paper').trim() || PAPER_FALLBACK,
    cs.getPropertyValue('--sg-ink').trim() || INK_FALLBACK,
  ];
}

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
  const paperRef = useRef(PAPER_FALLBACK);
  /* Did a stroke ever land? `toDataURL` on an untouched canvas returns a
     perfectly valid PNG of blank paper, so without this the page will happily
     submit an empty image as a signature on a document it has just told the
     signer is binding under the IT Act, 2000. Measured: a mount → click "Sign
     document" with the draw tab open produced
     `{signature_data: "data:image/png;base64,…", signature_type: "draw"}` and a
     "Document signed" screen. */
  const hasInkRef = useRef(false);
  /* `busy` disables the buttons, but it only does so once React has re-rendered.
     That is enough for a real double-CLICK — the browser dispatches those in
     separate tasks and React 18 flushes discrete updates before the second one
     lands (measured: 1 POST) — and NOT enough for two dispatches inside one
     task (measured: 2 POSTs). A ref is set synchronously inside the handler, so
     the guarantee stops depending on render timing. The endpoint is not
     idempotent: `esign.py:486` reads `signers_completed` and writes `+1`, and
     its `status == 'signed'` guard is evaluated against a row read before any
     concurrent write commits. */
  const inFlightRef = useRef(false);

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
     rest of the app expects to find on <html> when this route is left.

     THEMED_ACCENT: `applyPrefs` writes these four as INLINE styles chosen by
     the theme it saw, and `DEFAULT_PREFS.mode` is 'light', so for a stranger it
     writes the LIGHT values once and never re-runs. Flipping data-theme below
     moves the surfaces to the dark palette but an inline style outranks the
     `[data-theme="dark"]` block that exists to correct these, leaving dark-teal
     text on near-black. Removing them is right rather than recomputing: this
     branch is only reached when `k_prefs` is absent, so there is no chosen
     accent to preserve. Same defect and same repair as ApprovePage — see the
     measured ratios in its docblock. */
  useEffect(() => {
    const THEMED_ACCENT = ['--primary', '--primary-hover', '--primary-text', '--on-primary'];
    const root = document.documentElement;
    let chosen = null;
    try { chosen = window.localStorage?.getItem('k_prefs'); } catch { chosen = null; }
    if (chosen) return undefined;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const prev = root.getAttribute('data-theme');
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

  /* Extracted from the effect so the `server` branch of ErrorState has something
     to retry with. Without an `onRetry` a 500 on this request left a stranger
     looking at "Something broke on our side… Try again in a moment" above a card
     with ZERO buttons and ZERO links — measured, the whole page had no
     interactive element at all. This route has no nav chrome to escape through
     either, so the only recovery was knowing to reload the browser. */
  const loadDoc = useCallback(() => {
    setStep('loading');
    setError('');
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

  useEffect(() => { loadDoc(); }, [loadDoc]);

  /* The server's own `detail` when it sent one, and otherwise a sentence that is
     TRUE about what just happened. Every handler below used to fall back to a
     fixed string, which is fine for the status the string describes and a lie
     for every other one: a 500 or a dropped connection on OTP verify answered
     "Invalid OTP" — accusing the signer of mistyping a code that was correct and
     sending them round the loop again. `errorKind` already draws exactly this
     distinction for the full-page states; these inline ones now use it too. */
  const failMsg = (e, fallback) => {
    const detail = e?.response?.data?.detail;
    if (detail) return detail;
    const kind = errorKind(e);
    if (kind === 'offline') return 'You appear to be offline. Check your connection and try again.';
    if (kind === 'server') return 'Something broke on our side, not yours. Try again in a moment.';
    return fallback;
  };

  const sendOtp = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setError('');
    try {
      const r = await ax.post(`/v1/esign/verify/${token}/otp/send`);
      setData(d => ({ ...d, maskedEmail: r.data.email }));
      setStep('otp_verify');
    } catch (e) { setError(failMsg(e, 'Failed to send the code')); }
    finally { inFlightRef.current = false; setBusy(false); }
  };

  const verifyOtp = async () => {
    if (inFlightRef.current) return;
    if (otp.length !== 6) { setError('Enter the 6-digit code'); return; }
    inFlightRef.current = true;
    setBusy(true);
    setError('');
    try {
      await ax.post(`/v1/esign/verify/${token}/otp/verify`, { otp });
      setStep('sign');
    } catch (e) { setError(failMsg(e, 'Invalid code')); }
    finally { inFlightRef.current = false; setBusy(false); }
  };

  const submitSignature = async () => {
    if (inFlightRef.current) return;
    let sigData = '';
    if (sigType === 'type') {
      if (!typedName.trim()) { setError('Type your name to sign'); return; }
      sigData = typedName.trim();
    } else if (sigType === 'draw') {
      const canvas = canvasRef.current;
      // Bailing silently left the button inert with no explanation. It is the
      // one control on the page and it must always answer.
      if (!canvas) { setError('The signature pad did not load. Reload this page and try again.'); return; }
      if (!hasInkRef.current) { setError('Draw your signature above to sign'); return; }
      sigData = canvas.toDataURL('image/png');
    }
    inFlightRef.current = true;
    setBusy(true);
    setError('');
    try {
      const r = await ax.post(`/v1/esign/verify/${token}/sign`, {
        signature_data: sigData, signature_type: sigType,
      });
      setResult(r.data);
      setStep('done');
    } catch (e) { setError(failMsg(e, 'Your signature was not accepted. Nothing has been signed.')); }
    finally { inFlightRef.current = false; setBusy(false); }
  };

  const doDecline = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setError('');
    try {
      await ax.post(`/v1/esign/verify/${token}/decline`, { reason: 'Declined by signer' });
      setStep('declined');
    } catch (e) { setError(failMsg(e, 'Could not record your decline. Nothing has changed.')); }
    finally { inFlightRef.current = false; setBusy(false); }
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

  /* `useCallback`, and the identity matters more than the allocation.
     As an inline arrow this was a NEW function on every render, and React
     re-attaches a ref whose callback identity changed — calling it with `null`
     and then with the same DOM node. So every re-render of this step ran the
     body below again, which (a) `fillRect`s the whole canvas in paper, ERASING
     a signature the signer had already drawn, and (b) adds another seven
     listeners to a node that already had them.

     Measured, on the draw tab: opening the Decline dialog took fillRect from 1
     call to 2 and listeners from 7 to 14; cancelling it took them to 3 and 21.
     A failed sign attempt re-renders three times (busy on, error, busy off), so
     the sequence "draw → Sign → server error → Sign again" submitted a BLANK
     canvas on the second press, and the server accepted it. That chain is shut
     by this and by `hasInkRef` together.

     The `null` call is now handled rather than ignored: it is the unmount, and
     leaving `canvasRef` pointing at a detached node is how a stale canvas gets
     read at submit time. */
  const initCanvas = useCallback((canvas) => {
    if (!canvas) { canvasRef.current = null; hasInkRef.current = false; return; }
    if (canvasRef.current === canvas) return;
    canvasRef.current = canvas;
    hasInkRef.current = false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // --sg-paper / --sg-ink inherit down from .sg__paper, so reading them off
    // the canvas itself resolves the same values the stylesheet painted.
    const [paper, ink] = paperInk(canvas);
    paperRef.current = paper;
    // Paint the paper in, rather than leaving the canvas transparent: a
    // transparent PNG dropped onto a dark viewer background hides the ink just
    // as effectively as light ink would. See paperInk above.
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = ink;
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
    // `hasInkRef` is set here and not in `start`, because a bare click puts no
    // mark on the paper and must not count as a signature.
    const move = (e) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      ctx.lineTo(...getPos(e));
      ctx.stroke();
      hasInkRef.current = true;
    };
    const end = () => { drawingRef.current = false; };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
  }, []);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Repaint the paper, not clearRect — clearing back to transparent would
    // undo the fill laid down in initCanvas and reintroduce the invisible-ink
    // problem for anyone who draws, clears, and draws again.
    ctx.fillStyle = paperRef.current || PAPER_FALLBACK;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    hasInkRef.current = false;
  };

  return (
    <div className="pub">
      <header className="pub__brand">
        <KLogo size={36} />
        <div>
          <KWordmark />
          <p className="pub__kick">Secure document signing</p>
        </div>
      </header>

      <div className="pub__body">
        {/* Loading, error and every terminal state are distinct branches. A
            failed verify must never fall through to a state that implies the
            link was checked and found wanting. */}
        {step === 'loading' && (
          <Card className="pub__card">
            <CardBody>
              <div className="pub__pad pub__stack" aria-busy="true" aria-label="Checking this signing link">
                <SkeletonText width="45%" height={11} />
                <SkeletonText width="70%" height={22} />
                <SkeletonText width="100%" height={12} />
                <SkeletonText width="85%" height={12} />
              </div>
            </CardBody>
          </Card>
        )}

        {step === 'error' && (
          <Card className="pub__card">
            <CardBody>
              <div className="pub__pad">
                {/* `offline`'s shared copy is "Changes are saved and will sync
                    when you're back." That is true of the signed-in app and
                    false here: this page holds no draft, saves nothing and syncs
                    nothing, and telling a signer their work is safe on the one
                    screen where "did my signature go through?" is the only
                    question they have is the worst place in the product to say
                    it. The server's own `detail` still wins when there is one —
                    a dropped connection never has one. */}
                <ErrorState
                  kind={errKind}
                  detail={error || (errKind === 'offline'
                    ? 'Nothing has been sent. Reconnect and open this link again.'
                    : undefined)}
                  /* Only `server`. ErrorState also renders `onRetry` for
                     `denied`, where it is labelled "Request access" — a button
                     with no meaning to a signer who has no account to request
                     it with. */
                  onRetry={errKind === 'server' ? loadDoc : undefined}
                />
              </div>
            </CardBody>
          </Card>
        )}

        {step === 'otp_send' && data && (
          <Card className="pub__card">
            <CardHead title={`Sign: ${data.document_title}`} />
            <CardBody>
              <div className="pub__stack">
                {data.document_description && <p className="pub__lede">{data.document_description}</p>}
                <p className="pub__lede">
                  Hi <strong>{data.signer_name}</strong>, you need to verify your identity before signing.
                </p>
                <p className="pub__muted">We&rsquo;ll send a 6-digit code to your email.</p>
                {data.file_url && (
                  <a className="pub__link" href={data.file_url} target="_blank" rel="noopener noreferrer">
                    View document (PDF)
                  </a>
                )}
                {error && <span className="fldx__err" role="alert">{error}</span>}
                <div className="pub__actions">
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
          <Card className="pub__card">
            <CardHead title="Enter verification code" />
            <CardBody>
              <div className="pub__stack">
                <p className="pub__lede">
                  Sent to {data?.maskedEmail || 'your email'}. Valid for 10 minutes.
                </p>
                {/* Same rule as the `sign` step: whether the signer can read the
                    document must not depend on which step they are standing on.
                    This is the step where they are waiting on an email — the one
                    place they have time to read it — and it was the only step in
                    the flow with no link to the PDF at all. */}
                {data?.file_url && (
                  <a className="pub__link" href={data.file_url} target="_blank" rel="noopener noreferrer">
                    View document (PDF)
                  </a>
                )}
                {/* `.fldx--otp` is the system's OTP field — a 210px cap, because a
                    six-digit code in a full-width input reads as a text box. */}
                <div className={`fldx fldx--otp${error ? ' is-error' : ''}`}>
                  <label className="fldx__lbl" htmlFor="sgn-otp"><span>Verification code</span></label>
                  <input id="sgn-otp" className="fldx__in sg__otp" value={otp} inputMode="numeric"
                    autoComplete="one-time-code" maxLength={6} autoFocus
                    onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000" />
                  {error && <span className="fldx__err" role="alert">{error}</span>}
                </div>
                <div className="pub__actions">
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
          <Card className="pub__card">
            <CardHead title={`Sign: ${data.document_title}`} />
            <CardBody>
              <div className="pub__stack">
                <p className="pub__lede">
                  Signing as <strong>{data.signer_name}</strong> ({data.signer_email})
                </p>

                {/* The document itself, on the step where it is actually signed.
                    This link previously existed ONLY in the `otp_send` branch,
                    so it appeared for signers whose document required identity
                    verification and for nobody else. With `otp_required` false —
                    verified in a browser: zero <a> elements on this step — the
                    signer reached the button under the IT Act, 2000 notice below
                    with no way to open what they were agreeing to. Whether the
                    document is readable cannot depend on whether an OTP was
                    configured. */}
                {data.file_url && (
                  <a className="pub__link" href={data.file_url} target="_blank" rel="noopener noreferrer">
                    View document (PDF)
                  </a>
                )}

                <ChipRow>
                  {['type', 'draw'].map(t => (
                    <Chip key={t} on={sigType === t} onClick={() => setSigType(t)}>
                      {t === 'type' ? 'Type signature' : 'Draw signature'}
                    </Chip>
                  ))}
                </ChipRow>

                {sigType === 'type' && (
                  <div className="fldx sg__measure">
                    <label className="fldx__lbl" htmlFor="sgn-name"><span>Full name</span></label>
                    <input id="sgn-name" className="fldx__in" value={typedName} autoFocus
                      onChange={e => setTypedName(e.target.value)} placeholder="Type your full name" />
                    {typedName && (
                      /* Paper and ink, not surface tokens — this previews the ink
                         that goes onto the document, so it must read the same here
                         as it will on the page. Same exception as the canvas. */
                      <div className="sg__preview">
                        <span className="sg__preview-ink">{typedName}</span>
                      </div>
                    )}
                  </div>
                )}

                {sigType === 'draw' && (
                  <div className="sg__measure">
                    <div className="sg__paper">
                      <canvas className="sg__canvas" ref={initCanvas} width={500} height={160}
                        aria-label="Draw your signature" />
                    </div>
                    <Button className="sg__clear" variant="text" size="sm" onClick={clearCanvas}>
                      Clear
                    </Button>
                  </div>
                )}

                {error && <span className="fldx__err" role="alert">{error}</span>}

                <p className="pub__muted">
                  By pressing &ldquo;Sign document&rdquo; you agree that this electronic signature is
                  legally binding and has the same effect as a handwritten signature under the
                  IT Act, 2000.
                </p>

                <div className="pub__actions">
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
          <Card className="pub__card">
            <CardHead title="Document signed" />
            <CardBody>
              <div className="pub__stack">
                <p className="pub__lede sg__done">
                  {result?.signers_completed}/{result?.signers_total} signers have signed.
                  {result?.document_status === 'completed' && ' All signatures collected.'}
                </p>
                <p className="pub__muted">
                  You can close this window. A copy will be sent to your email when all parties
                  have signed.
                </p>
              </div>
            </CardBody>
          </Card>
        )}

        {step === 'already_signed' && (
          <Card className="pub__card">
            <CardHead title="Already signed" />
            <CardBody>
              <p className="pub__lede">
                You have already signed this document
                {result?.signed_at ? ` on ${new Date(result.signed_at).toLocaleDateString('en-IN', DATE)}` : ''}.
              </p>
            </CardBody>
          </Card>
        )}

        {step === 'declined' && (
          <Card className="pub__card">
            <CardHead title="Signing declined" />
            <CardBody>
              <p className="pub__lede">You have declined to sign this document.</p>
            </CardBody>
          </Card>
        )}
      </div>

      <p className="pub__foot">
        Powered by Kartavaya &middot; Aekam Inc &middot; Secure e-signatures
      </p>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
