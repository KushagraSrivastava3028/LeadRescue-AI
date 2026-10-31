/** Resolve a modern local business slot without using the visitor's timezone.
 * Supported IANA zones currently use offsets in 15-minute increments. Reject
 * daylight-saving gaps and ambiguous repeated times rather than guessing.
 */
export function resolveBusinessSlot(date: string, time: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error('Choose a valid date and time.');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const local = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(local).toISOString().slice(0, 10) !== date)
    throw new Error('Choose a valid calendar date.');
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const candidates: number[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const instant = local + offset * 60_000;
    const p = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((v) => [v.type, v.value]),
    );
    if (`${p.year}-${p.month}-${p.day}` === date && `${p.hour}:${p.minute}` === time)
      candidates.push(instant);
  }
  if (candidates.length !== 1)
    throw new Error(
      'This local time overlaps a daylight-saving change. Please choose another time.',
    );
  return new Date(candidates[0]).toISOString();
}
