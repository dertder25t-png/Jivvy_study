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

/**
 * New cards to learn per day for a set with no test date (a set with one gets its share from the study
 * plan instead): the set spread over about ten days, never fewer than 10 a day.
 */
export function dailyNewCards(setSize: number): number {
  return Math.max(10, Math.ceil(setSize / 10));
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'and', 'or', 'in', 'on', 'at', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its',
  'that', 'this', 'for', 'as', 'by', 'with', 'from', 'which', 'who', 'has', 'have', 'had',
]);

/** Lowercase, no accents or punctuation, split into words. */
function words(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9\u00c0-\uffff]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 0);
}

/** The words worth checking: filler words dropped (unless that would leave nothing). */
function keyWords(text: string): string[] {
  const all = words(text);
  const key = all.filter((w) => !STOPWORDS.has(w));
  return key.length > 0 ? key : all;
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/** Same word, allowing a typo (more for longer words) or a plural "s". */
function sameWord(typed: string, actual: string): boolean {
  if (typed === actual) return true;
  if (typed + 's' === actual || actual + 's' === typed) return true;
  const len = Math.max(typed.length, actual.length);
  const allowed = len >= 9 ? 2 : len >= 5 ? 1 : 0;
  return allowed > 0 && editDistance(typed, actual) <= allowed;
}

/**
 * How many seconds the answer stays up for copying before Learn hides it: a short floor, then more time the
 * longer the answer (mostly) and the prompt are, so a long definition isn't gone before you can read it.
 */
export function copyTimeSeconds(answer: string, prompt = ''): number {
  const secs = 4 + answer.trim().length * 0.12 + prompt.trim().length * 0.03;
  return Math.min(60, Math.max(4, Math.round(secs)));
}

export type AnswerVerdict = 'right' | 'close' | 'wrong';
export interface AnswerCheck {
  verdict: AnswerVerdict;
  /** Share of the answer's key words that were typed (0-1). */
  score: number;
  /** Key words of the answer that weren't typed. */
  missing: string[];
}

/**
 * Checks a typed answer against the real one — what happens when you hit Enter. Case, punctuation, accents,
 * filler words, word order and small typos don't matter. A short answer (a term, up to three key words) has
 * to be all there; a long one (a definition) is right at 80% of its key words and "almost" at 60%.
 */
export function checkAnswer(typed: string, actual: string): AnswerCheck {
  const target = keyWords(actual);
  if (target.length === 0) return { verdict: 'right', score: 1, missing: [] };
  const given = keyWords(typed);
  if (given.length === 0) return { verdict: 'wrong', score: 0, missing: target };

  const pool = [...given];
  const missing: string[] = [];
  for (const w of target) {
    const at = pool.findIndex((g) => sameWord(g, w));
    if (at >= 0) pool.splice(at, 1);
    else missing.push(w);
  }
  const score = (target.length - missing.length) / target.length;
  // Typing far more than the answer holds isn't recall, it's a word dump.
  const dump = given.length > target.length * 2.5 + 3;
  let verdict: AnswerVerdict;
  if (target.length <= 3) verdict = score === 1 && !dump ? 'right' : 'wrong';
  else verdict = dump ? 'wrong' : score >= 0.8 ? 'right' : score >= 0.6 ? 'close' : 'wrong';
  return { verdict, score, missing };
}

/** Calculate typing accuracy: the share of the answer's key words that were typed. */
export function calculateTypingAccuracy(typed: string, actual: string): number {
  return checkAnswer(typed, actual).score;
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

/** A well-mixed 32-bit hash (FNV-1a, then an avalanche step), so seeded shuffles look random. */
function mix(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A fresh seed for a new shuffled order. */
export function newShuffleSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * The order Learn goes through a set. Normally the order the cards were made in (the note's order);
 * with a shuffle seed, a random order — the same on every device for the same seed.
 */
export function learnOrder(cards: Card[], shuffleSeed?: string | null): Card[] {
  if (shuffleSeed) {
    return [...cards].sort((a, b) => mix(`${shuffleSeed}:${a.id}`) - mix(`${shuffleSeed}:${b.id}`) || a.id.localeCompare(b.id));
  }
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
 * A pocket (a day's session) from every card due for review and every new card that's up today, interleaved
 * review, new, review, new… in proportion — so neither a pile of overdue reviews nor a run of new cards
 * wears you out, and a backlog after missed days can't push new cards out. Nothing is cut: how many cards
 * a day needs is worked out before this (the study plan, or `dailyNewCards`), not by a size you pick.
 */
export function mixPocket(reviews: readonly string[], fresh: readonly string[]): string[] {
  const out: string[] = [];
  let r = 0;
  let n = 0;
  while (r < reviews.length || n < fresh.length) {
    const takeNew = r >= reviews.length || (n < fresh.length && n * reviews.length < r * fresh.length);
    out.push(takeNew ? fresh[n++] : reviews[r++]);
  }
  return out;
}

/**
 * Where to pick up: the pocket you were partway through (minus any cards deleted since), or else a new
 * one — first the learned cards that are due for review (`due`, most overdue first), so nothing learned
 * early slips away before the test, then the new cards that are up today.
 */
export function resumePoint(
  orderedIds: string[],
  progress: Pick<LearnProgress, 'done' | 'pocket' | 'pocket_started_at'>,
  due: readonly string[] = [],
  /**
   * With a study plan (a test date): exactly which new cards may go into a pocket today, in order, and
   * `due` is every card that's due for review (studied here or anywhere else). Without a plan, new cards
   * are the ones not learned yet this round, and only cards learned here count as reviews.
   */
  planned?: readonly string[],
  /** Start of the user's day: a pocket begun before it is stale (missed days) and is rebuilt, not resumed. */
  startOfToday?: Date,
  /** Without a plan: the new cards to learn today (default: every card not learned yet this round). */
  newToday?: readonly string[],
): ResumePoint {
  const inSet = new Set(orderedIds);
  const learnedIds = orderedIds.filter((id) => progress.done[id]);
  const saved = progress.pocket.filter((id) => inSet.has(id));
  const stale = startOfToday != null && progress.pocket_started_at != null && Date.parse(progress.pocket_started_at) < startOfToday.getTime();
  const resuming = !stale && saved.some((id) => !finishedInPocket(progress, id));
  const dueNow = due.filter((id) => inSet.has(id) && (planned || progress.done[id]));
  const dueSet = new Set(dueNow);

  let pocket: string[];
  let queue: string[];
  if (resuming) {
    pocket = saved;
    queue = saved.filter((id) => !finishedInPocket(progress, id));
  } else {
    const fresh = planned ? planned.filter((id) => inSet.has(id) && !dueSet.has(id)) : (newToday ?? orderedIds).filter((id) => inSet.has(id) && !progress.done[id]);
    pocket = mixPocket(dueNow, fresh);
    queue = pocket;
  }
  // A review = a card studied before this pocket: still waiting in it, or finished in it as a review.
  const isReview = (id: string) =>
    planned
      ? dueSet.has(id) || Boolean(progress.done[id]?.review && finishedInPocket(progress, id))
      : Boolean(progress.done[id]) && (!resuming || !finishedInPocket(progress, id) || Boolean(progress.done[id].review));
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

/**
 * Cards due for review by the end of today: the ones learned in Learn (`done`), or — with `done` null, when a
 * study plan is in charge — every card that's been studied anywhere. Cards that lapsed come first, then the
 * most overdue. A card already passed (Good or Easy) since `startOfToday` isn't served again the same day,
 * even if the test is close enough that its next review lands before midnight.
 */
export function dueForReview(
  cards: CardWithReviews[],
  done: Record<string, LearnMark> | null,
  endOfToday: Date,
  startOfToday?: Date,
): string[] {
  return cards
    .filter((k) => (done === null || done[k.card.id]) && k.reviews.length > 0)
    .map((k) => ({ id: k.card.id, s: stateFromReviews(k.reviews) }))
    .filter(({ s }) => !(startOfToday && s.lastRating != null && s.lastRating > 1 && s.lastReviewedAt && s.lastReviewedAt.getTime() >= startOfToday.getTime()))
    .map(({ id, s }) => ({ id, lapsed: s.lastRating === 1, dueAt: s.dueAt?.getTime() ?? 0 }))
    .filter((x) => x.dueAt < endOfToday.getTime())
    .sort((a, b) => Number(b.lapsed) - Number(a.lapsed) || a.dueAt - b.dueAt)
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
