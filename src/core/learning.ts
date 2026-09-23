/**
 * Learn mode: works through a set in "pockets" of active-recall typing practice, and remembers
 * where you are (a LearnProgress row, synced like everything else) so it picks up where you left
 * off — on any device — instead of starting over.
 */
import type { Card, LearnDirection, LearnMark, LearnProgress, Rating } from '@/types/db';
import { stateFromReviews, type CardWithReviews } from './scheduling';

/** Which side of the card gets typed. 'mixed' picks a side per card, deterministically. */
export type StudyDirection = LearnDirection;

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Resolves 'mixed' to a concrete direction for a specific card, stable across re-renders. */
export function directionForCard(direction: StudyDirection, cardId: string): 'term_to_def' | 'def_to_term' {
  if (direction !== 'mixed') return direction;
  return hashCode(cardId) % 2 === 0 ? 'term_to_def' : 'def_to_term';
}

/**
 * Learn mode's self-rating, mapped onto the same 1-4 scale the spaced-repetition schedule uses.
 * "Struggling" means you couldn't recall it, so it counts as a miss ("again"): the card comes back
 * later in the same pocket, and on the following days it starts over at short gaps — rather than being
 * treated as known and pushed further out.
 */
export function gradeToRating(grade: 'easy' | 'good' | 'struggling'): Rating {
  return grade === 'easy' ? 4 : grade === 'good' ? 3 : 1;
}

export interface PocketRecommendation {
  recommended: number;
  min: number;
  max: number;
  rationale: string;
}

/**
 * Recommend pocket size based on total cards and days remaining until exam.
 * Returns a recommended size (user can override), plus min/max constraints.
 */
export function calculateRecommendedPocketSize(
  totalCards: number,
  examDate: Date | null,
  now: Date,
): PocketRecommendation {
  if (totalCards <= 0) {
    return { recommended: 1, min: 1, max: 1, rationale: 'No cards available' };
  }

  if (!examDate) {
    // No exam date: recommend 10-15 cards as a comfortable study pocket
    const recommended = Math.min(12, Math.max(1, totalCards));
    return {
      recommended,
      min: 1,
      max: totalCards,
      rationale: `Study ${recommended} cards at a time (no exam scheduled)`,
    };
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysRemaining = Math.ceil((examDate.getTime() - now.getTime()) / msPerDay);

  if (daysRemaining <= 0) {
    // Study today only
    return {
      recommended: Math.min(10, totalCards),
      min: 1,
      max: totalCards,
      rationale: 'Study all remaining cards today before exam',
    };
  }

  // Calculate cards per day based on time available
  const baseCardsPerDay = totalCards / daysRemaining;
  let recommended = Math.ceil(baseCardsPerDay);

  // Cap within reasonable range (3-30 cards per pocket)
  recommended = Math.max(3, Math.min(30, recommended));

  // But don't recommend more than total cards
  recommended = Math.min(recommended, totalCards);

  return {
    recommended,
    min: 1,
    max: totalCards,
    rationale: `${recommended} cards/day over ${daysRemaining} days (${totalCards} to go)`,
  };
}

/**
 * Calculate typing accuracy: how many words matched between typed and actual definition.
 */
export function calculateTypingAccuracy(typed: string, actual: string): number {
  const normalizeText = (text: string) =>
    text
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);

  const typedWords = normalizeText(typed);
  const actualWords = normalizeText(actual);

  if (actualWords.length === 0) return 1;
  if (typedWords.length === 0) return 0;

  let matches = 0;
  const wordMap = new Map<string, number>();

  // Count occurrences in actual definition
  for (const word of actualWords) {
    wordMap.set(word, (wordMap.get(word) ?? 0) + 1);
  }

  // Count matches (up to the count in actual)
  for (const word of typedWords) {
    if (wordMap.has(word) && wordMap.get(word)! > 0) {
      matches++;
      wordMap.set(word, wordMap.get(word)! - 1);
    }
  }

  return matches / actualWords.length;
}

// ---------------------------------------------------------------- progress

export interface LearnScope {
  noteId?: string | null;
  examId?: string | null;
  courseId?: string | null;
  topicIds?: string[];
}

/** Names the cards a Learn session covers, so its progress can be found again on any device. */
export function learnScopeKey(scope: LearnScope): string {
  const parts: string[] = [];
  if (scope.noteId) parts.push(`note:${scope.noteId}`);
  if (scope.examId) parts.push(`exam:${scope.examId}`);
  if (scope.courseId) parts.push(`course:${scope.courseId}`);
  for (const t of [...(scope.topicIds ?? [])].sort()) parts.push(`topic:${t}`);
  return parts.join('|') || 'all';
}

/** Learn goes through a set in the order its cards were made (the note's order) — the same on every device. */
export function learnOrder(cards: Card[]): Card[] {
  return [...cards].sort(
    (a, b) =>
      Date.parse(a.created_at) - Date.parse(b.created_at) ||
      (a.source_span_start ?? 0) - (b.source_span_start ?? 0) ||
      a.id.localeCompare(b.id),
  );
}

