// Collision forecast — the crunch-week view. Students discover the brutal week
// *during* that week; we surface it weeks ahead.
import type { Obligation } from './obligations';
import { addDaysYmd, dateStringDayDiff, localDateString, weekStartYmd } from './time';

const BIG_TYPES = new Set(['exam', 'paper', 'project']);

export type Severity = 'crunch' | 'heavy';

export interface CrunchWeek {
  /** Monday of the week, 'YYYY-MM-DD'. */
  weekStart: string;
  /** Whole weeks from this week (0 = this week). */
  weeksAway: number;
  /** Days until the week begins (negative if it has started). */
  daysUntilStart: number;
  severity: Severity;
  items: Obligation[];
  bigCount: number;
  hours: number;
}

export function forecastCrunch(obligations: Obligation[], now: Date, tz: string): CrunchWeek[] {
  const today = localDateString(now, tz);
  const thisWeek = weekStartYmd(today);
  const byWeek = new Map<string, Obligation[]>();

  for (const o of obligations) {
    if (o.done || !o.dueAt || o.kind === 'waiting_on') continue;
    const day = localDateString(o.dueAt, tz);
    if (day < today) continue;
    const key = weekStartYmd(day);
    const list = byWeek.get(key) ?? [];
    list.push(o);
    byWeek.set(key, list);
  }

  const out: CrunchWeek[] = [];
  for (const [weekStart, items] of byWeek) {
    const bigCount = items.filter((i) => BIG_TYPES.has(i.type)).length;
    const hours = items.reduce((s, i) => s + i.estimatedMinutes, 0) / 60;

    let severity: Severity | null = null;
    if (bigCount >= 3 || hours >= 20 || (bigCount >= 2 && hours >= 12)) severity = 'crunch';
    else if (bigCount >= 2 || hours >= 12) severity = 'heavy';
    if (!severity) continue;

    out.push({
      weekStart,
      weeksAway: Math.round(dateStringDayDiff(weekStart, thisWeek) / 7),
      daysUntilStart: dateStringDayDiff(weekStart, today),
      severity,
      items: items.sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime()),
      bigCount,
      hours,
    });
  }
  return out.sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
}

function countPhrase(n: number, singular: string, plural = `${singular}s`): string {
  return n === 1 ? `1 ${singular}` : `${n} ${plural}`;
}

/** "2 exams, 1 paper and 1 project all land in the same week." */
export function crunchHeadline(week: CrunchWeek): string {
  const counts: Record<string, number> = {};
  for (const i of week.items) counts[i.type] = (counts[i.type] ?? 0) + 1;
  const order = ['exam', 'paper', 'project', 'quiz', 'discussion', 'reading', 'other'];
  const parts = order
    .filter((t) => counts[t])
    .map((t) => countPhrase(counts[t], t === 'other' ? 'other item' : t))
    .slice(0, 4);
  const joined =
    parts.length <= 1 ? parts[0] ?? 'work' : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${joined} all land in the same week`;
}

export function crunchWhen(week: CrunchWeek): string {
  if (week.weeksAway <= 0) return 'this week';
  if (week.weeksAway === 1) return 'next week';
  return `in ${week.weeksAway} weeks`;
}

/** Date (YYYY-MM-DD) at which the one-time "crunch week approaching" nudge should fire. */
export function crunchNudgeDay(week: CrunchWeek, daysOut = 10): string {
  return addDaysYmd(week.weekStart, -daysOut);
}
