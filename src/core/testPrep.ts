// Getting ready for a test with flashcards, one day at a time. From the cards in a set (or covered by
// a syllabus exam) and the days left, it works out each day's share: learn some of the cards you
// haven't seen yet, review the ones that are due, and go through everything the day before the test.
// Today's numbers subtract what you've already done today, so a day's plan can actually be finished.
// It feeds the Study tab, the study calendar, and one reminder a day at the student's study time.
import { stateFromReviews, type CardWithReviews } from './scheduling';
import { addDaysYmd, dateStringDayDiff, localDateString, zonedToUtc } from './time';

export interface PrepTarget {
  /** 'note:<id>' for a flashcard set, 'exam:<id>' for a syllabus exam. */
  key: string;
  title: string;
  color: string;
  testAt: Date;
  /** Which cards — also where the study buttons go. */
  scope: { noteId: string } | { examId: string };
  cards: CardWithReviews[];
}

/** learn: new cards + due reviews · final_review: everything, the day before · test_day: a quick run-through. */
export type PrepKind = 'learn' | 'final_review' | 'test_day';

export interface PrepTask {
  target: PrepTarget;
  ymd: string;
  /** 0 = today. */
  dayOffset: number;
  /** Days from this day to the test: 1 = the test is tomorrow. */
  daysToTest: number;
  kind: PrepKind;
  /** Still to do that day. Today's already has what you did today taken off; later days are estimates. */
  newCards: number;
  reviewCards: number;
  /** Today only: done so far today. */
  doneNew: number;
  doneReview: number;
}

export const isPrepDone = (t: PrepTask): boolean => t.newCards === 0 && t.reviewCards === 0;

const DEFAULT_HORIZON_DAYS = 60;

export function planTestPrep(args: { targets: PrepTarget[]; now: Date; tz: string; horizonDays?: number }): PrepTask[] {
  const { targets, now, tz, horizonDays = DEFAULT_HORIZON_DAYS } = args;
  const today = localDateString(now, tz);
  const dayOf = (iso: string) => localDateString(new Date(iso), tz);
  const endOfToday = zonedToUtc(addDaysYmd(today, 1), '00:00', tz).getTime();
  const out: PrepTask[] = [];

  for (const target of targets) {
    const cards = target.cards;
    if (cards.length === 0) continue;
    const daysLeft = dateStringDayDiff(localDateString(target.testAt, tz), today);
    if (daysLeft < 0 || daysLeft > horizonDays) continue;
    if (daysLeft === 0 && target.testAt.getTime() <= now.getTime()) continue; // it's already happened

    const firstDay = (c: CardWithReviews) => (c.reviews.length ? c.reviews.map((r) => dayOf(r.reviewed_at)).sort()[0] : null);
    const touchedToday = (c: CardWithReviews) => c.reviews.some((r) => dayOf(r.reviewed_at) === today);
    const learnedToday = cards.filter((c) => firstDay(c) === today).length;
    const seenBefore = cards.filter((c) => {
      const f = firstDay(c);
      return f !== null && f < today;
    });
    const dueDay = (c: CardWithReviews) => {
      const due = stateFromReviews(c.reviews).dueAt;
      return due ? localDateString(due, tz) : null;
    };

    let unseen = cards.length - seenBefore.length; // as of this morning
    let yesterdaysNew = 0;
    for (let d = 0; d <= daysLeft; d++) {
      const kind: PrepKind = d === daysLeft ? 'test_day' : d === daysLeft - 1 ? 'final_review' : 'learn';
      if (kind === 'test_day' && d > 0) break; // later test days show as the test itself on the calendar
      const ymd = addDaysYmd(today, d);
      // Spread what's unseen over the learning days left, keeping the day before the test for review.
      const newTarget = kind === 'learn' ? Math.ceil(unseen / Math.max(1, daysLeft - 1 - d)) : unseen;

      let newCards: number;
      let reviewCards: number;
      let doneNew = 0;
      let doneReview = 0;
      if (d === 0) {
        doneNew = learnedToday;
        doneReview = seenBefore.filter(touchedToday).length;
        newCards = Math.max(0, newTarget - learnedToday);
        const notYet = seenBefore.filter((c) => !touchedToday(c));
        reviewCards = kind === 'learn'
          ? notYet.filter((c) => (stateFromReviews(c.reviews).dueAt?.getTime() ?? 0) < endOfToday).length
          : notYet.length; // final review / test day: everything you haven't been through yet today
      } else {
        newCards = newTarget;
        const comingDue = cards.filter((c) => c.reviews.length > 0 && dueDay(c) === ymd).length;
        reviewCards = kind === 'learn'
          ? comingDue + yesterdaysNew // cards learned the day before come back the next day
          : cards.length - newTarget;
      }
      reviewCards = Math.min(reviewCards, cards.length);
      yesterdaysNew = d === 0 ? newCards : newTarget;
      unseen = Math.max(0, unseen - newTarget);

      if (newCards + reviewCards + doneNew + doneReview === 0) continue;
      out.push({ target, ymd, dayOffset: d, daysToTest: daysLeft - d, kind, newCards, reviewCards, doneNew, doneReview });
    }
  }

  return out.sort((a, b) => a.ymd.localeCompare(b.ymd) || a.target.testAt.getTime() - b.target.testAt.getTime());
}

