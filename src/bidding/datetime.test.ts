import { describe, expect, it } from 'vitest';
import { currentSeoulDate, defaultPublishDeadlineInput, isoToInputAtOffset, isoToLocalInput, localInputToIso, millisecondsUntilNextSeoulDate, seoulDateFromInstant } from './datetime';

describe('datetime-local conversion', () => {
  it('preserves null and empty deadlines', () => {
    expect(isoToLocalInput(null)).toBe('');
    expect(localInputToIso('')).toBeNull();
  });

  it('converts through the local wall clock without slicing UTC', () => {
    const server = '2026-08-03T03:00:00.000Z';
    const local = isoToLocalInput(server);
    expect(localInputToIso(local)).toBe(server);
  });

  it('does not throw or create a timestamp for malformed local input', () => {
    expect(localInputToIso('2026-99-03T12:00')).toBeNull();
    expect(localInputToIso('not-a-date')).toBeNull();
    expect(isoToLocalInput('not-a-date')).toBe('');
  });

  it('proves the Asia/Seoul UTC+09:00 display contract independently of the runner timezone', () => {
    expect(isoToInputAtOffset('2026-08-03T03:00:00.000Z', 9 * 60)).toBe('2026-08-03T12:00');
  });

  it('classifies instants and today by the deterministic Seoul calendar date', () => {
    expect(seoulDateFromInstant('2026-08-30T14:59:59.999Z')).toBe('2026-08-30');
    expect(seoulDateFromInstant('2026-08-30T15:00:00.000Z')).toBe('2026-08-31');
    expect(seoulDateFromInstant('invalid')).toBeNull();
    expect(currentSeoulDate(Date.parse('2026-08-30T15:00:00.000Z'))).toBe('2026-08-31');
  });

  it('calculates the next Seoul midnight without the browser timezone', () => {
    expect(millisecondsUntilNextSeoulDate(Date.parse('2026-08-30T14:59:59.900Z'))).toBe(100);
    expect(millisecondsUntilNextSeoulDate(Date.parse('2026-08-30T15:00:00.000Z'))).toBe(86_400_000);
  });

  it('uses today at 18:30 Seoul when now is before the cutoff', () => {
    const input = defaultPublishDeadlineInput(Date.parse('2026-08-03T09:29:59.999Z'));
    expect(localInputToIso(input)).toBe('2026-08-03T09:30:00.000Z');
  });

  it('rolls exactly 18:30 Seoul over to the next Seoul calendar day', () => {
    const input = defaultPublishDeadlineInput(Date.parse('2026-08-03T09:30:00.000Z'));
    expect(localInputToIso(input)).toBe('2026-08-04T09:30:00.000Z');
  });

  it('rolls after 18:30 Seoul over to the next Seoul calendar day', () => {
    const input = defaultPublishDeadlineInput(Date.parse('2026-08-03T10:00:00.000Z'));
    expect(localInputToIso(input)).toBe('2026-08-04T09:30:00.000Z');
  });

  it('round-trips the Seoul target instant through the runner local timezone', () => {
    const beforeCutoff = defaultPublishDeadlineInput(Date.parse('2026-08-03T00:00:00.000Z'));
    expect(localInputToIso(beforeCutoff)).toBe('2026-08-03T09:30:00.000Z');
  });
});
