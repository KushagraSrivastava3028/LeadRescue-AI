import { loadTestEnvironment } from '@/lib/server/loadtest-environment';
export const dynamic = 'force-dynamic';
export function GET() {
  const state = loadTestEnvironment();
  return Response.json(state ?? { error: 'Not found' }, {
    status: state ? 200 : 404,
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
