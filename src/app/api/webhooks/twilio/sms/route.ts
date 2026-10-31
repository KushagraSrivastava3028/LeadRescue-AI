import { z } from 'zod';
import { emptyMessagingXml } from '@/lib/server/providers/telephony';
import { persistTwilio, verifiedTwilio, webhookResponse } from '../../shared';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const input = await verifiedTwilio(request, 'To');
    z.object({
      MessageSid: z.string().regex(/^(SM|MM)[a-fA-F0-9]{32}$/),
      From: z.string().regex(/^\+1[2-9]\d{9}$/),
      Body: z.string().max(1600),
    })
      .passthrough()
      .parse(input.params);
    await persistTwilio({ ...input, topic: 'twilio.sms' });
    // Advanced Opt-Out owns STOP/HELP confirmations. Never duplicate them with app messages.
    return new Response(emptyMessagingXml(), {
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return webhookResponse(error);
  }
}
