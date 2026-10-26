/** Inspect the fixed weekly, floating-time contract emitted by our ICS writer. */
export function calendarDateRange(
  ics: string,
): { first: string; last: string } | null {
  const events = ics
    .replace(/\r?\n[ \t]/g, "")
    .split("BEGIN:VEVENT")
    .slice(1);
  let first = Infinity,
    last = -Infinity;
  for (const event of events) {
    const start = /^DTSTART:(\d{4})(\d{2})(\d{2})T/m.exec(event);
    const end = /^DTEND:(\d{4})(\d{2})(\d{2})T/m.exec(event);
    const count = /^RRULE:FREQ=WEEKLY;COUNT=(\d+)/m.exec(event);
    if (!start || !end || !count) return null;
    const from = Date.UTC(+start[1], +start[2] - 1, +start[3]);
    const until =
      Date.UTC(+end[1], +end[2] - 1, +end[3]) + (+count[1] - 1) * 7 * 86400000;
    first = Math.min(first, from);
    last = Math.max(last, until);
  }
  return Number.isFinite(first) && Number.isFinite(last)
    ? {
        first: new Date(first).toISOString().slice(0, 10),
        last: new Date(last).toISOString().slice(0, 10),
      }
    : null;
}
