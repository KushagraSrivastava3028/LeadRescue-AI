'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChartNoAxesCombined,
  Eye,
  EyeOff,
  Info,
  Loader2,
  LockKeyhole,
  Mail,
  Phone,
  RotateCw,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react';
import { Brand } from './brand';

const details: Record<
  string,
  { badge: string; title: string; description: string; heading: string }
> = {
  signin: {
    badge: 'GOOD TO HAVE YOU BACK',
    title: 'Your next job\ncould be calling.',
    description: 'Sign in and pick up right where your team left off.',
    heading: 'Welcome back',
  },
  signup: {
    badge: 'A BETTER DAY STARTS HERE',
    title: 'A little backup.\nA fresh start.',
    description: 'Recover more opportunities with an assistant that has your back.',
    heading: 'Create your account',
  },
  'verify-email': {
    badge: 'Almost there',
    title: 'Verify your email\nto get started.',
    description: 'A quick step to keep your account secure and get you to your leads faster.',
    heading: 'Check your inbox',
  },
  'forgot-password': {
    badge: 'Need to get back in?',
    title: 'Reset your\npassword.',
    description: 'Enter your email address and we’ll send you a link to create a new password.',
    heading: 'Reset your password',
  },
  'reset-password': {
    badge: 'Almost done',
    title: 'Create a new\npassword.',
    description: 'Choose a strong password to keep your account secure.',
    heading: 'Set a new password',
  },
  'two-factor': {
    badge: 'Keep your account secure',
    title: 'Verify it’s you.',
    description: 'Enter the 6-digit code from your authenticator app to continue.',
    heading: 'Enter your code',
  },
};
export function AuthScreen({ page }: { page: string }) {
  const router = useRouter();
  const d = details[page];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [show, setShow] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [code, setCode] = useState('');
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const e = sessionStorage.getItem('leadrescue-verification-email');
        if (e) setEmail(e);
      } catch {
        /* Email can still be entered manually. */
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);
  async function submit(e?: React.FormEvent, resend = false) {
    e?.preventDefault();
    setError('');
    setMessage('');
    if (page === 'signup' && !agreed) {
      setError('Please review and accept the Terms and Privacy Policy.');
      return;
    }
    if (['signup', 'reset-password'].includes(page) && password !== confirm) {
      setError('Your passwords don’t match.');
      return;
    }
    setBusy(true);
    const action = resend
      ? 'resend'
      : {
          signin: 'signin',
          signup: 'signup',
          'forgot-password': 'reset',
          'reset-password': 'update-password',
          'two-factor': 'mfa',
          'verify-email': 'resend',
        }[page];
    const body: Record<string, unknown> = { action };
    if (['signin', 'signup', 'reset', 'resend'].includes(action || '')) body.email = email;
    if (['signin', 'signup', 'update-password'].includes(action || '')) body.password = password;
    if (action === 'signup') {
      body.name = name;
      body.termsAccepted = agreed;
    }
    if (action === 'update-password') body.confirmPassword = confirm;
    if (action === 'mfa') body.code = code;
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'We couldn’t complete that request. Please try again.');
        return;
      }
      setMessage(data.message || 'Request received.');
      if (action === 'signup' || action === 'resend') {
        sessionStorage.setItem('leadrescue-verification-email', email);
        setCountdown(60);
      }
      if (data.redirect) {
        let invitation = '';
        try {
          invitation = sessionStorage.getItem('leadrescue-pending-invitation') || '';
        } catch {}
        window.location.assign(
          (action === 'signin' || action === 'mfa') &&
            !data.mfaRequired &&
            /^[a-f0-9]{64}$/.test(invitation)
            ? '/invite'
            : data.redirect,
        );
      } else if (action === 'signup') router.push('/verify-email');
    } catch {
      setError('The service is unavailable. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  }
  const passwordField = (isConfirm = false) => (
    <div className="input-wrap">
      <LockKeyhole size={17} />
      <input
        required
        minLength={8}
        maxLength={128}
        type={(isConfirm ? showConfirm : show) ? 'text' : 'password'}
        placeholder={
          isConfirm
            ? 'Confirm your new password'
            : page === 'signin'
              ? 'Enter your password'
              : 'Create a strong password'
        }
        value={isConfirm ? confirm : password}
        onChange={(e) => (isConfirm ? setConfirm(e.target.value) : setPassword(e.target.value))}
        autoComplete={page === 'signin' ? 'current-password' : 'new-password'}
      />
      <button
        type="button"
        aria-label={isConfirm ? 'Toggle confirm password visibility' : 'Toggle password visibility'}
        onClick={() => (isConfirm ? setShowConfirm(!showConfirm) : setShow(!show))}
      >
        {(isConfirm ? showConfirm : show) ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
  return (
    <div className={`auth-page ${page === 'signin' || page === 'signup' ? 'account-auth' : ''}`}>
      <header className="auth-header">
        <Brand />
        <Link href={page === 'signin' || page === 'signup' ? '/' : '/signin'}>
          <ArrowLeft size={15} />
          {page === 'signin' || page === 'signup' ? 'Back to home' : 'Back to sign in'}
        </Link>
      </header>
      <main className="auth-main">
        <div className="auth-copy">
          <span className="eyebrow">{d.badge}</span>
          <h2 className="auth-display">
            {d.title.split('\n').map((line, i) => (
              <span key={line}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
          </h2>
          <p>{d.description}</p>
          <ul className="auth-benefits">
            <li>
              <Phone />
              Recover missed calls with AI
            </li>
            <li>
              <Users />
              Turn enquiries into booked jobs
            </li>
            <li>
              <ChartNoAxesCombined />
              Built for roofing contractors
            </li>
          </ul>
          <div className="auth-testimonial">
            <p>
              “Get back to the work you do best.
              <br />
              We’ll help with the first hello.”
            </p>
            <span>YOUR NEXT OPPORTUNITY IS WORTH AN ANSWER.</span>
          </div>
        </div>
        <div className="auth-card">
          {['verify-email', 'forgot-password', 'two-factor', 'reset-password'].includes(page) && (
            <div className="auth-card-icon">
              {page === 'two-factor' ? (
                <ShieldCheck />
              ) : page === 'reset-password' ? (
                <LockKeyhole />
              ) : (
                <Mail />
              )}
            </div>
          )}
          <h1 className="auth-title">{d.heading}</h1>
          <p className="auth-subtitle">
            {page === 'signin' ? (
              'Sign in to your LeadRescue account.'
            ) : page === 'signup' ? (
              'Start with a 14-day trial after phone setup.'
            ) : page === 'verify-email' ? (
              <>
                If your signup was accepted, a verification link was sent to
                <br />
                <strong>{email || 'your email address'}</strong>
              </>
            ) : page === 'forgot-password' ? (
              'Enter the email address associated with your LeadRescue account.'
            ) : page === 'reset-password' ? (
              'Your new password must be different from your previous password.'
            ) : (
              'Open your authenticator app and enter the 6-digit code for your LeadRescue account.'
            )}
          </p>
          <form onSubmit={submit}>
            {page === 'signup' && (
              <label>
                Your name
                <div className="input-wrap">
                  <UserRound size={17} />
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={80}
                    autoComplete="name"
                    placeholder="Alex Morgan"
                  />
                </div>
              </label>
            )}
            {['signin', 'signup', 'forgot-password'].includes(page) && (
              <label>
                {page === 'forgot-password' ? 'Email address' : 'Work email'}
                <div className="input-wrap">
                  <Mail size={17} />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    maxLength={254}
                    autoComplete="email"
                    placeholder="you@yourcompany.com"
                  />
                </div>
              </label>
            )}
            {['signin', 'signup', 'reset-password'].includes(page) && (
              <label>
                {page === 'reset-password' ? 'New password' : 'Password'}
                {passwordField()}
                {page === 'signup' && (
                  <span className="password-help">
                    At least 8 characters, including a letter and a number.
                  </span>
                )}
              </label>
            )}
            {['signup', 'reset-password'].includes(page) && (
              <label>Confirm password{passwordField(true)}</label>
            )}
            {page === 'reset-password' && (
              <div className="password-requirements">
                <span className={password.length >= 8 ? 'met' : ''}>
                  <Check size={13} /> At least 8 characters
                </span>
                <span className={/[a-z]/i.test(password) && /\d/.test(password) ? 'met' : ''}>
                  <Check size={13} /> Includes a letter and a number
                </span>
              </div>
            )}
            {page === 'signin' && (
              <div className="signin-help">
                <span>
                  <ShieldCheck size={14} /> Secure sign in
                </span>
                <Link href="/forgot-password">Forgot password?</Link>
              </div>
            )}
            {page === 'signup' && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  required
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <span>
                  I agree to the{' '}
                  <Link href="/terms" target="_blank">
                    Terms of Service
                  </Link>{' '}
                  and{' '}
                  <Link href="/privacy" target="_blank">
                    Privacy Policy
                  </Link>
                  .
                </span>
              </label>
            )}
            {page === 'verify-email' && (
              <div className="notice">
                <Info size={18} />
                <span>
                  Click the link in the email to verify your account. The provider’s configured
                  expiration applies.
                </span>
              </div>
            )}
            {page === 'two-factor' && (
              <div
                className="otp-inputs"
                onPaste={(e) => {
                  const value = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
                  if (value) {
                    e.preventDefault();
                    setCode(value);
                    inputs.current[Math.min(value.length, 5)]?.focus();
                  }
                }}
              >
                {Array.from({ length: 6 }, (_, i) => (
                  <input
                    aria-label={`Digit ${i + 1}`}
                    key={i}
                    ref={(el) => {
                      inputs.current[i] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    maxLength={1}
                    value={code[i] || ''}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace' && !code[i] && i > 0)
                        inputs.current[i - 1]?.focus();
                    }}
                    onChange={(e) => {
                      const digit = e.target.value.replace(/\D/g, '').slice(-1);
                      setCode((prev) => prev.substring(0, i) + digit + prev.substring(i + 1));
                      if (digit && i < 5) inputs.current[i + 1]?.focus();
                    }}
                  />
                ))}
              </div>
            )}
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
            <button
              type="submit"
              className={`button ${page === 'verify-email' ? 'secondary' : 'primary'} full`}
              disabled={
                busy ||
                (page === 'verify-email' && countdown > 0) ||
                (page === 'two-factor' && code.length !== 6)
              }
            >
              {busy ? (
                <Loader2 size={18} className="spin" />
              ) : page === 'verify-email' ? (
                <RotateCw size={17} />
              ) : null}
              {page === 'signin'
                ? 'Sign in'
                : page === 'signup'
                  ? 'Create account'
                  : page === 'verify-email'
                    ? `Resend email${countdown > 0 ? ` (${countdown}s)` : ''}`
                    : page === 'forgot-password'
                      ? 'Send reset link'
                      : page === 'reset-password'
                        ? 'Update password'
                        : 'Verify and continue'}
              {['signin', 'signup'].includes(page) && <ArrowRight size={17} />}
            </button>
            {page === 'forgot-password' && (
              <p className="microcopy centered">If an account exists, we’ll email a link.</p>
            )}
          </form>
          <div className="auth-card-footer">
            {page === 'signin' ? (
              <>
                New around here?{' '}
                <Link href="/signup">
                  Create your account <ArrowRight size={13} />
                </Link>
              </>
            ) : page === 'signup' ? (
              <>
                Already have an account? <Link href="/signin">Sign in</Link>
              </>
            ) : page === 'verify-email' ? (
              <Link href="/signup">Use a different email</Link>
            ) : page === 'reset-password' ? (
              <Link href="/forgot-password">Request a new reset link</Link>
            ) : page === 'two-factor' ? (
              <span>Lost your authenticator? Contact your account operator.</span>
            ) : (
              <Link href="/signin">
                <ArrowLeft size={13} /> Back to sign in
              </Link>
            )}
          </div>
        </div>
      </main>
      <footer className="auth-footer">
        <span>Good work starts with a good connection.</span>
        <div>
          <ShieldCheck size={14} /> Your account, protected.
        </div>
      </footer>
    </div>
  );
}
