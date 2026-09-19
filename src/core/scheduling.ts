// Review scheduling — SM-2 with one critical change (§6.7): schedule BACKWARD
// from the exam date, not from an abstract forgetting curve.
import type { Card, CardReview, Rating } from '@/types/db';
import { MS } from './time';

export interface SrsState {
  interval_days: number;
  ease: number;
  lapses: number;
  reps: number;
}

export const INITIAL_STATE: SrsState = { interval_days: 0, ease: 2.5, lapses: 0, reps: 0 };
const MIN_EASE = 1.3;
/** Cards should be reviewed at least this long before the exam starts. */
const EXAM_BUFFER_MS = 12 * MS.HOUR;
const AGAIN_MS = 10 * MS.MIN;
const MIN_GAP_MS = 4 * MS.HOUR;

export interface Scheduled {
  interval_days: number;
  ease: number;
  due_at: Date;
  lapses: number;
  reps: number;
  /** True when the exam pulled the review earlier than standard spacing. */
  compressed: boolean;
}

/** Standard modified SM-2 step (no exam awareness). */
export function standardStep(state: SrsState, rating: Rating): { interval_days: number; ease: number; lapses: number; reps: number } {
  if (rating === 1) {
    return { interval_days: AGAIN_MS / MS.DAY, ease: Math.max(MIN_EASE, state.ease - 0.2), lapses: state.lapses + 1, reps: 0 };
  }
  const reps = state.reps + 1;
  let ease = state.ease;
  let interval: number;
  if (rating === 2) {
    ease = Math.max(MIN_EASE, ease - 0.15);
    interval = state.interval_days < 1 ? 1 : state.interval_days * 1.2;
  } else if (rating === 3) {
    interval = state.reps === 0 || state.interval_days < 1 ? 1 : state.reps === 1 ? 3 : state.interval_days * ease;
  } else {
    ease += 0.15;
    interval = state.reps === 0 || state.interval_days < 1 ? 3 : state.interval_days * ease * 1.3;
  }
  return { interval_days: interval, ease, lapses: state.lapses, reps };
}

/**
 * Studying AHEAD of schedule must never hurt you: an early "good" or "easy" leaves the card's due date
 * exactly where it was (no inflated interval from cramming, no shrinking either). Only a lapse ("again")
 * or a "hard" changes anything. Reviews on or near the due date use the normal SM-2 step.
 */
export function isEarly(state: SrsState, now: Date, dueAt: Date | null | undefined): boolean {
  if (!dueAt) return false;
  const remaining = dueAt.getTime() - now.getTime();
  return remaining > Math.max(6 * MS.HOUR, 0.25 * state.interval_days * MS.DAY);
}

/**
 * Next review, compressed so it lands before the exam when standard spacing
 * would overshoot. `examAt` is the next upcoming exam covering this card's topic.
 * Pass `opts.dueAt` (the card's current due date) so early reviews are handled as above.
 */
export function nextReview(
  state: SrsState,
  rating: Rating,
  now: Date,
  examAt?: Date | null,
  opts?: { dueAt?: Date | null },
): Scheduled {
  const early = rating !== 1 && isEarly(state, now, opts?.dueAt);
  let step = standardStep(state, rating);
  let due: Date;
  if (early) {
    step = {
      interval_days: state.interval_days,
      ease: rating === 2 ? Math.max(MIN_EASE, state.ease - 0.15) : rating === 4 ? state.ease + 0.05 : state.ease,
      lapses: state.lapses,
      reps: state.reps,
    };
    due = new Date(opts!.dueAt!.getTime());
  } else {
    due = new Date(now.getTime() + step.interval_days * MS.DAY);
  }
  let compressed = false;

  if (rating !== 1 && examAt && examAt.getTime() > now.getTime()) {
    const deadline = examAt.getTime() - EXAM_BUFFER_MS;
    if (due.getTime() > deadline) {
      const window = deadline - now.getTime();
      // Land inside the window; halve it so there is room for another pass.
      const gap = window <= MIN_GAP_MS ? Math.max(0, window) : Math.max(MIN_GAP_MS, window / 2);
      due = new Date(now.getTime() + gap);
      compressed = true;
    }
  }
  return { ...step, due_at: due, compressed };
}

