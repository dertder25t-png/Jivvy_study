// Late windows, attendance allowance, and the "buffers you forgot you have".
import type {
  Absence,
  Assignment,
  AttendancePolicy,
  CoursePolicy,
  GradeComponent,
  LatePolicy,
} from '@/types/db';
import { MS, formatMinutes } from './time';
import { componentResult } from './grades';

export type LateState = 'on_time' | 'late_open' | 'late_closed' | 'no_late_policy';

export interface LateStatus {
  state: LateState;
  /** Fraction of credit still available right now (1 = full). */
  creditRemaining: number;
  /** The window closes at this instant; null if open-ended or n/a. */
  closesAt: Date | null;
  msLeft: number | null;
}

export function lateStatus(dueAt: Date, policy: LatePolicy | undefined | null, now: Date): LateStatus {
  if (now.getTime() <= dueAt.getTime()) {
    return { state: 'on_time', creditRemaining: 1, closesAt: null, msLeft: null };
  }
  if (!policy || policy.accepted !== true) {
    return { state: 'no_late_policy', creditRemaining: 0, closesAt: null, msLeft: null };
  }

  const windowMs = policy.window_hours != null ? policy.window_hours * MS.HOUR : null;
  const closesAt = windowMs != null ? new Date(dueAt.getTime() + windowMs) : null;
  if (closesAt && now.getTime() > closesAt.getTime()) {
    return { state: 'late_closed', creditRemaining: 0, closesAt, msLeft: 0 };
  }

  const daysLate = Math.max(1, Math.ceil((now.getTime() - dueAt.getTime()) / MS.DAY));
  const perDay = policy.penalty_per_day ?? 0;
  const credit = Math.max(0, 1 - perDay * daysLate);
  if (credit <= 0) return { state: 'late_closed', creditRemaining: 0, closesAt, msLeft: 0 };

  return {
    state: 'late_open',
    creditRemaining: credit,
    closesAt,
    msLeft: closesAt ? closesAt.getTime() - now.getTime() : null,
  };
}

/** "2 more days", "about 5 more hours" — never a calendar date. */
export function timeLeftPhrase(ms: number): string {
  if (ms >= MS.DAY * 1.5) return `${Math.round(ms / MS.DAY)} more days`;
  if (ms >= MS.DAY) return '1 more day';
  if (ms >= MS.HOUR) {
    const h = Math.round(ms / MS.HOUR);
    return `about ${h} more hour${h === 1 ? '' : 's'}`;
  }
  return `${formatMinutes(Math.max(1, ms / MS.MIN))} left`;
}

/** Calming copy: "Still counts for 90% — 2 more days". */
export function describeLate(s: LateStatus): string | null {
  if (s.state === 'late_open') {
    const pct = Math.round(s.creditRemaining * 100);
    return s.msLeft != null
      ? `Still counts for ${pct}% — ${timeLeftPhrase(s.msLeft)}`
      : `Still accepted for ${pct}% credit`;
  }
  if (s.state === 'late_closed') return 'Late window has closed';
  if (s.state === 'no_late_policy') return 'Late work not listed as accepted';
  return null;
}

export interface AttendanceBuffer {
  allowed: number | null;
  used: number; // unexcused only
  remaining: number | null;
}

export function attendanceBuffer(policy: AttendancePolicy | undefined | null, absences: Absence[]): AttendanceBuffer {
  const used = absences.filter((a) => !a.excused).length;
  const allowed = policy?.allowed_absences ?? null;
  return { allowed, used, remaining: allowed == null ? null : Math.max(0, allowed - used) };
}

export interface Buffer {
  kind: 'drop' | 'absence' | 'late_window' | 'note';
  label: string;
  detail: string;
}

/** Everything the student has in their back pocket for one course. */
export function courseBuffers(args: {
  components: GradeComponent[];
  assignments: Assignment[];
  policy: CoursePolicy | undefined;
  absences: Absence[];
  now: Date;
}): Buffer[] {
  const { components, assignments, policy, absences, now } = args;
  const out: Buffer[] = [];

  for (const c of components) {
    if (c.drop_lowest > 0) {
      const r = componentResult(c, assignments);
      // Work that has lapsed unsubmitted counts as a zero — exactly what a drop-lowest policy absorbs.
      const missed = assignments.filter((a) => {
        if (a.component_id !== c.id || !a.due_at || new Date(a.due_at) >= now) return false;
        if (a.status !== 'todo' && a.status !== 'in_progress') return false;
        const s = lateStatus(new Date(a.due_at), policy?.late_policy, now).state;
        return s === 'late_closed' || s === 'no_late_policy';
      });
      const spent = Math.min(c.drop_lowest, r.droppedIds.length + missed.length);
      const left = c.drop_lowest - spent;
      out.push({
        kind: 'drop',
        label: `Lowest ${c.drop_lowest} ${c.name.toLowerCase()} dropped`,
        detail:
          spent === 0
            ? `Nothing spent yet — a bad one costs you nothing.`
            : left > 0
              ? `${spent} of ${c.drop_lowest} already covering a low or missed score; ${left} left.`
              : missed.length > 0
                ? `Already used on a missed one (${missed[0].title}). Any more misses will count.`
                : `All ${c.drop_lowest} are covering low scores right now.`,
      });
    }
  }

  const att = attendanceBuffer(policy?.attendance_policy, absences);
  if (att.allowed != null) {
    out.push({
      kind: 'absence',
      label: att.remaining === 1 ? '1 absence left' : `${att.remaining} absences left`,
      detail: policy?.attendance_policy?.penalty
        ? `After that: ${policy.attendance_policy.penalty}`
        : `${att.used} of ${att.allowed} used.`,
    });
  }

  for (const a of assignments) {
    if (!a.due_at || a.status === 'submitted' || a.status === 'graded' || a.status === 'dismissed') continue;
    const s = lateStatus(new Date(a.due_at), policy?.late_policy, now);
    if (s.state === 'late_open') {
      out.push({ kind: 'late_window', label: a.title, detail: describeLate(s) ?? '' });
    }
  }

  if (policy?.notes) out.push({ kind: 'note', label: 'Also worth knowing', detail: policy.notes });
  return out;
}
