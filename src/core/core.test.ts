import { describe, expect, it } from 'vitest';
import {
  addDaysYmd, bucketFor, dayDiff, formatMinutes, localDateString, relativeTime, weekStartYmd, zonedToUtc,
} from './time';
import { componentResult, courseGrade, gradeBand, gradeImpact, neededOnComponent } from './grades';
import { attendanceBuffer, courseBuffers, describeLate, lateStatus } from './policies';
import { forecastCrunch, crunchHeadline } from './collisions';
import { toObligations, type Obligation } from './obligations';
import { buildComeback, shouldShowComeback } from './triage';
import { INITIAL_STATE, examReviewQueue, nextReview, standardStep, cardStrength, intervalLabel } from './scheduling';
import { budgetNotifications, planNotifications, type PlannedNotification } from './notifications';
import { correctionFactor, startBy, capacityBefore } from './estimation';
import { routeNote, coverageGaps, mentionsInstructor } from './notes';
import { buildStudyPlan } from './studyPlan';
import { normalizeParse, summarizeParse, guessTerm } from './syllabus/normalize';
import { buildSampleSemester } from './syllabus/sample';
import { describeLatePolicy, draftEmail } from './email';
import { mkAssignment, mkCard, mkComponent, mkCourse, mkExam, mkReview, mkTopic } from './testutil';

const TZ = 'America/Chicago';
const NOW = new Date('2026-09-19T15:00:00Z'); // Saturday 10:00am in Chicago

describe('time', () => {
  it('speaks in relative terms', () => {
    expect(relativeTime('2026-09-22T15:00:00Z', NOW, TZ)).toBe('in 3 days');
    expect(relativeTime('2026-09-20T20:00:00Z', NOW, TZ)).toBe('tomorrow');
    expect(relativeTime('2026-09-19T15:40:00Z', NOW, TZ)).toBe('in 40 mins');
    expect(relativeTime('2026-09-19T20:00:00Z', NOW, TZ)).toBe('in 5 hours');
    expect(relativeTime('2026-10-10T15:00:00Z', NOW, TZ)).toBe('in 3 weeks');
    expect(relativeTime('2026-09-18T15:00:00Z', NOW, TZ)).toBe('yesterday');
    expect(relativeTime('2026-09-15T15:00:00Z', NOW, TZ)).toBe('4 days ago');
  });

  it('does calendar math in the user timezone, not UTC', () => {
    // 11:30pm Saturday in Chicago is already Sunday in UTC.
    const lateSat = new Date('2026-09-20T04:30:00Z');
    expect(localDateString(lateSat, TZ)).toBe('2026-09-19');
    expect(dayDiff(lateSat, NOW, TZ)).toBe(0);
    expect(zonedToUtc('2026-09-19', '23:59', TZ).toISOString()).toBe('2026-09-20T04:59:00.000Z');
  });

  it('handles DST offsets', () => {
    // 2026-11-01 is the end of DST in the US; 09:00 that day is CST (UTC-6).
    expect(zonedToUtc('2026-11-02', '09:00', TZ).toISOString()).toBe('2026-11-02T15:00:00.000Z');
    expect(zonedToUtc('2026-10-30', '09:00', TZ).toISOString()).toBe('2026-10-30T14:00:00.000Z');
  });

  it('computes Monday-based weeks and buckets', () => {
    expect(weekStartYmd('2026-09-19')).toBe('2026-09-14');
    expect(weekStartYmd('2026-09-14')).toBe('2026-09-14');
    expect(addDaysYmd('2026-12-30', 3)).toBe('2027-01-02');
    expect(bucketFor('2026-09-19T20:00:00Z', NOW, TZ)).toBe('today');
    expect(bucketFor('2026-09-19T14:00:00Z', NOW, TZ)).toBe('overdue');
    expect(bucketFor('2026-09-21T20:00:00Z', NOW, TZ)).toBe('this_week');
    expect(bucketFor('2026-10-20T20:00:00Z', NOW, TZ)).toBe('later');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(360)).toBe('6h');
  });
});

