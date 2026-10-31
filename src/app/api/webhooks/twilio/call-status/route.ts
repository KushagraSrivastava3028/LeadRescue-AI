import { z } from 'zod';
import { voiceXml } from '@/lib/server/providers/telephony';
import { persistTwilio, verifiedTwilio, webhookResponse } from '../../shared';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const input = await verifiedTwilio(request, 'To');
    z.object({
      CallSid: z.string().regex(/^CA[a-fA-F0-9]{32}$/),
      DialCallStatus: z.enum(['completed', 'answered', 'busy', 'no-answer', 'failed', 'canceled']),
      DialCallSid: z.string().regex(/^CA[a-fA-F0-9]{32}$/),
    })
      .passthrough()
      .parse(input.params);
    await persistTwilio({ ...input, topic: 'twilio.call_status' });
    // End the parent call after Dial. No automated voice AI or extra outbound call.
    const xml = voiceXml({}).replace(/<Say>[\s\S]*?<\/Say>/, '');
    return new Response(xml, {
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return webhookResponse(error);
  }
}
