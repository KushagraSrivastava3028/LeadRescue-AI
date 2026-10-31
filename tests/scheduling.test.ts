import { describe, expect, it } from 'vitest';
import { resolveBusinessSlot } from '@/lib/domain/scheduling';
describe('business-timezone inspection requests', () => {
  it('uses the business timezone across winter and summer', () => {
    expect(resolveBusinessSlot('2026-12-01', '09:00', 'America/Chicago')).toBe(
      '2026-12-01T15:00:00.000Z',
    );
    expect(resolveBusinessSlot('2026-07-01', '09:00', 'America/Chicago')).toBe(
      '2026-07-01T14:00:00.000Z',
    );
  });
  it('rejects nonexistent and ambiguous daylight-saving times', () => {
    expect(() => resolveBusinessSlot('2026-03-08', '02:30', 'America/New_York')).toThrow();
    expect(() => resolveBusinessSlot('2026-11-01', '01:30', 'America/New_York')).toThrow();
  });
  it('rejects invalid dates and accepts a quarter-hour IANA offset', () => {
    expect(() => resolveBusinessSlot('2026-02-30', '09:00', 'America/Chicago')).toThrow();
    expect(resolveBusinessSlot('2026-12-01', '09:00', 'Asia/Kathmandu')).toBe(
      '2026-12-01T03:15:00.000Z',
    );
  });
});
