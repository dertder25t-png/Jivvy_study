/**
 * Learning mode session management & pocket sizing.
 * Organizes cards into "pockets" for active-recall typing practice.
 */

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
    rationale: `${recommended} cards/day over ${daysRemaining} days (${totalCards} total)`,
  };
}

export interface LearnSession {
  cardIds: string[];
  pocketSize: number;
  currentIndex: number;
  completedCards: Map<string, CardTypingAttempt>;
}

export interface CardTypingAttempt {
  cardId: string;
  visibleTyping: string;
  hiddenTyping: string;
  accuracy: number; // 0-1, undefined if not compared
  selfGrade: 'easy' | 'good' | 'struggling' | null; // user's self-rating
  timestamp: number;
}

/**
 * Create a new learning session with the given cards and pocket size.
 */
export function createLearnSession(cardIds: string[], pocketSize: number): LearnSession {
  return {
    cardIds,
    pocketSize: Math.min(pocketSize, cardIds.length),
    currentIndex: 0,
    completedCards: new Map(),
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

/**
 * Record a typing attempt for a card.
 */
export function recordTypingAttempt(
  session: LearnSession,
  cardId: string,
  visibleTyping: string,
  hiddenTyping: string,
  actualDefinition: string,
): CardTypingAttempt {
  const accuracy = calculateTypingAccuracy(hiddenTyping, actualDefinition);
  const attempt: CardTypingAttempt = {
    cardId,
    visibleTyping,
    hiddenTyping,
    accuracy,
    selfGrade: null,
    timestamp: Date.now(),
  };
  session.completedCards.set(cardId, attempt);
  return attempt;
}

/**
 * Update the self-grade for a typing attempt.
 */
export function updateSelfGrade(
  session: LearnSession,
  cardId: string,
  grade: 'easy' | 'good' | 'struggling',
): void {
  const attempt = session.completedCards.get(cardId);
  if (attempt) {
    attempt.selfGrade = grade;
  }
}

/**
 * Get the next pocket of cards (up to pocketSize).
 */
export function getNextPocket(session: LearnSession): string[] {
  const start = session.currentIndex;
  const end = Math.min(start + session.pocketSize, session.cardIds.length);
  return session.cardIds.slice(start, end);
}

/**
 * Check if there are more pockets to study.
 */
export function hasNextPocket(session: LearnSession): boolean {
  return session.currentIndex + session.pocketSize < session.cardIds.length;
}

/**
 * Advance to the next pocket.
 */
export function advanceToPocket(session: LearnSession): void {
  session.currentIndex = Math.min(session.currentIndex + session.pocketSize, session.cardIds.length);
}

/**
 * Get statistics for the completed pocket.
 */
export function getPocketStats(session: LearnSession): {
  completed: number;
  easy: number;
  good: number;
  struggling: number;
  averageAccuracy: number;
} {
  const completed = session.completedCards.size;
  let easy = 0;
  let good = 0;
  let struggling = 0;
  let totalAccuracy = 0;

  for (const attempt of session.completedCards.values()) {
    if (attempt.selfGrade === 'easy') easy++;
    else if (attempt.selfGrade === 'good') good++;
    else if (attempt.selfGrade === 'struggling') struggling++;

    totalAccuracy += attempt.accuracy;
  }

  return {
    completed,
    easy,
    good,
    struggling,
    averageAccuracy: completed > 0 ? totalAccuracy / completed : 0,
  };
}
