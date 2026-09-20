// Turns the raw LLM parse into reviewable drafts: real timestamps, resolved
// "Week 6" dates (flagged approximate), linked components, and exam → topic
// coverage. Never silently trusts the parse — it also emits `issues` so the
// confirmation screen can point at what looks off.
import type { AttendancePolicy, ClassMeeting, LatePolicy } from '@/types/db';
import type { ParsedSyllabus } from './types';
import { addDaysYmd, localDateString, weekStartYmd, zonedToUtc } from '../time';
import { stem, words, STOPWORDS } from '../flashcards/text';
import { topicMatchScore } from '../notes';

export interface TermRange {
  starts_on: string;
  ends_on: string;
}

export interface DraftComponent {
  key: string;
  name: string;
  weight: number;
  expected_count: number | null;
  drop_lowest: number;
}

export interface DraftAssignment {
  title: string;
  type: string;
  due_at: string | null;
  due_is_approximate: boolean;
  points_possible: number | null;
  component_key: string | null;
  estimated_minutes: number | null;
}

export interface DraftTopic {
  week_no: number | null;
  starts_on: string | null;
  ends_on: string | null;
  title: string;
  readings: string | null;
}

export interface DraftExam {
  title: string;
  happens_at: string;
  is_cumulative: boolean;
  location: string | null;
  /** Indexes into `topics`. */
  topic_indexes: number[];
  /** True when coverage was inferred ("everything since the last exam") rather than stated. */
  coverage_inferred: boolean;
  /** Index into `assignments` — the row that carries this exam's grade. */
  assignment_index: number;
}

export interface DraftQuiz {
  title: string;
  type: string | null;
  frequency: string | null;
  due_at: string | null;
  due_is_approximate: boolean;
  points_possible: number | null;
  component_key: string | null;
  topic_indexes: number[];
}

export interface ParseIssue {
  severity: 'warn' | 'info';
  field: 'weights' | 'dates' | 'exams' | 'quizzes' | 'topics' | 'policy' | 'general';
  message: string;
}

