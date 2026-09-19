// Notification engine (§5.6). Fewer, smarter, escalating.
//   * hard cap: ≤3 per local day, ranked by grade impact, the rest dropped
//   * allowed types only: start-date nudge, exam-review session, late-window
//     closing, collision week approaching (once, ~10 days out), waiting_on nudge
//   * escalation only for high-weight items
//   * NEVER a streak reminder, NEVER "you haven't opened the app"
//
// It works on generic Obligations, so the same engine can remind about things
// that aren't coursework later (§11).
import type { CoursePolicy } from '@/types/db';
import type { Obligation } from './obligations';
import { DEFAULT_DAILY_MINUTES, effortMinutes, startBy, type EstimateSample } from './estimation';
import { lateStatus } from './policies';
import { crunchHeadline, crunchNudgeDay, crunchWhen, type CrunchWeek } from './collisions';
import type { StudySession } from './studyPlan';
import { MS, addDaysYmd, localDateString, zonedToUtc } from './time';

export const DAILY_CAP = 3;
export const HIGH_WEIGHT_IMPACT = 8; // % of course grade
export const NOTIFY_HOUR = '09:00';

export type NotificationKind =
  | 'start_date'
  | 'exam_review'
  | 'late_window_closing'
  | 'collision_week'
  | 'waiting_on'
  | 'escalation';

export interface PlannedNotification {
  id: string;
  kind: NotificationKind;
  fireAt: Date;
  title: string;
  body: string;
  /** Ranking weight — higher survives the daily cap. */
  impact: number;
  /** Deep link target inside the app. */
  href?: string;
}

const KIND_PRIORITY: Record<NotificationKind, number> = {
  late_window_closing: 5,
  escalation: 4,
  exam_review: 3,
  start_date: 2,
  collision_week: 1,
  waiting_on: 0,
};

