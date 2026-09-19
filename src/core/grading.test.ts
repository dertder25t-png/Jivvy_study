import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCALE, PLUS_MINUS_SCALE, calibrationOffset, courseScale, gradeBand, neededOnComponent, officialPercent,
  reconcile, targetBands,
} from './grades';
import { mkAssignment, mkComponent, mkCourse } from './testutil';

const official = (over: { percent?: number | null; letter?: string | null } = {}) => ({
  percent: null, letter: null, as_of: '2026-09-19T00:00:00Z', ...over,
});

describe('per-course grading scales', () => {
  it('falls back to plain A–F and sorts a custom scale high → low', () => {
    expect(courseScale(mkCourse())).toBe(DEFAULT_SCALE);
    const scrambled = [{ letter: 'C', floor: 70 }, { letter: 'A', floor: 92 }, { letter: 'F', floor: 0 }, { letter: 'B', floor: 81 }];
    expect(courseScale(mkCourse({ grading_scale: scrambled })).map((b) => b.letter)).toEqual(['A', 'B', 'C', 'F']);
  });
  it('uses the college cutoffs, not ours', () => {
    expect(gradeBand(91, DEFAULT_SCALE).letter).toBe('A');
    expect(gradeBand(91, PLUS_MINUS_SCALE).letter).toBe('A-');
    expect(gradeBand(91, [{ letter: 'A', floor: 93 }, { letter: 'B', floor: 85 }, { letter: 'F', floor: 0 }]).letter).toBe('B');
  });
  it('offers every rung above the bottom as a target', () => {
    expect(targetBands(PLUS_MINUS_SCALE).map((b) => b.letter)).toEqual(['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-']);
  });
});

describe('official grade vs. our estimate', () => {
  it('reads a percent, or falls back to the floor of a letter', () => {
    expect(officialPercent(official({ percent: 88.4 }), DEFAULT_SCALE)).toBe(88.4);
    expect(officialPercent(official({ letter: 'B' }), DEFAULT_SCALE)).toBe(80);
    expect(officialPercent(official({ letter: 'B+' }), PLUS_MINUS_SCALE)).toBe(87);
    expect(officialPercent(official({ letter: 'Z' }), DEFAULT_SCALE)).toBeNull();
    expect(officialPercent(null, DEFAULT_SCALE)).toBeNull();
  });
  it('says plainly when the numbers agree or differ', () => {
    expect(reconcile(87.2, official({ percent: 87.9 }), DEFAULT_SCALE).kind).toBe('close');
    const higher = reconcile(85, official({ percent: 88 }), DEFAULT_SCALE);
    expect(higher.kind).toBe('official_higher');
    expect(higher.diff).toBe(3);
    expect(higher.message).toContain('3 points higher');
    expect(reconcile(90, official({ percent: 86.5 }), DEFAULT_SCALE).kind).toBe('official_lower');
  });
  it('compares letters when only a letter was given', () => {
    expect(reconcile(85, official({ letter: 'B' }), DEFAULT_SCALE).kind).toBe('close');
    expect(reconcile(85, official({ letter: 'A' }), DEFAULT_SCALE).kind).toBe('letter_differs');
  });
  it('has nothing to say without both sides', () => {
    expect(reconcile(null, official({ percent: 90 }), DEFAULT_SCALE).kind).toBe('none');
    expect(reconcile(90, null, DEFAULT_SCALE).kind).toBe('none');
    expect(reconcile(90, official(), DEFAULT_SCALE).kind).toBe('none');
  });
  it('only calibrates from a percent, and caps the shift', () => {
    expect(calibrationOffset(85, official({ percent: 88 }))).toBe(3);
    expect(calibrationOffset(85, official({ letter: 'A' }))).toBe(0);
    expect(calibrationOffset(85, official({ percent: 40 }))).toBe(-15);
    expect(calibrationOffset(null, official({ percent: 90 }))).toBe(0);
  });
  it('"what do I need" lands on the college number when calibrated', () => {
    const course = mkCourse();
    const body = mkComponent(course.id, { name: 'Coursework', weight: 0.7 });
    const final = mkComponent(course.id, { name: 'Final', weight: 0.3 });
    const asg = [
      mkAssignment(course.id, { component_id: body.id, status: 'graded', points_earned: 80, points_possible: 100 }),
      mkAssignment(course.id, { component_id: final.id, points_possible: 100 }),
    ];
    const plain = neededOnComponent([body, final], asg, final.id, 80)!;
    const boosted = neededOnComponent([body, final], asg, final.id, 80, 3)!; // college says we're 3 points higher
    const lower = neededOnComponent([body, final], asg, final.id, 80, -3)!;
    expect(plain.needed).toBeCloseTo(80, 5);
    expect(boosted.needed).toBeLessThan(plain.needed);
    expect(lower.needed).toBeGreaterThan(plain.needed);
    // still reports the target the student asked for
    expect(boosted.targetPercent).toBe(80);
  });
});
