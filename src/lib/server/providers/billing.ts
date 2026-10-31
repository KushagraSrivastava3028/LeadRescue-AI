import 'server-only';
import Stripe from 'stripe';
import { appOrigin, billingConfig } from './config';
import { assertPlanPrice, planSettings } from './plan';
export { planSettings } from './plan';

export function stripeClient(): Stripe {
  return new Stripe(billingConfig().secretKey, { timeout: 10000, maxNetworkRetries: 1 });
}

export async function ensureBillingCustomer(input: {
  businessId: string;
  email: string;
  name: string;
}): Promise<{ customerId: string }> {
  const customer = await stripeClient().customers.create(
    { email: input.email, name: input.name.slice(0, 120) },
    { idempotencyKey: `customer:${input.businessId}` },
  );
  return { customerId: customer.id };
}

export async function createCheckout(input: {
  businessId: string;
  customerId: string;
  trialEndsAt?: Date | null;
  acceptedTermsAt: string;
}): Promise<{ url: string }> {
  const config = billingConfig();
  if (!input.acceptedTermsAt || !Number.isFinite(Date.parse(input.acceptedTermsAt)))
    throw new Error('Recurring pricing acceptance required');
  // Customer identity must already be recorded server-side. Never use browser metadata as authoritative mapping.
  if (
    input.trialEndsAt &&
    input.trialEndsAt.getTime() > Date.now() &&
    input.trialEndsAt.getTime() <= Date.now() + 48 * 60 * 60_000
  )
    throw new Error(
      'Return after trial expiry to subscribe; your remaining trial will not be shortened',
    );
  const trialEnd =
    input.trialEndsAt && input.trialEndsAt.getTime() > Date.now()
      ? Math.floor(input.trialEndsAt.getTime() / 1000)
      : undefined;
  const sdk = stripeClient();
  assertPlanPrice(await sdk.prices.retrieve(config.priceId), config.priceId);
  const open = await sdk.checkout.sessions.list({
    customer: input.customerId,
    status: 'open',
    limit: 10,
  });
  const reusable = open.data.find((s) => s.mode === 'subscription' && s.url);
  if (reusable?.url) {
    const items = await sdk.checkout.sessions.listLineItems(reusable.id, { limit: 2 });
    if (items.data.length !== 1 || items.data[0].quantity !== 1)
      throw new Error('Checkout plan configuration changed');
    assertPlanPrice(items.data[0].price, config.priceId);
    return { url: reusable.url };
  }
  const settings = planSettings();
  const session = await sdk.checkout.sessions.create(
    {
      mode: 'subscription',
      customer: input.customerId,
      line_items: [{ price: config.priceId, quantity: 1 }],
      adaptive_pricing: { enabled: false },
      consent_collection: { terms_of_service: 'required' },
      subscription_data: trialEnd ? { trial_end: trialEnd } : undefined,
      success_url: `${appOrigin()}/app/billing?checkout=returned`,
      cancel_url: `${appOrigin()}/app/billing`,
      custom_text: {
        submit: {
          message: `Recurring monthly subscription including ${settings.paidSmsLimit} SMS segments and ${settings.paidAiLimit} AI qualification calls per paid period. Automation pauses at the cap; no automatic overages. Cancel through Billing.`,
        },
      },
    },
    {
      idempotencyKey: `checkout:${input.businessId}:${input.trialEndsAt?.toISOString() ?? 'no-trial'}`,
    },
  );
  if (!session.url) throw new Error('Checkout unavailable');
  return { url: session.url };
}

export async function createPortal(customerId: string): Promise<{ url: string }> {
  const session = await stripeClient().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appOrigin()}/app/billing`,
  });
  return { url: session.url };
}

export function verifyBillingWebhook(body: string, signature: string): Stripe.Event {
  return stripeClient().webhooks.constructEvent(
    body,
    signature,
    billingConfig().webhookSecret,
    300,
  );
}