export function planNotifications(args: {
  obligations: Obligation[];
  policies: Map<string, CoursePolicy>;
  sessions: StudySession[];
  crunch: CrunchWeek[];
  samples: EstimateSample[];
  courseName: (id: string | null) => string;
  now: Date;
  tz: string;
  dailyMinutes?: number;
  horizonDays?: number;
}): PlannedNotification[] {
  const { obligations, policies, sessions, crunch, samples, courseName, now, tz } = args;
  const dailyMinutes = args.dailyMinutes ?? DEFAULT_DAILY_MINUTES;
  const horizon = now.getTime() + (args.horizonDays ?? 14) * MS.DAY;
  const out: PlannedNotification[] = [];
  const at9 = (ymd: string) => zonedToUtc(ymd, NOTIFY_HOUR, tz);
  const inFuture = (d: Date) => d.getTime() > now.getTime() && d.getTime() <= horizon;

  for (const o of obligations) {
    if (o.done || !o.dueAt) continue;
    const course = courseName(o.courseId);

    if (o.kind === 'waiting_on') {
      let fire = o.dueAt.getTime() > now.getTime() ? o.dueAt : at9(localDateString(now, tz));
      if (fire.getTime() <= now.getTime()) fire = new Date(now.getTime() + 5 * MS.MIN);
      if (fire.getTime() <= horizon) {
        out.push({
          id: `waiting:${o.refId}`,
          kind: 'waiting_on',
          fireAt: fire,
          title: 'Time to follow up?',
          body: o.title,
          impact: o.impact,
          href: '/waiting',
        });
      }
      continue;
    }

    // Late-window closing: only when something is actually still recoverable.
    if (o.dueAt.getTime() < now.getTime() && o.courseId) {
      const late = lateStatus(o.dueAt, policies.get(o.courseId)?.late_policy, now);
      if (late.state === 'late_open' && late.closesAt) {
        const fire = new Date(late.closesAt.getTime() - 24 * MS.HOUR);
        const when = fire.getTime() > now.getTime() ? fire : new Date(now.getTime() + 5 * MS.MIN);
        if (when.getTime() <= horizon) {
          out.push({
            id: `late:${o.refId}`,
            kind: 'late_window_closing',
            fireAt: when,
            title: `${o.title} is still worth handing in`,
            body: `${course}: it still counts for ${Math.round(late.creditRemaining * 100)}% — the window closes soon.`,
            impact: o.impact * late.creditRemaining + 1,
            href: `/assignment/${o.refId}`,
          });
        }
      }
      continue;
    }

    if (o.dueAt.getTime() < now.getTime() || o.approximate) continue;

    // Start-date nudge: ONE per assignment, on the day you should begin — the due-date reminder
    // arrives when it's already too late to act.
    if (o.kind === 'assignment' && o.type !== 'exam') {
      const effort = effortMinutes({ type: o.type, estimated_minutes: o.estimatedMinutes }, samples);
      const plan = startBy(o.dueAt, effort, now, dailyMinutes);
      const startDay = localDateString(plan.startAt, tz);
      let fire = at9(startDay);
      if (fire.getTime() <= now.getTime()) fire = new Date(Math.max(now.getTime() + 5 * MS.MIN, at9(localDateString(now, tz)).getTime()));
      if (fire.getTime() < o.dueAt.getTime() && inFuture(fire)) {
        const hours = Math.max(1, Math.round(effort / 60));
        out.push({
          id: `start:${o.refId}`,
          kind: 'start_date',
          fireAt: fire,
          title: `Start "${o.title}" today`,
          body: `${course} · needs about ${hours}h of work to finish comfortably.`,
          impact: o.impact,
          href: `/assignment/${o.refId}`,
        });
      }

      // Escalation — high-weight items only, one extra nudge the day before.
      if (o.impact >= HIGH_WEIGHT_IMPACT) {
        const eve = at9(addDaysYmd(localDateString(o.dueAt, tz), -1));
        if (eve.getTime() > now.getTime() && eve.getTime() <= horizon && eve.getTime() > fire.getTime()) {
          out.push({
            id: `escalate:${o.refId}`,
            kind: 'escalation',
            fireAt: eve,
            title: `"${o.title}" is due tomorrow`,
            body: `${course} · worth about ${Math.round(o.impact)}% of your grade.`,
            impact: o.impact + 2,
            href: `/assignment/${o.refId}`,
          });
        }
      }
    }
  }

  // Exam-review sessions: one per session-day.
  for (const s of sessions) {
    const fire = at9(s.date);
    if (!inFuture(fire)) continue;
    out.push({
      id: `session:${s.examId}:${s.date}:${s.kind}`,
      kind: 'exam_review',
      fireAt: fire,
      title: `${s.minutes} min for ${s.examTitle}`,
      body: s.what,
      impact: 5 + (s.kind === 'final_pass' ? 3 : 0),
      href: '/study',
    });
  }

  // Collision week: one-time, ~10 days out.
  for (const w of crunch) {
    if (w.severity !== 'crunch') continue;
    const fire = at9(crunchNudgeDay(w));
    if (inFuture(fire)) {
      out.push({
        id: `crunch:${w.weekStart}`,
        kind: 'collision_week',
        fireAt: fire,
        title: `A heavy week is coming ${crunchWhen(w)}`,
        body: `${crunchHeadline(w)}. Worth planning ahead now.`,
        impact: 3 + w.bigCount,
        href: '/crunch',
      });
    }
  }

  return budgetNotifications(dedupe(out), tz);
}

function dedupe(list: PlannedNotification[]): PlannedNotification[] {
  const seen = new Map<string, PlannedNotification>();
  for (const n of list) if (!seen.has(n.id)) seen.set(n.id, n);
  return [...seen.values()];
}

/** Keep the top `cap` notifications per local day (by impact, then kind priority). */
export function budgetNotifications(list: PlannedNotification[], tz: string, cap = DAILY_CAP): PlannedNotification[] {
  const byDay = new Map<string, PlannedNotification[]>();
  for (const n of list) {
    const day = localDateString(n.fireAt, tz);
    byDay.set(day, [...(byDay.get(day) ?? []), n]);
  }
  const kept: PlannedNotification[] = [];
  for (const items of byDay.values()) {
    items.sort((a, b) => b.impact - a.impact || KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind] || a.id.localeCompare(b.id));
    kept.push(...items.slice(0, cap));
  }
  return kept.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
}
