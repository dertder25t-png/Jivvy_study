// Everything the screens need, computed once per data change from the pure core.
import { useEffect, useMemo, useState } from 'react';
import type { Assignment, Course, CoursePolicy, Exam, GradeComponent, Topic } from '@/types/db';
import { useStoreSnapshot, type Rows } from './store';
import { usePrefs } from './prefs';
import { toObligations, type Obligation } from '@/core/obligations';
import { forecastCrunch, type CrunchWeek } from '@/core/collisions';
import { buildStudyPlan, type StudySession } from '@/core/studyPlan';
import { samplesFrom, type EstimateSample } from '@/core/estimation';
import { courseGrade, type CourseGrade } from '@/core/grades';
import type { CardWithReviews, ExamTarget } from '@/core/scheduling';
import { needsConfirmation } from '@/core/notes';
import { planNotifications, type PlannedNotification } from '@/core/notifications';
import { inScope, paceSecondsPerCard, usable } from '@/core/session';
import { colorForSet } from '@/core/sets';
import { planTestPrep, type PrepTarget, type PrepTask } from '@/core/testPrep';

/** A clock that ticks each minute so "in 40 min" stays honest. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export interface Semester {
  rows: Rows;
  tz: string;
  now: Date;
  courseById: Map<string, Course>;
  policies: Map<string, CoursePolicy>;
  componentsByCourse: Map<string, GradeComponent[]>;
  assignmentsByCourse: Map<string, Assignment[]>;
  topicsByCourse: Map<string, Topic[]>;
  examsByCourse: Map<string, Exam[]>;
  obligations: Obligation[];
  grades: Map<string, CourseGrade>;
  crunch: CrunchWeek[];
  samples: EstimateSample[];
  cards: CardWithReviews[];
  examTargets: ExamTarget[];
  sessions: StudySession[];
  inboxCount: number;
  courseName: (id: string | null) => string;
  notifications: PlannedNotification[];
  /** Day-by-day flashcard plan for every upcoming test (sets with a test date + syllabus exams). */
  prep: PrepTask[];
  /** Your review pace, seconds per card. */
  pace: number;
}

function groupBy<T>(list: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

export function useSemester(): Semester {
  const rows = useStoreSnapshot();
  const { tz, dailyMinutes, studyTime } = usePrefs();
  const now = useNow();

  return useMemo(() => {
    const courseById = new Map(rows.courses.map((c) => [c.id, c]));
    const policies = new Map(rows.course_policies.map((p) => [p.course_id, p]));
    const componentsByCourse = groupBy(rows.grade_components, (c) => c.course_id);
    const assignmentsByCourse = groupBy(rows.assignments, (a) => a.course_id);
    const topicsByCourse = groupBy(rows.topics, (t) => t.course_id);
    const examsByCourse = groupBy(rows.exams, (e) => e.course_id);

    const obligations = toObligations({
      assignments: rows.assignments, exams: rows.exams, components: rows.grade_components, waiting: rows.waiting_on,
    });
    const grades = new Map<string, CourseGrade>();
    for (const c of rows.courses) {
      grades.set(c.id, courseGrade(componentsByCourse.get(c.id) ?? [], assignmentsByCourse.get(c.id) ?? []));
    }
    const crunch = forecastCrunch(obligations, now, tz);
    const samples = samplesFrom(rows.assignments);

    const reviewsByCard = groupBy(rows.card_reviews, (r) => r.card_id);
    const cards: CardWithReviews[] = rows.cards.map((card) => ({ card, reviews: reviewsByCard.get(card.id) ?? [] }));

    const coverageByExam = groupBy(rows.exam_coverage, (c) => c.exam_id);
    const examTargets: ExamTarget[] = rows.exams.map((e) => ({
      examId: e.id, title: e.title, at: new Date(e.happens_at),
      topicIds: new Set((coverageByExam.get(e.id) ?? []).map((c) => c.topic_id)),
    }));

    const sessions = buildStudyPlan({
      exams: rows.exams.map((e) => ({
        id: e.id, title: e.title, courseId: e.course_id, at: new Date(e.happens_at),
        topicIds: (coverageByExam.get(e.id) ?? []).map((c) => c.topic_id),
      })),
      topics: rows.topics, notes: rows.notes, cards, now, tz, dailyMinutes,
    });

    const courseName = (id: string | null) => (id ? courseById.get(id)?.code ?? courseById.get(id)?.name ?? '' : '');

    // Every upcoming test that has flashcards: a set with its own test date, or a syllabus exam.
    const cardsByNote = groupBy(cards.filter((k) => usable(k) && k.card.source_note_id), (k) => k.card.source_note_id!);
    const prepTargets: PrepTarget[] = [];
    for (const n of rows.notes) {
      const set = n.test_date ? cardsByNote.get(n.id) : undefined;
      if (!set) continue;
      prepTargets.push({
        key: `note:${n.id}`, title: n.title || 'Untitled set', color: colorForSet(n.id),
        testAt: new Date(n.test_date!), scope: { noteId: n.id }, cards: set,
      });
    }
    for (const e of rows.exams) {
      const covered = inScope(cards, { examId: e.id }, examTargets);
      if (covered.length === 0) continue;
      prepTargets.push({
        key: `exam:${e.id}`, title: [courseName(e.course_id), e.title].filter(Boolean).join(' '),
        color: courseById.get(e.course_id)?.color ?? '#4F46E5', testAt: new Date(e.happens_at), scope: { examId: e.id }, cards: covered,
      });
    }
    const prep = planTestPrep({ targets: prepTargets, now, tz });
    const pace = paceSecondsPerCard(rows.card_reviews);

    const notifications = planNotifications({
      obligations, policies, sessions, crunch, samples, courseName, now, tz, dailyMinutes,
      prep, studyTime, secondsPerCard: pace,
    });

    return {
      rows, tz, now, courseById, policies, componentsByCourse, assignmentsByCourse, topicsByCourse,
      examsByCourse, obligations, grades, crunch, samples, cards, examTargets, sessions,
      inboxCount: rows.notes.filter(needsConfirmation).length, courseName, notifications, prep, pace,
    };
    // `now` is intentionally minute-granular
  }, [rows, tz, dailyMinutes, studyTime, now]);
}