describe('grades', () => {
  const course = mkCourse();
  it('drops the lowest scores but never all of them', () => {
    const quizzes = mkComponent(course.id, { name: 'Quizzes', weight: 0.2, drop_lowest: 1 });
    const a = [
      mkAssignment(course.id, { component_id: quizzes.id, status: 'graded', points_earned: 5, points_possible: 10 }),
      mkAssignment(course.id, { component_id: quizzes.id, status: 'graded', points_earned: 9, points_possible: 10 }),
    ];
    const r = componentResult(quizzes, a);
    expect(r.percent).toBe(90);
    expect(r.droppedIds).toEqual([a[0].id]);
    const one = componentResult(quizzes, [a[0]]);
    expect(one.percent).toBe(50); // never drops the only score
  });

  it('weights only the components that have grades', () => {
    const exams = mkComponent(course.id, { weight: 0.5 });
    const quiz = mkComponent(course.id, { name: 'Quizzes', weight: 0.5 });
    const ungraded = mkComponent(course.id, { name: 'Final', weight: 0.4 });
    const asg = [
      mkAssignment(course.id, { component_id: exams.id, status: 'graded', points_earned: 80, points_possible: 100 }),
      mkAssignment(course.id, { component_id: quiz.id, status: 'graded', points_earned: 10, points_possible: 10 }),
    ];
    expect(courseGrade([exams, quiz, ungraded], asg).percent).toBe(90);
  });

  it('answers "what do I need on the final"', () => {
    const body = mkComponent(course.id, { name: 'Coursework', weight: 0.7 });
    const final = mkComponent(course.id, { name: 'Final', weight: 0.3 });
    const asg = [
      mkAssignment(course.id, { component_id: body.id, status: 'graded', points_earned: 80, points_possible: 100 }),
      mkAssignment(course.id, { component_id: final.id, points_possible: 100 }),
    ];
    const hold80 = neededOnComponent([body, final], asg, final.id, 80)!;
    expect(hold80.needed).toBeCloseTo(80, 5);
    expect(hold80.status).toBe('possible');
    expect(neededOnComponent([body, final], asg, final.id, 90)!.status).toBe('out_of_reach');
    expect(neededOnComponent([body, final], asg, final.id, 50)!.status).toBe('secured');
    expect(gradeBand(87.2).letter).toBe('B');
  });

  it('ranks impact by weight ÷ count, with type fallbacks', () => {
    const quizzes = mkComponent(course.id, { weight: 0.2, expected_count: 10 });
    const q = mkAssignment(course.id, { component_id: quizzes.id });
    expect(gradeImpact(q, [quizzes], [q])).toBeCloseTo(2, 5);
    expect(gradeImpact(mkAssignment(course.id, { type: 'exam' }), [], [])).toBe(10);
  });
});

describe('policies', () => {
  const due = new Date('2026-09-17T15:00:00Z');
  it('computes salvageable late credit and time left', () => {
    const s = lateStatus(due, { accepted: true, window_hours: 72, penalty_per_day: 0.1 }, NOW);
    expect(s.state).toBe('late_open');
    expect(s.creditRemaining).toBeCloseTo(0.8, 5);
    expect(describeLate(s)).toBe('Still counts for 80% — 1 more day');
  });
  it('closes the window and handles no policy', () => {
    expect(lateStatus(due, { accepted: true, window_hours: 24, penalty_per_day: 0.1 }, NOW).state).toBe('late_closed');
    expect(lateStatus(due, undefined, NOW).state).toBe('no_late_policy');
    expect(lateStatus(new Date('2026-09-25T00:00:00Z'), undefined, NOW).state).toBe('on_time');
  });
  it('tracks the buffers students forget', () => {
    const course = mkCourse();
    const quizzes = mkComponent(course.id, { name: 'Quizzes', drop_lowest: 2 });
    const buffers = courseBuffers({
      components: [quizzes],
      assignments: [],
      policy: { course_id: course.id, late_policy: {}, attendance_policy: { allowed_absences: 3, penalty: 'a letter grade each' }, notes: 'Ask about extensions in week one.' },
      absences: [{ id: 'a', course_id: course.id, happened_on: '2026-09-01', excused: false }, { id: 'b', course_id: course.id, happened_on: '2026-09-08', excused: true }],
      now: NOW,
    });
    expect(buffers.map((b) => b.kind)).toEqual(['drop', 'absence', 'note']);
    expect(buffers[1].label).toBe('2 absences left');
    expect(attendanceBuffer({ allowed_absences: 3 }, []).remaining).toBe(3);
  });
});

function obl(over: Partial<Obligation>): Obligation {
  return {
    id: `o-${Math.random()}`, kind: 'assignment', refId: 'x', title: 'Thing', courseId: 'c1',
    dueAt: new Date('2026-10-07T20:00:00Z'), approximate: false, type: 'other', impact: 2,
    estimatedMinutes: 60, done: false, source: 'syllabus', ...over,
  };
}

