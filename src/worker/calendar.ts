import { createCalendarBooking } from '../lib/server/providers/calendar';
import { integrationEnabled } from '../lib/server/providers/config';
import { query, transaction } from '../lib/server/providers/database';
import { notifyTeam } from '../lib/server/providers/notifications';

interface AppointmentRow {
  id: string;
  lead_id: string;
  start_at: Date;
  end_at: Date;
  customer_confirmed_at: Date | null;
  status: string;
  provider_id: string | null;
  calendar_id: string;
  refresh_token_ciphertext: string;
  timezone: string;
  opening_hours: Record<string, { open: string; close: string; enabled?: boolean }>;
}

function withinHours(
  start: Date,
  end: Date,
  timezone: string,
  hours: AppointmentRow['opening_hours'],
): boolean {
  const parts = (date: Date) =>
    Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(date)
        .map((p) => [p.type, p.value]),
    );
  const a = parts(new Date(start.getTime() - 15 * 60_000)),
    b = parts(new Date(end.getTime() + 15 * 60_000));
  const day = hours[a.weekday.toLowerCase()];
  if (!day || day.enabled === false || a.weekday !== b.weekday) return false;
  return `${a.hour}:${a.minute}` >= day.open && `${b.hour}:${b.minute}` <= day.close;
}

export async function bookAppointment(businessId: string, appointmentId: string): Promise<void> {
  if (!integrationEnabled('CALENDAR')) {
    await notifyTeam({
      businessId,
      type: 'booking_request',
      message:
        'An inspection request was saved. Calendar is not configured; contact the customer to arrange it.',
    });
    return;
  }
  const appointment = await transaction(async (db) => {
    const rows = await db.query<AppointmentRow>(
      'select a.*,c.calendar_id,c.refresh_token_ciphertext,p.timezone,p.opening_hours from public.appointments a join public.calendar_connections c on c.business_id=a.business_id and c.id=a.calendar_connection_id and c.revoked_at is null join public.business_profiles p on p.business_id=a.business_id where a.business_id=$1 and a.id=$2 for update of a',
      [businessId, appointmentId],
    );
    const row = rows.rows[0];
    if (!row || row.status === 'confirmed' || row.status === 'canceled' || row.status === 'failed')
      return null;
    const eligible = await db.query(
      "select e.business_id from public.entitlements e join public.businesses b on b.id=e.business_id join public.subscriptions s on s.business_id=e.business_id where e.business_id=$1 and e.automation_enabled and e.valid_until>now() and b.suspended_at is null and b.automation_hold_at is null and b.state in ('trial_active','paid_active') and s.review_required_at is null",
      [businessId],
    );
    if (!eligible.rows[0]) {
      await db.query(
        "update public.appointments set status=case when status='unknown' then status else 'requested' end where business_id=$1 and id=$2",
        [businessId, appointmentId],
      );
      await db.query(
        "insert into public.notifications(business_id,lead_id,type,message) values($1,$2,'booking_request','Automation is unavailable. Contact the customer to arrange their inspection request.')",
        [businessId, row.lead_id],
      );
      return null;
    }
    if (!row.customer_confirmed_at) throw new Error('Customer confirmation required');
    const start = new Date(row.start_at),
      end = new Date(row.end_at);
    if (!withinHours(start, end, row.timezone, row.opening_hours))
      throw new Error('Outside approved booking hours');
    await db.query("select public.reserve_usage($1,'appointment',$2,1)", [
      businessId,
      `appointment:${appointmentId}`,
    ]);
    // DB trigger reserves this slot against other application bookings. Provider check follows outside transaction.
    await db.query(
      "update public.appointments set status='pending' where business_id=$1 and id=$2",
      [businessId, appointmentId],
    );
    return { ...row, start_at: start, end_at: end };
  });
  if (!appointment) return;
  const [stillEligible] = await query(
    "select e.business_id from public.entitlements e join public.businesses b on b.id=e.business_id join public.subscriptions s on s.business_id=e.business_id where e.business_id=$1 and e.automation_enabled and e.valid_until>now() and b.suspended_at is null and b.automation_hold_at is null and b.state in ('trial_active','paid_active') and s.review_required_at is null",
    [businessId],
  );
  if (!stillEligible) {
    await query('update public.appointments set status=$3 where business_id=$1 and id=$2', [
      businessId,
      appointmentId,
      appointment.status === 'unknown' ? 'unknown' : 'requested',
    ]);
    await notifyTeam({
      businessId,
      leadId: appointment.lead_id,
      type: 'booking_request',
      message:
        'Automation changed before booking dispatch. Contact the customer to arrange the saved request.',
    });
    return;
  }
  try {
    const result = await createCalendarBooking({
      businessId,
      appointmentId,
      refreshTokenCiphertext: appointment.refresh_token_ciphertext,
      calendarId: appointment.calendar_id,
      start: appointment.start_at,
      end: appointment.end_at,
      timezone: appointment.timezone,
      summary: 'Roof inspection request',
      customerConfirmedAt: appointment.customer_confirmed_at
        ? new Date(appointment.customer_confirmed_at)
        : null,
    });
    await transaction(async (db) => {
      await db.query(
        "update public.appointments set status='confirmed',provider_id=$3 where business_id=$1 and id=$2",
        [businessId, appointmentId, result.providerId],
      );
      await db.query(
        "update public.usage_events set status='settled' where business_id=$1 and idempotency_key=$2",
        [businessId, `appointment:${appointmentId}`],
      );
      await db.query(
        "update public.leads set status='booked',updated_at=now() where business_id=$1 and id=$2",
        [businessId, appointment.lead_id],
      );
      await db.query(
        "insert into public.notifications(business_id,lead_id,type,message) values($1,$2,'booking_confirmed','The inspection was created in the connected calendar and saved locally.')",
        [businessId, appointment.lead_id],
      );
    });
  } catch {
    await query(
      "update public.appointments set status='unknown' where business_id=$1 and id=$2 and status='pending'",
      [businessId, appointmentId],
    );
    await notifyTeam({
      businessId,
      leadId: appointment.lead_id,
      type: 'booking_review',
      message:
        'Booking could not be confirmed. Reconcile the deterministic event ID with Google before retrying. The request remains available for a callback.',
    });
    // Retries reconcile using the deterministic event ID; never tell the customer it is confirmed here.
  }
}
