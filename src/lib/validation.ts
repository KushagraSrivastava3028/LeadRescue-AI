import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/[a-zA-Z]/)
  .regex(/[0-9]/);
export const phoneSchema = z.string().regex(/^\+1[2-9]\d{9}$/);
export const timezoneSchema = z
  .string()
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });
const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
export const authSchema = z.discriminatedUnion('action', [
  strict({
    action: z.literal('signup'),
    email: emailSchema,
    password: passwordSchema,
    name: z.string().trim().min(2).max(100),
    termsAccepted: z.literal(true),
  }),
  strict({ action: z.literal('signin'), email: emailSchema, password: z.string().min(1).max(128) }),
  strict({ action: z.literal('reset'), email: emailSchema }),
  strict({ action: z.literal('resend'), email: emailSchema }),
  strict({ action: z.literal('signout') }),
  strict({
    action: z.literal('update-password'),
    password: passwordSchema,
    confirmPassword: z.string().min(8).max(128),
  }),
  strict({
    action: z.literal('mfa'),
    code: z.string().regex(/^\d{6}$/),
    factorId: uuidSchema.optional(),
  }),
  strict({ action: z.literal('mfa-enroll') }),
  strict({ action: z.literal('reauthenticate') }),
]);

const base = { businessId: uuidSchema };
export const workspaceMutationSchema = z.discriminatedUnion('action', [
  strict({
    action: z.literal('create-business'),
    name: z.string().trim().min(2).max(100),
    timezone: timezoneSchema,
    zipCodes: z
      .array(z.string().regex(/^\d{5}$/))
      .min(1)
      .max(100),
  }),
  strict({ action: z.literal('accept-invitation'), token: z.string().regex(/^[a-f0-9]{64}$/) }),
  strict({ action: z.literal('takeover'), ...base, conversationId: uuidSchema }),
  strict({ action: z.literal('resume'), ...base, conversationId: uuidSchema }),
  strict({
    action: z.literal('send'),
    ...base,
    conversationId: uuidSchema,
    body: z.string().trim().min(1).max(480),
  }),
  strict({
    action: z.literal('update-lead'),
    ...base,
    leadId: uuidSchema,
    status: z.enum(['new', 'needs_callback', 'qualified', 'won', 'lost']),
  }),
  strict({
    action: z.literal('settings'),
    ...base,
    name: z.string().trim().min(2).max(100),
    services: z.array(z.string().trim().min(1).max(100)).max(30),
    zipCodes: z
      .array(z.string().regex(/^\d{5}$/))
      .min(1)
      .max(100),
    timezone: timezoneSchema,
    escalationPhone: phoneSchema.nullable(),
    assistantRestrictions: z.array(z.string().trim().min(1).max(500)).max(20),
    faqs: z
      .array(
        strict({
          question: z.string().trim().min(1).max(300),
          answer: z.string().trim().min(1).max(1200),
        }),
      )
      .max(30),
    openingHours: z.record(
      z.string().regex(/^(mon|tue|wed|thu|fri|sat|sun)$/),
      strict({
        open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        enabled: z.boolean().optional(),
      }),
    ),
  }),
  strict({
    action: z.literal('invite'),
    ...base,
    email: emailSchema,
    role: z.enum(['staff', 'viewer']),
  }),
  strict({ action: z.literal('activate-trial'), ...base }),
  strict({ action: z.literal('billing-checkout'), ...base, acceptRecurringTerms: z.literal(true) }),
  strict({ action: z.literal('billing-portal'), ...base }),
  strict({ action: z.literal('calendar-connect'), ...base }),
  strict({
    action: z.literal('callback'),
    ...base,
    leadId: uuidSchema,
    note: z.string().trim().min(1).max(1000),
  }),
  strict({
    action: z.literal('request-appointment'),
    ...base,
    leadId: uuidSchema,
    startAt: z.string().datetime({ offset: true }),
    note: z.string().trim().min(1).max(1000),
  }),
  strict({ action: z.literal('remove-member'), ...base, membershipId: uuidSchema }),
  strict({ action: z.literal('cancel-subscription'), ...base }),
]);
