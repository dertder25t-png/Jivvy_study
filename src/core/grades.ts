// Grade math. Percentages are on a 0–100 scale; component weights are 0–1.
import type { Assignment, Course, GradeBand, GradeComponent, OfficialGrade } from '@/types/db';

export type { GradeBand };

export function isGraded(a: Assignment): boolean {
  return (
    a.status === 'graded' &&
    a.points_earned != null &&
    a.points_possible != null &&
    a.points_possible > 0
  );
}

export interface ComponentResult {
  component: GradeComponent;
  /** Assignments counted toward this component (not dismissed). */
  totalCount: number;
  gradedCount: number;
  earned: number;
  possible: number;
  /** null until something in the component is graded. */
  percent: number | null;
  /** Assignment ids currently covered by the drop-lowest policy. */
  droppedIds: string[];
}

export function componentResult(component: GradeComponent, all: Assignment[]): ComponentResult {
  const mine = all.filter((a) => a.component_id === component.id && a.status !== 'dismissed');
  const graded = mine.filter(isGraded);

  // Drop the lowest N graded scores, but never all of them (keeps at least one).
  const dropCount = Math.min(component.drop_lowest ?? 0, Math.max(0, graded.length - 1));
  const byScore = [...graded].sort(
    (a, b) => a.points_earned! / a.points_possible! - b.points_earned! / b.points_possible!,
  );
  const dropped = byScore.slice(0, dropCount);
  const counted = graded.filter((a) => !dropped.includes(a));

  const earned = counted.reduce((s, a) => s + a.points_earned!, 0);
  const possible = counted.reduce((s, a) => s + a.points_possible!, 0);

  return {
    component,
    totalCount: mine.length,
    gradedCount: graded.length,
    earned,
    possible,
    percent: possible > 0 ? (earned / possible) * 100 : null,
    droppedIds: dropped.map((a) => a.id),
  };
}

export interface CourseGrade {
  /** Grade over the work graded so far; null if nothing is graded. */
  percent: number | null;
  gradedWeight: number;
  totalWeight: number;
  results: ComponentResult[];
}

export function courseGrade(components: GradeComponent[], assignments: Assignment[]): CourseGrade {
  const results = components.map((c) => componentResult(c, assignments));
  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  const live = results.filter((r) => r.percent != null);
  const gradedWeight = live.reduce((s, r) => s + r.component.weight, 0);
  const percent =
    gradedWeight > 0 ? live.reduce((s, r) => s + r.component.weight * r.percent!, 0) / gradedWeight : null;
  return { percent, gradedWeight, totalWeight, results };
}

export const DEFAULT_SCALE: GradeBand[] = [
  { letter: 'A', floor: 90 },
  { letter: 'B', floor: 80 },
  { letter: 'C', floor: 70 },
  { letter: 'D', floor: 60 },
  { letter: 'F', floor: 0 },
];

export function gradeBand(percent: number, scale: GradeBand[] = DEFAULT_SCALE): GradeBand {
  const sorted = [...scale].sort((a, b) => b.floor - a.floor);
  return sorted.find((b) => percent >= b.floor) ?? sorted[sorted.length - 1];
}

/** Common college scales. Every school differs, so these are only starting points. */
export const PLUS_MINUS_SCALE: GradeBand[] = [
  { letter: 'A', floor: 93 }, { letter: 'A-', floor: 90 }, { letter: 'B+', floor: 87 }, { letter: 'B', floor: 83 },
  { letter: 'B-', floor: 80 }, { letter: 'C+', floor: 77 }, { letter: 'C', floor: 73 }, { letter: 'C-', floor: 70 },
  { letter: 'D+', floor: 67 }, { letter: 'D', floor: 63 }, { letter: 'D-', floor: 60 }, { letter: 'F', floor: 0 },
];

export const SCALE_PRESETS: Array<{ key: string; label: string; scale: GradeBand[] }> = [
  { key: 'simple', label: 'A–F (90/80/70/60)', scale: DEFAULT_SCALE },
  { key: 'plusminus', label: 'Plus / minus', scale: PLUS_MINUS_SCALE },
];

/** This course's scale, falling back to plain A–F. Always sorted high → low. */
export function courseScale(course: Pick<Course, 'grading_scale'> | undefined | null): GradeBand[] {
  const s = course?.grading_scale;
  return s && s.length > 0 ? [...s].sort((a, b) => b.floor - a.floor) : DEFAULT_SCALE;
}

/** Bands worth aiming for (everything above the bottom rung). */
export function targetBands(scale: GradeBand[]): GradeBand[] {
  return [...scale].sort((a, b) => b.floor - a.floor).filter((b) => b.floor > 0);
}

export function bandByLetter(letter: string, scale: GradeBand[] = DEFAULT_SCALE): GradeBand | undefined {
  return scale.find((b) => b.letter.toUpperCase() === letter.toUpperCase());
}

export type NeededStatus = 'secured' | 'possible' | 'out_of_reach';

export interface NeededResult {
  /** Percent needed on the remaining ungraded work in this component. */
  needed: number;
  status: NeededStatus;
  targetPercent: number;
  /** What we assumed every other ungraded component will score. */
  assumedOtherPercent: number;
  remainingPoints: number;
}

/**
 * "What do I need on the final?" — the score required on the *remaining
 * ungraded work* of one component to finish the course at `targetPercent`.
 * Other components use their graded average; if they have none yet, they are
 * assumed to land at the student's current overall grade (or the target when
 * nothing at all is graded).
 */
