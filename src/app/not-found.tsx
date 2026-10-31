import Link from 'next/link';
import { Brand } from '@/components/brand';
export default function NotFound() {
  return (
    <main className="error-page">
      <Brand />
      <span className="eyebrow">404 · A little off course</span>
      <h1>
        Let’s get you back
        <br />
        to your next job.
      </h1>
      <p>The page you’re looking for isn’t here.</p>
      <Link className="button primary" href="/">
        Back to home →
      </Link>
    </main>
  );
}
