// Study sessions on the student's terms. Nothing here is gated by the review schedule:
// you can study any cards, any time. The schedule only decides what we SUGGEST first,
// and the advice below is information — never a limit.
import type { CardReview } from '@/types/db';
import { cardStrength, isDue, stateFromReviews, type CardWithReviews, type ExamTarget } from './scheduling';
import { MS, dayDiff, relativeTime } from './time';

export const DEFAULT_SECONDS_PER_CARD = 20;

/** Your real pace: median gap between consecutive ratings within a sitting (needs some history). */
export function paceSecondsPerCard(reviews: CardReview[]): number {
  const times = reviews.map((r) => new Date(r.reviewed_at).getTime()).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const g = (times[i] - times[i - 1]) / 1000;
    if (g >= 3 && g <= 120) gaps.push(g); // longer gaps mean you left and came back
  }
  if (gaps.length < 10) return DEFAULT_SECONDS_PER_CARD;
  gaps.sort((a, b) => a - b);
  const mid = gaps[Math.floor(gaps.length / 2)];
  return Math.min(60, Math.max(8, Math.round(mid)));
}

export const minutesFor = (cards: number, pace: number): number => Math.max(1, Math.round((cards * pace) / 60));
export const cardsFor = (minutes: number, pace: number): number => Math.max(1, Math.round((minutes * 60) / pace));

export interface StudyScope {
  courseId?: string | null;
  examId?: string | null;
  noteId?: string | null;
  topicIds?: string[];
}

export type StudyOrder = 'smart' | 'weakest' | 'shuffle';

export const usable = (c: CardWithReviews): boolean => c.card.status === 'accepted' || c.card.status === 'edited';

export function inScope(cards: CardWithReviews[], scope: StudyScope, exams: ExamTarget[]): CardWithReviews[] {
  const examTopics = scope.examId ? exams.find((e) => e.examId === scope.examId)?.topicIds : undefined;
  return cards.filter((c) => {
    if (!usable(c)) return false;
    if (scope.courseId && c.card.course_id !== scope.courseId) return false;
    if (scope.noteId && c.card.source_note_id !== scope.noteId) return false;
    if (scope.topicIds?.length && !(c.card.topic_id && scope.topicIds.includes(c.card.topic_id))) return false;
    if (examTopics && !(c.card.topic_id && examTopics.has(c.card.topic_id))) return false;
    return true;
  });
}

function shuffled<T>(list: T[], rng: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build a session from whatever the student picked. `smart` puts what's due first (most overdue
 * first) and then tops up with the weakest cards that aren't due yet — so studying always has
 * something to offer, even when you're "caught up".
 */
export function buildSession(args: {
  cards: CardWithReviews[];
  scope: StudyScope;
  order: StudyOrder;
  limit: number;
  now: Date;
  examTargets: ExamTarget[];
  rng?: () => number;
}): CardWithReviews[] {
  const { scope, order, limit, now, examTargets, rng = Math.random } = args;
  const pool = inScope(args.cards, scope, examTargets);
  const strength = new Map(pool.map((c) => [c.card.id, cardStrength(c.reviews, now)]));
  // never-seen cards count as "due now", i.e. after anything that has genuinely been waiting
  const dueAt = (c: CardWithReviews) => stateFromReviews(c.reviews).dueAt?.getTime() ?? now.getTime();

  let ordered: CardWithReviews[];
  if (order === 'shuffle') {
    ordered = shuffled(pool, rng);
  } else if (order === 'weakest') {
    ordered = [...pool].sort((a, b) => strength.get(a.card.id)! - strength.get(b.card.id)!);
  } else {
    const due = pool.filter((c) => isDue(c.reviews, now)).sort((a, b) => dueAt(a) - dueAt(b));
    const rest = pool.filter((c) => !isDue(c.reviews, now)).sort((a, b) => strength.get(a.card.id)! - strength.get(b.card.id)!);
    ordered = [...due, ...rest];
  }
  return ordered.slice(0, Math.max(1, limit));
}

export interface PoolStats {
  total: number;
  due: number;
  neverSeen: number;
  /** Not yet solid (unseen or low strength). */
  weak: number;
}

export function poolStats(pool: CardWithReviews[], now: Date): PoolStats {
  return {
    total: pool.length,
    due: pool.filter((c) => isDue(c.reviews, now)).length,
    neverSeen: pool.filter((c) => c.reviews.length === 0).length,
    weak: pool.filter((c) => cardStrength(c.reviews, now) < 0.7).length,
  };
}

const PASSES_TO_SOLID = 3; // roughly how many successful looks a shaky card needs

export interface StudyAdvice {
  stats: PoolStats;
  dueMinutes: number;
  exam: null | {
    title: string;
    when: string;
    daysLeft: number;
    weakCards: number;
    totalMinutes: number;
    perDayMinutes: number;
  };
  lines: string[];
}

/** Friendly, optional guidance: how long things take and how much time is worth spending. */
export function studyAdvice(args: {
  pool: CardWithReviews[];
  examTargets: ExamTarget[];
  now: Date;
  tz: string;
  pace: number;
}): StudyAdvice {
  const { pool, examTargets, now, tz, pace } = args;
  const stats = poolStats(pool, now);
  const dueMinutes = minutesFor(stats.due, pace);
  const lines: string[] = [];

  // the nearest exam (within a month) that this pool actually has cards for
  let exam: StudyAdvice['exam'] = null;
  for (const e of [...examTargets].filter((t) => t.at > now).sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (e.at.getTime() - now.getTime() > 30 * MS.DAY) break;
    const cover = pool.filter((c) => c.card.topic_id && e.topicIds.has(c.card.topic_id));
    if (cover.length === 0) continue;
    const weak = cover.filter((c) => cardStrength(c.reviews, now) < 0.7).length;
    const daysLeft = Math.max(1, dayDiff(e.at, now, tz));
    const totalMinutes = Math.max(1, Math.round((weak * PASSES_TO_SOLID * pace) / 60));
    exam = {
      title: e.title,
      when: relativeTime(e.at, now, tz),
      daysLeft,
      weakCards: weak,
      totalMinutes,
      perDayMinutes: Math.min(45, Math.max(3, Math.ceil(totalMinutes / daysLeft))),
    };
    break;
  }

  if (stats.total === 0) {
    lines.push('No cards here yet. Make some from a note, or add your own.');
  } else if (stats.due > 0) {
    lines.push(`${stats.due} card${stats.due === 1 ? ' is' : 's are'} due — about ${dueMinutes} min to clear them.`);
  } else {
    lines.push("You're all caught up. Studying ahead is fine — it never pushes your reviews further out.");
  }

  if (exam && exam.weakCards > 0) {
    const daily = exam.daysLeft <= 1
      ? `One focused pass of about ${exam.totalMinutes} min is the best use of the time you have.`
      : `About ${exam.totalMinutes} min in total gets your ${exam.weakCards} weaker card${exam.weakCards === 1 ? '' : 's'} solid — roughly ${exam.perDayMinutes} min a day.`;
    lines.push(`${exam.title} is ${exam.when}. ${daily}`);
  } else if (exam) {
    lines.push(`${exam.title} is ${exam.when} and your cards for it look solid. A quick refresher is plenty.`);
  }

  if (stats.total > 0) lines.push(`At your pace (~${pace}s a card) 10 minutes is about ${cardsFor(10, pace)} cards.`);
  return { stats, dueMinutes, exam, lines };
}
