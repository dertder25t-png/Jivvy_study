// Study plan generation (§5.2): concrete sessions on concrete days, built
// backward from each exam using data already in the DB — coverage, card
// strength per topic, and topics with no notes.
import type { Note, Topic } from '@/types/db';
import { addDaysYmd, dayDiff, localDateString } from './time';
import { cardStrength, type CardWithReviews } from './scheduling';
import { DEFAULT_DAILY_MINUTES } from './estimation';

export interface PlanExam {
  id: string;
  title: string;
  courseId: string;
  at: Date;
  topicIds: string[];
}

export type SessionKind = 'add_notes' | 'review_cards' | 'final_pass';

export interface StudySession {
  date: string; // YYYY-MM-DD in the user's zone
  dayOffset: number; // 0 = today
  minutes: number;
  kind: SessionKind;
  examId: string;
  examTitle: string;
  courseId: string;
  topicIds: string[];
  /** e.g. "Operant conditioning & Extinction cards — your weakest area" */
  what: string;
}

export const HORIZON_DAYS = 21;
const MAX_SESSIONS_PER_EXAM = 5;

function joinTitles(titles: string[]): string {
  if (titles.length <= 2) return titles.join(' & ');
  return `${titles.slice(0, 2).join(', ')} +${titles.length - 2} more`;
}

export function buildStudyPlan(args: {
  exams: PlanExam[];
  topics: Topic[];
  notes: Note[];
  cards: CardWithReviews[];
  now: Date;
  tz: string;
  dailyMinutes?: number;
}): StudySession[] {
  const { exams, topics, notes, cards, now, tz, dailyMinutes = DEFAULT_DAILY_MINUTES } = args;
  const today = localDateString(now, tz);
  const sessions: StudySession[] = [];

  const topicById = new Map(topics.map((t) => [t.id, t]));
  const notedTopics = new Set(notes.filter((n) => n.topic_id && n.body.trim().length >= 40).map((n) => n.topic_id!));

  for (const exam of [...exams].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const daysLeft = dayDiff(exam.at, now, tz);
    if (daysLeft < 1 || daysLeft > HORIZON_DAYS) continue;

    const covered = exam.topicIds.map((id) => topicById.get(id)).filter((t): t is Topic => !!t);
    const strengthOf = (topicId: string) => {
      const ofTopic = cards.filter((c) => c.card.topic_id === topicId && c.card.status !== 'rejected' && c.card.status !== 'pending');
      if (ofTopic.length === 0) return 0;
      return ofTopic.reduce((s, c) => s + cardStrength(c.reviews, now), 0) / ofTopic.length;
    };
    const ranked = covered
      .map((t) => ({ t, strength: strengthOf(t.id), hasCards: cards.some((c) => c.card.topic_id === t.id && c.card.status !== 'rejected' && c.card.status !== 'pending') }))
      .sort((a, b) => a.strength - b.strength);

    const n = Math.min(MAX_SESSIONS_PER_EXAM, daysLeft);
    const firstDay = daysLeft - n; // days from today of the first session
    const buckets: typeof ranked[] = Array.from({ length: Math.max(0, n - 1) }, () => []);
    ranked.forEach((r, i) => buckets[i % Math.max(1, buckets.length)]?.push(r));

    buckets.forEach((bucket, i) => {
      if (bucket.length === 0) return;
      const day = firstDay + i;
      const missingNotes = bucket.filter((b) => !b.hasCards && !notedTopics.has(b.t.id));
      const kind: SessionKind = missingNotes.length === bucket.length ? 'add_notes' : 'review_cards';
      const titles = bucket.map((b) => b.t.title);
      sessions.push({
        date: addDaysYmd(today, day),
        dayOffset: day,
        minutes: kind === 'add_notes' ? 30 : 30,
        kind,
        examId: exam.id,
        examTitle: exam.title,
        courseId: exam.courseId,
        topicIds: bucket.map((b) => b.t.id),
        what:
          kind === 'add_notes'
            ? `Fill in notes: ${joinTitles(titles)} (nothing captured yet)`
            : `${joinTitles(titles)} cards${i === 0 ? ' — your weakest area' : ''}`,
      });
    });

    // Final pass the day before: the weakest cards across everything covered.
    sessions.push({
      date: addDaysYmd(today, daysLeft - 1),
      dayOffset: daysLeft - 1,
      minutes: 40,
      kind: 'final_pass',
      examId: exam.id,
      examTitle: exam.title,
      courseId: exam.courseId,
      topicIds: exam.topicIds,
      what: `Final pass: the cards you're weakest on for ${exam.title}`,
    });
  }

  return levelLoad(sessions, dailyMinutes);
}

/** Push sessions earlier (never onto the past) when a day is over budget. */
function levelLoad(sessions: StudySession[], dailyMinutes: number): StudySession[] {
  const byDay = new Map<number, StudySession[]>();
  for (const s of sessions) byDay.set(s.dayOffset, [...(byDay.get(s.dayOffset) ?? []), s]);

  const days = [...byDay.keys()].sort((a, b) => b - a); // latest first
  for (const day of days) {
    let list = byDay.get(day) ?? [];
    let total = list.reduce((s, x) => s + x.minutes, 0);
    // Move non-final sessions to an earlier day with room.
    for (const s of [...list].filter((x) => x.kind !== 'final_pass')) {
      if (total <= dailyMinutes) break;
      for (let d = day - 1; d >= 0; d--) {
        const load = (byDay.get(d) ?? []).reduce((a, x) => a + x.minutes, 0);
        if (load + s.minutes <= dailyMinutes) {
          list = list.filter((x) => x !== s);
          total -= s.minutes;
          const dayStr = addDaysYmd(s.date, d - day);
          byDay.set(d, [...(byDay.get(d) ?? []), { ...s, dayOffset: d, date: dayStr }]);
          break;
        }
      }
    }
    byDay.set(day, list);
  }
  return [...byDay.values()].flat().sort((a, b) => a.dayOffset - b.dayOffset || a.examId.localeCompare(b.examId));
}
