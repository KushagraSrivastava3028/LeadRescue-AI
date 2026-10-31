import type { Metadata, Viewport } from 'next';
import './globals.css';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: { default: 'LeadRescue — Every enquiry deserves an answer.', template: '%s | LeadRescue' },
  description:
    'Turn eligible missed calls into your next roofing job. A shared inbox, thoughtful AI follow-up, and a clearer day for your team.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#087443' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
