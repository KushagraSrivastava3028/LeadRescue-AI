'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="error-page">
      <span className="eyebrow">Something interrupted the connection</span>
      <h1>Let’s try that again.</h1>
      <p>Your changes may not have been saved. Please check before retrying.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
