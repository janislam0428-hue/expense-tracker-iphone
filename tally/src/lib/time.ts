// Time helpers. Everything is stored in UTC and bucketed in the user's
// timezone (Asia/Hong_Kong by default) so a 23:50 payment lands on the right day.
import { TZDate, tz } from "@date-fns/tz";
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from "date-fns";

export const DEFAULT_TZ = "Asia/Hong_Kong";

export type Period = { start: Date; end: Date }; // end is exclusive

export function nowIn(zone = DEFAULT_TZ): TZDate {
  return TZDate.tz(zone);
}

/** Build a UTC instant from wall clock parts in a zone. Month is 1 based. */
export function zonedDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  zone = DEFAULT_TZ,
): Date {
  return new Date(new TZDate(year, month - 1, day, hour, minute, 0, zone).getTime());
}

export function monthPeriod(ref: Date, zone = DEFAULT_TZ): Period {
  const start = startOfMonth(ref, { in: tz(zone) });
  return { start: new Date(start.getTime()), end: new Date(addMonths(start, 1).getTime()) };
}

export function previousMonthPeriod(ref: Date, zone = DEFAULT_TZ): Period {
  const start = startOfMonth(ref, { in: tz(zone) });
  const prev = addMonths(start, -1);
  return { start: new Date(prev.getTime()), end: new Date(start.getTime()) };
}

export function quarterStart(ref: Date, zone = DEFAULT_TZ): Date {
  return new Date(startOfQuarter(ref, { in: tz(zone) }).getTime());
}

export function yearStart(ref: Date, zone = DEFAULT_TZ): Date {
  return new Date(startOfYear(ref, { in: tz(zone) }).getTime());
}

export function weekStart(ref: Date, zone = DEFAULT_TZ, weekStartsOn: 0 | 1 = 1): Date {
  return new Date(startOfWeek(ref, { in: tz(zone), weekStartsOn }).getTime());
}

export function dayStart(ref: Date, zone = DEFAULT_TZ): Date {
  return new Date(startOfDay(ref, { in: tz(zone) }).getTime());
}

/** Days elapsed in the month up to and including today. */
export function daysElapsedInMonth(ref: Date, zone = DEFAULT_TZ): number {
  const start = startOfMonth(ref, { in: tz(zone) });
  return differenceInCalendarDays(new TZDate(ref, zone), start) + 1;
}

export function daysInMonth(ref: Date, zone = DEFAULT_TZ): number {
  const z = new TZDate(ref, zone);
  return endOfMonth(z).getDate();
}

export function formatInZone(date: Date, pattern: string, zone = DEFAULT_TZ): string {
  return format(new TZDate(date, zone), pattern);
}

/** Local calendar parts of an instant in a zone. Month is 1 based. */
export function zonedParts(date: Date, zone = DEFAULT_TZ) {
  const z = new TZDate(date, zone);
  return {
    year: z.getFullYear(),
    month: z.getMonth() + 1,
    day: z.getDate(),
    weekday: z.getDay(), // 0 Sunday
    hour: z.getHours(),
    minute: z.getMinutes(),
  };
}

export function addZonedDays(date: Date, days: number, zone = DEFAULT_TZ): Date {
  return new Date(addDays(new TZDate(date, zone), days).getTime());
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}
