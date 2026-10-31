import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { calendarConfig } from './config';
import { decryptToken, encryptToken } from './encryption';
import { boundedJson, providerFetch } from './http';

export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.owned',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
];
export function createCalendarAuthorization(input: {
  state: string;
  codeChallenge: string;
}): string {
  const config = calendarConfig();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: CALENDAR_SCOPES.join(' '),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  }).toString();
  return url.toString();
}

export async function exchangeCalendarCode(
  code: string,
  codeVerifier: string,
  businessId: string,
): Promise<{ refreshTokenCiphertext: string; scopes: string[]; keyVersion: string }> {
  const config = calendarConfig();
  const raw = await boundedJson(
    await providerFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        code_verifier: codeVerifier,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
    }),
  );
  const tokens = z
    .object({ refresh_token: z.string(), scope: z.string() })
    .passthrough()
    .parse(raw);
  const scopes = tokens.scope.split(' ');
  if (!CALENDAR_SCOPES.every((s) => scopes.includes(s)))
    throw new Error('Calendar scopes incomplete');
  const ciphertext = encryptToken(tokens.refresh_token, businessId);
  return { refreshTokenCiphertext: ciphertext, scopes, keyVersion: ciphertext.split('.')[0] };
}

async function accessToken(ciphertext: string, businessId: string): Promise<string> {
  const config = calendarConfig();
  const refreshToken = decryptToken(ciphertext, businessId);
  const raw = await boundedJson(
    await providerFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    }),
  );
  return z.object({ access_token: z.string() }).passthrough().parse(raw).access_token;
}

export async function createCalendarBooking(input: {
  businessId: string;
  appointmentId: string;
  refreshTokenCiphertext: string;
  calendarId: string;
  start: Date;
  end: Date;
  timezone: string;
  summary: string;
  customerConfirmedAt: Date | null;
  bufferMinutes?: number;
}): Promise<{ providerId: string }> {
  if (!input.customerConfirmedAt) throw new Error('Customer confirmation required');
  const duration = input.end.getTime() - input.start.getTime();
  if (duration !== 60 * 60_000 || input.start.getTime() <= Date.now())
    throw new Error('Inspection must be a future 60-minute slot');
  new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format(input.start);
  const token = await accessToken(input.refreshTokenCiphertext, input.businessId);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const eventId = createHash('sha256')
    .update(`${input.businessId}:${input.appointmentId}`)
    .digest('hex');
  const endpoint = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`;
  // Reconcile before availability: an already-created event occupies the requested slot itself.
  const reconciled = await providerFetch(`${endpoint}/${eventId}`, { headers });
  if (reconciled.ok) {
    const existing = z
      .object({
        id: z.string(),
        start: z.object({ dateTime: z.string() }),
        end: z.object({ dateTime: z.string() }),
        extendedProperties: z.object({ private: z.record(z.string(), z.string()) }).optional(),
      })
      .passthrough()
      .parse(await boundedJson(reconciled));
    if (
      existing.extendedProperties?.private?.leadrescueAppointment !== input.appointmentId ||
      Date.parse(existing.start.dateTime) !== input.start.getTime() ||
      Date.parse(existing.end.dateTime) !== input.end.getTime()
    )
      throw new Error('Calendar event conflict');
    return { providerId: existing.id };
  }
  if (reconciled.status !== 404) throw new Error('Calendar reconciliation unavailable');
  const buffer = (input.bufferMinutes ?? 15) * 60_000;
  const freeBusy = z
    .object({
      calendars: z.record(
        z.string(),
        z.object({
          busy: z.array(z.object({ start: z.string(), end: z.string() })),
          errors: z.array(z.unknown()).optional(),
        }),
      ),
    })
    .passthrough()
    .parse(
      await boundedJson(
        await providerFetch('https://www.googleapis.com/calendar/v3/freeBusy', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            timeMin: new Date(input.start.getTime() - buffer).toISOString(),
            timeMax: new Date(input.end.getTime() + buffer).toISOString(),
            timeZone: input.timezone,
            items: [{ id: input.calendarId }],
          }),
        }),
      ),
    );
  const availability = freeBusy.calendars[input.calendarId];
  if (!availability || availability.errors?.length || availability.busy.length)
    throw new Error('Calendar availability changed');
  // Hex is a subset of Google's base32hex event-ID alphabet. Deterministic ID reconciles timeout retries.
  const response = await providerFetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: eventId,
      summary: input.summary.slice(0, 160),
      start: { dateTime: input.start.toISOString(), timeZone: input.timezone },
      end: { dateTime: input.end.toISOString(), timeZone: input.timezone },
      extendedProperties: { private: { leadrescueAppointment: input.appointmentId } },
    }),
  });
  if (response.status === 409) {
    const existing = z
      .object({
        id: z.string(),
        start: z.object({ dateTime: z.string() }),
        end: z.object({ dateTime: z.string() }),
        extendedProperties: z.object({ private: z.record(z.string(), z.string()) }).optional(),
      })
      .passthrough()
      .parse(await boundedJson(await providerFetch(`${endpoint}/${eventId}`, { headers })));
    if (
      existing.extendedProperties?.private?.leadrescueAppointment !== input.appointmentId ||
      Date.parse(existing.start.dateTime) !== input.start.getTime() ||
      Date.parse(existing.end.dateTime) !== input.end.getTime()
    )
      throw new Error('Calendar event conflict');
    return { providerId: existing.id };
  }
  return {
    providerId: z
      .object({ id: z.string() })
      .passthrough()
      .parse(await boundedJson(response)).id,
  };
}
