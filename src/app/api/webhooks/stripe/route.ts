import { stripeClient, verifyBillingWebhook } from '@/lib/server/providers/billing';
import { query } from '@/lib/server/providers/database';
import { rawBody, WebhookError, webhookResponse } from '../shared';

export const runtime = 'nodejs';
const supported = new Set([
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'charge.refunded',
  'charge.dispute.created',
]);
export async function POST(request: Request) {
  try {
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json')
      throw new WebhookError(415);
    const body = await rawBody(request, 256_000);
    const signature = request.headers.get('stripe-signature');
    if (!signature) throw new WebhookError(403);
    let event;
    try {
      event = verifyBillingWebhook(body, signature);
    } catch {
      throw new WebhookError(403);
    }
    if (!supported.has(event.type)) return new Response(null, { status: 204 });
    const object = event.data.object as unknown as {
      id: string;
      customer?: string | { id: string };
      subscription?: string;
      charge?: string;
    };
    let customer = typeof object.customer === 'string' ? object.customer : object.customer?.id;
    // Dispute payloads reference a charge rather than carrying customer directly.
    if (!customer && event.type === 'charge.dispute.created' && object.charge) {
      const charge = await stripeClient().charges.retrieve(object.charge);
      customer = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id;
    }
    if (!customer) throw new WebhookError(400);
    const [mapping] = await query<{ business_id: string }>(
      'select business_id from public.subscriptions where provider_customer_id=$1',
      [customer],
    );
    if (!mapping) throw new WebhookError(409);
    const admission = await query<{ result: { allowed: boolean } }>(
      'select public.consume_rate_limit($1,1200,60) result',
      [`webhook:stripe:${mapping.business_id}`],
    );
    if (!admission[0]?.result.allowed) throw new WebhookError(429);
    await query("select public.persist_webhook($1,'stripe',$2,$3::jsonb,'stripe.event')", [
      mapping.business_id,
      event.id,
      JSON.stringify({
        id: event.id,
        type: event.type,
        created: event.created,
        customer,
        objectId: object.id,
      }),
    ]);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return webhookResponse(error);
  }
}