describe('collision forecast', () => {
  it('finds the week where two exams, a paper and a project collide', () => {
    const items = [
      obl({ type: 'exam', title: 'Exam 1', dueAt: new Date('2026-10-07T16:00:00Z'), estimatedMinutes: 240 }),
      obl({ type: 'exam', title: 'Midterm', dueAt: new Date('2026-10-08T15:00:00Z'), estimatedMinutes: 240 }),
      obl({ type: 'paper', title: 'Paper', dueAt: new Date('2026-10-09T04:00:00Z'), estimatedMinutes: 300 }),
      obl({ type: 'project', title: 'Project', dueAt: new Date('2026-10-06T22:00:00Z'), estimatedMinutes: 480 }),
      obl({ type: 'quiz', title: 'Quiz', dueAt: new Date('2026-09-25T22:00:00Z') }),
    ];
    const weeks = forecastCrunch(items, NOW, TZ);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].weekStart).toBe('2026-10-05');
    expect(weeks[0].severity).toBe('crunch');
    expect(weeks[0].weeksAway).toBe(3);
    expect(crunchHeadline(weeks[0])).toBe('2 exams, 1 paper and 1 project all land in the same week');
  });
  it('ignores light weeks and finished work', () => {
    const items = [obl({ type: 'exam' }), obl({ type: 'exam', done: true }), obl({ type: 'exam', done: true })];
    expect(forecastCrunch(items, NOW, TZ)).toEqual([]);
  });
});

describe('comeback triage', () => {
  const course = mkCourse();
  const policies = new Map([[course.id, { course_id: course.id, late_policy: { accepted: true, window_hours: 72, penalty_per_day: 0.1 }, attendance_policy: {}, notes: null }]]);
  it('splits salvageable from dead and picks one thing', () => {
    const salvage = obl({ courseId: course.id, title: 'Recent paper', impact: 6, dueAt: new Date('2026-09-18T15:00:00Z'), type: 'paper' });
    const dead = obl({ courseId: course.id, title: 'Old quiz', impact: 1, dueAt: new Date('2026-09-01T15:00:00Z'), type: 'quiz' });
    const missedExam = obl({ courseId: course.id, title: 'Missed exam', impact: 10, dueAt: new Date('2026-09-02T15:00:00Z'), type: 'exam' });
    const upcoming = obl({ courseId: course.id, title: 'Quiz Friday', impact: 2, dueAt: new Date('2026-09-22T15:00:00Z'), type: 'quiz' });
    const plan = buildComeback({ obligations: [dead, salvage, missedExam, upcoming], policies, now: NOW });
    expect(plan.salvageable.map((s) => s.obligation.title)).toEqual(['Recent paper']);
    expect(plan.dead.map((d) => d.title)).toEqual(['Old quiz']);
    expect(plan.oneThing?.title).toBe('Recent paper');
  });
  it('triggers after 4 days away', () => {
    expect(shouldShowComeback(new Date('2026-09-14T00:00:00Z'), NOW)).toBe(true);
    expect(shouldShowComeback(new Date('2026-09-17T00:00:00Z'), NOW)).toBe(false);
    expect(shouldShowComeback(null, NOW)).toBe(false);
  });
});

