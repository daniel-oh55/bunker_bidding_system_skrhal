/** Convert a server ISO timestamp to a datetime-local wall-clock value. */
export function isoToLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Format an ISO instant as a wall-clock value at a supplied UTC offset. */
export function isoToInputAtOffset(value: string | null, offsetMinutes: number): string {
  if (!value || !Number.isFinite(offsetMinutes)) return '';
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return '';
  const wallClock = new Date(instant.getTime() + offsetMinutes * 60_000);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${wallClock.getUTCFullYear()}-${pad(wallClock.getUTCMonth() + 1)}-${pad(wallClock.getUTCDate())}T${pad(wallClock.getUTCHours())}:${pad(wallClock.getUTCMinutes())}`;
}

/** Convert a valid datetime-local value to its ISO UTC representation. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  // Date's string parser is deliberately avoided: it has browser-dependent rules.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const local = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (Number.isNaN(local.getTime()) || local.getFullYear() !== Number(year) || local.getMonth() !== Number(month) - 1 || local.getDate() !== Number(day) || local.getHours() !== Number(hour) || local.getMinutes() !== Number(minute)) return null;
  return local.toISOString();
}