// ---------------------------------------------------------------- words

const cardsWord = (n: number) => `${n} card${n === 1 ? '' : 's'}`;

function testWhen(daysToTest: number): string {
  if (daysToTest <= 0) return 'today';
  if (daysToTest === 1) return 'tomorrow';
  return `in ${daysToTest} days`;
}

/** Learn mode takes about three looks' worth of time per new card (read, copy, recall); a review is one. */
export function prepMinutes(t: Pick<PrepTask, 'newCards' | 'reviewCards'>, secondsPerCard: number): number {
  const seconds = (t.newCards * 3 + t.reviewCards) * secondsPerCard;
  return seconds === 0 ? 0 : Math.max(1, Math.round(seconds / 60));
}

/** "Review 12 cards and learn 8 new ones" — what's left of a day's plan, as one sentence. */
export function prepSentence(t: PrepTask): string {
  if (isPrepDone(t)) return t.kind === 'test_day' ? "You've been through everything — good luck!" : 'Done for today — nice work.';
  if (t.kind === 'test_day') {
    return `Test today — a quick run-through of ${cardsWord(t.reviewCards + t.newCards)} before it.`;
  }
  if (t.kind === 'final_review') {
    const extra = t.newCards > 0 ? `, plus the last ${t.newCards} new` : '';
    return `Last review before the test: go through ${t.reviewCards > 0 ? `all ${cardsWord(t.reviewCards)}` : 'your cards'}${extra}.`;
  }
  if (t.newCards > 0 && t.reviewCards > 0) return `Review ${cardsWord(t.reviewCards)} and learn ${t.newCards} new ${t.newCards === 1 ? 'one' : 'ones'}.`;
  if (t.newCards > 0) return `Learn ${t.newCards} new ${t.newCards === 1 ? 'card' : 'cards'}.`;
  return `Review ${cardsWord(t.reviewCards)}.`;
}

/** Short form for the calendar and notifications: "review 12 · 8 new". */
export function prepShort(t: PrepTask): string {
  if (t.kind === 'final_review') return `final review · ${cardsWord(t.reviewCards + t.newCards)}`;
  const parts: string[] = [];
  if (t.reviewCards > 0) parts.push(`review ${t.reviewCards}`);
  if (t.newCards > 0) parts.push(`${t.newCards} new`);
  return parts.join(' · ') || 'done';
}

/** The one reminder for a day, covering every test being studied for. Null when there's nothing left. */
export function prepReminder(tasks: PrepTask[], secondsPerCard: number): { title: string; body: string } | null {
  const todo = tasks.filter((t) => !isPrepDone(t) && t.kind !== 'test_day');
  if (todo.length === 0) return null;
  const minutes = todo.reduce((s, t) => s + prepMinutes(t, secondsPerCard), 0);
  if (todo.length === 1) {
    const t = todo[0];
    const when = testWhen(t.daysToTest);
    if (t.kind === 'final_review') {
      return { title: `Last review before ${t.target.title}`, body: `${prepSentence(t)} The test is ${when}. About ${minutes} min.` };
    }
    return { title: `Study for ${t.target.title} · about ${minutes} min`, body: `${prepSentence(t)} Your test is ${when}.` };
  }
  return {
    title: `Today's study plan · about ${minutes} min`,
    body: todo.map((t) => `${t.target.title}: ${prepShort(t)}`).join(' · '),
  };
}

/** Where a task's buttons go. */
export function prepHref(t: PrepTask, mode: 'learn' | 'review'): string {
  const q = new URLSearchParams();
  if ('noteId' in t.target.scope) q.set('noteId', t.target.scope.noteId);
  else q.set('examId', t.target.scope.examId);
  if (mode === 'review') {
    q.set('order', 'smart');
    q.set('limit', String(Math.max(1, t.kind === 'learn' ? t.reviewCards : t.target.cards.length)));
  }
  return `/cards/${mode}?${q.toString()}`;
}