/** Current SRS state for a card, derived from its latest review. */
export function stateFromReviews(reviews: CardReview[]): SrsState & { lastRating: Rating | null; lastReviewedAt: Date | null; dueAt: Date | null } {
  if (reviews.length === 0) return { ...INITIAL_STATE, lastRating: null, lastReviewedAt: null, dueAt: null };
  const sorted = [...reviews].sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at));
  const last = sorted[sorted.length - 1];
  return {
    interval_days: Number(last.interval_days),
    ease: Number(last.ease),
    lapses: sorted.filter((r) => r.rating === 1).length,
    reps: countTrailingSuccesses(sorted),
    lastRating: last.rating,
    lastReviewedAt: new Date(last.reviewed_at),
    dueAt: new Date(last.due_at),
  };
}

function countTrailingSuccesses(sorted: CardReview[]): number {
  let n = 0;
  for (let i = sorted.length - 1; i >= 0 && sorted[i].rating > 1; i--) n++;
  return n;
}

/** 0 (never seen / just failed) → 1 (solid). Used to find the weakest cards first. */
export function cardStrength(reviews: CardReview[], now: Date): number {
  if (reviews.length === 0) return 0;
  const s = stateFromReviews(reviews);
  const base = Math.min(1, s.interval_days / 21);
  const ratingFactor = s.lastRating === 1 ? 0.1 : s.lastRating === 2 ? 0.6 : s.lastRating === 4 ? 1 : 0.85;
  // Overdue reviews decay confidence.
  const overdueDays = s.dueAt ? Math.max(0, (now.getTime() - s.dueAt.getTime()) / MS.DAY) : 0;
  const decay = 1 / (1 + overdueDays / Math.max(1, s.interval_days));
  return Math.max(0, Math.min(1, base * ratingFactor * decay + (s.reps > 0 ? 0.05 : 0)));
}

export interface CardWithReviews {
  card: Card;
  reviews: CardReview[];
}

export function isDue(reviews: CardReview[], now: Date): boolean {
  const s = stateFromReviews(reviews);
  return s.dueAt == null || s.dueAt.getTime() <= now.getTime();
}

export interface ExamTarget {
  examId: string;
  title: string;
  at: Date;
  topicIds: Set<string>;
}

/** The soonest upcoming exam whose coverage includes this topic. */
export function nextExamFor(topicId: string | null, exams: ExamTarget[], now: Date): ExamTarget | null {
  if (!topicId) return null;
  return (
    exams
      .filter((e) => e.at.getTime() > now.getTime() && e.topicIds.has(topicId))
      .sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null
  );
}

/**
 * "Test Thursday — here are the 15 cards you're weakest on."
 * Weakest-first among cards whose topic the exam covers.
 */
export function examReviewQueue(args: {
  cards: CardWithReviews[];
  exam: ExamTarget;
  now: Date;
  limit?: number;
}): CardWithReviews[] {
  const { cards, exam, now, limit = 15 } = args;
  return cards
    .filter((c) => c.card.status !== 'rejected' && c.card.status !== 'pending' && c.card.topic_id && exam.topicIds.has(c.card.topic_id))
    .map((c) => ({ c, strength: cardStrength(c.reviews, now) }))
    .sort((a, b) => a.strength - b.strength)
    .slice(0, limit)
    .map((x) => x.c);
}

/** Cards due right now, most overdue first (outside exam windows). */
export function dueQueue(cards: CardWithReviews[], now: Date, limit = 50): CardWithReviews[] {
  return cards
    .filter((c) => c.card.status !== 'rejected' && c.card.status !== 'pending' && isDue(c.reviews, now))
    .sort((a, b) => {
      const da = stateFromReviews(a.reviews).dueAt?.getTime() ?? 0;
      const db = stateFromReviews(b.reviews).dueAt?.getTime() ?? 0;
      return da - db;
    })
    .slice(0, limit);
}

/** Short label for a rating button, e.g. "3 days" — relative, never a date. */
export function intervalLabel(days: number): string {
  if (days < 1 / 24) return '10 min';
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`;
  if (days < 14) return `${Math.round(days)}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  return `${Math.round(days / 30)}mo`;
}
