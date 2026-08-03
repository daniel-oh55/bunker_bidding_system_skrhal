import { describe, expect, it } from 'vitest';
import { isoToLocalInput, localInputToIso } from './datetime';

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
});
