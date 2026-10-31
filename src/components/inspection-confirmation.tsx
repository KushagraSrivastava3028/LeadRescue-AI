'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, Check, Info, Loader2, ShieldCheck } from 'lucide-react';
import { Brand } from './brand';

type RequestDetails = {
  business: { name: string; timezone: string };
  appointment: {
    id: string;
    start_at: string;
    end_at: string;
    status: string;
    customer_confirmed_at: string | null;
  };
};
const storageKey = 'leadrescue-inspection-confirmation';

export function InspectionConfirmation() {
  const [token, setToken] = useState('');
  const [details, setDetails] = useState<RequestDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async (value: string, signal?: AbortSignal) => {
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/appointments/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'view', token: value }),
        signal,
      });
      const data = await response.json();
      if (signal?.aborted) return;
      if (!response.ok) {
        setError(data.error || 'This inspection request is unavailable.');
        return;
      }
      setDetails(data);
    } catch {
      if (!signal?.aborted)
        setError('This inspection request could not be loaded. Try again shortly.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      const fragment = new URLSearchParams(window.location.hash.slice(1)).get('token');
      let value = fragment || '';
      try {
        if (fragment) sessionStorage.setItem(storageKey, fragment);
        else value = sessionStorage.getItem(storageKey) || '';
      } catch {
        /* The fragment can still be used for this visit. */
      }
      if (fragment) window.history.replaceState(null, '', window.location.pathname);
      if (!value || value.length > 2048) {
        setError(
          'Open the confirmation link your roofing team shared with you. Links expire after 30 minutes.',
        );
        setLoading(false);
        return;
      }
      setToken(value);
      void load(value, controller.signal);
    });
    return () => controller.abort();
  }, [load]);
  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!accepted || busy || !token) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/appointments/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', token, confirm: true }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Your request could not be saved.');
        return;
      }
      setMessage(data.message);
      setAccepted(false);
      setDetails((previous) =>
        previous
          ? {
              ...previous,
              appointment: {
                ...previous.appointment,
                status: data.status,
                customer_confirmed_at: new Date().toISOString(),
              },
            }
          : previous,
      );
      if (data.status === 'confirmed') {
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* No storage was required. */
        }
      }
    } catch {
      setError('We could not verify the result. Refresh the request status before trying again.');
    } finally {
      setBusy(false);
    }
  }
  const appointment = details?.appointment;
  const received = Boolean(appointment?.customer_confirmed_at);
  const time = (() => {
    if (!details) return '';
    try {
      return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: details.business.timezone,
      }).format(new Date(details.appointment.start_at));
    } catch {
      return 'Time unavailable';
    }
  })();
  return (
    <div className="auth-page">
      <header className="auth-header">
        <Brand />
        <Link href="/">
          <ArrowLeft size={15} />
          Back to home
        </Link>
      </header>
      <main className="auth-main">
        <div className="auth-copy">
          <span className="eyebrow">ONE CLEAR NEXT STEP</span>
          <h1>
            Let’s make time
            <br />
            for your roof.
          </h1>
          <p>
            Review the time your roofing team proposed. Your confirmation requests a final
            availability check.
          </p>
          <ul className="auth-benefits">
            <li>
              <CalendarDays />
              60-minute inspection request
            </li>
            <li>
              <ShieldCheck />
              No payment details required
            </li>
            <li>
              <Check />
              Your team confirms the final booking
            </li>
          </ul>
        </div>
        <section className="auth-card">
          <div className="auth-card-icon">
            <CalendarDays />
          </div>
          <h2>
            {appointment?.status === 'confirmed'
              ? 'Inspection confirmed'
              : received
                ? 'Request received'
                : 'Review your inspection'}
          </h2>
          {loading ? (
            <p className="auth-subtitle" role="status">
              <Loader2 className="spin" size={18} />
              Loading your request…
            </p>
          ) : details ? (
            <>
              <p className="auth-subtitle">
                <strong>{details.business.name}</strong>
                <br />
                {time}
                <br />
                {details.business.timezone}
              </p>
              <div className="notice">
                <Info size={17} />
                <span>
                  {appointment?.status === 'confirmed'
                    ? "The booking was created successfully in the team's calendar."
                    : received
                      ? 'Your team will confirm availability or contact you to arrange another time.'
                      : 'This is a requested time. It becomes a confirmed appointment after your team’s calendar accepts the booking.'}
                </span>
              </div>
              {!received && appointment?.status === 'requested' && (
                <form onSubmit={confirm}>
                  <label className="checkbox-label">
                    <input
                      required
                      type="checkbox"
                      checked={accepted}
                      onChange={(event) => setAccepted(event.target.checked)}
                    />
                    <span>
                      I am the intended customer and I would like to request this inspection time.
                    </span>
                  </label>
                  <button className="button primary full" disabled={!accepted || busy}>
                    {busy ? <Loader2 className="spin" size={17} /> : <Check size={17} />}Confirm my
                    request
                  </button>
                </form>
              )}
              {received && (
                <button
                  className="button secondary full"
                  disabled={busy || loading}
                  onClick={() => void load(token)}
                >
                  Refresh request status
                </button>
              )}
            </>
          ) : null}
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
          <div className="auth-card-footer">
            Questions or changes? Contact your roofing team directly.
          </div>
        </section>
      </main>
    </div>
  );
}
