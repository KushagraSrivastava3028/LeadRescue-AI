import { cookies } from 'next/headers';
import { authSchema } from '@/lib/validation';
import { getServerEnv } from '@/lib/server/env';
import { createUserClient } from '@/lib/server/supabase';
import {
  clientRateIdentity,
  enforceRateLimit,
  errorResponse,
  HttpError,
  jsonResponse,
  readJson,
} from '@/lib/server/security';
import { requireRecentSignIn, requireUser } from '@/lib/server/authorization';
import { verifyCookie } from '@/lib/server/signed-cookie';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const inboxMessage = 'If this email can receive a link, check your inbox for the next step.';
const recoveryCookieName = () =>
  getServerEnv().NODE_ENV === 'production' ? '__Host-lr-recovery' : 'lr-recovery';

export async function GET() {
  try {
    const { user } = await requireUser();
    return jsonResponse({
      ok: true,
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: typeof user.user_metadata?.name === 'string' ? user.user_metadata.name : '',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await readJson(request, authSchema, 4096);
    const env = getServerEnv();
    const client = await createUserClient();
    const ip = clientRateIdentity(request);
    await enforceRateLimit(
      `auth:${input.action}:source`,
      ip,
      input.action === 'signin' ? 60 : 30,
      900,
    );
    if ('email' in input)
      await enforceRateLimit(
        `auth:${input.action}:account`,
        input.email,
        input.action === 'signin' ? 10 : 5,
        900,
      );

    switch (input.action) {
      case 'signup': {
        const { error } = await client.auth.signUp({
          email: input.email,
          password: input.password,
          options: {
            data: { name: input.name },
            emailRedirectTo: `${env.APP_ORIGIN}/auth/callback?next=/onboarding`,
          },
        });
        if (error && error.status === 429)
          throw new HttpError(429, 'rate_limited', 'Please wait before trying again.', 60);
        if (error?.code === 'weak_password')
          throw new HttpError(
            400,
            'password_rejected',
            'Choose a stronger password that meets the account security requirements.',
          );
        if (error?.code === 'email_address_invalid')
          throw new HttpError(400, 'email_rejected', 'Use a valid work email address.');
        if (
          error &&
          ['signup_disabled', 'email_provider_disabled', 'email_address_not_authorized'].includes(
            error.code ?? '',
          )
        )
          throw new HttpError(
            503,
            'auth_unavailable',
            'Account services are temporarily unavailable.',
          );
        if (error && (error.status ?? 0) >= 500)
          throw new HttpError(
            503,
            'auth_unavailable',
            'Account services are temporarily unavailable.',
          );
        return jsonResponse({ ok: true, message: inboxMessage, redirect: '/verify-email' });
      }
      case 'signin': {
        const { data, error } = await client.auth.signInWithPassword({
          email: input.email,
          password: input.password,
        });
        if (error || !data.user)
          throw new HttpError(
            401,
            'invalid_credentials',
            'We could not sign you in. Check your details and email verification.',
          );
        if (!data.user.email_confirmed_at) {
          await client.auth.signOut({ scope: 'local' });
          throw new HttpError(
            401,
            'invalid_credentials',
            'We could not sign you in. Check your details and email verification.',
          );
        }
        const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
        if (assurance.error)
          throw new HttpError(
            503,
            'auth_unavailable',
            'Account services are temporarily unavailable.',
          );
        const mfaRequired =
          assurance.data.nextLevel === 'aal2' && assurance.data.currentLevel !== 'aal2';
        return jsonResponse({
          ok: true,
          message: 'Signed in.',
          mfaRequired,
          redirect: mfaRequired ? '/two-factor' : '/app',
        });
      }
      case 'reset': {
        // Configure Supabase's recovery email template to /auth/confirm with token_hash + type=recovery.
        const { error } = await client.auth.resetPasswordForEmail(input.email, {
          redirectTo: `${env.APP_ORIGIN}/auth/confirm?type=recovery`,
        });
        if (error && error.status === 429)
          throw new HttpError(
            429,
            'rate_limited',
            'Please wait before requesting another link.',
            60,
          );
        if (error && (error.status ?? 0) >= 500)
          throw new HttpError(
            503,
            'auth_unavailable',
            'Account services are temporarily unavailable.',
          );
        return jsonResponse({ ok: true, message: inboxMessage });
      }
      case 'resend': {
        const { error } = await client.auth.resend({
          type: 'signup',
          email: input.email,
          options: { emailRedirectTo: `${env.APP_ORIGIN}/auth/callback?next=/onboarding` },
        });
        if (error && error.status === 429)
          throw new HttpError(
            429,
            'rate_limited',
            'Please wait before requesting another link.',
            60,
          );
        if (error && (error.status ?? 0) >= 500)
          throw new HttpError(
            503,
            'auth_unavailable',
            'Account services are temporarily unavailable.',
          );
        return jsonResponse({ ok: true, message: inboxMessage });
      }
      case 'signout': {
        const { error } = await client.auth.signOut({ scope: 'global' });
        if (error && error.status !== 401 && error.status !== 403)
          throw new HttpError(
            503,
            'signout_unavailable',
            'Sign out could not be completed. Try again.',
          );
        (await cookies()).delete(recoveryCookieName());
        return jsonResponse({ ok: true, message: 'Signed out.', redirect: '/signin' });
      }
      case 'update-password': {
        if (input.password !== input.confirmPassword)
          throw new HttpError(400, 'password_mismatch', 'Your passwords must match.');
        const { user } = await requireUser();
        const cookieStore = await cookies();
        const grant = cookieStore.get(recoveryCookieName())?.value;
        if (!grant)
          throw new HttpError(
            403,
            'recovery_required',
            'Open a fresh password reset link to continue.',
          );
        let payload;
        try {
          payload = await verifyCookie(grant, 'password-recovery');
        } catch {
          throw new HttpError(
            403,
            'recovery_required',
            'Open a fresh password reset link to continue.',
          );
        }
        if (payload.sub !== user.id)
          throw new HttpError(
            403,
            'recovery_required',
            'Open a fresh password reset link to continue.',
          );
        const { error } = await client.auth.updateUser({ password: input.password });
        if (error)
          throw new HttpError(
            400,
            'password_rejected',
            'Your new password could not be accepted. Use a different password or request a fresh link.',
          );
        cookieStore.delete(recoveryCookieName());
        await client.auth.signOut({ scope: 'global' });
        return jsonResponse({
          ok: true,
          message: 'Your password was updated. Sign in again to continue.',
          redirect: '/signin',
        });
      }
      case 'mfa': {
        const verified = await client.auth.getUser();
        if (verified.error || !verified.data.user?.email_confirmed_at)
          throw new HttpError(401, 'unauthenticated', 'Please sign in to continue.');
        const active = await client.rpc('check_active_session');
        if (active.error || !active.data)
          throw new HttpError(
            401,
            'session_revoked',
            'Your session has ended. Please sign in again.',
          );
        await enforceRateLimit('auth:mfa:user', verified.data.user.id, 8, 900);
        const factors = await client.auth.mfa.listFactors();
        const factor = input.factorId
          ? factors.data?.all.find(
              (entry) => entry.factor_type === 'totp' && entry.id === input.factorId,
            )
          : factors.data?.totp.find((entry) => entry.status === 'verified');
        if (factors.error || !factor)
          throw new HttpError(400, 'mfa_unavailable', 'Authenticator verification is unavailable.');
        const { error } = await client.auth.mfa.challengeAndVerify({
          factorId: factor.id,
          code: input.code,
        });
        if (error)
          throw new HttpError(
            401,
            'invalid_code',
            'This code could not be verified. Try the current code from your authenticator.',
          );
        return jsonResponse({ ok: true, message: 'Verification complete.', redirect: '/app' });
      }
      case 'mfa-enroll': {
        const { user } = await requireUser();
        requireRecentSignIn(user);
        await enforceRateLimit('auth:mfa-enroll:user', user.id, 3, 3600);
        const factors = await client.auth.mfa.listFactors();
        if (factors.error || factors.data.totp.some((factor) => factor.status === 'verified'))
          throw new HttpError(
            409,
            'mfa_unavailable',
            'An authenticator is already configured or enrollment is unavailable.',
          );
        for (const factor of factors.data.all.filter(
          (entry) => entry.factor_type === 'totp' && entry.status === 'unverified',
        )) {
          const removed = await client.auth.mfa.unenroll({ factorId: factor.id });
          if (removed.error)
            throw new HttpError(
              409,
              'mfa_unavailable',
              'The previous setup could not be replaced. Sign in again to continue.',
            );
        }
        const { data, error } = await client.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: 'LeadRescue authenticator',
          issuer: 'LeadRescue',
        });
        if (error)
          throw new HttpError(
            400,
            'mfa_unavailable',
            'Authenticator enrollment could not be started.',
          );
        // The OTP setup secret is deliberately delivered only to the authenticated owner, never logs.
        return jsonResponse({
          ok: true,
          factorId: data.id,
          qrCode: data.totp.qr_code,
          secret: data.totp.secret,
        });
      }
      case 'reauthenticate': {
        await requireUser();
        const { error } = await client.auth.reauthenticate();
        if (error)
          throw new HttpError(
            400,
            'reauthentication_unavailable',
            'Please sign in again to continue.',
          );
        return jsonResponse({
          ok: true,
          message: 'Check your email for verification instructions.',
        });
      }
    }
  } catch (error) {
    return errorResponse(error);
  }
}
