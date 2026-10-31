/** Provider-independent safety decisions. No network or privileged imports. */
export type CallOutcome =
  'queued' | 'ringing' | 'in-progress' | 'completed' | 'no-answer' | 'busy' | 'failed' | 'canceled';
export type DeliveryStatus =
  | 'pending'
  | 'submitted'
  | 'sent'
  | 'delivered'
  | 'undelivered'
  | 'failed'
  | 'unknown'
  | 'suppressed';

export function isRecoverableCall(outcome: string, isForwardedLeg: boolean): boolean {
  return isForwardedLeg && ['no-answer', 'busy', 'failed', 'canceled'].includes(outcome);
}

// A completed leg can be voicemail. Do not claim a human answered or text it automatically.
export function callNeedsReview(outcome: string): boolean {
  return outcome === 'completed';
}

export function isUsPhone(phone: string): boolean {
  return /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(phone);
}

export function validForwarding(
  receiving: string,
  destination: string,
  verified: boolean,
): boolean {
  return verified && isUsPhone(destination) && receiving !== destination;
}

export function classifyKeyword(
  body: string,
  providerOptOutType?: string,
): 'stop' | 'help' | 'start' | null {
  const provider = providerOptOutType?.toUpperCase();
  if (provider === 'STOP') return 'stop';
  if (provider === 'HELP') return 'help';
  if (provider === 'START') return 'start';
  const text = body.trim().toUpperCase();
  if (
    ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPT OUT'].includes(text)
  )
    return 'stop';
  if (['HELP', 'INFO'].includes(text)) return 'help';
  if (['START', 'UNSTOP', 'YES'].includes(text)) return 'start';
  return null;
}

export function localHour(now: Date, timezone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(now),
  );
}

export function isQuietHour(now: Date, timezone: string, start = 20, end = 8): boolean {
  const hour = localHour(now, timezone);
  // Invalid/equal boundaries fail closed; explicit legal policy is an operator prerequisite.
  if (start < 0 || start > 23 || end < 0 || end > 23 || start === end) return true;
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

export interface DispatchContext {
  now: Date;
  createdAt: Date;
  consent: boolean;
  suppressed: boolean;
  registrationReady: boolean;
  contactEligible: boolean;
  automationActive: boolean;
  budgetAvailable: boolean;
  humanTakeover: boolean;
  manual: boolean;
  timezone: string;
  quietStart: number;
  quietEnd: number;
  lastOutboundAt: Date | null;
  maxAgeMs?: number;
  cooldownMs?: number;
}

export function dispatchDecision(
  c: DispatchContext,
): { allowed: true } | { allowed: false; reason: string } {
  if (c.suppressed) return { allowed: false, reason: 'opted_out' };
  if (!c.consent) return { allowed: false, reason: 'consent_required' };
  if (!c.registrationReady) return { allowed: false, reason: 'registration_pending' };
  if (!c.contactEligible) return { allowed: false, reason: 'ineligible_contact' };
  if (!c.automationActive) return { allowed: false, reason: 'automation_paused' };
  if (!c.budgetAvailable) return { allowed: false, reason: 'usage_limit' };
  if (!c.manual && c.humanTakeover) return { allowed: false, reason: 'human_takeover' };
  if (c.manual && !c.humanTakeover) return { allowed: false, reason: 'takeover_required' };
  if (c.now.getTime() - c.createdAt.getTime() > (c.maxAgeMs ?? 60 * 60_000))
    return { allowed: false, reason: 'stale_job' };
  try {
    if (isQuietHour(c.now, c.timezone, c.quietStart, c.quietEnd))
      return { allowed: false, reason: 'quiet_hours' };
  } catch {
    return { allowed: false, reason: 'invalid_timezone' };
  }
  if (c.lastOutboundAt && c.now.getTime() - c.lastOutboundAt.getTime() < (c.cooldownMs ?? 30_000))
    return { allowed: false, reason: 'cooldown' };
  return { allowed: true };
}

const ranks: Record<DeliveryStatus, number> = {
  pending: 0,
  submitted: 1,
  unknown: 1,
  sent: 2,
  delivered: 3,
  undelivered: 3,
  failed: 3,
  suppressed: 3,
};
export function advanceDelivery(current: DeliveryStatus, incoming: DeliveryStatus): DeliveryStatus {
  // Terminal outcomes cannot be overwritten by late "sent" callbacks or a contradictory terminal.
  return ranks[incoming] > ranks[current] ? incoming : current;
}

export function trialIsActive(
  verifiedAt: Date | null,
  liveTestPassedAt: Date | null,
  startedAt: Date | null,
  endsAt: Date | null,
  now: Date,
): boolean {
  return (
    !!verifiedAt &&
    !!liveTestPassedAt &&
    !!startedAt &&
    !!endsAt &&
    now >= startedAt &&
    now < endsAt
  );
}

export function safeService(service: string | null, approvedServices: string[]): string | null {
  return service && approvedServices.includes(service) ? service : null;
}

export function qualifyLead(
  service: string | null,
  zip: string | null,
  approvedServices: string[],
  approvedZips: string[],
): boolean {
  return !!safeService(service, approvedServices) && !!zip && approvedZips.includes(zip);
}

export function recoveryText(businessName: string): string {
  return `Hi, this is ${businessName.slice(0, 80)}'s virtual assistant. Sorry we missed your call. Are you still looking for help with your roof? Reply STOP to opt out.`;
}

export function nextQuestion(
  data: { service: string | null; zip: string | null; urgent: boolean },
  businessName: string,
): string {
  if (data.urgent)
    return `I've flagged your request for ${businessName.slice(0, 80)} to review. Stay clear of roof hazards. If there is immediate danger, contact emergency services. A team member will follow up.`;
  if (!data.service)
    return 'What can we help with: a roof leak, storm damage, inspection, or roof replacement?';
  if (!data.zip) return 'Thanks. What is the ZIP code for the property?';
  return "Thanks for the details. I've saved your request for the team. What is the best time for a callback? An inspection is only confirmed after the team checks availability.";
}
