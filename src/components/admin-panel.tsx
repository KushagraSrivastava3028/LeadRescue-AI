'use client';
import { useState } from 'react';
import { CirclePause, Loader2, Search, ShieldCheck } from 'lucide-react';

type OperationsResult = {
  business: {
    id: string;
    name: string;
    state: string;
    created_at: string;
    suspended_at: string | null;
  } | null;
  pendingEvents: { id: string; topic: string; attempts: number; available_at: string }[];
  attempts: { id: string; status: string; error_code: string | null; created_at: string }[];
};

export function AdminPanel() {
  const [businessId, setBusinessId] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<OperationsResult | null>(null);
  async function run(action: 'inspect' | 'pause') {
    if (busy || !businessId || reason.trim().length < 10 || (action === 'pause' && !confirmed))
      return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, businessId, reason }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'This operation could not be completed.');
        return;
      }
      if (action === 'inspect') setResult(data);
      else {
        setMessage(data.message);
        setConfirmed(false);
        setResult(null);
      }
    } catch {
      setError('The operations service is unavailable. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="public-width">
      <div className="page-heading">
        <div>
          <span className="eyebrow">RESTRICTED PLATFORM OPERATIONS</span>
          <h1>Keep the work moving.</h1>
          <p>
            Inspect a specific workspace or pause its automation. Every operation records your
            identity and support reason.
          </p>
        </div>
        <ShieldCheck size={32} />
      </div>
      <section className="panel settings-form">
        <div className="panel-heading">
          <div>
            <h2>Workspace operation</h2>
            <p>Customer conversations and integration credentials are excluded from this view.</p>
          </div>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run('inspect');
          }}
        >
          <div className="form-grid">
            <label>
              Business ID
              <input
                required
                value={businessId}
                onChange={(event) => {
                  setBusinessId(event.target.value);
                  setResult(null);
                }}
                placeholder="Workspace UUID"
                maxLength={36}
                pattern="[a-fA-F0-9-]{36}"
                autoComplete="off"
              />
            </label>
            <label>
              Support reason
              <textarea
                required
                minLength={10}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                placeholder="Explain the specific support request or incident."
              />
            </label>
          </div>
          <div className="settings-form-footer">
            <button className="button secondary small" disabled={busy}>
              {busy ? <Loader2 className="spin" size={16} /> : <Search size={16} />}Inspect
              workspace
            </button>
          </div>
        </form>
        <div className="notice amber-notice">
          <CirclePause size={18} />
          <span>
            Pausing stops automated recovery work. Ordinary call routing and essential suppression
            processing remain available.
          </span>
        </div>
        <div className="settings-form-footer">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>I intend to pause automation for the workspace above.</span>
          </label>
          <button
            className="button secondary small"
            disabled={busy || !confirmed || !businessId || reason.trim().length < 10}
            onClick={() => void run('pause')}
          >
            Pause automation
          </button>
        </div>
        {error && (
          <p className="form-message error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="form-message success" role="status">
            {message}
          </p>
        )}
      </section>
      {result && (
        <div className="settings-stack">
          <section className="panel">
            <div className="panel-heading">
              <h2>{result.business?.name || 'Workspace unavailable'}</h2>
              <span className="badge gray">{result.business?.state || 'Unknown'}</span>
            </div>
            <div className="integration-detail">
              <span>Pending events shown</span>
              <strong>{result.pendingEvents.length} / maximum 50</strong>
            </div>
            <div className="integration-detail">
              <span>Recent attempts shown</span>
              <strong>{result.attempts.length} / maximum 50</strong>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Pending event delivery</h2>
            </div>
            {result.pendingEvents.length ? (
              result.pendingEvents.map((event) => (
                <div className="integration-detail" key={event.id}>
                  <span>{event.topic}</span>
                  <strong>
                    {event.attempts} attempts · {new Date(event.available_at).toLocaleString()}
                  </strong>
                </div>
              ))
            ) : (
              <p className="auth-subtitle">No pending events in this result.</p>
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Recent job attempts</h2>
            </div>
            {result.attempts.length ? (
              result.attempts.map((attempt) => (
                <div className="integration-detail" key={attempt.id}>
                  <span>{attempt.status}</span>
                  <strong>
                    {attempt.error_code || 'No error code'} ·{' '}
                    {new Date(attempt.created_at).toLocaleString()}
                  </strong>
                </div>
              ))
            ) : (
              <p className="auth-subtitle">No job attempts in this result.</p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
