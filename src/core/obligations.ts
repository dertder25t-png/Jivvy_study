// Generic "obligation" — the one shape the reminder, forecast and triage engines
// understand. Nothing downstream knows about "courses" specifically, which keeps
// the door open for email-to-task, invoices, renewals, etc. (spec §11).
import type { Assignment, Exam, GradeComponent, WaitingOn } from '@/types/db';
import { gradeImpact } from './grades';
import { DEFAULT_MINUTES } from './estimation';

export type ObligationKind = 'assignment' | 'exam' | 'waiting_on' | (string & {});

export interface Obligation {
  id: string;
  kind: ObligationKind;
  /** Underlying row id in its own table. */
  refId: string;
  title: string;
  courseId: string | null;
  dueAt: Date | null;
  approximate: boolean;
  /** Assignment type, or 'exam', or free-form for other sources. */
  type: string;
  /** Percentage points of the course grade at stake. */
  impact: number;
  estimatedMinutes: number;
  done: boolean;
  source: string;
  examId?: string;
}

const DONE = new Set(['submitted', 'graded', 'dismissed']);

export function toObligations(args: {
  assignments: Assignment[];
  exams: Exam[];
  components: GradeComponent[];
  waiting?: WaitingOn[];
}): Obligation[] {
  const { assignments, exams, components, waiting = [] } = args;
  const examByAssignment = new Map(exams.filter((e) => e.assignment_id).map((e) => [e.assignment_id!, e]));
  const out: Obligation[] = [];

  for (const a of assignments) {
    const courseAssignments = assignments.filter((x) => x.course_id === a.course_id);
    const exam = examByAssignment.get(a.id);
    out.push({
      id: `assignment:${a.id}`,
      kind: 'assignment',
      refId: a.id,
      title: a.title,
      courseId: a.course_id,
      dueAt: exam ? new Date(exam.happens_at) : a.due_at ? new Date(a.due_at) : null,
      approximate: a.due_is_approximate,
      type: exam ? 'exam' : a.type,
      impact: gradeImpact(a, components, courseAssignments),
      estimatedMinutes: a.estimated_minutes ?? DEFAULT_MINUTES[exam ? 'exam' : a.type] ?? DEFAULT_MINUTES.other,
      done: DONE.has(a.status),
      source: a.source,
      examId: exam?.id,
    });
  }

  // Exams that were never linked to an assignment still need to surface.
  for (const e of exams) {
    if (e.assignment_id && assignments.some((a) => a.id === e.assignment_id)) continue;
    out.push({
      id: `exam:${e.id}`,
      kind: 'exam',
      refId: e.id,
      title: e.title,
      courseId: e.course_id,
      dueAt: new Date(e.happens_at),
      approximate: false,
      type: 'exam',
      impact: 10,
      estimatedMinutes: DEFAULT_MINUTES.exam,
      done: false,
      source: 'syllabus',
      examId: e.id,
    });
  }

  for (const w of waiting) {
    if (w.resolved_at) continue;
    out.push({
      id: `waiting_on:${w.id}`,
      kind: 'waiting_on',
      refId: w.id,
      title: w.what,
      courseId: w.course_id,
      dueAt: new Date(w.nudge_at),
      approximate: false,
      type: 'waiting_on',
      impact: 1,
      estimatedMinutes: 5,
      done: false,
      source: 'manual',
    });
  }
  return out;
}
