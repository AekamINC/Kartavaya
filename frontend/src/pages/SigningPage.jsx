import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

const API = `${import.meta.env.VITE_BACKEND_URL}/api`;

const ax = axios.create({ baseURL: API });

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
    ctx.strokeStyle = '#1a1a1a';
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const box = {
    maxWidth: 560, margin: '0 auto', padding: '32px 24px',
    fontFamily: '-apple-system, system-ui, sans-serif',
  };
  const card = {
    background: '#fff', borderRadius: 12, padding: 32,
    boxShadow: '0 1px 3px rgba(0,0,0,.08), 0 4px 16px rgba(0,0,0,.04)',
  };
  const btn = (primary) => ({
    padding: '12px 32px', borderRadius: 8, border: primary ? 'none' : '1px solid #d1d5db',
    background: primary ? '#0082c6' : '#fff', color: primary ? '#fff' : '#374151',
    fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontSize: 14, opacity: busy ? 0.6 : 1,
  });
  const inp = {
    width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid #d1d5db',
    fontSize: 15, outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f8f9fb', ...box }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0082c6', margin: 0 }}>Kartavya</h1>
        <p style={{ fontSize: 12, color: '#9ca3af', margin: '4px 0 0' }}>Secure Document Signing</p>
      </div>

      {step === 'loading' && <div style={card}><p style={{ textAlign: 'center', color: '#6b7280' }}>Loading...</p></div>}

      {step === 'error' && (
        <div style={card}>
          <p style={{ textAlign: 'center', color: '#ef4444', fontSize: 15, fontWeight: 600 }}>{error}</p>
        </div>
      )}

      {step === 'otp_send' && data && (
        <div style={card}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', color: '#111' }}>
            Sign: {data.document_title}
          </h2>
          {data.document_description && <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px' }}>{data.document_description}</p>}
          <p style={{ fontSize: 14, color: '#374151', margin: '0 0 8px' }}>
            Hi <strong>{data.signer_name}</strong>, you need to verify your identity before signing.
          </p>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 24px' }}>
            We'll send a 6-digit code to your email.
          </p>
          {data.file_url && (
            <a href={data.file_url} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-block', marginBottom: 24, color: '#0082c6', fontSize: 13, fontWeight: 600 }}>
              View Document (PDF)
            </a>
          )}
          {error && <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{error}</p>}
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
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', color: '#111' }}>Enter Verification Code</h2>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 24px' }}>
            Sent to {data?.maskedEmail || 'your email'}. Valid for 10 minutes.
          </p>
          <input value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            style={{ ...inp, textAlign: 'center', fontSize: 28, letterSpacing: 8, fontWeight: 700 }}
            placeholder="000000" autoFocus />
          {error && <p style={{ color: '#ef4444', fontSize: 13, margin: '12px 0 0' }}>{error}</p>}
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
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', color: '#111' }}>
            Sign: {data.document_title}
          </h2>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 24px' }}>
            Signing as <strong>{data.signer_name}</strong> ({data.signer_email})
          </p>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {['type', 'draw'].map(t => (
              <button key={t} onClick={() => setSigType(t)}
                style={{ padding: '6px 16px', borderRadius: 99, fontSize: 12, fontWeight: sigType === t ? 700 : 400,
                  background: sigType === t ? '#0082c618' : '#f3f4f6', color: sigType === t ? '#0082c6' : '#6b7280',
                  border: sigType === t ? '1px solid #0082c6' : '1px solid #e5e7eb', cursor: 'pointer' }}>
                {t === 'type' ? 'Type Signature' : 'Draw Signature'}
              </button>
            ))}
          </div>

          {sigType === 'type' && (
            <div>
              <input value={typedName} onChange={e => setTypedName(e.target.value)} style={inp}
                placeholder="Type your full name" autoFocus />
              {typedName && (
                <div style={{ marginTop: 12, padding: 16, background: '#f8f9fb', borderRadius: 8, textAlign: 'center' }}>
                  <span style={{ fontFamily: "'Brush Script MT', 'Segoe Script', cursive", fontSize: 32, color: '#111' }}>
                    {typedName}
                  </span>
                </div>
              )}
            </div>
          )}

          {sigType === 'draw' && (
            <div>
              <div style={{ border: '1px solid #d1d5db', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                <canvas ref={initCanvas} width={500} height={160}
                  style={{ width: '100%', height: 160, cursor: 'crosshair', display: 'block' }} />
              </div>
              <button onClick={clearCanvas}
                style={{ marginTop: 8, fontSize: 12, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>
                Clear
              </button>
            </div>
          )}

          {error && <p style={{ color: '#ef4444', fontSize: 13, margin: '12px 0 0' }}>{error}</p>}

          <p style={{ fontSize: 11, color: '#9ca3af', margin: '16px 0' }}>
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
            <div style={{ fontSize: 48, marginBottom: 16 }}>&#10003;</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#10b981', margin: '0 0 8px' }}>
              Document Signed Successfully
            </h2>
            <p style={{ fontSize: 14, color: '#6b7280' }}>
              {result?.signers_completed}/{result?.signers_total} signers have signed.
              {result?.document_status === 'completed' && ' All signatures collected!'}
            </p>
            <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 16 }}>
              You can close this window. A copy will be sent to your email when all parties have signed.
            </p>
          </div>
        </div>
      )}

      {step === 'already_signed' && (
        <div style={card}>
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#6b7280' }}>Already Signed</h2>
            <p style={{ fontSize: 13, color: '#9ca3af' }}>
              You have already signed this document{result?.signed_at ? ` on ${new Date(result.signed_at).toLocaleDateString()}` : ''}.
            </p>
          </div>
        </div>
      )}

      {step === 'declined' && (
        <div style={card}>
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#ef4444' }}>Signing Declined</h2>
            <p style={{ fontSize: 13, color: '#9ca3af' }}>You have declined to sign this document.</p>
          </div>
        </div>
      )}

      <p style={{ textAlign: 'center', fontSize: 10, color: '#9ca3af', marginTop: 32 }}>
        Powered by Kartavya &middot; Aekam Inc &middot; Secure e-signatures
      </p>
    </div>
  );
}
