import { Workspace } from '@/components/workspace';
import { requireUser } from '@/lib/server/authorization';
import { HttpError } from '@/lib/server/security';
import { redirect, notFound } from 'next/navigation';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your workspace' };
export default async function AppPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  const name = section?.[0] || 'overview';
  if (
    (section && section.length > 1) ||
    !['overview', 'inbox', 'leads', 'calendar', 'assistant', 'settings', 'billing'].includes(name)
  )
    notFound();
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof HttpError && error.code === 'mfa_required') redirect('/two-factor');
    redirect('/signin');
  }
  return <Workspace demo={false} section={name} />;
}