describe('scheduling', () => {
  it('follows SM-2 spacing', () => {
    let s = standardStep(INITIAL_STATE, 3);
    expect(s.interval_days).toBe(1);
    s = standardStep({ ...INITIAL_STATE, ...s }, 3);
    expect(s.interval_days).toBe(3);
    s = standardStep({ ...INITIAL_STATE, ...s }, 3);
    expect(s.interval_days).toBeCloseTo(7.5, 5);
    expect(standardStep({ ...INITIAL_STATE, ...s }, 1).lapses).toBe(1);
  });
  it('compresses a review that would land after the exam', () => {
    const exam = new Date(NOW.getTime() + 5 * 86_400_000);
    const state = { interval_days: 10, ease: 2.5, lapses: 0, reps: 3 };
    const plain = nextReview(state, 3, NOW, null);
    const squeezed = nextReview(state, 3, NOW, exam);
    expect(plain.due_at.getTime()).toBeGreaterThan(exam.getTime());
    expect(squeezed.compressed).toBe(true);
    expect(squeezed.due_at.getTime()).toBeLessThan(exam.getTime() - 12 * 3_600_000);
    expect(squeezed.due_at.getTime()).toBeGreaterThan(NOW.getTime());
    // "Again" is never compressed — it's already soon.
    expect(nextReview(state, 1, NOW, exam).compressed).toBe(false);
  });
  it('surfaces the weakest cards for an exam first', () => {
    const course = mkCourse();
    const topic = mkTopic(course.id);
    const strong = mkCard(course.id, { topic_id: topic.id, term: 'strong' });
    const weak = mkCard(course.id, { topic_id: topic.id, term: 'weak' });
    const unseen = mkCard(course.id, { topic_id: topic.id, term: 'unseen' });
    const offTopic = mkCard(course.id, { topic_id: 'other', term: 'off' });
    const cards = [
      { card: strong, reviews: [mkReview(strong.id, { rating: 4, interval_days: 20, due_at: '2026-10-01T00:00:00Z' })] },
      { card: weak, reviews: [mkReview(weak.id, { rating: 1, interval_days: 0.01, due_at: '2026-09-10T00:00:00Z' })] },
      { card: unseen, reviews: [] },
      { card: offTopic, reviews: [] },
    ];
    const queue = examReviewQueue({ cards, exam: { examId: 'e', title: 'Midterm', at: new Date('2026-10-08T00:00:00Z'), topicIds: new Set([topic.id]) }, now: NOW });
    expect(queue.map((c) => c.card.term)).toEqual(['unseen', 'weak', 'strong']);
    expect(cardStrength([], NOW)).toBe(0);
    expect(intervalLabel(3)).toBe('3d');
  });
});

describe('estimation', () => {
  it('learns a personal correction factor, shrunk when history is thin', () => {
    const papers = [1, 2, 3].map(() => ({ type: 'paper', estimated: 100, actual: 240 }));
    const c = correctionFactor(papers, 'paper');
    expect(c.confident).toBe(true);
    expect(c.factor).toBeGreaterThan(1.7); // raw 2.4x, shrunk toward 1 with only 3 samples
    expect(c.factor).toBeLessThan(2.4);
    expect(correctionFactor([{ type: 'paper', estimated: 100, actual: 300 }], 'paper').factor).toBeLessThan(c.factor + 0.5);
    expect(correctionFactor([], 'paper').factor).toBe(1);
  });
  it('works backward from the deadline', () => {
    const due = new Date('2026-09-30T04:59:00Z');
    const plan = startBy(due, 360, NOW, 90);
    expect(plan.daysNeeded).toBe(4);
    expect(plan.startNow).toBe(false);
    expect(startBy(new Date('2026-09-20T04:59:00Z'), 360, NOW, 90).startNow).toBe(true);
  });
  it('reports unclaimed hours before a deadline', () => {
    const due = new Date('2026-09-22T15:00:00Z'); // 3 days → 270 min budget
    const cap = capacityBefore(
      { dueAt: due, effort: 360, id: 'a' },
      [{ dueAt: new Date('2026-09-21T15:00:00Z'), effort: 60, id: 'b' }],
      NOW, TZ, 90,
    );
    expect(cap.availableMinutes).toBe(210);
    expect(cap.deficitMinutes).toBe(150);
  });
});

describe('notifications', () => {
  const mk = (id: string, impact: number, day = '2026-09-21'): PlannedNotification => ({
    id, kind: 'start_date', fireAt: zonedToUtc(day, '09:00', TZ), title: id, body: '', impact,
  });
  it('hard-caps at 3 per day, keeping the highest grade impact', () => {
    const kept = budgetNotifications([mk('a', 1), mk('b', 9), mk('c', 5), mk('d', 7), mk('e', 3), mk('other-day', 0, '2026-09-22')], TZ);
    expect(kept.filter((n) => n.fireAt.getTime() === zonedToUtc('2026-09-21', '09:00', TZ).getTime()).map((n) => n.id)).toEqual(['b', 'd', 'c']);
    expect(kept.map((n) => n.id)).toContain('other-day');
  });
  it('emits only permitted types, one start nudge per assignment', () => {
    const course = mkCourse();
    const paper = mkAssignment(course.id, { title: 'Big paper', type: 'paper', due_at: '2026-09-30T04:59:00Z' });
    const comps = [mkComponent(course.id, { weight: 0.3 })];
    paper.component_id = comps[0].id;
    const obligations = toObligations({ assignments: [paper], exams: [], components: comps });
    const out = planNotifications({
      obligations, policies: new Map(), sessions: [], crunch: [], samples: [],
      courseName: () => course.name, now: NOW, tz: TZ,
    });
    const allowed = new Set(['start_date', 'exam_review', 'late_window_closing', 'collision_week', 'waiting_on', 'escalation']);
    expect(out.every((n) => allowed.has(n.kind))).toBe(true);
    expect(out.filter((n) => n.kind === 'start_date')).toHaveLength(1);
    expect(out.some((n) => n.kind === 'escalation')).toBe(true); // 30% weight → high-weight escalation
  });
});

