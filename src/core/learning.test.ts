import { describe, expect, it } from 'vitest';
import type { Card, LearnMark } from '@/types/db';
import { learnOrder, learnScopeKey, pocketStats, resumePoint } from './learning';

const mark = (grade: LearnMark['grade'] = 'good', accuracy = 1): LearnMark => ({ grade, accuracy, at: '2026-09-23T12:00:00Z' });
const done = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, mark()]));
const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'];

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

describe('resumePoint', () => {
  it('starts a new set at the first card', () => {
    const p = resumePoint(ids, { done: {}, pocket: [], pocket_size: 3 });
    expect(p).toMatchObject({ pocket: ['c1', 'c2', 'c3'], position: 0, learned: 0, remaining: 7, complete: false });
  });

  it('picks up partway through the pocket you left', () => {
    const p = resumePoint(ids, { done: done('c1', 'c2'), pocket: ['c1', 'c2', 'c3'], pocket_size: 3 });
    expect(p).toMatchObject({ pocket: ['c1', 'c2', 'c3'], position: 2, learned: 2 });
  });

  it('moves on to the next unfinished cards once a pocket is done — never repeating the first ones', () => {
    const p = resumePoint(ids, { done: done('c1', 'c2', 'c3'), pocket: ['c1', 'c2', 'c3'], pocket_size: 3 });
    expect(p.pocket).toEqual(['c4', 'c5', 'c6']);
    expect(p.position).toBe(0);
  });

  it('uses a new pocket size from the next pocket, and skips cards that were deleted', () => {
    const p = resumePoint(['c1', 'c2', 'c4', 'c5', 'c6'], { done: done('c1', 'c2', 'c3'), pocket: ['c1', 'c2', 'c3'], pocket_size: 2 });
    expect(p.pocket).toEqual(['c4', 'c5']);
    expect(p).toMatchObject({ learned: 2, remaining: 3, total: 5 });
  });

  it('knows when the whole set is learned', () => {
    const p = resumePoint(['c1', 'c2'], { done: done('c1', 'c2'), pocket: ['c1', 'c2'], pocket_size: 5 });
    expect(p).toMatchObject({ pocket: [], complete: true, remaining: 0 });
  });

  it('keeps going with cards added to the set after it was finished', () => {
    const p = resumePoint(['c1', 'c2', 'new'], { done: done('c1', 'c2'), pocket: ['c1', 'c2'], pocket_size: 5 });
    expect(p).toMatchObject({ pocket: ['new'], complete: false, remaining: 1 });
  });
});

describe('pocketStats', () => {
  it('summarizes a pocket from the saved marks', () => {
    const marks = { a: mark('easy', 1), b: mark('struggling', 0.5), z: mark('good', 0) };
    expect(pocketStats(['a', 'b', 'c'], marks)).toEqual({ completed: 2, easy: 1, good: 0, struggling: 1, averageAccuracy: 0.75 });
  });
});