export interface ResumePoint {
  /** The pocket to work on, in order (finished cards included, so "3 of 10 done" reads right). */
  pocket: string[];
  /** The pocket's cards not finished yet, in order. */
  queue: string[];
  /** True when this pocket was just picked and hasn't been saved yet. */
  isNew: boolean;
  /** Of the pocket: spaced reviews of cards already learned, and brand-new cards. */
  reviews: number;
  fresh: number;
  /** Cards of the set learned this round, and how many haven't been yet. */
  learned: number;
  remaining: number;
  total: number;
  /** Everything learned and nothing due for review right now. */
  complete: boolean;
}

/** Finished in the current pocket = graded after it started. */
export function finishedInPocket(progress: Pick<LearnProgress, 'done' | 'pocket_started_at'>, id: string): boolean {
  const mark = progress.done[id];
  if (!mark) return false;
  return Date.parse(mark.at) >= (progress.pocket_started_at ? Date.parse(progress.pocket_started_at) : 0);
}

/**
 * Where to pick up: the pocket you were partway through (minus any cards deleted since), or else a new
 * one — first the learned cards that are due for review (`due`, most overdue first), so nothing learned
 * early slips away before the test, then the next cards you haven't learned yet, up to `pocket_size`.
 */
export function resumePoint(
  orderedIds: string[],
  progress: Pick<LearnProgress, 'done' | 'pocket' | 'pocket_size' | 'pocket_started_at'>,
  due: readonly string[] = [],
): ResumePoint {
  const inSet = new Set(orderedIds);
  const learnedIds = orderedIds.filter((id) => progress.done[id]);
  const saved = progress.pocket.filter((id) => inSet.has(id));
  const resuming = saved.some((id) => !finishedInPocket(progress, id));

  let pocket: string[];
  let queue: string[];
  if (resuming) {
    pocket = saved;
    queue = saved.filter((id) => !finishedInPocket(progress, id));
  } else {
    const dueLearned = due.filter((id) => inSet.has(id) && progress.done[id]);
    const unlearned = orderedIds.filter((id) => !progress.done[id]);
    pocket = [...dueLearned, ...unlearned].slice(0, Math.max(1, progress.pocket_size));
    queue = pocket;
  }
  // A review = a card learned before this pocket: still waiting in it, or finished in it as a review.
  const isReview = (id: string) =>
    Boolean(progress.done[id]) && (!resuming || !finishedInPocket(progress, id) || Boolean(progress.done[id].review));
  const reviews = pocket.filter(isReview).length;
  return {
    pocket,
    queue,
    isNew: !resuming && pocket.length > 0,
    reviews,
    fresh: pocket.length - reviews,
    learned: learnedIds.length,
    remaining: orderedIds.length - learnedIds.length,
    total: orderedIds.length,
    complete: pocket.length === 0,
  };
}

/** Learned cards that are due for review by the end of today, most overdue first. */
export function dueForReview(cards: CardWithReviews[], done: Record<string, LearnMark>, endOfToday: Date): string[] {
  return cards
    .filter((k) => done[k.card.id] && k.reviews.length > 0)
    .map((k) => ({ id: k.card.id, dueAt: stateFromReviews(k.reviews).dueAt?.getTime() ?? 0 }))
    .filter((x) => x.dueAt < endOfToday.getTime())
    .sort((a, b) => a.dueAt - b.dueAt)
    .map((x) => x.id);
}

/** When the next learned card comes due (for "next review tomorrow" once everything is done). */
export function nextReviewAt(cards: CardWithReviews[], done: Record<string, LearnMark>): Date | null {
  let next: number | null = null;
  for (const k of cards) {
    if (!done[k.card.id] || k.reviews.length === 0) continue;
    const at = stateFromReviews(k.reviews).dueAt?.getTime();
    if (at != null && (next == null || at < next)) next = at;
  }
  return next == null ? null : new Date(next);
}

export interface PocketStats {
  completed: number;
  easy: number;
  good: number;
  /** Cards that needed another go before they stuck. */
  retried: number;
  /** Of those completed: spaced reviews vs new cards. */
  reviews: number;
  averageAccuracy: number;
}

/** How a pocket went, from the marks saved as each card was finished in it. */
export function pocketStats(pocket: string[], progress: Pick<LearnProgress, 'done' | 'pocket_started_at'>): PocketStats {
  const marks = pocket.filter((id) => finishedInPocket(progress, id)).map((id) => progress.done[id]);
  return {
    completed: marks.length,
    easy: marks.filter((m) => m.grade === 'easy').length,
    good: marks.filter((m) => m.grade === 'good').length,
    retried: marks.filter((m) => (m.misses ?? 0) > 0 || m.grade === 'struggling').length,
    reviews: marks.filter((m) => m.review).length,
    averageAccuracy: marks.length > 0 ? marks.reduce((s, m) => s + m.accuracy, 0) / marks.length : 0,
  };
}

/** Cards of a set studied today, and the ones among them you weren't sure of (missed at least once today). */
export function studiedToday(cards: CardWithReviews[], today: string, dayOf: (iso: string) => string): { all: string[]; shaky: string[] } {
  const all: string[] = [];
  const shaky: string[] = [];
  for (const k of cards) {
    const todays = k.reviews.filter((r) => dayOf(r.reviewed_at) === today);
    if (todays.length === 0) continue;
    all.push(k.card.id);
    if (todays.some((r) => r.rating <= 2)) shaky.push(k.card.id);
  }
  return { all, shaky };
}
