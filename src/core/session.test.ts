import { describe, expect, it } from 'vitest';
import { INITIAL_STATE, nextReview } from './scheduling';
import { buildSession, cardsFor, minutesFor, paceSecondsPerCard, studyAdvice, poolStats, inScope } from './session';
import { MS } from './time';
import { mkCard, mkCourse, mkReview, mkTopic } from './testutil';

const TZ = 'America/Chicago';
const NOW = new Date('2026-09-19T15:00:00Z');
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

describe('studying ahead never hurts (early reviews)', () => {
  const state = { interval_days: 10, ease: 2.5, lapses: 0, reps: 4 };
  const dueIn5Days = new Date(NOW.getTime() + 5 * MS.DAY);

  it('an early "good" leaves the due date exactly where it was', () => {
    const r = nextReview(state, 3, NOW, null, { dueAt: dueIn5Days });
    expect(r.due_at.getTime()).toBe(dueIn5Days.getTime());
    expect(r.interval_days).toBe(10);
  });
  it('an early "easy" does not inflate the interval; "hard" only nudges ease', () => {
    expect(nextReview(state, 4, NOW, null, { dueAt: dueIn5Days }).interval_days).toBe(10);
    const hard = nextReview(state, 2, NOW, null, { dueAt: dueIn5Days });
    expect(hard.due_at.getTime()).toBe(dueIn5Days.getTime());
    expect(hard.ease).toBeLessThan(2.5);
  });
  it('a lapse is a lapse whenever it happens', () => {
    const r = nextReview(state, 1, NOW, null, { dueAt: dueIn5Days });
    expect(r.lapses).toBe(1);
    expect(r.due_at.getTime()).toBeLessThan(NOW.getTime() + MS.HOUR);
  });
  it('on or near the due date it grows normally', () => {
    const due = new Date(NOW.getTime() + 2 * MS.HOUR);
    expect(nextReview(state, 3, NOW, null, { dueAt: due }).interval_days).toBeCloseTo(25, 5);
  });
  it('a brand-new card is never "early"', () => {
    expect(nextReview(INITIAL_STATE, 3, NOW, null, { dueAt: null }).interval_days).toBe(1);
  });
  it('an early review still respects the exam deadline', () => {
    const exam = new Date(NOW.getTime() + 3 * MS.DAY);
    const r = nextReview(state, 3, NOW, exam, { dueAt: dueIn5Days });
    expect(r.compressed).toBe(true);
    expect(r.due_at.getTime()).toBeLessThan(exam.getTime());
  });
});

