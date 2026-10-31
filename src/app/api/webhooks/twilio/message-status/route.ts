import { z } from 'zod';
import { persistTwilio, verifiedTwilio, webhookResponse } from '../../shared';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const input = await verifiedTwilio(request, 'From');
    z.object({
      MessageSid: z.string().regex(/^(SM|MM)[a-fA-F0-9]{32}$/),
      MessageStatus: z.enum([
        'accepted',
        'scheduled',
        'queued',
        'sending',
        'sent',
        'delivered',
        'undelivered',
        'failed',
        'canceled',
        'read',
      ]),
    })
      .passthrough()
      .parse(input.params);
    await persistTwilio({ ...input, topic: 'twilio.message_status' });
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return webhookResponse(error);
  }
}
