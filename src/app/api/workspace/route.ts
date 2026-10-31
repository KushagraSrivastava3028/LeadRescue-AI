import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { workspaceMutationSchema, uuidSchema } from '@/lib/validation';
import { requireMembership, requireRecentSignIn, requireUser } from '@/lib/server/authorization';
import {
  checkDatabaseError,
  enforceRateLimit,
  errorResponse,
  HttpError,
  jsonResponse,
  readJson,
} from '@/lib/server/security';
import { getServerEnv } from '@/lib/server/env';
import { signCookie } from '@/lib/server/signed-cookie';
import { planSettings } from '@/lib/server/providers/plan';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => !['businessId', 'days'].includes(key)))
      throw new HttpError(400, 'invalid_request', 'Check the requested workspace.');
    let businessId = params.get('businessId');
    const days = z.coerce
      .number()
      .int()
      .min(1)
      .max(90)
      .parse(params.get('days') ?? 7);
    if (!businessId) {
      const { client, user } = await requireUser();
      const memberships = await client
        .from('memberships')
        .select('business_id')
        .eq('user_id', user.id)
        .is('suspended_at', null)
        .order('created_at')
        .limit(1);
      checkDatabaseError(memberships.error);
      businessId = memberships.data?.[0]?.business_id ?? null;
      if (!businessId)
        return jsonResponse({
          ok: true,
          onboardingRequired: true,
          business: null,
          leads: [],
          conversations: [],
          messages: [],
          appointments: [],
        });
    }
    if (!uuidSchema.safeParse(businessId).success)
      throw new HttpError(400, 'invalid_request', 'Check the requested workspace.');
    const { client, user, business, role } = await requireMembership(businessId!);
    await enforceRateLimit('workspace:read', `${businessId}:${user.id}`, 180, 60);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const [
      profile,
      leads,
      conversations,
      messages,
      appointments,
      subscription,
      entitlements,
      usage,
      calls,
      replies,
      qualified,
      booked,
      notifications,
      totalCalls,
      recoveryAttempts,
      delivered,
      won,
    ] = await Promise.all([
      client
        .from('business_profiles')
        .select(
          'name,services,zip_codes,timezone,opening_hours,faqs,escalation_phone,assistant_restrictions,quiet_start,quiet_end',
        )
        .eq('business_id', businessId)
        .maybeSingle(),
      client
        .from('leads')
        .select(
          'id,contact_id,service,status,summary,created_at,updated_at,contacts(name,phone,zip_code)',
        )
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(100),
      client
        .from('conversations')
        .select('id,lead_id,contact_id,mode,last_inbound_at,last_outbound_at,created_at,updated_at')
        .eq('business_id', businessId)
        .order('updated_at', { ascending: false })
        .limit(100),
      client
        .from('messages')
        .select('id,conversation_id,direction,body,status,author,created_at')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(500),
      client
        .from('appointments')
        .select('id,lead_id,status,start_at,end_at,customer_confirmed_at')
        .eq('business_id', businessId)
        .order('start_at')
        .limit(100),
      client
        .from('subscriptions')
        .select('status,current_period_end,cancel_at_period_end,monthly_price_minor,currency')
        .eq('business_id', businessId)
        .maybeSingle(),
      client
        .from('entitlements')
        .select(
          'automation_enabled,valid_until,period_start,sms_limit,sms_used,ai_limit,ai_used,overage_behavior',
        )
        .eq('business_id', businessId)
        .maybeSingle(),
      client
        .from('usage_events')
        .select('id,kind,quantity,status,created_at')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(100),
      client
        .from('calls')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('recovery_eligible', true)
        .gte('created_at', since),
      client
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('direction', 'inbound')
        .gte('created_at', since),
      client
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .in('status', ['qualified', 'booked', 'won'])
        .gte('created_at', since),
      client
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('status', 'confirmed')
        .gte('created_at', since),
      client
        .from('notifications')
        .select('id,lead_id,type,message,read_at,created_at')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(30),
      client
        .from('calls')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .gte('created_at', since),
      client
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('direction', 'outbound')
        .like('idempotency_key', 'recovery:%')
        .not('send_intent_at', 'is', null)
        .gte('created_at', since),
      client
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('direction', 'outbound')
        .eq('status', 'delivered')
        .gte('created_at', since),
      client
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('status', 'won')
        .gte('updated_at', since),
    ]);
    for (const result of [
      profile,
      leads,
      conversations,
      messages,
      appointments,
      subscription,
      entitlements,
      usage,
      calls,
      replies,
      qualified,
      booked,
      notifications,
      totalCalls,
      recoveryAttempts,
      delivered,
      won,
    ])
      checkDatabaseError(result.error);
    return jsonResponse({
      ok: true,
      business,
      role,
      user: {
        id: user.id,
        email: user.email,
        name: typeof user.user_metadata?.name === 'string' ? user.user_metadata.name : '',
      },
      profile: profile.data,
      leads: leads.data,
      conversations: conversations.data,
      messages: messages.data?.reverse(),
      appointments: appointments.data,
      subscription: subscription.data,
      entitlements: entitlements.data,
      usage: usage.data,
      notifications: notifications.data,
      plan: planSettings(),
      metrics: {
        missedCalls: calls.count ?? 0,
        customerReplies: replies.count ?? 0,
        qualifiedLeads: qualified.count ?? 0,
        inspectionsBooked: booked.count ?? 0,
        totalCalls: totalCalls.count ?? 0,
        recoveryAttempts: recoveryAttempts.count ?? 0,
        deliveredMessages: delivered.count ?? 0,
        ownerConfirmedWins: won.count ?? 0,
        days,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return errorResponse(new HttpError(400, 'invalid_request', 'Choose a valid date range.'));
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await readJson(request, workspaceMutationSchema, 32_768);
    if (input.action === 'create-business' || input.action === 'accept-invitation') {
      const { client, user } = await requireUser();
      await enforceRateLimit(`workspace:${input.action}`, user.id, 5, 3600);
      const result =
        input.action === 'create-business'
          ? await client.rpc('create_business', {
              p_name: input.name,
              p_timezone: input.timezone,
              p_zip_codes: input.zipCodes,
            })
          : await client.rpc('accept_invitation', { p_token: input.token });
      checkDatabaseError(result.error);
      return jsonResponse({
        ok: true,
        businessId: result.data,
        message:
          input.action === 'create-business'
            ? 'Workspace created. Complete phone setup before activating your trial.'
            : 'You joined the workspace.',
      });
    }
    const permission = ['settings', 'invite', 'remove-member', 'activate-trial'].includes(
      input.action,
    )
      ? 'profile'
      : input.action.startsWith('billing') || input.action === 'cancel-subscription'
        ? 'billing'
        : input.action === 'calendar-connect'
          ? 'integration'
          : ['update-lead', 'callback', 'request-appointment'].includes(input.action)
            ? 'lead'
            : 'conversation';
    const { client, user } = await requireMembership(input.businessId, permission);
    await enforceRateLimit(
      `workspace:${input.action}`,
      `${input.businessId}:${user.id}`,
      ['send', 'callback'].includes(input.action) ? 30 : 20,
      60,
    );
    if (
      [
        'invite',
        'remove-member',
        'billing-checkout',
        'billing-portal',
        'cancel-subscription',
        'calendar-connect',
      ].includes(input.action)
    )
      requireRecentSignIn(user);
    switch (input.action) {
      case 'takeover':
      case 'resume': {
        const { error } = await client.rpc('take_over_conversation', {
          p_business_id: input.businessId,
          p_conversation_id: input.conversationId,
          p_mode: input.action === 'takeover' ? 'human' : 'ai',
        });
        checkDatabaseError(error);
        return jsonResponse({
          ok: true,
          message:
            input.action === 'takeover'
              ? 'You are now managing this conversation.'
              : 'AI assistance resumed. Every send still requires eligibility checks.',
        });
      }
      case 'send': {
        const { data, error } = await client.rpc('enqueue_manual_message', {
          p_business_id: input.businessId,
          p_conversation_id: input.conversationId,
          p_body: input.body,
        });
        checkDatabaseError(error);
        return jsonResponse(
          {
            ok: true,
            messageId: data,
            message: 'Reply queued. Consent, delivery, and usage checks apply before sending.',
          },
          202,
        );
      }
      case 'update-lead': {
        const { error } = await client.rpc('update_lead', {
          p_business_id: input.businessId,
          p_lead_id: input.leadId,
          p_status: input.status,
        });
        checkDatabaseError(error);
        return jsonResponse({ ok: true, message: 'Lead updated.' });
      }
      case 'callback': {
        const { error } = await client.rpc('create_callback', {
          p_business_id: input.businessId,
          p_lead_id: input.leadId,
          p_note: input.note,
        });
        checkDatabaseError(error);
        return jsonResponse({ ok: true, message: 'Callback request saved for your team.' });
      }
      case 'request-appointment': {
        const { data, error } = await client.rpc('request_appointment', {
          p_business_id: input.businessId,
          p_lead_id: input.leadId,
          p_start_at: input.startAt,
          p_note: input.note,
        });
        checkDatabaseError(error);
        const token = await signCookie(
          { businessId: input.businessId, appointmentId: data },
          'appointment-confirmation',
          '30m',
        );
        return jsonResponse(
          {
            ok: true,
            appointmentId: data,
            customerConfirmationUrl: `${getServerEnv().APP_ORIGIN}/confirm-inspection#token=${token}`,
            message:
              'Inspection requested. Share the confirmation link with the customer; the appointment is booked only after their confirmation and a successful calendar check.',
          },
          202,
        );
      }
      case 'settings': {
        const { error } = await client
          .from('business_profiles')
          .update({
            name: input.name,
            services: input.services,
            zip_codes: input.zipCodes,
            timezone: input.timezone,
            escalation_phone: input.escalationPhone,
            assistant_restrictions: input.assistantRestrictions,
            faqs: input.faqs,
            opening_hours: input.openingHours,
          })
          .eq('business_id', input.businessId);
        checkDatabaseError(error);
        return jsonResponse({ ok: true, message: 'Workspace settings saved.' });
      }
      case 'invite': {
        const token = randomBytes(32).toString('hex');
        const tokenHash = createHash('sha256').update(token).digest('hex');
        const { data, error } = await client.rpc('create_invitation', {
          p_business_id: input.businessId,
          p_email: input.email,
          p_role: input.role,
          p_token_hash: tokenHash,
        });
        checkDatabaseError(error);
        // Returning a share link to the owner does not send unsolicited mail.
        return jsonResponse({
          ok: true,
          invitationId: data,
          invitationUrl: `${getServerEnv().APP_ORIGIN}/invite#token=${token}`,
          message:
            'Invitation created. Share this private link with the intended teammate; it expires in 48 hours.',
        });
      }
      case 'remove-member': {
        const { error } = await client.rpc('remove_member', {
          p_business_id: input.businessId,
          p_membership_id: input.membershipId,
        });
        checkDatabaseError(error);
        return jsonResponse({ ok: true, message: 'Team membership removed.' });
      }
      case 'activate-trial': {
        const { data, error } = await client.rpc('activate_trial', {
          p_business_id: input.businessId,
        });
        checkDatabaseError(error);
        return jsonResponse({
          ok: true,
          trialEndsAt: data,
          message: 'Your 14-day trial is active.',
        });
      }
      case 'billing-checkout':
      case 'billing-portal':
      case 'cancel-subscription': {
        const subscription = await client
          .from('subscriptions')
          .select('provider_customer_id,provider_subscription_id,status')
          .eq('business_id', input.businessId)
          .maybeSingle();
        checkDatabaseError(subscription.error);
        const billing = await import('@/lib/server/providers/billing');
        if (input.action === 'billing-portal' || input.action === 'cancel-subscription') {
          if (!subscription.data?.provider_customer_id)
            throw new HttpError(409, 'billing_unavailable', 'No billing account is connected yet.');
          return jsonResponse({
            ok: true,
            ...(await billing.createPortal(subscription.data.provider_customer_id)),
          });
        }
        if (
          subscription.data?.provider_subscription_id &&
          !['canceled', 'incomplete_expired', 'inactive'].includes(subscription.data.status)
        )
          throw new HttpError(
            409,
            'subscription_exists',
            'Manage your existing subscription in the billing portal.',
          );
        const business = await client
          .from('businesses')
          .select('name,trial_ends_at,trial_started_at')
          .eq('id', input.businessId)
          .single();
        checkDatabaseError(business.error);
        if (!business.data?.trial_started_at || !business.data?.trial_ends_at)
          throw new HttpError(
            409,
            'activation_required',
            'Complete activation and start your trial before adding a subscription.',
          );
        const acceptedTermsAt = new Date().toISOString();
        let customerId: string | undefined = subscription.data?.provider_customer_id;
        if (!customerId) {
          const created = await billing.ensureBillingCustomer({
            businessId: input.businessId,
            email: user.email!,
            name: business.data.name ?? 'Roofing contractor',
          });
          customerId = created.customerId;
        }
        const { createServiceClient } = await import('@/lib/server/supabase');
        const service = createServiceClient();
        const mapping = await service
          .from('subscriptions')
          .update({
            provider_customer_id: customerId,
            pricing_accepted_at: acceptedTermsAt,
            pricing_policy_version: '2026-10-30-v1',
          })
          .eq('business_id', input.businessId);
        checkDatabaseError(mapping.error);
        return jsonResponse({
          ok: true,
          ...(await billing.createCheckout({
            businessId: input.businessId,
            customerId: customerId!,
            trialEndsAt: new Date(business.data.trial_ends_at),
            acceptedTermsAt,
          })),
        });
      }
      case 'calendar-connect': {
        const state = randomBytes(32).toString('hex');
        const verifier = randomBytes(48).toString('base64url');
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        const env = getServerEnv();
        const calendar = await import('@/lib/server/providers/calendar');
        const url = calendar.createCalendarAuthorization({ state, codeChallenge: challenge });
        (await cookies()).set(
          env.NODE_ENV === 'production' ? '__Host-lr-calendar' : 'lr-calendar',
          await signCookie(
            { sub: user.id, businessId: input.businessId, state, verifier },
            'calendar-oauth',
          ),
          {
            httpOnly: true,
            secure: env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 600,
          },
        );
        return jsonResponse({ ok: true, url });
      }
    }
  } catch (error) {
    return errorResponse(error);
  }
}