export function neededOnComponent(
  components: GradeComponent[],
  assignments: Assignment[],
  componentId: string,
  targetPercent: number,
  /** official − estimate, so the math lands on the college's number (see calibrationOffset). */
  calibration = 0,
): NeededResult | null {
  const adjusted = targetPercent - calibration; // what OUR math must hit for the college's number to hit the target
  const total = components.reduce((s, c) => s + c.weight, 0);
  const target = components.find((c) => c.id === componentId);
  if (!target || total <= 0 || target.weight <= 0) return null;

  const { percent: current, results } = courseGrade(components, assignments);
  const assumed = current ?? adjusted;

  const mine = results.find((r) => r.component.id === componentId)!;
  const ungraded = assignments.filter(
    (a) => a.component_id === componentId && a.status !== 'dismissed' && !isGraded(a),
  );
  if (ungraded.length === 0) return null;

  const avgPossible = mine.gradedCount > 0 ? (mine.possible / Math.max(1, mine.gradedCount)) : 100;
  const remainingPoints = ungraded.reduce((s, a) => s + (a.points_possible ?? avgPossible), 0);
  if (remainingPoints <= 0) return null;

  const others = results.filter((r) => r.component.id !== componentId);
  const othersContribution = others.reduce(
    (s, r) => s + (r.component.weight / total) * (r.percent ?? assumed),
    0,
  );
  const wT = target.weight / total;
  const requiredComponentPercent = (adjusted - othersContribution) / wT;

  const needed =
    ((requiredComponentPercent / 100) * (mine.possible + remainingPoints) - mine.earned) / remainingPoints * 100;

  const status: NeededStatus = needed <= 0 ? 'secured' : needed > 100 ? 'out_of_reach' : 'possible';
  return {
    needed: Math.max(0, needed),
    status,
    targetPercent,
    assumedOtherPercent: assumed,
    remainingPoints,
  };
}

const TYPE_FALLBACK_IMPACT: Record<string, number> = {
  exam: 10,
  paper: 6,
  project: 6,
  quiz: 2,
  discussion: 1,
  reading: 0.5,
  other: 1,
};

/**
 * Percentage points of the final course grade riding on one assignment.
 * Used everywhere we need "triage by consequence, not volume".
 */
export function gradeImpact(
  assignment: Assignment,
  components: GradeComponent[],
  courseAssignments: Assignment[],
): number {
  const comp = components.find((c) => c.id === assignment.component_id);
  if (!comp) return TYPE_FALLBACK_IMPACT[assignment.type] ?? 1;
  const inComponent = courseAssignments.filter(
    (a) => a.component_id === comp.id && a.status !== 'dismissed',
  ).length;
  const denominator = Math.max(1, comp.expected_count ?? 0, inComponent);
  return (comp.weight * 100) / denominator;
}

export function formatPercent(p: number | null, digits = 1): string {
  if (p == null) return '—';
  return `${p.toFixed(digits).replace(/\.0+$/, '')}%`;
}

// ---------------------------------------------------------------------------
// Official grade (from the college's own system) vs. our estimate
// ---------------------------------------------------------------------------

/** The official grade as a percent: as entered, else the floor of the entered letter. */
export function officialPercent(o: OfficialGrade | null | undefined, scale: GradeBand[]): number | null {
  if (!o) return null;
  if (o.percent != null) return o.percent;
  if (o.letter) return bandByLetter(o.letter.trim(), scale)?.floor ?? null;
  return null;
}

export interface Reconciliation {
  kind: 'none' | 'close' | 'official_higher' | 'official_lower' | 'letter_differs';
  /** official − estimate in percentage points, when both are percents. */
  diff: number | null;
  message: string | null;
}

/**
 * Compares our estimate with the college's number. They will often differ — missing grades, different
 * weights, rounding, curves — and that's fine; the point is to say so plainly rather than pretend.
 */
export function reconcile(
  estimate: number | null,
  official: OfficialGrade | null | undefined,
  scale: GradeBand[],
): Reconciliation {
  if (!official || estimate == null || (official.percent == null && !official.letter)) {
    return { kind: 'none', diff: null, message: null };
  }
  if (official.percent != null) {
    const diff = official.percent - estimate;
    if (Math.abs(diff) <= 1) return { kind: 'close', diff, message: 'Matches our estimate.' };
    const pts = Math.abs(diff).toFixed(1).replace(/\.0$/, '');
    return diff > 0
      ? { kind: 'official_higher', diff, message: `Your college's number is ${pts} points higher than our estimate — some grades or credit may not be entered here yet.` }
      : { kind: 'official_lower', diff, message: `Your college's number is ${pts} points lower than our estimate — it may weight things differently, or count work we don't know about.` };
  }
  const ours = gradeBand(estimate, scale).letter;
  const theirs = official.letter!.trim().toUpperCase();
  return ours.toUpperCase() === theirs
    ? { kind: 'close', diff: null, message: 'Same letter as our estimate.' }
    : { kind: 'letter_differs', diff: null, message: `Your college shows ${official.letter}; we estimate ${ours}. Enter the official percent for a closer match.` };
}

/** How far to shift targets so our math reproduces the college's number. Only when it gave a percent. */
export function calibrationOffset(estimate: number | null, official: OfficialGrade | null | undefined): number {
  if (estimate == null || official?.percent == null) return 0;
  return Math.max(-15, Math.min(15, official.percent - estimate));
}
