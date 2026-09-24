import { describe, expect, it } from 'vitest';
import type { Card, CardReview, LearnMark, LearnProgress } from '@/types/db';
import {
  dueForReview, finishedInPocket, gradeToRating, learnOrder, learnScopeKey, nextReviewAt, pocketStats, resumePoint, studiedToday,
} from './learning';
import { nextReview, stateFromReviews, type CardWithReviews } from './scheduling';
import { mkCard, mkReview } from './testutil';

const T0 = '2026-09-23T12:00:00.000Z';
const mark = (over: Partial<LearnMark> = {}): LearnMark => ({ grade: 'good', accuracy: 1, at: T0, ...over });
const done = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, mark()]));
const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'];
type P = Pick<LearnProgress, 'done' | 'pocket' | 'pocket_size' | 'pocket_started_at'>;
const progress = (over: Partial<P> = {}): P => ({ done: {}, pocket: [], pocket_size: 3, pocket_started_at: null, ...over });

describe('learnScopeKey', () => {
  it('names the same cards the same way, however the scope is written', () => {
    expect(learnScopeKey({ noteId: 'n1' })).toBe('note:n1');
    expect(learnScopeKey({})).toBe('all');
    expect(learnScopeKey({ courseId: 'c', topicIds: ['b', 'a'] })).toBe(learnScopeKey({ topicIds: ['a', 'b'], courseId: 'c' }));
  });
});

describe('learnOrder', () => {
  it('follows the order cards were made in, then their place in the note', () => {
    const card = (id: string, created_at: string, span: number | null) => ({ id, created_at, source_span_start: span }) as Card;
    const ordered = learnOrder([
      card('late', '2026-09-22T10:00:00.000Z', 0),
      card('second', '2026-09-21T10:00:00+00:00', 50),
      card('first', '2026-09-21T10:00:00.000Z', 10),
    ]);
    expect(ordered.map((c) => c.id)).toEqual(['first', 'second', 'late']);
  });
});

describe('shuffled order', () => {
  const deck = Array.from({ length: 30 }, (_, i) => ({ id: `card-${i}`, created_at: '2026-09-21T10:00:00.000Z', source_span_start: i }) as Card);
  const order = (seed?: string | null) => learnOrder(deck, seed).map((c) => c.id);

  it('is the same on every device for the same seed, and a new seed gives a new order', () => {
    expect(order('abc123')).toEqual(order('abc123'));
    expect(order('abc123')).not.toEqual(order('xyz789'));
    expect(order('abc123')).not.toEqual(order(null));
    expect([...order('abc123')].sort()).toEqual([...order(null)].sort()); // same cards, just reordered
  });

  it('without a seed keeps the set order', () => {
    expect(order(null)).toEqual(deck.map((c) => c.id));
  });
});

describe('gradeToRating', () => {
  it('treats "Struggling" as a miss, so the card starts over at short gaps', () => {
    expect(gradeToRating('struggling')).toBe(1);
    expect(gradeToRating('good')).toBe(3);
    expect(gradeToRating('easy')).toBe(4);
  });
});

