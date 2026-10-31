import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { requirePlatformAdmin } from '@/lib/server/authorization';
import { AdminPanel } from '@/components/admin-panel';
import { Brand } from '@/components/brand';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Platform operations', robots: { index: false, follow: false } };

export default async function AdminPage() {
  let allowed = false;
  try {
    await requirePlatformAdmin();
    allowed = true;
  } catch {
    /* Do not enumerate administrator membership or configuration. */
  }
  return (
    <div className="auth-page">
      <header className="auth-header">
        <Brand />
        <Link href="/app">
          <ArrowLeft size={15} />
          Back to workspace
        </Link>
      </header>
      {allowed ? (
        <AdminPanel />
      ) : (
        <main className="public-width">
          <section className="auth-card">
            <div className="auth-card-icon">
              <ShieldCheck />
            </div>
            <h2>Access unavailable</h2>
            <p className="auth-subtitle">
              This area requires a verified platform operator account and two-step verification.
              Sign in with an authorized account to continue.
            </p>
            <Link className="button primary full" href="/signin">
              Sign in
            </Link>
          </section>
        </main>
      )}
    </div>
  );
}
