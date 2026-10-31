import { notFound } from 'next/navigation';
import { AuthScreen } from '@/components/auth-screen';
const pages = [
  'signin',
  'signup',
  'verify-email',
  'forgot-password',
  'reset-password',
  'two-factor',
];
export default async function AuthPage({ params }: { params: Promise<{ authPage: string }> }) {
  const { authPage } = await params;
  if (!pages.includes(authPage)) notFound();
  return <AuthScreen page={authPage} />;
}