describe('notes routing', () => {
  const course = mkCourse({ meetings: [{ days: ['Tue', 'Thu'], start: '09:30', end: '10:45' }] });
  const other = mkCourse({ name: 'General Biology', code: 'BIO 1408', meetings: [] });
  const topics = [
    mkTopic(course.id, { title: 'Learning: operant conditioning', starts_on: '2026-09-21', ends_on: '2026-09-27' }),
    mkTopic(other.id, { title: 'Cellular respiration', starts_on: '2026-09-21', ends_on: '2026-09-27' }),
  ];
  it('files by explicit course, then class schedule, then keywords, else inbox', () => {
    const inClass = new Date('2026-09-22T15:00:00Z'); // Tue 10:00 Chicago
    const bySchedule = routeNote({ text: 'random words', now: inClass, tz: TZ, courses: [course, other], topics });
    expect(bySchedule).toMatchObject({ course_id: course.id, topic_id: topics[0].id, course_inferred: false, method: 'schedule' });

    const explicit = routeNote({ text: 'x', now: NOW, tz: TZ, courses: [course, other], topics, explicitCourseId: other.id });
    expect(explicit.method).toBe('explicit');

    const byKeywords = routeNote({ text: 'mitochondria run cellular respiration in the cell', now: NOW, tz: TZ, courses: [course, other], topics });
    expect(byKeywords).toMatchObject({ course_id: other.id, course_inferred: true, method: 'keywords' });

    const none = routeNote({ text: 'buy milk', now: NOW, tz: TZ, courses: [course, other], topics });
    expect(none.method).toBe('none');
  });
  it('files a note that names the instructor', () => {
    expect(mentionsInstructor('Dr. Reyes said the reading moved', 'Dr. Reyes')).toBe(true);
    expect(mentionsInstructor('reyes is out on Tuesday', 'Prof. Ana Reyes')).toBe(true);
    expect(mentionsInstructor('Dr. is a title', 'Dr. Reyes')).toBe(false);
    const withInstructor = mkCourse({ instructor_name: 'Dr. Reyes' });
    const r = routeNote({ text: 'Dr. Reyes said the reading moved to Thursday', now: NOW, tz: TZ, courses: [withInstructor, other], topics: [] });
    expect(r).toMatchObject({ course_id: withInstructor.id, course_inferred: true, method: 'keywords' });
  });

  it('detects coverage gaps', () => {
    const gaps = coverageGaps({
      topicIds: topics.map((t) => t.id),
      topics,
      notes: [{ id: 'n', user_id: 'u', course_id: course.id, topic_id: topics[0].id, title: null, body: 'x'.repeat(80), captured_via: 'in_app', course_inferred: false, created_at: '', updated_at: '' }],
    });
    expect(gaps.map((g) => g.title)).toEqual(['Cellular respiration']);
  });
});

describe('study plan', () => {
  it('builds sessions backward from the exam, ending with a final pass the day before', () => {
    const course = mkCourse();
    const topics = [1, 2, 3, 4].map((n) => mkTopic(course.id, { title: `Topic ${n}`, week_no: n }));
    const exam = { id: 'e1', title: 'Midterm', courseId: course.id, at: new Date(NOW.getTime() + 6 * 86_400_000), topicIds: topics.map((t) => t.id) };
    const plan = buildStudyPlan({ exams: [exam], topics, notes: [], cards: [], now: NOW, tz: TZ });
    expect(plan.length).toBeGreaterThanOrEqual(2);
    const last = plan[plan.length - 1];
    expect(last.kind).toBe('final_pass');
    expect(last.dayOffset).toBe(5);
    expect(plan.every((s) => s.dayOffset >= 0)).toBe(true);
    expect(plan.filter((s) => s.kind === 'add_notes').length).toBeGreaterThan(0); // no notes, no cards yet
  });
  it('skips exams that are too far away or already here', () => {
    const exam = { id: 'e', title: 'Far', courseId: 'c', at: new Date(NOW.getTime() + 60 * 86_400_000), topicIds: [] };
    expect(buildStudyPlan({ exams: [exam], topics: [], notes: [], cards: [], now: NOW, tz: TZ })).toEqual([]);
  });
});

