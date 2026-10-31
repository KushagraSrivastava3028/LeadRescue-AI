import { Workspace } from '@/components/workspace';
import { notFound } from 'next/navigation';
export const metadata = { title: 'Demo workspace' };
export default async function DemoPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  const name = section?.[0] || 'overview';
  if (
    (section && section.length > 1) ||
    !['overview', 'inbox', 'leads', 'calendar', 'assistant', 'settings', 'billing'].includes(name)
  )
    notFound();
  return <Workspace demo section={name} />;
}