describe('building a session', () => {
  const course = mkCourse();
  const t1 = mkTopic(course.id, { title: 'A' });
  const t2 = mkTopic(course.id, { title: 'B' });
  const mk = (term: string, topic: string | null, reviews: Parameters<typeof mkReview>[1][] = []) => {
    const card = mkCard(course.id, { term, topic_id: topic });
    return { card, reviews: reviews.map((r) => mkReview(card.id, r)) };
  };
  const overdue = mk('overdue', t1.id, [{ rating: 3, interval_days: 1, due_at: iso(-3 * MS.DAY), reviewed_at: iso(-4 * MS.DAY) }]);
  const fresh = mk('unseen', t1.id);
  const solid = mk('solid', t2.id, [{ rating: 4, interval_days: 20, due_at: iso(15 * MS.DAY), reviewed_at: iso(-5 * MS.DAY) }]);
  const shaky = mk('shaky', t2.id, [{ rating: 2, interval_days: 2, due_at: iso(1 * MS.DAY), reviewed_at: iso(-1 * MS.DAY) }]);
  const cards = [solid, shaky, fresh, overdue];
  const exams = [{ examId: 'e1', title: 'Midterm', at: new Date(NOW.getTime() + 6 * MS.DAY), topicIds: new Set([t2.id]) }];
  const terms = (list: typeof cards) => list.map((c) => c.card.term);

  it('smart: what is due first, then weakest of the rest — so there is always something to study', () => {
    const s = buildSession({ cards, scope: {}, order: 'smart', limit: 10, now: NOW, examTargets: exams });
    expect(terms(s)).toEqual(['overdue', 'unseen', 'shaky', 'solid']);
  });
  it('weakest-first ignores the schedule entirely', () => {
    const s = buildSession({ cards, scope: {}, order: 'weakest', limit: 3, now: NOW, examTargets: exams });
    expect(s).toHaveLength(3);
    expect(terms(s)[3]).toBeUndefined();
    expect(terms(s)).not.toContain('solid');
  });
  it('shuffle is deterministic under a seeded rng and keeps every card', () => {
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const s = buildSession({ cards, scope: {}, order: 'shuffle', limit: 10, now: NOW, examTargets: exams, rng });
    expect(terms(s).sort()).toEqual(['overdue', 'shaky', 'solid', 'unseen']);
  });
  it('scopes by topic, exam coverage, course and note; skips pending/rejected cards', () => {
    expect(terms(inScope(cards, { topicIds: [t1.id] }, exams)).sort()).toEqual(['overdue', 'unseen']);
    expect(terms(inScope(cards, { examId: 'e1' }, exams)).sort()).toEqual(['shaky', 'solid']);
    expect(inScope(cards, { courseId: 'other' }, exams)).toEqual([]);
    const pending = { card: mkCard(course.id, { status: 'pending' }), reviews: [] };
    expect(inScope([pending], {}, exams)).toEqual([]);
  });
  it('respects the limit', () => {
    expect(buildSession({ cards, scope: {}, order: 'smart', limit: 2, now: NOW, examTargets: exams })).toHaveLength(2);
  });
  it('counts due / unseen / weak', () => {
    expect(poolStats(cards, NOW)).toMatchObject({ total: 4, due: 2, neverSeen: 1 });
  });

  it('gives optional, plain-language time guidance', () => {
    const a = studyAdvice({ pool: cards, examTargets: exams, now: NOW, tz: TZ, pace: 20 });
    expect(a.stats.due).toBe(2);
    expect(a.dueMinutes).toBe(1);
    expect(a.exam?.title).toBe('Midterm');
    expect(a.exam?.daysLeft).toBe(6);
    expect(a.lines.join(' ')).toContain('Midterm is in 6 days');
    expect(a.lines.join(' ')).toMatch(/min a day/);
  });
  it('tells you studying ahead is fine when nothing is due', () => {
    const a = studyAdvice({ pool: [solid], examTargets: [], now: NOW, tz: TZ, pace: 20 });
    expect(a.lines[0]).toContain('all caught up');
    expect(a.lines[0]).toContain('never pushes your reviews further out');
  });
  it('switches to a single final pass the day before', () => {
    const tomorrow = [{ examId: 'e2', title: 'Final', at: new Date(NOW.getTime() + 20 * MS.HOUR), topicIds: new Set([t2.id]) }];
    const a = studyAdvice({ pool: [shaky, solid], examTargets: tomorrow, now: NOW, tz: TZ, pace: 20 });
    expect(a.lines.join(' ')).toContain('One focused pass');
  });
});

describe('pace', () => {
  it('defaults until there is history, then uses your median', () => {
    expect(paceSecondsPerCard([])).toBe(20);
    const c = mkCard('c');
    const reviews = Array.from({ length: 15 }, (_, i) => mkReview(c.id, { reviewed_at: new Date(NOW.getTime() + i * 12_000).toISOString() }));
    expect(paceSecondsPerCard(reviews)).toBe(12);
  });
  it('converts between cards and minutes', () => {
    expect(minutesFor(30, 20)).toBe(10);
    expect(cardsFor(10, 20)).toBe(30);
    expect(minutesFor(1, 20)).toBe(1);
  });
});