describe('syllabus normalization (sample semester)', () => {
  const sample = buildSampleSemester(NOW, TZ);
  const ctx = { term: sample.term, tz: TZ, now: NOW };

  it('places us in week 4 of the term', () => {
    expect(weekStartYmd(sample.term.starts_on)).toBe(sample.term.starts_on);
    expect(dayDiff(NOW, zonedToUtc(sample.term.starts_on, '12:00', TZ), TZ)).toBeGreaterThanOrEqual(21);
  });

  it('resolves week-only dates as approximate and links coverage', () => {
    const psych = normalizeParse(sample.syllabi[0], ctx);
    expect(psych.exams).toHaveLength(3);
    expect(psych.assignments.filter((a) => a.type === 'exam')).toHaveLength(3);
    expect(psych.exams[0].topic_indexes).toEqual([0, 1, 2, 3, 4, 5]);
    expect(psych.exams[2].topic_indexes).toHaveLength(16); // cumulative final
    const reading = psych.assignments.find((a) => a.title.startsWith('Reading'))!;
    expect(reading.due_is_approximate).toBe(true);
    expect(reading.due_at).not.toBeNull();
    expect(psych.issues.some((i) => i.field === 'weights')).toBe(false);
    expect(psych.assignments.every((a) => a.type === 'exam' ? a.component_key : true)).toBe(true);
    expect(summarizeParse(psych)).toBe('13 assignments, 3 exams, 16 weeks of topics');
  });

  it('infers coverage when the syllabus does not state it', () => {
    const bio = normalizeParse(sample.syllabi[1], ctx);
    expect(bio.exams[1].coverage_inferred).toBe(true);
    expect(bio.exams[1].topic_indexes.length).toBeGreaterThan(0);
  });

  it('fixes missing years and percent-style weights', () => {
    const p = structuredClone(sample.syllabi[0]);
    p.grade_components.forEach((c) => (c.weight *= 100));
    p.assignments[0].due_date = p.assignments[0].due_date!.replace(/^\d{4}/, '1999');
    const n = normalizeParse(p, ctx);
    expect(n.components.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 5);
    expect(n.assignments[0].due_at!.startsWith(String(sample.term.starts_on.slice(0, 4)))).toBe(true);
  });

  it('flags weights that do not add up', () => {
    const p = structuredClone(sample.syllabi[0]);
    p.grade_components[0].weight = 0.05;
    expect(normalizeParse(p, ctx).issues.some((i) => i.field === 'weights')).toBe(true);
  });

  it('guesses a term from today', () => {
    expect(guessTerm(NOW, TZ).name).toBe('Fall 2026');
  });

  it('builds an obligation list where exams are not double-counted', () => {
    const course = mkCourse();
    const a = mkAssignment(course.id, { type: 'exam', title: 'Midterm', due_at: '2026-10-08T15:00:00Z' });
    const e = mkExam(course.id, { assignment_id: a.id, happens_at: '2026-10-08T15:00:00Z' });
    expect(toObligations({ assignments: [a], exams: [e], components: [] })).toHaveLength(1);
  });
});

describe('email drafter', () => {
  it('quotes the real late policy', () => {
    const course = mkCourse();
    const policy = { course_id: course.id, late_policy: { accepted: true, window_hours: 72, penalty_per_day: 0.1 }, attendance_policy: {}, notes: null };
    expect(describeLatePolicy(policy.late_policy)).toBe('The syllabus allows late work for up to 3 days after the deadline with a 10% penalty per day.');
    const asg = mkAssignment(course.id, { title: 'Research paper', due_at: '2026-09-22T05:00:00Z' });
    const d = draftEmail({ kind: 'extension', course, policy, assignment: asg, now: NOW, tz: TZ });
    expect(d.to).toBe('reyes@uni.edu');
    expect(d.subject).toContain('Research paper');
    expect(d.body).toContain('10% penalty per day');
    expect(d.body).toContain('in 3 days');
  });
});
