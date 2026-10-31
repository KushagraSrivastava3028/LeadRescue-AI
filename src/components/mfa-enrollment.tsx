'use client';
import { useState } from 'react';
import { Check, Loader2, ShieldCheck } from 'lucide-react';

export function MfaEnrollment() {
  const [busy, setBusy] = useState(false);
  const [factorId, setFactorId] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  async function call(body: Record<string, unknown>) {
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Authenticator setup is unavailable.');
    return data;
  }
  async function enroll() {
    setBusy(true);
    setError('');
    try {
      const data = await call({ action: 'mfa-enroll' });
      // Supabase supplies an SVG data URL. Render it as an image; never execute SVG markup.
      if (typeof data.qrCode !== 'string' || !data.qrCode.startsWith('data:image/svg+xml'))
        throw new Error('The authenticator setup image could not be loaded.');
      setFactorId(data.factorId);
      setQrCode(data.qrCode);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Authenticator setup is unavailable.');
    } finally {
      setBusy(false);
    }
  }
  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await call({ action: 'mfa', factorId, code });
      setComplete(true);
      setQrCode('');
      setCode('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'This code could not be verified.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel integration-card">
      <div className="panel-heading">
        <span className="metric-icon green">
          <ShieldCheck size={22} />
        </span>
        <div>
          <h2>Two-step verification</h2>
          <p>An authenticator adds another check when you sign in.</p>
        </div>
      </div>
      {complete ? (
        <div className="notice" role="status">
          <Check size={17} />
          <span>Your authenticator was verified. Future sign-ins require its current code.</span>
        </div>
      ) : factorId ? (
        <form className="settings-form" onSubmit={verify}>
          <p className="auth-subtitle">
            Scan this code with your authenticator app, then enter its six-digit code.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- Provider-generated ephemeral QR data URL, never a remote image. */}
          <img src={qrCode} width={200} height={200} alt="Authenticator setup QR code" />
          <label>
            Authenticator code
            <input
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
            />
          </label>
          <button className="button primary small" disabled={busy || code.length !== 6}>
            {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}Verify
            authenticator
          </button>
        </form>
      ) : (
        <button className="button secondary small" disabled={busy} onClick={() => void enroll()}>
          {busy ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}Set up
          authenticator
        </button>
      )}
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
