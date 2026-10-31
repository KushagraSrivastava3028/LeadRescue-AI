'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Clock3, Loader2, ShieldCheck, Users } from 'lucide-react';
import { Brand } from './brand';

const storageKey = 'leadrescue-pending-invitation';
export function InvitationAcceptance() {
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(false);
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
        /* An original fragment can still be accepted during this visit. */
      }
      if (fragment) window.history.replaceState(null, '', window.location.pathname);
      if (!/^[a-f0-9]{64}$/.test(value)) {
        setError('Open the private invitation link your workspace owner shared with you.');
        setLoading(false);
        return;
      }
      setToken(value);
      void fetch('/api/auth', { cache: 'no-store', signal: controller.signal })
        .then(async (response) => {
          const data = await response.json();
          if (controller.signal.aborted) return;
          if (response.ok) setEmail(data.user?.email || '');
          else if (data.code === 'mfa_required')
            setError('Complete two-step verification, then return to this invitation page.');
          else if (response.status !== 401)
            setError(data.error || 'Sign in to your verified account to continue.');
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setError('Account services could not be reached. Try again shortly.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    });
    return () => controller.abort();
  }, []);
  async function accept(event: React.FormEvent) {
    event.preventDefault();
    if (!token || !email || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept-invitation', token }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(
          data.error ||
            'This invitation is unavailable. Check that you signed in using the invited email address.',
        );
        return;
      }
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Joining does not depend on browser storage. */
      }
      setJoined(true);
      setToken('');
    } catch {
      setError('The invitation could not be accepted. Try again shortly.');
    } finally {
      setBusy(false);
    }
  }
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
          <span className="eyebrow">BETTER TOGETHER</span>
          <h1>
            A place
            <br />
            on the team.
          </h1>
          <p>Join your roofing team and help keep every enquiry moving.</p>
          <ul className="auth-benefits">
            <li>
              <Users />
              Access set by your workspace owner
            </li>
            <li>
              <ShieldCheck />
              Only the intended verified email can join
            </li>
            <li>
              <Clock3 />
              Private links expire after 48 hours
            </li>
          </ul>
        </div>
        <section className="auth-card">
          <div className="auth-card-icon">
            <Users />
          </div>
          <h2>{joined ? 'You’re on the team.' : 'Join your workspace'}</h2>
          <p className="auth-subtitle">
            {joined ? (
              'Your invitation was accepted. Your assigned role controls what you can do.'
            ) : email ? (
              <>
                Signed in as <strong>{email}</strong>. Accept only if this invitation was intended
                for you.
              </>
            ) : (
              'Sign in with the email address your workspace owner invited. You can return to this page after signing in.'
            )}
          </p>
          {loading ? (
            <p className="auth-subtitle" role="status">
              <Loader2 className="spin" size={18} />
              Checking your account…
            </p>
          ) : joined ? (
            <Link className="button primary full" href="/app">
              Open workspace
              <ArrowRight size={17} />
            </Link>
          ) : email && token ? (
            <form onSubmit={accept}>
              <button className="button primary full" disabled={busy}>
                {busy ? <Loader2 className="spin" size={17} /> : <Users size={17} />}Accept
                invitation
              </button>
            </form>
          ) : token ? (
            <>
              <Link className="button primary full" href="/signin">
                Sign in
                <ArrowRight size={17} />
              </Link>
              <Link className="text-link centered" href="/signup">
                Create a verified account
              </Link>
              <Link className="text-link centered" href="/two-factor">
                Complete two-step verification
              </Link>
            </>
          ) : null}
          {error && (
            <p className="form-message error" role="alert">
              {error}
            </p>
          )}
          {email && !joined && (
            <Link className="text-link centered" href="/signin">
              Use a different account
            </Link>
          )}
          {token && !joined && (
            <button
              className="text-link centered"
              onClick={() => {
                try {
                  sessionStorage.removeItem(storageKey);
                } catch {}
                setToken('');
                setError('Invitation cleared. Ask your owner for a fresh link if needed.');
              }}
            >
              Discard this invitation
            </button>
          )}
          <div className="auth-card-footer">
            Never share a private invitation link with anyone else.
          </div>
        </section>
      </main>
    </div>
  );
}
