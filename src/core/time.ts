// Relative-time helpers. Design rule #1: never show "Sept 22" — show "in 3 days".
// All calendar-day math happens in the user's timezone, never the device's.

const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

export const DEFAULT_TZ = 'America/Chicago';

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}

interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  weekday: number; // 0 = Sunday
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_NAMES = WEEKDAYS;

export function zonedParts(date: Date, tz: string): Parts {
  const out: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(date)) out[p.type] = p.value;
  return {
    y: Number(out.year),
    m: Number(out.month),
    d: Number(out.day),
    h: Number(out.hour) % 24,
    min: Number(out.minute),
    weekday: Math.max(0, WEEKDAYS.indexOf(out.weekday)),
  };
}

/** 'YYYY-MM-DD' for the calendar day `date` falls on in `tz`. */
export function localDateString(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Whole calendar days from `from` to `to` in `tz` (positive = `to` is later). */
export function dayDiff(to: Date, from: Date, tz: string): number {
  const a = zonedParts(to, tz);
  const b = zonedParts(from, tz);
  return Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / MS_DAY);
}

export function dateStringDayDiff(toYmd: string, fromYmd: string): number {
  return Math.round((parseYmd(toYmd) - parseYmd(fromYmd)) / MS_DAY);
}

export function parseYmd(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDaysYmd(ymd: string, days: number): string {
  const t = new Date(parseYmd(ymd) + days * MS_DAY);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** Offset (ms) of `tz` relative to UTC at the given instant. */
function tzOffsetMs(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, 0);
  return asUtc - Math.floor(instant.getTime() / MS_MIN) * MS_MIN;
}

/** Convert a wall-clock date+time in `tz` to a UTC instant. */
export function zonedToUtc(ymd: string, hhmm: string, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  // Two passes handle DST boundaries.
  let t = guess - tzOffsetMs(new Date(guess), tz);
  t = guess - tzOffsetMs(new Date(t), tz);
  return new Date(t);
}

/** Start of the calendar day (00:00) for `date` in `tz`, as a UTC instant. */
export function startOfDay(date: Date, tz: string): Date {
  return zonedToUtc(localDateString(date, tz), '00:00', tz);
}

/** Monday-based week start ('YYYY-MM-DD') containing the given date string. */
export function weekStartYmd(ymd: string): string {
  const dow = new Date(parseYmd(ymd)).getUTCDay(); // 0 = Sun
  const sinceMonday = (dow + 6) % 7;
  return addDaysYmd(ymd, -sinceMonday);
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * Human relative time. Day-level phrases are calendar-based ("tomorrow" means
 * the next calendar day in the user's zone, not "in 24+ hours").
 */
export function relativeTime(target: Date | string, now: Date, tz: string = DEFAULT_TZ): string {
  const t = typeof target === 'string' ? new Date(target) : target;
  const ms = t.getTime() - now.getTime();
  const abs = Math.abs(ms);
  const future = ms >= 0;

  if (abs < MS_MIN) return 'right now';
  if (abs < MS_HOUR) {
    const n = Math.round(abs / MS_MIN);
    return future ? `in ${plural(n, 'min')}` : `${plural(n, 'min')} ago`;
  }

  const days = dayDiff(t, now, tz);
  if (days === 0) {
    const n = Math.round(abs / MS_HOUR);
    return future ? `in ${plural(n, 'hour')}` : `${plural(n, 'hour')} ago`;
  }
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1 && days < 14) return `in ${days} days`;
  if (days < -1 && days > -14) return `${-days} days ago`;
  const weeks = Math.round(Math.abs(days) / 7);
  return days > 0 ? `in ${plural(weeks, 'week')}` : `${plural(weeks, 'week')} ago`;
}

/** Same as relativeTime but for plain calendar dates ('YYYY-MM-DD'). */
export function relativeDay(ymd: string, now: Date, tz: string = DEFAULT_TZ): string {
  const days = dateStringDayDiff(ymd, localDateString(now, tz));
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1 && days < 14) return `in ${days} days`;
  if (days < -1 && days > -14) return `${-days} days ago`;
  const weeks = Math.round(Math.abs(days) / 7);
  return days > 0 ? `in ${plural(weeks, 'week')}` : `${plural(weeks, 'week')} ago`;
}

/** Relative bucket used for the flat "what's coming" list headers. */
export type Bucket = 'overdue' | 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'later';

export function bucketFor(target: Date | string, now: Date, tz: string = DEFAULT_TZ): Bucket {
  const t = typeof target === 'string' ? new Date(target) : target;
  const days = dayDiff(t, now, tz);
  if (days < 0) return 'overdue';
  if (days === 0) return t.getTime() < now.getTime() ? 'overdue' : 'today';
  if (days === 1) return 'tomorrow';
  if (days <= 6) return 'this_week';
  if (days <= 13) return 'next_week';
  return 'later';
}

export const BUCKET_LABEL: Record<Bucket, string> = {
  overdue: 'Past due',
  today: 'Today',
  tomorrow: 'Tomorrow',
  this_week: 'Later this week',
  next_week: 'Next week',
  later: 'Further out',
};

/** "40 min", "2h", "1h 30m" */
export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (rem === 0) return `${h}h`;
  if (rem >= 45) return `${h + 1}h`;
  if (rem < 15) return `${h}h`;
  return `${h}h ${rem}m`;
}

/** Time-of-day only ("5pm", "9:30am") — the one place clock time is fine. */
export function clockTime(date: Date | string, tz: string = DEFAULT_TZ): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const p = zonedParts(d, tz);
  const suffix = p.h >= 12 ? 'pm' : 'am';
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return p.min === 0 ? `${h12}${suffix}` : `${h12}:${String(p.min).padStart(2, '0')}${suffix}`;
}

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

export const MS = { MIN: MS_MIN, HOUR: MS_HOUR, DAY: MS_DAY };