export interface NormalizedSyllabus {
  course: {
    name: string;
    code: string | null;
    section: string | null;
    instructor_name: string | null;
    instructor_email: string | null;
  };
  meetings: ClassMeeting[];
  components: DraftComponent[];
  assignments: DraftAssignment[];
  exams: DraftExam[];
  quizzes: DraftQuiz[];
  topics: DraftTopic[];
  late_policy: LatePolicy;
  attendance_policy: AttendancePolicy;
  policy_notes: string | null;
  issues: ParseIssue[];
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function validYmd(s: string | null | undefined): string | null {
  if (!s || !YMD.test(s)) return null;
  const t = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(t.getTime()) ? null : s;
}

function validTime(s: string | null | undefined, fallback: string): string {
  const m = s?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return fallback;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** Syllabi often omit the year; if a date lands outside the term, try neighbouring years. */
export function fixYear(ymd: string, term: TermRange): string {
  const lo = addDaysYmd(term.starts_on, -45);
  const hi = addDaysYmd(term.ends_on, 45);
  if (ymd >= lo && ymd <= hi) return ymd;
  // Re-anchor the month/day to the term's own year(s) — the model often guesses the wrong year.
  const [, m, d] = ymd.split('-');
  const t0 = Number(term.starts_on.slice(0, 4));
  const t1 = Number(term.ends_on.slice(0, 4));
  for (const year of [t0, t1, t0 - 1, t1 + 1]) {
    const cand = `${year}-${m}-${d}`;
    if (cand >= lo && cand <= hi) return cand;
  }
  return ymd;
}

/** A sensible default term for "today" — refined later from the syllabus dates. */
export function guessTerm(now: Date, tz: string): { name: string; starts_on: string; ends_on: string } {
  const ymd = localDateString(now, tz);
  let year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  if (month === 12 && day > 20) {
    year += 1;
    return { name: `Spring ${year}`, starts_on: `${year}-01-10`, ends_on: `${year}-05-15` };
  }
  if (month <= 5) return { name: `Spring ${year}`, starts_on: `${year}-01-10`, ends_on: `${year}-05-15` };
  if (month <= 7) return { name: `Summer ${year}`, starts_on: `${year}-06-01`, ends_on: `${year}-08-05` };
  return { name: `Fall ${year}`, starts_on: `${year}-08-20`, ends_on: `${year}-12-20` };
}

function tokens(s: string): Set<string> {
  return new Set(words(s).map((w) => w.toLowerCase()).filter((w) => !STOPWORDS.has(w)).map(stem));
}

function overlap(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.min(A.size, B.size);
}

export function normalizeParse(
  parsed: ParsedSyllabus,
  ctx: { term: TermRange; tz: string; now: Date },
): NormalizedSyllabus {
  const { term, tz } = ctx;
  const issues: ParseIssue[] = [];
  for (const w of parsed.warnings ?? []) issues.push({ severity: 'info', field: 'general', message: w });

  // ---- topics ---------------------------------------------------------------
  const termWeek1 = weekStartYmd(term.starts_on);
  const rawTopics = [...parsed.topics].sort((a, b) => (a.week_no ?? 999) - (b.week_no ?? 999));
  const topics: DraftTopic[] = rawTopics.map((t) => {
    const given = validYmd(t.starts_on);
    const starts_on = given
      ? fixYear(given, term)
      : t.week_no != null
        ? addDaysYmd(termWeek1, (t.week_no - 1) * 7)
        : null;
    return { week_no: t.week_no, starts_on, ends_on: null, title: t.title, readings: t.readings };
  });
  topics.forEach((t, i) => {
    if (!t.starts_on) return;
    const next = topics.slice(i + 1).find((n) => n.starts_on && n.starts_on > t.starts_on!);
    const weekEnd = addDaysYmd(t.starts_on, 6);
    t.ends_on = next && addDaysYmd(next.starts_on!, -1) < weekEnd ? addDaysYmd(next.starts_on!, -1) : weekEnd;
  });
  if (topics.length === 0) {
    issues.push({ severity: 'warn', field: 'topics', message: 'No weekly topic schedule found — notes will not auto-file by week.' });
  }

  const weekToDate = (week: number): string => {
    const t = topics.find((x) => x.week_no === week && x.starts_on);
    return t?.starts_on ?? addDaysYmd(termWeek1, (week - 1) * 7);
  };

  // ---- grade components ------------------------------------------------------
  const scale = parsed.grade_components.some((c) => c.weight > 1) ? 0.01 : 1;
  const components: DraftComponent[] = parsed.grade_components.map((c, i) => ({
    key: `c${i}`,
    name: c.name,
    weight: Math.max(0, Math.min(1, c.weight * scale)),
    expected_count: c.expected_count,
    drop_lowest: Math.max(0, c.drop_lowest ?? 0),
  }));
  if (components.length === 0) {
    issues.push({ severity: 'warn', field: 'weights', message: 'No grade breakdown found — grade math will be unavailable until you add one.' });
  } else {
    const sum = components.reduce((s, c) => s + c.weight, 0);
    if (Math.abs(sum - 1) > 0.02) {
      issues.push({
        severity: 'warn',
        field: 'weights',
        message: `Grade weights add up to ${Math.round(sum * 100)}%, not 100%. Check them below.`,
      });
    }
  }

  const findComponent = (name: string | null, type: string): string | null => {
    if (name) {
      const exact = components.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (exact) return exact.key;
      const fuzzy = components.map((c) => ({ c, s: overlap(c.name, name) })).sort((a, b) => b.s - a.s)[0];
      if (fuzzy && fuzzy.s >= 0.5) return fuzzy.c.key;
    }
    const byType = components.find((c) => tokens(c.name).has(stem(type)));
    return byType?.key ?? null;
  };

  // ---- assignments -----------------------------------------------------------
  const assignments: DraftAssignment[] = [];
  let approx = 0;
  for (const a of parsed.assignments) {
    let date = validYmd(a.due_date);
    let approximate = a.due_is_approximate;
    if (date) date = fixYear(date, term);
    else if (a.due_week != null) {
      date = addDaysYmd(weekToDate(a.due_week), 4); // end of that week
      approximate = true;
    } else approximate = true;
    if (approximate) approx++;
    assignments.push({
      title: a.title,
      type: a.type,
      due_at: date ? zonedToUtc(date, validTime(a.due_time, '23:59'), tz).toISOString() : null,
      due_is_approximate: approximate,
      points_possible: a.points_possible,
      component_key: findComponent(a.component_name, a.type),
      estimated_minutes: a.estimated_minutes,
    });
  }
  if (approx > 0) {
    issues.push({
      severity: 'info',
      field: 'dates',
      message: `${approx} due date${approx === 1 ? ' is' : 's are'} approximate (no exact date in the syllabus). They're marked "around" until you set them.`,
    });
  }

  // ---- exams (+ the assignment row that carries each exam's grade) -----------
  const exams: DraftExam[] = [];
  const sortedExamDates: string[] = [];
  const examsRaw = parsed.exams
    .map((e) => ({ e, date: validYmd(e.date) ? fixYear(validYmd(e.date)!, term) : null }))
    .filter((x) => {
      if (!x.date) issues.push({ severity: 'warn', field: 'exams', message: `"${x.e.title}" has no date in the syllabus — add it so review can be scheduled.` });
      return !!x.date;
    })
    .sort((a, b) => (a.date! < b.date! ? -1 : 1));

  examsRaw.forEach(({ e, date }) => {
    const time = validTime(e.time, '12:00');
    if (!e.time) issues.push({ severity: 'info', field: 'exams', message: `No start time found for "${e.title}"; assuming midday.` });
    const at = zonedToUtc(date!, time, tz);

    // Reuse an existing exam-typed assignment for the same event instead of duplicating it.
    let ai = assignments.findIndex(
      (a) => a.type === 'exam' && a.due_at && localDateString(new Date(a.due_at), tz) === date && overlap(a.title, e.title) >= 0.4,
    );
    if (ai === -1) {
      ai = assignments.findIndex((a) => a.type === 'exam' && a.due_at && localDateString(new Date(a.due_at), tz) === date);
    }
    if (ai === -1) {
      assignments.push({
        title: e.title,
        type: 'exam',
        due_at: at.toISOString(),
        due_is_approximate: false,
        points_possible: null,
        component_key: findComponent(e.title, 'exam'),
        estimated_minutes: null,
      });
      ai = assignments.length - 1;
    } else {
      assignments[ai].due_at = at.toISOString();
      assignments[ai].due_is_approximate = false;
    }

    // Coverage: stated weeks → stated topics → cumulative → "since the last exam".
    let idxs = new Set<number>();
    for (const w of e.covers_weeks) topics.forEach((t, i) => t.week_no === w && idxs.add(i));
    for (const name of e.covers_topics) {
      topics.forEach((t, i) => topicMatchScore(name, t.title) >= 0.6 || overlap(name, t.title) >= 0.6 ? idxs.add(i) : undefined);
    }
    let inferred = false;
    if (e.is_cumulative) {
      idxs = new Set(topics.map((t, i) => (t.starts_on && t.starts_on <= date! ? i : -1)).filter((i) => i >= 0));
    } else if (idxs.size === 0) {
      const prev = sortedExamDates[sortedExamDates.length - 1] ?? '0000-00-00';
      topics.forEach((t, i) => {
        if (t.starts_on && t.starts_on <= date! && t.starts_on > prev) idxs.add(i);
      });
      inferred = idxs.size > 0;
      if (inferred) {
        issues.push({ severity: 'info', field: 'exams', message: `"${e.title}" doesn't list what it covers; assuming everything since the previous exam.` });
      }
    }
    sortedExamDates.push(date!);

    exams.push({
      title: e.title,
      happens_at: at.toISOString(),
      is_cumulative: e.is_cumulative,
      location: e.location,
      topic_indexes: [...idxs].sort((a, b) => a - b),
      coverage_inferred: inferred,
      assignment_index: ai,
    });
  });

  // ---- policies -------------------------------------------------------------
  const late = parsed.policies.late;
  const late_policy: LatePolicy = {
    accepted: late.accepted ?? (late.window_hours != null || late.penalty_per_day != null ? true : undefined),
    window_hours: late.window_hours,
    penalty_per_day:
      late.penalty_per_day != null && late.penalty_per_day > 1 ? late.penalty_per_day / 100 : late.penalty_per_day,
    notes: late.notes,
  };
  if (late.accepted == null && late.window_hours == null && late.penalty_per_day == null) {
    issues.push({ severity: 'info', field: 'policy', message: 'No late policy found. Late-window tracking is off for this course.' });
  }

  const meetings: ClassMeeting[] = parsed.meetings
    .filter((m) => m.days.length > 0 && m.start && m.end)
    .map((m) => ({
      days: m.days,
      start: validTime(m.start, '09:00'),
      end: validTime(m.end, '10:00'),
      location: m.location,
    }));

  // ---- quizzes ---------------------------------------------------------------
  const quizzes: DraftQuiz[] = [];
  let quizApprox = 0;
  for (const q of parsed.quizzes) {
    let date = validYmd(q.due_date);
    let approximate = q.due_is_approximate;
    if (date) date = fixYear(date, term);
    else if (q.due_week != null) {
      date = addDaysYmd(weekToDate(q.due_week), 4);
      approximate = true;
    } else approximate = true;
    if (approximate) quizApprox++;

    // Coverage
    let idxs = new Set<number>();
    for (const w of q.covers_weeks) topics.forEach((t, i) => t.week_no === w && idxs.add(i));
    for (const name of q.covers_topics) {
      topics.forEach((t, i) => topicMatchScore(name, t.title) >= 0.6 || overlap(name, t.title) >= 0.6 ? idxs.add(i) : undefined);
    }

    quizzes.push({
      title: q.title,
      type: q.type,
      frequency: q.frequency,
      due_at: date ? zonedToUtc(date, validTime(q.due_time, '23:59'), tz).toISOString() : null,
      due_is_approximate: approximate,
      points_possible: q.points_possible,
      component_key: findComponent(q.component_name, 'quiz'),
      topic_indexes: [...idxs].sort((a, b) => a - b),
    });
  }
  if (quizApprox > 0) {
    issues.push({
      severity: 'info',
      field: 'dates',
      message: `${quizApprox} quiz due date${quizApprox === 1 ? ' is' : 's are'} approximate. They're marked "around" until you set them.`,
    });
  }

  return {
    course: {
      name: parsed.course.name,
      code: parsed.course.code,
      section: parsed.course.section,
      instructor_name: parsed.course.instructor_name,
      instructor_email: parsed.course.instructor_email,
    },
    meetings,
    components,
    assignments,
    exams,
    quizzes,
    topics,
    late_policy,
    attendance_policy: {
      allowed_absences: parsed.policies.attendance.allowed_absences,
      penalty: parsed.policies.attendance.penalty,
    },
    policy_notes: parsed.policies.notes,
    issues,
  };
}

/** "12 assignments, 3 exams, 15 weeks of topics — look right?" */
export function summarizeParse(n: NormalizedSyllabus): string {
  const assignments = n.assignments.filter((a) => a.type !== 'exam').length;
  const parts = [
    `${assignments} assignment${assignments === 1 ? '' : 's'}`,
    `${n.exams.length} exam${n.exams.length === 1 ? '' : 's'}`,
    `${n.topics.length} week${n.topics.length === 1 ? '' : 's'} of topics`,
  ];
  return parts.join(', ');
}
