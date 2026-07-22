import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useToast } from '../components/ui/toast';
import AuthShell, { authInput, authLabel, authBtn } from '../components/layout/AuthShell';
import { K } from '../lib/brand';
import { apiLogin, apiAcceptInvite, apiForgotPassword, apiResetPassword } from '../lib/auth';

// ── Eye icon for show/hide password ───────────────────────────────────────────
function EyeIcon({ open }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

function PasswordInput({ name, value, onChange, placeholder, required = true }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        name={name}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        style={{ ...authInput, paddingRight: 44 }}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', cursor: 'pointer', color: '#8aa5be', padding: 0,
          display: 'flex', alignItems: 'center' }}
        tabIndex={-1}
      >
        <EyeIcon open={show} />
      </button>
    </div>
  );
}

// ── Login ──────────────────────────────────────────────────────────────────────
export function LoginPage() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [form, setForm]       = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const set = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      const data = await apiLogin(form.email, form.password);
      navigate(data.user?.role === 'client' ? '/client' : '/dashboard', { replace: true });
    } catch (err) {
      pushToast({ type: 'error', title: 'Sign in failed', message: err?.response?.data?.detail || 'Check your credentials.' });
    } finally { setLoading(false); }
  };

  return (
    <AuthShell
      title={<>Do what<br /><span style={{ background: K.grad, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>must be done.</span></>}
      sub="Team task management built for agencies and founders. Invite-only access."
    >
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 3.5, textTransform: 'uppercase', color: K.mid, marginBottom: 8 }}>Welcome back</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0a1628', letterSpacing: -0.5, lineHeight: 1.2 }}>
          Sign in to<br /><span style={{ color: K.blue }}>Kartavaya</span>
        </h1>
      </div>
      <form onSubmit={submit}>
        <div style={{ marginBottom: 14 }}>
          <label style={authLabel}>Email</label>
          <input name="email" type="email" value={form.email} onChange={set} required placeholder="you@example.com" style={authInput} />
        </div>
        <div style={{ marginBottom: 6 }}>
          <label style={authLabel}>Password</label>
          <PasswordInput name="password" value={form.password} onChange={set} placeholder="••••••••••" />
        </div>
        <div style={{ textAlign: 'right', marginBottom: 18 }}>
          <span
            onClick={() => navigate('/forgot-password')}
            style={{ fontSize: 12, color: K.blue, fontWeight: 600, cursor: 'pointer' }}
          >
            Forgot password?
          </span>
        </div>
        <button type="submit" disabled={loading} style={{ ...authBtn, opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
      <p style={{ textAlign: 'center', fontSize: 12, color: '#8aa5be', marginTop: 20 }}>
        Access is invite-only. Contact your admin to get access.
      </p>
    </AuthShell>
  );
}

// ── Accept invite ──────────────────────────────────────────────────────────────
export function AcceptInvitePage() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [searchParams]  = useSearchParams();
  const token           = searchParams.get('token') || '';
  const [form, setForm] = useState({ name: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const set = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  if (!token) return (
    <AuthShell title="Invalid link" sub="This invite link is missing a token.">
      <p style={{ color: '#e74c3c', fontSize: 14 }}>No invite token found. Please ask your admin for a new link.</p>
    </AuthShell>
  );

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) { pushToast({ type: 'error', title: "Passwords don't match" }); return; }
    if (form.password.length < 8) { pushToast({ type: 'error', title: 'Password too short', message: 'Minimum 8 characters.' }); return; }
    setLoading(true);
    try {
      const data = await apiAcceptInvite(token, form.name, form.password);
      pushToast({ type: 'success', title: 'Welcome to Kartavaya!' });
      navigate(data.user?.role === 'client' ? '/client' : '/dashboard', { replace: true });
    } catch (err) {
      const detail = err?.response?.data?.detail || '';
      if (detail.includes('already activated') || detail.includes('already exists')) {
        pushToast({ type: 'error', title: 'Account already active', message: 'Your account is set up. Please sign in.' });
        navigate('/login', { replace: true });
      } else {
        pushToast({ type: 'error', title: 'Could not accept invite', message: detail || 'Link may have expired.' });
      }
    } finally { setLoading(false); }
  };

  return (
    <AuthShell
      title={<>You've been<br /><span style={{ background: K.grad, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>invited.</span></>}
      sub="Set your name and password to activate your account."
    >
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 3.5, textTransform: 'uppercase', color: K.mid, marginBottom: 8 }}>Create your account</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0a1628', letterSpacing: -0.5, lineHeight: 1.2 }}>
          Join<br /><span style={{ color: K.blue }}>Kartavaya</span>
        </h1>
      </div>
      <form onSubmit={submit}>
        <div style={{ marginBottom: 14 }}>
          <label style={authLabel}>Your name</label>
          <input name="name" type="text" value={form.name} onChange={set} required placeholder="Your full name" style={authInput} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={authLabel}>Password</label>
          <PasswordInput name="password" value={form.password} onChange={set} placeholder="At least 8 characters" />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={authLabel}>Confirm password</label>
          <PasswordInput name="confirm" value={form.confirm} onChange={set} placeholder="••••••••••" />
        </div>
        <button type="submit" disabled={loading} style={{ ...authBtn, opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Activating…' : 'Activate Account'}
        </button>
      </form>
      <p style={{ textAlign: 'center', fontSize: 13, color: '#5a7087', marginTop: 14 }}>
        Already have an account?{' '}
        <span onClick={() => navigate('/login')} style={{ color: K.blue, fontWeight: 800, cursor: 'pointer' }}>Sign in</span>
      </p>
    </AuthShell>
  );
}

// ── Forgot password ────────────────────────────────────────────────────────────
export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [email, setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent]     = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      await apiForgotPassword(email);
      setSent(true);
    } catch {
      pushToast({ type: 'error', title: 'Something went wrong', message: 'Please try again.' });
    } finally { setLoading(false); }
  };

  return (
    <AuthShell
      title={<>Reset your<br /><span style={{ background: K.grad, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>password.</span></>}
      sub="Enter your email and we'll send a reset link."
    >
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 3.5, textTransform: 'uppercase', color: K.mid, marginBottom: 8 }}>Password reset</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0a1628', letterSpacing: -0.5, lineHeight: 1.2 }}>
          Forgot your<br /><span style={{ color: K.blue }}>password?</span>
        </h1>
      </div>
      {sent ? (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📬</div>
          <p style={{ fontSize: 15, color: '#1a2230', fontWeight: 600, marginBottom: 8 }}>Check your inbox</p>
          <p style={{ fontSize: 13, color: '#5a7087', lineHeight: 1.6 }}>
            If <strong>{email}</strong> has an account, you'll receive a reset link within a minute. Check your spam folder too.
          </p>
          <button
            onClick={() => navigate('/login')}
            style={{ ...authBtn, marginTop: 24 }}
          >
            Back to sign in
          </button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div style={{ marginBottom: 20 }}>
            <label style={authLabel}>Email address</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" style={authInput} />
          </div>
          <button type="submit" disabled={loading} style={{ ...authBtn, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
          <p style={{ textAlign: 'center', fontSize: 13, color: '#5a7087', marginTop: 14 }}>
            <span onClick={() => navigate('/login')} style={{ color: K.blue, fontWeight: 700, cursor: 'pointer' }}>Back to sign in</span>
          </p>
        </form>
      )}
    </AuthShell>
  );
}

// ── Reset password ─────────────────────────────────────────────────────────────
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [form, setForm]   = useState({ password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const set = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  if (!token) return (
    <AuthShell title="Invalid link" sub="This reset link is missing a token.">
      <p style={{ color: '#e74c3c', fontSize: 14, marginBottom: 16 }}>No reset token found.</p>
      <span onClick={() => navigate('/forgot-password')} style={{ color: K.blue, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
        Request a new reset link →
      </span>
    </AuthShell>
  );

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) { pushToast({ type: 'error', title: "Passwords don't match" }); return; }
    if (form.password.length < 8) { pushToast({ type: 'error', title: 'Password too short', message: 'Minimum 8 characters.' }); return; }
    setLoading(true);
    try {
      const data = await apiResetPassword(token, form.password);
      pushToast({ type: 'success', title: 'Password updated!' });
      navigate(data.user?.role === 'client' ? '/client' : '/dashboard', { replace: true });
    } catch (err) {
      pushToast({ type: 'error', title: 'Reset failed', message: err?.response?.data?.detail || 'Link may have expired.' });
    } finally { setLoading(false); }
  };

  return (
    <AuthShell
      title={<>Choose a new<br /><span style={{ background: K.grad, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>password.</span></>}
      sub="Pick something strong. At least 8 characters."
    >
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 3.5, textTransform: 'uppercase', color: K.mid, marginBottom: 8 }}>New password</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0a1628', letterSpacing: -0.5, lineHeight: 1.2 }}>
          Reset your<br /><span style={{ color: K.blue }}>password</span>
        </h1>
      </div>
      <form onSubmit={submit}>
        <div style={{ marginBottom: 14 }}>
          <label style={authLabel}>New password</label>
          <PasswordInput name="password" value={form.password} onChange={set} placeholder="At least 8 characters" />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={authLabel}>Confirm password</label>
          <PasswordInput name="confirm" value={form.confirm} onChange={set} placeholder="••••••••••" />
        </div>
        <button type="submit" disabled={loading} style={{ ...authBtn, opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </AuthShell>
  );
}
