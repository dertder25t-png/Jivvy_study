import { describe, expect, it } from 'vitest';
import type { Card, CardReview, LearnMark, LearnProgress } from '@/types/db';
import {
  checkAnswer, copyTimeSeconds, dailyNewCards, requeueMissed, troubleCards, dueForReview, finishedInPocket, gradeToRating, learnOrder, learnScopeKey, mixPocket, nextReviewAt, pocketStats, resumePoint, studiedToday,
} from './learning';
import { nextReview, stateFromReviews, type CardWithReviews } from './scheduling';
import { mkCard, mkReview } from './testutil';

const T0 = '2026-09-23T12:00:00.000Z';
const mark = (over: Partial<LearnMark> = {}): LearnMark => ({ grade: 'good', accuracy: 1, at: T0, ...over });
const done = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, mark()]));
const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'];
type P = Pick<LearnProgress, 'done' | 'pocket' | 'pocket_started_at'>;
const progress = (over: Partial<P> = {}): P => ({ done: {}, pocket: [], pocket_started_at: null, ...over });

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
  it('starts a new set with every card up today, in order', () => {
    const p = resumePoint(ids, progress());
    expect(p).toMatchObject({ pocket: ids, queue: ids, isNew: true, learned: 0, remaining: 7, fresh: 7, reviews: 0 });
  });

  it("limits new cards to today's share when it's given", () => {
    const p = resumePoint(ids, progress(), [], undefined, undefined, ['c1', 'c2', 'c3']);
    expect(p.pocket).toEqual(['c1', 'c2', 'c3']);
  });

  it('picks up partway through the pocket you left', () => {
    const p = resumePoint(ids, progress({ done: done('c1', 'c2'), pocket: ['c1', 'c2', 'c3'] }), [], undefined, undefined, ['c3']);
    expect(p).toMatchObject({ pocket: ['c1', 'c2', 'c3'], queue: ['c3'], isNew: false, grown: false, learned: 2 });
  });

  it("adds the rest of today's share to a smaller pocket picked earlier, keeping your place in it", () => {
    const p = resumePoint(ids, progress({ done: done('c1', 'c2'), pocket: ['c1', 'c2', 'c3'] }), [], undefined, undefined, ['c3', 'c4', 'c5']);
    expect(p).toMatchObject({ pocket: ['c1', 'c2', 'c3', 'c4', 'c5'], queue: ['c3', 'c4', 'c5'], isNew: false, grown: true });
  });

  it('moves on to the next unlearned cards once a pocket is done — never repeating the first ones', () => {
    const p = resumePoint(ids, progress({ done: done('c1', 'c2', 'c3'), pocket: ['c1', 'c2', 'c3'] }));
    expect(p.pocket).toEqual(['c4', 'c5', 'c6', 'c7']);
    expect(p.isNew).toBe(true);
  });

  it('puts learned cards that are due for review first in the next pocket', () => {
    const p = resumePoint(ids, progress({ done: done('c1', 'c2', 'c3'), pocket: ['c1', 'c2', 'c3'] }), ['c2']);
    expect(p).toMatchObject({ pocket: ['c2', 'c4', 'c5', 'c6', 'c7'], reviews: 1, fresh: 4 });
  });

  it("counts a review card as finished only once it's been graded again in this pocket", () => {
    const earlier = { ...done('c1'), c1: mark({ at: '2026-09-20T10:00:00.000Z' }) };
    const pocket = progress({ done: earlier, pocket: ['c1', 'c4'], pocket_started_at: T0 });
    expect(finishedInPocket(pocket, 'c1')).toBe(false);
    expect(resumePoint(ids, pocket, ['c1'], undefined, undefined, ['c4'])).toMatchObject({ queue: ['c1', 'c4'], reviews: 1, isNew: false });

    const regraded = { ...pocket, done: { ...earlier, c1: mark({ at: '2026-09-23T12:05:00.000Z', review: true }) } };
    expect(resumePoint(ids, regraded, [], undefined, undefined, ['c4'])).toMatchObject({ queue: ['c4'], reviews: 1 });
  });

  it('skips cards that were deleted', () => {
    const p = resumePoint(['c1', 'c2', 'c4', 'c5', 'c6'], progress({ done: done('c1', 'c2', 'c3'), pocket: ['c1', 'c2', 'c3'] }));
    expect(p.pocket).toEqual(['c4', 'c5', 'c6']);
    expect(p).toMatchObject({ learned: 2, remaining: 3, total: 5 });
  });

  it("is complete only when everything's learned and nothing is due", () => {
    const all = progress({ done: done('c1', 'c2'), pocket: ['c1', 'c2'] });
    expect(resumePoint(['c1', 'c2'], all)).toMatchObject({ pocket: [], complete: true, remaining: 0 });
    expect(resumePoint(['c1', 'c2'], all, ['c2'])).toMatchObject({ pocket: ['c2'], complete: false, reviews: 1 });
  });

  describe('with a study plan', () => {
    it("serves the day's reviews (studied anywhere) and only today's share of new cards", () => {
      // c1, c2 were studied in Review mode (not in Learn); c2 is due. The plan allows 2 new cards today.
      const p = resumePoint(ids, progress(), ['c2'], ['c3', 'c4']);
      expect(p).toMatchObject({ pocket: ['c2', 'c3', 'c4'], reviews: 1, fresh: 2, isNew: true });
    });

    it("is done for the day once today's reviews and new cards are through", () => {
      const p = resumePoint(ids, progress({ done: done('c2', 'c3', 'c4'), pocket: ['c2', 'c3', 'c4'] }), [], []);
      expect(p).toMatchObject({ pocket: [], complete: true });
    });

    it('never serves a due review twice in one pocket', () => {
      const p = resumePoint(ids, progress(), ['c3'], ['c3', 'c4']);
      expect(p.pocket).toEqual(['c3', 'c4']);
    });
  });

  it('keeps going with cards added to the set after it was finished', () => {
    const p = resumePoint(['c1', 'c2', 'new'], progress({ done: done('c1', 'c2'), pocket: ['c1', 'c2'] }));
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

describe('checkAnswer', () => {
  const def = 'The powerhouse of the cell that produces ATP through cellular respiration';

  it('ignores case, punctuation, accents, filler words and word order', () => {
    expect(checkAnswer('CELL powerhouse!! produces atp, through cellular respiration', def).verdict).toBe('right');
    expect(checkAnswer('  ', def)).toMatchObject({ verdict: 'wrong', score: 0 });
    expect(checkAnswer('café', 'Cafe').verdict).toBe('right');
  });

  it('forgives small typos and plurals', () => {
    expect(checkAnswer('powerhose of the cell that produces atp throgh cellular respiraton', def).verdict).toBe('right');
    expect(checkAnswer('mitochondrion', 'Mitochondria').verdict).toBe('right');
  });

  it('is lenient on long definitions but strict on short terms', () => {
    expect(checkAnswer('powerhouse cell produces ATP cellular', def).verdict).toBe('close');
    expect(checkAnswer('something about energy', def).verdict).toBe('wrong');
    expect(checkAnswer('cell wall', 'cell membrane').verdict).toBe('wrong');
    expect(checkAnswer('Cell Membrane', 'the cell membrane').verdict).toBe('right');
  });

  it('lists what was left out', () => {
    expect(checkAnswer('powerhouse of the cell', def).missing).toContain('atp');
  });

  it('does not accept a word dump', () => {
    const dump = Array.from({ length: 40 }, () => 'powerhouse cell produces atp cellular respiration').join(' ');
    expect(checkAnswer(dump, def).verdict).toBe('wrong');
  });
});

describe('mixPocket', () => {
  it('serves every card, interleaving reviews and new cards in proportion', () => {
    const r = ['r1', 'r2', 'r3', 'r4'];
    const n = ['n1', 'n2'];
    const p = mixPocket(r, n);
    expect(p).toHaveLength(6);
    expect([...p].sort()).toEqual([...r, ...n].sort());
    expect(p.slice(0, 3)).toEqual(['r1', 'n1', 'r2']);
  });

  it('keeps all of a big backlog and all of the new cards, new ones spread through it', () => {
    const backlog = Array.from({ length: 56 }, (_, i) => `r${i}`);
    const fresh = Array.from({ length: 49 }, (_, i) => `n${i}`);
    const p = mixPocket(backlog, fresh);
    expect(p).toHaveLength(105);
    expect(p.slice(0, 10).some((x) => x.startsWith('n'))).toBe(true);
  });

  it('with only one kind, just that kind in order', () => {
    expect(mixPocket(['r1', 'r2'], [])).toEqual(['r1', 'r2']);
    expect(mixPocket([], ['n1', 'n2'])).toEqual(['n1', 'n2']);
  });
});

describe('dailyNewCards', () => {
  it('is at least 10 a day and spreads big sets over about ten days', () => {
    expect(dailyNewCards(30)).toBe(10);
    expect(dailyNewCards(300)).toBe(30);
  });
});

describe('a pocket left from an earlier day', () => {
  it('is rebuilt instead of resumed', () => {
    const stale = progress({ done: done('c1'), pocket: ['c1', 'c2', 'c3'], pocket_started_at: '2026-09-20T10:00:00.000Z' });
    const p = resumePoint(ids, stale, [], undefined, new Date('2026-09-23T00:00:00Z'));
    expect(p.isNew).toBe(true);
    expect(p.pocket).toEqual(['c2', 'c3', 'c4', 'c5', 'c6', 'c7']);
    // Same day: still resumed.
    expect(resumePoint(ids, stale, [], undefined, new Date('2026-09-19T00:00:00Z')).isNew).toBe(false);
  });
});

describe('due reviews after a Good today', () => {
  const k = (id: string, reviews: Partial<CardReview>[]): CardWithReviews => ({ card: mkCard('c', { id }), reviews: reviews.map((r) => mkReview(id, r)) });
  const endOfToday = new Date('2026-09-24T05:00:00Z');
  const startOfToday = new Date('2026-09-23T05:00:00Z');

  it("doesn't bring back a card that was passed today, even if the test makes it due before midnight", () => {
    const passed = k('passed', [{ reviewed_at: '2026-09-23T14:00:00Z', rating: 3, due_at: '2026-09-23T20:00:00Z' }]);
    const failed = k('failed', [{ reviewed_at: '2026-09-23T14:00:00Z', rating: 1, due_at: '2026-09-23T14:10:00Z' }]);
    expect(dueForReview([passed, failed], null, endOfToday)).toEqual(['failed', 'passed']);
    expect(dueForReview([passed, failed], null, endOfToday, startOfToday)).toEqual(['failed']);
  });

  it('puts lapsed cards before the merely overdue, and treats an unreadable due date as due', () => {
    const late = k('late', [{ reviewed_at: '2026-09-10T10:00:00Z', rating: 3, due_at: '2026-09-11T10:00:00Z' }]);
    const lapsed = k('lapsed', [{ reviewed_at: '2026-09-20T10:00:00Z', rating: 1, due_at: '2026-09-20T10:10:00Z' }]);
    const broken = k('broken', [{ reviewed_at: '2026-09-20T10:00:00Z', rating: 3, due_at: 'garbage' }]);
    expect(dueForReview([late, lapsed, broken], null, endOfToday, startOfToday)).toEqual(['lapsed', 'broken', 'late']);
  });
});

describe('copyTimeSeconds', () => {
  it('gives short answers a few seconds and long ones time to type them, up to a cap', () => {
    expect(copyTimeSeconds('cat', 'dog')).toBeLessThanOrEqual(7);
    expect(copyTimeSeconds('x'.repeat(200), 'term')).toBeGreaterThanOrEqual(60);
    expect(copyTimeSeconds('x'.repeat(5000))).toBe(300);
  });

  it('gives more time at a slower typing speed and less at a faster one', () => {
    const def = 'x'.repeat(120);
    expect(copyTimeSeconds(def, '', 1)).toBeGreaterThan(copyTimeSeconds(def, '', 3));
    expect(copyTimeSeconds(def, '', 8)).toBeLessThan(copyTimeSeconds(def, '', 3));
    expect(copyTimeSeconds(def, '', 0)).toBe(copyTimeSeconds(def, ''));
    expect(copyTimeSeconds(def, '', 50)).toBeLessThanOrEqual(3);
  });
});

describe('troubleCards', () => {
  const k = (id: string, ratings: number[]): CardWithReviews => ({
    card: mkCard('c', { id }),
    reviews: ratings.map((rating, i) => mkReview(id, { rating: rating as 1 | 2 | 3 | 4, reviewed_at: `2026-09-2${i}T10:00:00.000Z` })),
  });

  it('lists missed cards until they are recalled twice in a row, most-missed first', () => {
    const list = troubleCards([
      k('never', [3, 3]),
      k('once', [1, 3]),
      k('cleared', [1, 3, 3]),
      k('often', [1, 1, 3, 1]),
      k('new', []),
    ]);
    expect(list.map((t) => t.id)).toEqual(['often', 'once']);
    expect(list[0]).toMatchObject({ misses: 3, passesSince: 0 });
  });

  it('a miss after being cleared puts it back', () => {
    expect(troubleCards([k('c', [1, 3, 3, 1])]).map((t) => t.id)).toEqual(['c']);
  });
});

describe('requeueMissed', () => {
  it('brings a missed card back after a few others, not at the end of a big deck', () => {
    const deck = Array.from({ length: 60 }, (_, i) => `c${i}`);
    const q = requeueMissed(deck);
    expect(q.indexOf('c0')).toBe(3);
    expect(q).toHaveLength(60);
  });

  it('goes to the end when only a few cards are left', () => {
    expect(requeueMissed(['a', 'b'])).toEqual(['b', 'a']);
    expect(requeueMissed(['a'])).toEqual(['a']);
  });
});
