import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ price: vi.fn(), list: vi.fn(), create: vi.fn(), items: vi.fn() }));
vi.mock('stripe', () => ({
  default: vi.fn(function () {
    return {
      prices: { retrieve: fake.price },
      checkout: { sessions: { list: fake.list, create: fake.create, listLineItems: fake.items } },
    };
  }),
}));
import { assertPlanPrice, planSettings } from '../src/lib/server/providers/plan';
import { createCheckout } from '../src/lib/server/providers/billing';
function fixturePrice() {
  return {
    id: 'price_fixture',
    active: true,
    currency: 'usd',
    type: 'recurring',
    billing_scheme: 'per_unit',
    unit_amount: 29900,
    custom_unit_amount: null,
    transform_quantity: null,
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
  };
}
beforeEach(() => {
  vi.stubEnv('PLAN_MONTHLY_PRICE_MINOR', '29900');
  vi.stubEnv('PLAN_PAID_SMS_LIMIT', '500');
  vi.stubEnv('PLAN_PAID_AI_LIMIT', '500');
  vi.stubEnv('BILLING_ENABLED', 'true');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_synthetic_fixture');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_synthetic_fixture');
  vi.stubEnv('STRIPE_PRICE_ID', 'price_fixture');
  vi.stubEnv('APP_ORIGIN', 'https://app.example.test');
  fake.price.mockReset().mockResolvedValue(fixturePrice());
  fake.list.mockReset().mockResolvedValue({ data: [] });
  fake.create.mockReset().mockResolvedValue({ url: 'https://checkout.stripe.test/synthetic' });
  fake.items.mockReset().mockResolvedValue({ data: [{ price: fixturePrice(), quantity: 1 }] });
});
afterEach(() => vi.unstubAllEnvs());
describe('approved paid plan settings', () => {
  it('returns only validated safe plan settings', () => {
    expect(planSettings()).toEqual({
      monthlyPriceMinor: 29900,
      paidSmsLimit: 500,
      paidAiLimit: 500,
      currency: 'usd',
      interval: 'month',
      overageBehavior: 'pause',
    });
  });
  it('rejects invalid price/allowance settings', () => {
    for (const [name, value] of [
      ['PLAN_MONTHLY_PRICE_MINOR', '0'],
      ['PLAN_PAID_SMS_LIMIT', '100001'],
      ['PLAN_PAID_AI_LIMIT', 'NaN'],
    ]) {
      vi.stubEnv(name, value);
      expect(() => planSettings()).toThrow();
      vi.stubEnv(name, name === 'PLAN_MONTHLY_PRICE_MINOR' ? '29900' : '500');
    }
  });
  it('rejects wrong currency, amount, interval, quantity transform and metered pricing', () => {
    for (const override of [
      { currency: 'eur' },
      { unit_amount: 29899 },
      { recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } },
      { recurring: { interval: 'month', interval_count: 2, usage_type: 'licensed' } },
      { recurring: { interval: 'month', interval_count: 1, usage_type: 'metered' } },
      { transform_quantity: { divide_by: 10, round: 'up' } },
      { custom_unit_amount: { enabled: true } },
      { type: 'one_time' },
    ])
      expect(() => assertPlanPrice({ ...fixturePrice(), ...override }, 'price_fixture')).toThrow();
  });
  it('checks actual provider price before creating checkout', async () => {
    await expect(
      createCheckout({
        businessId: 'a0000000-0000-4000-8000-000000000001',
        customerId: 'cus_fixture',
        acceptedTermsAt: new Date().toISOString(),
      }),
    ).resolves.toHaveProperty('url');
    expect(fake.price).toHaveBeenCalledWith('price_fixture');
    expect(fake.create).toHaveBeenCalledWith(
      expect.objectContaining({
        adaptive_pricing: { enabled: false },
        line_items: [{ price: 'price_fixture', quantity: 1 }],
      }),
      expect.anything(),
    );
  });
  it('mismatched provider amount prevents any checkout creation', async () => {
    fake.price.mockResolvedValueOnce({ ...fixturePrice(), unit_amount: 100 });
    await expect(
      createCheckout({
        businessId: 'a0000000-0000-4000-8000-000000000001',
        customerId: 'cus_fixture',
        acceptedTermsAt: new Date().toISOString(),
      }),
    ).rejects.toThrow();
    expect(fake.create).not.toHaveBeenCalled();
    expect(fake.list).not.toHaveBeenCalled();
  });
  it('does not reuse an open checkout for a different price or quantity', async () => {
    fake.list.mockResolvedValueOnce({
      data: [
        { id: 'cs_fixture', mode: 'subscription', url: 'https://checkout.stripe.test/synthetic' },
      ],
    });
    fake.items.mockResolvedValueOnce({ data: [{ price: fixturePrice(), quantity: 2 }] });
    await expect(
      createCheckout({
        businessId: 'a0000000-0000-4000-8000-000000000001',
        customerId: 'cus_fixture',
        acceptedTermsAt: new Date().toISOString(),
      }),
    ).rejects.toThrow();
    expect(fake.create).not.toHaveBeenCalled();
  });
});