describe('resumePoint', () => {
  it('starts a new set at the first card', () => {
    const p = resumePoint(ids, progress());
    expect(p).toMatchObject({ pocket: ['c1', 'c2', 'c3'], queue: ['c1', 'c2', 'c3'], isNew: true, learned: 0, remaining: 7, fresh: 3, reviews: 0 });
  });

  it('picks up partway through the pocket you left', () => {
    const p = resumePoint(ids, progress({ done: done('c1', 'c2'), pocket: ['c1', 'c2', 'c3'] }));
    expect(p).toMatchObject({ pocket: ['c1', 'c2', 'c3'], queue: ['c3'], isNew: false, learned: 2 });
  });

  it('moves on to the next unlearned cards once a pocket is done — never repeating the first ones', () => {
    const p = resumePoint(ids, progress({ done: done('c1', 'c2', 'c3'), pocket: ['c1', 'c2', 'c3'] }));
    expect(p.pocket).toEqual(['c4', 'c5', 'c6']);
    expect(p.isNew).toBe(true);
  });

  it('puts learned cards that are due for review first in the next pocket', () => {
    const p = resumePoint(ids, progress({ done: done('c1', 'c2', 'c3'), pocket: ['c1', 'c2', 'c3'] }), ['c2']);
    expect(p).toMatchObject({ pocket: ['c2', 'c4', 'c5'], reviews: 1, fresh: 2 });
  });

  it("counts a review card as finished only once it's been graded again in this pocket", () => {
    const earlier = { ...done('c1'), c1: mark({ at: '2026-09-20T10:00:00.000Z' }) };
    const pocket = progress({ done: earlier, pocket: ['c1', 'c4'], pocket_started_at: T0 });
    expect(finishedInPocket(pocket, 'c1')).toBe(false);
    expect(resumePoint(ids, pocket, ['c1'])).toMatchObject({ queue: ['c1', 'c4'], reviews: 1, isNew: false });

    const regraded = { ...pocket, done: { ...earlier, c1: mark({ at: '2026-09-23T12:05:00.000Z', review: true }) } };
    expect(resumePoint(ids, regraded, [])).toMatchObject({ queue: ['c4'], reviews: 1 });
  });

  it('uses a new pocket size from the next pocket, and skips cards that were deleted', () => {
    const p = resumePoint(['c1', 'c2', 'c4', 'c5', 'c6'], progress({ done: done('c1', 'c2', 'c3'), pocket: ['c1', 'c2', 'c3'], pocket_size: 2 }));
    expect(p.pocket).toEqual(['c4', 'c5']);
    expect(p).toMatchObject({ learned: 2, remaining: 3, total: 5 });
  });

  it("is complete only when everything's learned and nothing is due", () => {
    const all = progress({ done: done('c1', 'c2'), pocket: ['c1', 'c2'], pocket_size: 5 });
    expect(resumePoint(['c1', 'c2'], all)).toMatchObject({ pocket: [], complete: true, remaining: 0 });
    expect(resumePoint(['c1', 'c2'], all, ['c2'])).toMatchObject({ pocket: ['c2'], complete: false, reviews: 1 });
  });

  describe('with a study plan', () => {
    it("serves the day's reviews (studied anywhere) and only today's share of new cards", () => {
      // c1, c2 were studied in Review mode (not in Learn); c2 is due. The plan allows 2 new cards today.
      const p = resumePoint(ids, progress({ pocket_size: 10 }), ['c2'], ['c3', 'c4']);
      expect(p).toMatchObject({ pocket: ['c2', 'c3', 'c4'], reviews: 1, fresh: 2, isNew: true });
    });

    it("is done for the day once today's reviews and new cards are through", () => {
      const p = resumePoint(ids, progress({ done: done('c2', 'c3', 'c4'), pocket: ['c2', 'c3', 'c4'], pocket_size: 10 }), [], []);
      expect(p).toMatchObject({ pocket: [], complete: true });
    });

    it('never serves a due review twice in one pocket', () => {
      const p = resumePoint(ids, progress({ pocket_size: 10 }), ['c3'], ['c3', 'c4']);
      expect(p.pocket).toEqual(['c3', 'c4']);
    });
  });

  it('keeps going with cards added to the set after it was finished', () => {
    const p = resumePoint(['c1', 'c2', 'new'], progress({ done: done('c1', 'c2'), pocket: ['c1', 'c2'], pocket_size: 5 }));
    expect(p).toMatchObject({ pocket: ['new'], complete: false, remaining: 1 });
  });
});

