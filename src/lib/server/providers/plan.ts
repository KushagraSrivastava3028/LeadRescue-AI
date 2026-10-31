import 'server-only';
import { z } from 'zod';
import { CapabilityUnavailable } from './config';

const settingsSchema = z.object({
  monthlyPriceMinor: z.coerce.number().int().min(1).max(1_000_000).default(29900),
  paidSmsLimit: z.coerce.number().int().min(1).max(100_000).default(500),
  paidAiLimit: z.coerce.number().int().min(1).max(100_000).default(500),
});

/** Safe business settings may be returned as a DTO; no provider secrets are read. */
export function planSettings() {
  const result = settingsSchema.safeParse({
    monthlyPriceMinor: process.env.PLAN_MONTHLY_PRICE_MINOR,
    paidSmsLimit: process.env.PLAN_PAID_SMS_LIMIT,
    paidAiLimit: process.env.PLAN_PAID_AI_LIMIT,
  });
  if (!result.success) throw new CapabilityUnavailable('Approved billing plan settings');
  return {
    ...result.data,
    currency: 'usd' as const,
    interval: 'month' as const,
    overageBehavior: 'pause' as const,
  };
}

/** Server/provider data is checked before checkout or paid entitlement writes. */
export function assertPlanPrice(
  price: unknown,
  expectedPriceId: string,
  requireActive = true,
): void {
  const schema = z
    .object({
      id: z.literal(expectedPriceId),
      active: z.boolean(),
      currency: z.literal('usd'),
      type: z.literal('recurring'),
      billing_scheme: z.literal('per_unit'),
      unit_amount: z.number().int(),
      custom_unit_amount: z.null(),
      transform_quantity: z.null(),
      recurring: z
        .object({
          interval: z.literal('month'),
          interval_count: z.literal(1),
          usage_type: z.literal('licensed'),
        })
        .passthrough(),
    })
    .passthrough();
  const parsed = schema.safeParse(price);
  if (
    !parsed.success ||
    parsed.data.unit_amount !== planSettings().monthlyPriceMinor ||
    (requireActive && !parsed.data.active)
  )
    throw new CapabilityUnavailable('Approved Stripe price configuration');
}
