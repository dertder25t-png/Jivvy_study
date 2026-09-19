// Comeback triage (§5.5). The failure state — vanishing for a week and coming
// back in a panic — is a normal mode, so it gets its own carefully-shaped screen:
//   1. Still salvageable   (open late window, with real penalty + time left)
//   2. Actually dead       (grouped, dismissible in one tap, no red, no guilt)
//   3. The one thing today (highest grade impact, singular)
import type { Obligation } from './obligations';
import type { CoursePolicy } from '@/types/db';
import { MS } from './time';
import { lateStatus, type LateStatus } from './policies';

export const COMEBACK_AFTER_DAYS = 4;

export function shouldShowComeback(lastOpenedAt: Date | null, now: Date): boolean {
  if (!lastOpenedAt) return false;
  return now.getTime() - lastOpenedAt.getTime() >= COMEBACK_AFTER_DAYS * MS.DAY;
}

export interface SalvageItem {
  obligation: Obligation;
  late: LateStatus;
  /** Grade points still recoverable if handed in now. */
  recoverable: number;
}

export interface ComebackPlan {
  salvageable: SalvageItem[];
  dead: Obligation[];
  /** Single highest-consequence item across salvageable + upcoming. */
  oneThing: Obligation | null;
  /** Items actually coming up (for context under the one thing). */
  upcomingCount: number;
}

export function buildComeback(args: {
  obligations: Obligation[];
  policies: Map<string, CoursePolicy>;
  now: Date;
}): ComebackPlan {
  const { obligations, policies, now } = args;
  const salvageable: SalvageItem[] = [];
  const dead: Obligation[] = [];
  const upcoming: Obligation[] = [];

  for (const o of obligations) {
    if (o.done || !o.dueAt || o.kind === 'waiting_on') continue;
    if (o.dueAt.getTime() >= now.getTime()) {
      upcoming.push(o);
      continue;
    }
    // Past due and not handed in.
    const policy = o.courseId ? policies.get(o.courseId) : undefined;
    const late = lateStatus(o.dueAt, policy?.late_policy, now);
    if (late.state === 'late_open') {
      salvageable.push({ obligation: o, late, recoverable: o.impact * late.creditRemaining });
    } else if (o.type !== 'exam') {
      // Exams can't be "handed in late"; leave them out of the dead pile so we
      // never dress up a missed exam as a tidy-up chore.
      dead.push(o);
    }
  }

  salvageable.sort((a, b) => b.recoverable - a.recoverable);
  dead.sort((a, b) => b.impact - a.impact);

  const soon = upcoming
    .filter((o) => o.dueAt!.getTime() - now.getTime() <= 7 * MS.DAY)
    .map((o) => ({ o, score: o.impact }));
  const candidates = [
    ...salvageable.map((s) => ({ o: s.obligation, score: s.recoverable })),
    ...soon,
  ].sort((a, b) => b.score - a.score || (a.o.dueAt!.getTime() - b.o.dueAt!.getTime()));

  return {
    salvageable,
    dead,
    oneThing: candidates[0]?.o ?? null,
    upcomingCount: upcoming.length,
  };
}

/** The most consequential thing for today, for the normal (non-comeback) home screen. */
export function oneThingToday(obligations: Obligation[], now: Date, horizonDays = 7): Obligation | null {
  const horizon = now.getTime() + horizonDays * MS.DAY;
  const pool = obligations.filter(
    (o) =>
      !o.done &&
      o.kind !== 'waiting_on' &&
      o.dueAt &&
      o.dueAt.getTime() >= now.getTime() &&
      o.dueAt.getTime() <= horizon,
  );
  pool.sort((a, b) => b.impact - a.impact || a.dueAt!.getTime() - b.dueAt!.getTime());
  return pool[0] ?? null;
}
