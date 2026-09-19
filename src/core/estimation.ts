// Duration estimation: students schedule by due date and get destroyed by
// duration. We learn a per-type correction factor from estimated vs actual
// minutes and work backward from the deadline to a "start this today" date.
import type { Assignment } from '@/types/db';
import { MS, dayDiff } from './time';

export const DEFAULT_MINUTES: Record<string, number> = {
  reading: 45,
  discussion: 30,
  quiz: 30,
  paper: 300,
  project: 480,
  exam: 240, // total study time, not the sitting itself
  other: 60,
};

export const DEFAULT_DAILY_MINUTES = 90;

export interface EstimateSample {
  type: string;
  estimated: number;
  actual: number;
}

export function samplesFrom(assignments: Assignment[]): EstimateSample[] {
  return assignments
    .filter((a) => a.estimated_minutes && a.actual_minutes && a.estimated_minutes > 0 && a.actual_minutes > 0)
    .map((a) => ({ type: a.type, estimated: a.estimated_minutes!, actual: a.actual_minutes! }));
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface Correction {
  factor: number;
  samples: number;
  /** True once we have enough history to show the number to the student. */
  confident: boolean;
}

/**
 * Personal correction factor for an assignment type (actual ÷ estimated).
 * Shrunk toward 1.0 when history is thin, and falls back to all-types history
 * when this type has none.
 */
export function correctionFactor(samples: EstimateSample[], type: string): Correction {
  const own = samples.filter((s) => s.type === type);
  const pool = own.length >= 2 ? own : samples;
  if (pool.length === 0) return { factor: 1, samples: 0, confident: false };
  const raw = median(pool.map((s) => s.actual / s.estimated));
  const n = pool.length;
  const shrunk = 1 + (raw - 1) * (n / (n + 2));
  return {
    factor: Math.min(5, Math.max(0.5, shrunk)),
    samples: n,
    confident: own.length >= 3,
  };
}

/** Minutes of real work we expect this to take, for this particular student. */
export function effortMinutes(
  a: Pick<Assignment, 'type' | 'estimated_minutes'>,
  samples: EstimateSample[],
): number {
  const base = a.estimated_minutes ?? DEFAULT_MINUTES[a.type] ?? DEFAULT_MINUTES.other;
  return Math.round(base * correctionFactor(samples, a.type).factor);
}

export interface StartPlan {
  startAt: Date;
  daysNeeded: number;
  /** The ideal start already passed — the honest message is "start now". */
  startNow: boolean;
}

/** Work backward from the deadline: due − (effort ÷ what you can do per day). */
export function startBy(
  dueAt: Date,
  effort: number,
  now: Date,
  dailyMinutes = DEFAULT_DAILY_MINUTES,
): StartPlan {
  const daysNeeded = Math.min(21, Math.max(1, Math.ceil(effort / dailyMinutes)));
  const ideal = new Date(dueAt.getTime() - daysNeeded * MS.DAY);
  const startNow = ideal.getTime() <= now.getTime();
  return { startAt: startNow ? now : ideal, daysNeeded, startNow };
}

export interface Capacity {
  neededMinutes: number;
  availableMinutes: number;
  deficitMinutes: number;
}

/**
 * How many unclaimed minutes exist before this deadline, after earlier-or-equal
 * deadlines have taken their share. No calendar integration — a simple daily budget.
 */
export function capacityBefore(
  target: { dueAt: Date; effort: number; id: string },
  others: { dueAt: Date | null; effort: number; id: string }[],
  now: Date,
  tz: string,
  dailyMinutes = DEFAULT_DAILY_MINUTES,
): Capacity {
  const days = Math.max(0, dayDiff(target.dueAt, now, tz));
  const budget = days * dailyMinutes;
  const claimed = others
    .filter((o) => o.id !== target.id && o.dueAt && o.dueAt.getTime() <= target.dueAt.getTime() && o.dueAt.getTime() >= now.getTime())
    .reduce((s, o) => s + o.effort, 0);
  const available = Math.max(0, budget - claimed);
  return {
    neededMinutes: target.effort,
    availableMinutes: available,
    deficitMinutes: Math.max(0, target.effort - available),
  };
}
