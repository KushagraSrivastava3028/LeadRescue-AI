import { z } from 'zod';
import { twilioConfig } from '@/lib/server/providers/config';
import { voiceXml } from '@/lib/server/providers/telephony';
import { validForwarding } from '@/lib/domain/recovery';
import { persistTwilio, verifiedTwilio, webhookResponse } from '../../shared';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const input = await verifiedTwilio(request, 'To');
    z.object({
      CallSid: z.string().regex(/^CA[a-fA-F0-9]{32}$/),
      From: z.string().max(40),
      To: z.string().max(40),
    })
      .passthrough()
      .parse(input.params);
    await persistTwilio({ ...input, topic: 'twilio.voice' });
    const destination = input.mapping.forward_to;
    const eligible =
      destination &&
      input.mapping.routing_enabled &&
      validForwarding(input.mapping.phone, destination, !!input.mapping.destination_verified_at);
    const xml = voiceXml(
      eligible
        ? {
            forwardTo: destination,
            actionUrl: `${twilioConfig().webhookOrigin}/api/webhooks/twilio/call-status`,
          }
        : {},
    );
    return new Response(xml, {
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return webhookResponse(error);
  }
}
