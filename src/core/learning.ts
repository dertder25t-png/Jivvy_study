/**
 * Learn mode: works through a set in "pockets" of active-recall typing practice, and remembers
 * where you are (a LearnProgress row, synced like everything else) so it picks up where you left
 * off — on any device — instead of starting over.
 */
import type { Card, LearnDirection, LearnMark, LearnProgress, Rating } from '@/types/db';

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

/** Learn mode's self-rating, mapped onto the same 1-4 scale the spaced-repetition schedule uses. */
export function gradeToRating(grade: 'easy' | 'good' | 'struggling'): Rating {
  return grade === 'easy' ? 4 : grade === 'good' ? 3 : 2;
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
  /** The pocket to work on, in order (finished cards included, so "Card 4 of 10" reads right). */
  pocket: string[];
  /** Index of the first unfinished card in `pocket`. */
  position: number;
  /** Cards of the set finished this round, and how many are left. */
  learned: number;
  remaining: number;
  total: number;
  complete: boolean;
}

/**
 * Where to pick up: the pocket you were partway through (minus any cards deleted since), or else the
 * next `pocket_size` cards you haven't finished this round.
 */
export function resumePoint(orderedIds: string[], progress: Pick<LearnProgress, 'done' | 'pocket' | 'pocket_size'>): ResumePoint {
  const inSet = new Set(orderedIds);
  const finished = (id: string) => Boolean(progress.done[id]);
  const learned = orderedIds.filter(finished).length;
  const saved = progress.pocket.filter((id) => inSet.has(id));
  const pocket = saved.some((id) => !finished(id))
    ? saved
    : orderedIds.filter((id) => !finished(id)).slice(0, Math.max(1, progress.pocket_size));
  return {
    pocket,
    position: Math.max(0, pocket.findIndex((id) => !finished(id))),
    learned,
    remaining: orderedIds.length - learned,
    total: orderedIds.length,
    complete: orderedIds.length > 0 && learned === orderedIds.length,
  };
}

export interface PocketStats {
  completed: number;
  easy: number;
  good: number;
  struggling: number;
  averageAccuracy: number;
}

/** How a pocket went, from the marks saved as you finished each card. */
export function pocketStats(pocket: string[], done: Record<string, LearnMark>): PocketStats {
  const marks = pocket.map((id) => done[id]).filter((m): m is LearnMark => Boolean(m));
  const count = (g: LearnMark['grade']) => marks.filter((m) => m.grade === g).length;
  return {
    completed: marks.length,
    easy: count('easy'),
    good: count('good'),
    struggling: count('struggling'),
    averageAccuracy: marks.length > 0 ? marks.reduce((s, m) => s + m.accuracy, 0) / marks.length : 0,
  };
}