describe('due reviews', () => {
  const k = (id: string, reviews: Partial<CardReview>[]): CardWithReviews => ({
    card: mkCard('c', { id }),
    reviews: reviews.map((r) => mkReview(id, r)),
  });
  const cards = [
    k('late', [{ reviewed_at: '2026-09-19T10:00:00Z', due_at: '2026-09-20T10:00:00Z' }]),
    k('today', [{ reviewed_at: '2026-09-22T10:00:00Z', due_at: '2026-09-23T20:00:00Z' }]),
    k('later', [{ reviewed_at: '2026-09-22T10:00:00Z', due_at: '2026-09-26T10:00:00Z' }]),
    k('unlearned', []),
  ];
  const learned = done('late', 'today', 'later');

  it("lists learned cards due by the end of today, most overdue first", () => {
    expect(dueForReview(cards, learned, new Date('2026-09-24T05:00:00Z'))).toEqual(['late', 'today']);
    expect(dueForReview(cards, { today: mark() }, new Date('2026-09-24T05:00:00Z'))).toEqual(['today']);
  });

  it('with a study plan, counts cards studied anywhere (not just in Learn)', () => {
    expect(dueForReview(cards, null, new Date('2026-09-24T05:00:00Z'))).toEqual(['late', 'today']);
  });

  it('says when the next one comes due', () => {
    expect(nextReviewAt(cards, { later: mark() })?.toISOString()).toBe('2026-09-26T10:00:00.000Z');
  });

  it("knows which cards were studied today, and which of them you weren't sure of", () => {
    const withToday = [
      k('ok', [{ reviewed_at: '2026-09-23T14:00:00Z', rating: 3 }]),
      k('shaky', [{ reviewed_at: '2026-09-23T14:00:00Z', rating: 1 }, { reviewed_at: '2026-09-23T14:05:00Z', rating: 3 }]),
      k('yesterday', [{ reviewed_at: '2026-09-22T14:00:00Z', rating: 1 }]),
    ];
    expect(studiedToday(withToday, '2026-09-23', (iso) => iso.slice(0, 10))).toEqual({ all: ['ok', 'shaky'], shaky: ['shaky'] });
  });
});

describe('pocketStats', () => {
  it('summarizes the cards finished in this pocket', () => {
    const p = {
      pocket_started_at: T0,
      done: {
        a: mark({ grade: 'easy', accuracy: 1, at: '2026-09-23T12:01:00Z' }),
        b: mark({ grade: 'good', accuracy: 0.5, at: '2026-09-23T12:02:00Z', misses: 2, review: true }),
        old: mark({ at: '2026-09-22T12:00:00Z' }), // finished in an earlier pocket
      },
    };
    expect(pocketStats(['a', 'b', 'old', 'c'], p)).toEqual({ completed: 2, easy: 1, good: 1, retried: 1, reviews: 1, averageAccuracy: 0.75 });
  });
});

describe('spacing toward a test', () => {
  it('keeps bringing a card back across the days before the test, with a review shortly before it', () => {
    // Learned on day 0; the test is day 9 at 10am. Study each morning, answering "Good" to whatever is due.
    const day = (n: number, hour = 10) => new Date(Date.UTC(2026, 8, 23 + n, hour));
    const test = day(9);
    const reviews: CardReview[] = [];
    const studyDays: number[] = [];
    for (let n = 0; n < 9; n++) {
      const now = day(n);
      const state = stateFromReviews(reviews);
      if (reviews.length > 0 && state.dueAt && state.dueAt > day(n, 23)) continue; // not due today
      const s = nextReview(state, 3, now, test, { dueAt: state.dueAt });
      reviews.push(mkReview('card', { reviewed_at: now.toISOString(), rating: 3, interval_days: s.interval_days, ease: s.ease, due_at: s.due_at.toISOString() }));
      studyDays.push(n);
    }
    expect(studyDays.length).toBeGreaterThanOrEqual(4); // not learned once and forgotten
    expect(studyDays[1]).toBe(1); // the next day, then spreading out
    expect(9 - studyDays[studyDays.length - 1]).toBeLessThanOrEqual(2); // fresh right before the test
  });
});
