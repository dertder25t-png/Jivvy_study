// Note auto-filing (§5.3). There is no filing step, ever:
//   1. created from inside a course view → that course
//   2. else match "now" against the class meeting schedule → that course + week's topic
//   3. else infer from content keywords vs topic titles / course names → flagged
//      `course_inferred` so it can be confirmed later in a low-friction batch
import type { ClassMeeting, Course, Note, Topic } from '@/types/db';
import { WEEKDAY_NAMES, localDateString, zonedParts } from './time';
import { STOPWORDS, stem, words } from './flashcards/text';

export type RouteMethod = 'explicit' | 'schedule' | 'keywords' | 'none';

export interface Route {
  course_id: string | null;
  topic_id: string | null;
  course_inferred: boolean;
  method: RouteMethod;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Is `now` during (or within a grace window of) one of the meetings? */
export function isInMeeting(meetings: ClassMeeting[], now: Date, tz: string, graceMinutes = 20): boolean {
  const p = zonedParts(now, tz);
  const day = WEEKDAY_NAMES[p.weekday];
  const minutes = p.h * 60 + p.min;
  return meetings.some(
    (m) =>
      m.days.some((d) => d.slice(0, 3).toLowerCase() === day.toLowerCase()) &&
      minutes >= toMinutes(m.start) - graceMinutes &&
      minutes <= toMinutes(m.end) + graceMinutes,
  );
}

/** The topic whose date range covers `ymd`; falls back to the most recently started one. */
export function topicForDate(topics: Topic[], ymd: string): Topic | null {
  const dated = topics.filter((t) => t.starts_on);
  const covering = dated.find((t) => t.starts_on! <= ymd && (t.ends_on ?? t.starts_on!) >= ymd);
  if (covering) return covering;
  const started = dated.filter((t) => t.starts_on! <= ymd).sort((a, b) => (a.starts_on! < b.starts_on! ? 1 : -1));
  return started[0] ?? null;
}

function tokenSet(s: string): Set<string> {
  return new Set(words(s).map((w) => w.toLowerCase()).filter((w) => !STOPWORDS.has(w) && w.length > 2).map(stem));
}

/** Score how strongly `text` relates to a topic title (fraction of title tokens present). */
export function topicMatchScore(text: string, topicTitle: string): number {
  const t = tokenSet(topicTitle);
  if (t.size === 0) return 0;
  const body = tokenSet(text);
  let hit = 0;
  for (const w of t) if (body.has(w)) hit++;
  return hit / t.size;
}

const HONORIFICS = new Set(['dr', 'prof', 'professor', 'mr', 'mrs', 'ms', 'mx']);

/** "Dr. Reyes said…" — an instructor's surname in the text is a strong signal for the course. */
export function mentionsInstructor(text: string, instructorName: string | null): boolean {
  if (!instructorName) return false;
  const names = words(instructorName)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 3 && !HONORIFICS.has(w));
  if (names.length === 0) return false;
  const present = new Set(words(text).map((w) => w.toLowerCase()));
  return names.some((n) => present.has(n));
}

export function routeNote(args: {
  text: string;
  now: Date;
  tz: string;
  courses: Course[];
  topics: Topic[];
  explicitCourseId?: string | null;
}): Route {
  const { text, now, tz, courses, topics, explicitCourseId } = args;
  const today = localDateString(now, tz);
  const topicsFor = (courseId: string) => topics.filter((t) => t.course_id === courseId);

  // 1. explicit
  if (explicitCourseId) {
    const topic = topicForDate(topicsFor(explicitCourseId), today);
    return { course_id: explicitCourseId, topic_id: topic?.id ?? null, course_inferred: false, method: 'explicit' };
  }

  // 2. schedule
  const inClass = courses.filter((c) => isInMeeting(c.meetings ?? [], now, tz));
  if (inClass.length === 1) {
    const c = inClass[0];
    const topic = topicForDate(topicsFor(c.id), today);
    return { course_id: c.id, topic_id: topic?.id ?? null, course_inferred: false, method: 'schedule' };
  }

  // 3. keywords: best topic-title match across all courses, else course name/code
  const candidatePool = inClass.length > 1 ? courses.filter((c) => inClass.includes(c)) : courses;
  let best: { course: Course; topic: Topic | null; score: number } | null = null;
  for (const c of candidatePool) {
    for (const t of topicsFor(c.id)) {
      const score = topicMatchScore(text, t.title);
      if (score >= 0.5 && (!best || score > best.score)) best = { course: c, topic: t, score };
    }
    if (mentionsInstructor(text, c.instructor_name) && (!best || best.score < 0.9)) best = { course: c, topic: null, score: 0.9 };
    const nameScore = Math.max(topicMatchScore(text, c.name), c.code ? topicMatchScore(text, c.code) : 0);
    if (nameScore >= 0.6 && (!best || nameScore > best.score)) best = { course: c, topic: null, score: nameScore };
  }
  if (best) {
    const topic = best.topic ?? topicForDate(topicsFor(best.course.id), today);
    return { course_id: best.course.id, topic_id: topic?.id ?? null, course_inferred: true, method: 'keywords' };
  }

  return { course_id: null, topic_id: null, course_inferred: false, method: 'none' };
}

/** Notes that still need a low-friction confirmation. */
export function needsConfirmation(n: Note): boolean {
  return n.course_id == null || n.course_inferred;
}

/** Topics an exam covers but for which the student has no notes. */
export function coverageGaps(args: {
  topicIds: string[];
  topics: Topic[];
  notes: Note[];
  minChars?: number;
}): Topic[] {
  const { topicIds, topics, notes, minChars = 40 } = args;
  const noted = new Set(notes.filter((n) => n.topic_id && n.body.trim().length >= minChars).map((n) => n.topic_id!));
  return topics.filter((t) => topicIds.includes(t.id) && !noted.has(t.id));
}
