import { describe, expect, it } from 'vitest';
import {
  advanceDelivery,
  classifyKeyword,
  dispatchDecision,
  isRecoverableCall,
  isQuietHour,
  nextQuestion,
  qualifyLead,
  trialIsActive,
  validForwarding,
  type DispatchContext,
} from '../src/lib/domain/recovery';

const ready = (): DispatchContext => ({
  now: new Date('2026-10-30T17:00:00Z'),
  createdAt: new Date('2026-10-30T16:59:00Z'),
  consent: true,
  suppressed: false,
  registrationReady: true,
  contactEligible: true,
  automationActive: true,
  budgetAvailable: true,
  humanTakeover: false,
  manual: false,
  timezone: 'America/Chicago',
  quietStart: 20,
  quietEnd: 8,
  lastOutboundAt: null,
});

describe('dispatch admission rechecks current state', () => {
  it('does not infer consent from a missed call', () => {
    expect(dispatchDecision({ ...ready(), consent: false })).toEqual({
      allowed: false,
      reason: 'consent_required',
    });
  });
  it('STOP after enqueue suppresses both AI and manual messages', () => {
    expect(dispatchDecision({ ...ready(), suppressed: true })).toEqual({
      allowed: false,
      reason: 'opted_out',
    });
    expect(
      dispatchDecision({ ...ready(), suppressed: true, manual: true, humanTakeover: true }),
    ).toEqual({ allowed: false, reason: 'opted_out' });
  });
  it('prevents queued AI after takeover and manual sends without takeover', () => {
    expect(dispatchDecision({ ...ready(), humanTakeover: true })).toEqual({
      allowed: false,
      reason: 'human_takeover',
    });
    expect(dispatchDecision({ ...ready(), manual: true })).toEqual({
      allowed: false,
      reason: 'takeover_required',
    });
  });
  it('rejects cancellation, budgets, stale recovery, cooldown and registration changes', () => {
    for (const delta of [
      { automationActive: false },
      { budgetAvailable: false },
      { registrationReady: false },
      { contactEligible: false },
      { createdAt: new Date('2026-10-29T16:00:00Z') },
      { lastOutboundAt: new Date('2026-10-30T16:59:59Z') },
    ])
      expect(dispatchDecision({ ...ready(), ...delta }).allowed).toBe(false);
    expect(dispatchDecision(ready()).allowed).toBe(true);
  });
  it('handles quiet hours in local timezone across DST and denies bad timezone', () => {
    expect(isQuietHour(new Date('2026-11-01T06:30:00Z'), 'America/New_York')).toBe(true);
    expect(isQuietHour(new Date('2026-03-08T07:30:00Z'), 'America/New_York')).toBe(true);
    expect(dispatchDecision({ ...ready(), timezone: 'made-up' }).allowed).toBe(false);
  });
});

describe('provider events and qualification', () => {
  it('recovers only explicitly missed child legs; completed could be voicemail', () => {
    for (const status of ['no-answer', 'busy', 'failed', 'canceled']) {
      expect(isRecoverableCall(status, true)).toBe(true);
      expect(isRecoverableCall(status, false)).toBe(false);
    }
    expect(isRecoverableCall('completed', true)).toBe(false);
  });
  it('prevents loops, unverified destinations and non-US forwarding', () => {
    expect(validForwarding('+12145550187', '+12145550187', true)).toBe(false);
    expect(validForwarding('+12145550187', '+12145550188', false)).toBe(false);
    expect(validForwarding('+12145550187', '+442012345678', true)).toBe(false);
    expect(validForwarding('+12145550187', '+12145550188', true)).toBe(true);
  });
  it('handles provider opt out before message body; START is not an automatic consent grant', () => {
    expect(classifyKeyword('hello', 'STOP')).toBe('stop');
    expect(classifyKeyword(' stop ')).toBe('stop');
    expect(classifyKeyword('HELP')).toBe('help');
    expect(classifyKeyword('START')).toBe('start');
  });
  it('never regresses delivery on reordered callbacks', () => {
    expect(advanceDelivery('delivered', 'sent')).toBe('delivered');
    expect(advanceDelivery('unknown', 'delivered')).toBe('delivered');
    expect(advanceDelivery('failed', 'delivered')).toBe('failed');
  });
  it('AI cannot choose unapproved services or ZIPs or book through a reply', () => {
    expect(qualifyLead('pay me $500', '75201', ['Roof leak'], ['75201'])).toBe(false);
    expect(qualifyLead('Roof leak', '99999', ['Roof leak'], ['75201'])).toBe(false);
    expect(qualifyLead('Roof leak', '75201', ['Roof leak'], ['75201'])).toBe(true);
    expect(
      nextQuestion({ service: 'Roof leak', zip: '75201', urgent: false }, 'Example'),
    ).toContain('only confirmed after');
  });
  it('trial requires all actual verification and test evidence', () => {
    const now = new Date('2026-10-30T17:00:00Z'),
      before = new Date('2026-10-29T17:00:00Z'),
      after = new Date('2026-11-10T17:00:00Z');
    expect(trialIsActive(before, null, before, after, now)).toBe(false);
    expect(trialIsActive(before, before, before, before, now)).toBe(false);
    expect(trialIsActive(before, before, before, after, now)).toBe(true);
  });
});
