import { describe, expect, it } from 'vitest';
import type { CardReview } from '@/types/db';
import type { CardWithReviews } from './scheduling';
import { isPrepDone, planTestPrep, prepHref, prepReminder, prepSentence, type PrepTarget } from './testPrep';
import { planNotifications } from './notifications';
import { mkCard, mkReview } from './testutil';

const tz = 'America/Chicago';
const now = new Date('2026-09-23T15:00:00Z'); // Wed 10am in Chicago

function set(n: number, testAt: string, reviews: (i: number, cardId: string) => CardReview[] = () => []): PrepTarget {
  const cards: CardWithReviews[] = Array.from({ length: n }, (_, i) => {
    const card = mkCard('c1', { source_note_id: 'n1' });
    return { card, reviews: reviews(i, card.id) };
  });
  return { key: 'note:n1', title: 'Bio Ch. 3', color: '#059669', testAt: new Date(testAt), scope: { noteId: 'n1' }, cards };
}

describe('planTestPrep', () => {
  it('spreads new cards over the days left and keeps the day before the test for a full review', () => {
    const tasks = planTestPrep({ targets: [set(12, '2026-10-01T04:59:00Z')], now, tz }); // Wed Sep 30, 11:59pm local
    expect(tasks.map((t) => [t.ymd, t.kind, t.newCards, t.reviewCards])).toEqual([
      ['2026-09-23', 'learn', 2, 0],
      ['2026-09-24', 'learn', 2, 2],
      ['2026-09-25', 'learn', 2, 2],
      ['2026-09-26', 'learn', 2, 2],
      ['2026-09-27', 'learn', 2, 2],
      ['2026-09-28', 'learn', 2, 2],
      ['2026-09-29', 'final_review', 0, 12],
    ]);
  });

  it("counts what's already done today instead of re-dividing, so today's plan can be finished", () => {
    const learnedThisMorning = (i: number, id: string) =>
      i < 2 ? [mkReview(id, { reviewed_at: '2026-09-23T14:00:00Z', due_at: '2026-09-24T14:00:00Z' })] : [];
    const [today, tomorrow] = planTestPrep({ targets: [set(12, '2026-10-01T04:59:00Z', learnedThisMorning)], now, tz });
    expect(today).toMatchObject({ newCards: 0, reviewCards: 0, doneNew: 2 });
    expect(isPrepDone(today)).toBe(true);
    expect(prepSentence(today)).toBe('Done for today — nice work.');
    expect(tomorrow).toMatchObject({ newCards: 2, reviewCards: 2 }); // the two from today come back
  });

  it('includes reviews that fall due today', () => {
    const seenLastWeek = (i: number, id: string) =>
      i < 5 ? [mkReview(id, { reviewed_at: '2026-09-16T15:00:00Z', due_at: i < 3 ? '2026-09-23T20:00:00Z' : '2026-09-26T20:00:00Z' })] : [];
    const [today] = planTestPrep({ targets: [set(10, '2026-10-01T04:59:00Z', seenLastWeek)], now, tz });
    expect(today).toMatchObject({ kind: 'learn', newCards: 1, reviewCards: 3 });
    expect(prepSentence(today)).toBe('Review 3 cards and learn 1 new one.');
  });

  it('with the test tomorrow, today is the final review — including any cards never seen', () => {
    const someSeen = (i: number, id: string) => (i < 4 ? [mkReview(id, { reviewed_at: '2026-09-20T15:00:00Z', due_at: '2026-09-28T15:00:00Z' })] : []);
    const tasks = planTestPrep({ targets: [set(6, '2026-09-24T19:00:00Z', someSeen)], now, tz });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ kind: 'final_review', newCards: 2, reviewCards: 4, daysToTest: 1 });
  });

  it('on test day: a run-through before the test, nothing once it has started', () => {
    expect(planTestPrep({ targets: [set(5, '2026-09-23T19:00:00Z')], now, tz })[0]).toMatchObject({ kind: 'test_day', daysToTest: 0 });
    expect(planTestPrep({ targets: [set(5, '2026-09-23T14:00:00Z')], now, tz })).toEqual([]);
  });

  it('links straight to studying that set', () => {
    const [today] = planTestPrep({ targets: [set(12, '2026-10-01T04:59:00Z')], now, tz });
    expect(prepHref(today, 'learn')).toBe('/cards/learn?noteId=n1');
    expect(prepHref(today, 'review')).toBe('/cards/review?noteId=n1&order=smart&limit=1');
  });
});

describe('daily study reminder', () => {
  const target = set(12, '2026-10-01T04:59:00Z');

  it('one reminder a day at the study time, saying what to do and when the test is', () => {
    const prep = planTestPrep({ targets: [target], now, tz });
    const out = planNotifications({
      obligations: [], policies: new Map(), sessions: [], crunch: [], samples: [], courseName: () => '', now, tz,
      prep, studyTime: '18:00', secondsPerCard: 20,
    });
    const study = out.filter((n) => n.kind === 'study_plan');
    expect(study.map((n) => n.id)).toEqual(
      ['2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29'].map((d) => `study:${d}`),
    );
    expect(study[0].fireAt.toISOString()).toBe('2026-09-23T23:00:00.000Z'); // 6pm Chicago
    expect(study[0].title).toBe('Study for Bio Ch. 3 · about 2 min');
    expect(study[0].body).toBe('Learn 2 new cards. Your test is in 7 days.');
    expect(study[6].title).toBe('Last review before Bio Ch. 3');
  });

  it("skips a day that's already done, and combines several tests into one", () => {
    const done = planTestPrep({
      targets: [set(2, '2026-10-01T04:59:00Z', (_, id) => [mkReview(id, { reviewed_at: '2026-09-23T14:00:00Z', due_at: '2026-09-26T14:00:00Z' })])],
      now, tz,
    });
    expect(prepReminder(done.filter((t) => t.dayOffset === 0), 20)).toBeNull();

    const other: PrepTarget = { ...set(4, '2026-09-26T15:00:00Z'), key: 'note:n2', title: 'Chem quiz', scope: { noteId: 'n2' } };
    const both = planTestPrep({ targets: [target, other], now, tz }).filter((t) => t.dayOffset === 0);
    expect(prepReminder(both, 20)).toEqual({
      title: "Today's study plan · about 4 min",
      body: 'Chem quiz: 2 new · Bio Ch. 3: 2 new', // soonest test first
    });
  });
});
