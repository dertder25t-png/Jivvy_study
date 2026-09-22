// Every user-facing mutation lives here so screens stay declarative and the
// spine of the app (syllabus → topics → notes → cards → review) is wired in one place.
import type {
  Absence, Assignment, Card, CardReview, Course, CoursePolicy, Exam, ExamCoverage, Quiz, QuizCoverage, GradeBand, GradeComponent,
  GenerationEvent, Note, Rating, Term, Topic, WaitingOn,
} from '@/types/db';
import type { NormalizedSyllabus } from '@/core/syllabus/normalize';
import { guessTerm, normalizeParse } from '@/core/syllabus/normalize';
import { buildSampleSemester, SAMPLE_NOTES } from '@/core/syllabus/sample';
import type { ParsedSyllabus } from '@/core/syllabus/types';
import { routeNote, topicForDate } from '@/core/notes';
import type { GeneratedItem } from '@/core/flashcards/pipeline';
import { nextExamFor, nextReview, stateFromReviews, type ExamTarget } from '@/core/scheduling';
import { localDateString, MS } from '@/core/time';
import { store } from './store';
import { newId, nowIso } from './id';
import { prefs } from './prefs';

export const COURSE_COLORS = ['#4F46E5', '#0891B2', '#059669', '#D97706', '#DC2626', '#7C3AED', '#DB2777', '#0D9488'];

// ---------------------------------------------------------------- metrics (§9)
export function logMetric(kind: string, payload: Record<string, unknown> = {}) {
  store.insert('metric_events', {
    id: newId(), user_id: store.userId, kind, payload, created_at: nowIso(),
  });
}

// ---------------------------------------------------------------- terms
export function ensureTerm(now: Date): Term {
  const terms = store.all('terms');
  const today = localDateString(now, prefs.get().tz);
  const current =
    terms.find((t) => t.starts_on <= today && today <= t.ends_on) ??
    [...terms].sort((a, b) => (a.ends_on < b.ends_on ? 1 : -1))[0];
  if (current) return current;
  const g = guessTerm(now, prefs.get().tz);
  return store.insert('terms', { id: newId(), user_id: store.userId, ...g });
}

// ---------------------------------------------------------------- syllabus commit
export interface CommitInput {
  normalized: NormalizedSyllabus;
  parsed: ParsedSyllabus | null;
  rawText: string | null;
  contentHash: string | null;
  filePath: string | null;
  cacheHit: boolean;
  /** How many fields the student edited in the confirmation screen (§9 parse accuracy). */
  edits: Record<string, number>;
  termId: string;
}

export function commitSyllabus(input: CommitInput): Course {
  const { normalized: n } = input;
  const created = nowIso();
  const color = COURSE_COLORS[store.all('courses').length % COURSE_COLORS.length];

  const course: Course = {
    id: newId(), user_id: store.userId, term_id: input.termId,
    name: n.course.name, code: n.course.code, section: n.course.section,
    instructor_name: n.course.instructor_name, instructor_email: n.course.instructor_email,
    color, meetings: n.meetings, created_at: created,
  };
  store.insert('courses', course);

  const componentIds = new Map<string, string>();
  const components: GradeComponent[] = n.components.map((c) => {
    const id = newId();
    componentIds.set(c.key, id);
    return {
      id, course_id: course.id, name: c.name, weight: c.weight,
      expected_count: c.expected_count, drop_lowest: c.drop_lowest, source: 'syllabus',
    };
  });
  store.insertMany('grade_components', components);

  const assignmentIds: string[] = [];
  const assignments: Assignment[] = n.assignments.map((a) => {
    const id = newId();
    assignmentIds.push(id);
    return {
      id, course_id: course.id,
      component_id: a.component_key ? componentIds.get(a.component_key) ?? null : null,
      title: a.title, type: a.type, due_at: a.due_at, due_is_approximate: a.due_is_approximate,
      points_possible: a.points_possible, points_earned: null, status: 'todo',
      estimated_minutes: a.estimated_minutes, actual_minutes: null, source: 'syllabus', created_at: created,
    };
  });
  store.insertMany('assignments', assignments);

  const topicIds: string[] = [];
  const topics: Topic[] = n.topics.map((t) => {
    const id = newId();
    topicIds.push(id);
    return {
      id, course_id: course.id, week_no: t.week_no, starts_on: t.starts_on, ends_on: t.ends_on,
      title: t.title, readings: t.readings, source: 'syllabus',
    };
  });
  store.insertMany('topics', topics);

  const exams: Exam[] = [];
  const coverage: ExamCoverage[] = [];
  for (const e of n.exams) {
    const id = newId();
    exams.push({
      id, course_id: course.id, assignment_id: assignmentIds[e.assignment_index] ?? null,
      title: e.title, happens_at: e.happens_at, is_cumulative: e.is_cumulative, location: e.location,
    });
    for (const ti of e.topic_indexes) if (topicIds[ti]) coverage.push({ exam_id: id, topic_id: topicIds[ti] });
  }
  store.insertMany('exams', exams);
  store.insertMany('exam_coverage', coverage);

  const quizzes: Quiz[] = [];
  const quizCoverage: QuizCoverage[] = [];
  for (const q of n.quizzes) {
    const id = newId();
    quizzes.push({
      id, course_id: course.id, assignment_id: null,
      title: q.title, type: q.type, frequency: q.frequency, due_at: q.due_at,
      due_is_approximate: q.due_is_approximate, points_possible: q.points_possible, created_at: created,
    });
    for (const ti of q.topic_indexes) if (topicIds[ti]) quizCoverage.push({ quiz_id: id, topic_id: topicIds[ti] });
  }
  store.insertMany('quizzes', quizzes);
  store.insertMany('quiz_coverage', quizCoverage);

  const policy: CoursePolicy = {
    course_id: course.id, late_policy: n.late_policy, attendance_policy: n.attendance_policy, notes: n.policy_notes,
  };
  store.insert('course_policies', policy);

  store.insert('syllabi', {
    id: newId(), course_id: course.id, file_path: input.filePath, content_hash: input.contentHash,
    raw_text: input.rawText, parsed: input.parsed,
    parse_status: n.issues.some((i) => i.severity === 'warn') ? 'partial' : 'ok',
    parse_version: 1, parsed_at: created,
  });

  logMetric('syllabus_committed', {
    cache_hit: input.cacheHit, edits: input.edits,
    assignments: assignments.length, exams: exams.length, quizzes: quizzes.length, topics: topics.length,
    warnings: n.issues.filter((i) => i.severity === 'warn').length,
  });
  return course;
}

/** The sample semester's term row (created once). */
export function ensureSampleTerm(now: Date): Term {
  const sample = buildSampleSemester(now, prefs.get().tz);
  const existing = store.all('terms').find((t) => t.starts_on === sample.term.starts_on);
  return existing ?? store.insert('terms', { id: newId(), user_id: store.userId, ...sample.term });
}

/** Loads the bundled two-course semester (demo mode / "try a sample"). */
export function addSampleSemester(now: Date): Course[] {
  const tz = prefs.get().tz;
  const sample = buildSampleSemester(now, tz);
  const term = ensureSampleTerm(now);
  const courses = sample.syllabi.map((parsed) =>
    commitSyllabus({
      normalized: normalizeParse(parsed, { term, tz, now }),
      parsed, rawText: null, contentHash: null, filePath: null, cacheHit: false, edits: {}, termId: term.id,
    }),
  );

  seedProgress(courses, now);

  // A couple of realistic notes so flashcard generation can be tried immediately.
  const topics = store.all('topics');
  for (const s of SAMPLE_NOTES) {
    const course = courses.find((c) => c.code === s.course);
    if (!course) continue;
    const topic = topics.find((t) => t.course_id === course.id && s.topic.test(t.title));
    const at = nowIso();
    store.insert('notes', {
      id: newId(), user_id: store.userId, course_id: course.id, topic_id: topic?.id ?? null, parent_note_id: null,
      title: null, body: s.body, captured_via: 'in_app', course_inferred: false, created_at: at, updated_at: at,
    });
  }
  return courses;
}

/**
 * Makes the demo semester feel lived-in rather than punishing: past work is mostly
 * handed in and graded (so grade math has something to show), with one item still inside
 * its late window (salvageable) and one that has lapsed — a gentle taste of the comeback view.
 */
function seedProgress(courses: Course[], now: Date) {
  const scores = [9, 7, 10, 8, 9, 6];
  let i = 0;
  for (const course of courses) {
    const items = store.all('assignments')
      .filter((a) => a.course_id === course.id && a.due_at && new Date(a.due_at) < now)
      .sort((a, b) => a.due_at!.localeCompare(b.due_at!));
    const leaveOpen = new Set<string>();
    if (course.code === 'PSY 2301') {
      const disc = items.filter((a) => a.type === 'discussion');
      if (disc.length > 1) leaveOpen.add(disc[disc.length - 1].id); // still inside the late window
    }
    if (course.code === 'BIO 1408') {
      const lab = items.filter((a) => a.type === 'paper');
      if (lab.length > 1) leaveOpen.add(lab[lab.length - 1].id); // window already closed
    }
    for (const a of items) {
      if (leaveOpen.has(a.id)) continue;
      const possible = a.points_possible ?? 10;
      const pct = (scores[i++ % scores.length] + (a.type === 'paper' ? -0.5 : 0)) / 10;
      recordGrade(a, Math.round(possible * pct * 10) / 10, possible);
    }
  }
}

export function deleteCourse(courseId: string) {
  const course = store.all('courses').find((c) => c.id === courseId);
  if (!course) return;
  const examIds = new Set(store.all('exams').filter((e) => e.course_id === courseId).map((e) => e.id));
  const cardIds = new Set(store.all('cards').filter((c) => c.course_id === courseId).map((c) => c.id));
  store.remove('courses', course); // server cascades; the rest is in-memory housekeeping
  store.purgeLocal('exam_coverage', (r) => examIds.has(r.exam_id));
  store.purgeLocal('card_reviews', (r) => cardIds.has(r.card_id));
  for (const t of ['syllabi', 'grade_components', 'assignments', 'exams', 'course_policies', 'absences', 'topics', 'cards'] as const) {
    store.purgeLocal(t, (r: { course_id: string | null }) => r.course_id === courseId);
  }
  store.patchLocal('notes', (n) => n.course_id === courseId, { course_id: null, topic_id: null });
  store.patchLocal('waiting_on', (w) => w.course_id === courseId, { course_id: null });
}

// ---------------------------------------------------------------- assignments
export function addAssignment(a: Partial<Assignment> & { course_id: string; title: string }): Assignment {
  return store.insert('assignments', {
    id: newId(), component_id: null, type: 'other', due_at: null, due_is_approximate: false,
    points_possible: null, points_earned: null, status: 'todo', estimated_minutes: null,
    actual_minutes: null, source: 'manual', created_at: nowIso(), ...a,
  });
}

export function updateAssignment(a: Assignment, patch: Partial<Assignment>): Assignment {
  return store.update('assignments', a, patch);
}

/** Entering a grade recomputes everything downstream on next render (grade math is derived). */
export function recordGrade(a: Assignment, earned: number, possible: number): Assignment {
  return store.update('assignments', a, { points_earned: earned, points_possible: possible, status: 'graded' });
}

export function dismissAssignment(a: Assignment) {
  return store.update('assignments', a, { status: 'dismissed' });
}

export function dismissMany(list: Assignment[]) {
  for (const a of list) store.update('assignments', a, { status: 'dismissed' });
  logMetric('comeback_dismiss_dead', { count: list.length });
}

export function addAbsence(courseId: string, excused = false): Absence {
  return store.insert('absences', {
    id: newId(), course_id: courseId, happened_on: localDateString(new Date(), prefs.get().tz), excused,
  });
}
export function removeAbsence(a: Absence) {
  store.remove('absences', a);
}

// ---------------------------------------------------------------- notes
export function createNote(args: { body: string; via?: string; explicitCourseId?: string | null; now?: Date }): Note {
  const now = args.now ?? new Date();
  const route = routeNote({
    text: args.body, now, tz: prefs.get().tz,
    courses: store.all('courses'), topics: store.all('topics'), explicitCourseId: args.explicitCourseId,
  });
  const at = now.toISOString();
  const note: Note = {
    id: newId(), user_id: store.userId, course_id: route.course_id, topic_id: route.topic_id, parent_note_id: null,
    title: null, body: args.body, captured_via: args.via ?? 'in_app',
    course_inferred: route.course_inferred, created_at: at, updated_at: at,
  };
  return store.insert('notes', note);
}

/** A note nested under another. Fully inherits the parent's filing — no routing/confirmation step. */
export function createSubNote(parent: Note, body = ''): Note {
  const at = nowIso();
  const note: Note = {
    id: newId(), user_id: store.userId, course_id: parent.course_id, topic_id: parent.topic_id, parent_note_id: parent.id,
    title: null, body, captured_via: 'in_app', course_inferred: false, created_at: at, updated_at: at,
  };
  return store.insert('notes', note);
}

export function saveNote(note: Note, patch: Partial<Pick<Note, 'title' | 'body'>>): Note {
  return store.update('notes', note, { ...patch, updated_at: nowIso() });
}

/** Confirms (or corrects) where an auto-routed note belongs — the low-friction batch step. */
export function fileNote(note: Note, courseId: string | null): Note {
  const topics = store.all('topics').filter((t) => t.course_id === courseId);
  const topic = courseId ? topicForDate(topics, localDateString(new Date(note.created_at), prefs.get().tz)) : null;
  return store.update('notes', note, { course_id: courseId, topic_id: topic?.id ?? null, course_inferred: false });
}

/** Deleting a note promotes its sub-notes to top-level rather than taking them down too. */
export function deleteNote(note: Note) {
  store.patchLocal('notes', (n) => n.parent_note_id === note.id, { parent_note_id: null });
  store.remove('notes', note);
}

// ---------------------------------------------------------------- flashcards
/** Persists a generated batch: pending cards for survivors + a generation_event for EVERY candidate. */
export function saveGeneratedBatch(note: Note, items: GeneratedItem[]): { cards: Card[]; eventIds: Map<string, string> } {
  const at = nowIso();
  const cards: Card[] = [];
  const events: GenerationEvent[] = [];
  const eventIds = new Map<string, string>();

  for (const it of items) {
    let cardId: string | null = null;
    if (it.card && !it.rejectedBy) {
      cardId = newId();
      cards.push({
        id: cardId, user_id: store.userId, course_id: note.course_id, topic_id: note.topic_id,
        term: it.card.term, definition: it.card.definition, card_type: it.card.card_type,
        cloze_text: it.card.cloze_text, origin: 'generated', status: 'pending',
        source_note_id: note.id, source_span_start: it.candidate.span_start,
        source_span_end: it.candidate.span_end, created_at: at,
      });
    }
    const eventId = newId();
    if (cardId) eventIds.set(cardId, eventId);
    events.push({
      id: eventId, user_id: store.userId, card_id: cardId, source_note_id: note.id,
      span_start: it.candidate.span_start, span_end: it.candidate.span_end,
      candidate_text: it.candidate.text, pattern_type: it.pattern_type,
      model: it.model, prompt_version: it.prompt_version, raw_output: it.raw,
      auto_rejected_by: it.rejectedBy, user_decision: null, decided_at: null, created_at: at,
    });
  }
  // Cards first: generation_events.card_id references them.
  store.insertMany('cards', cards);
  store.insertMany('generation_events', events);
  return { cards, eventIds };
}

/** The human approve gate: keep / reject / edit. Every decision is training data. */
export function decideCard(card: Card, decision: 'accepted' | 'rejected' | 'edited', edits?: { term: string; definition: string }) {
  const status = decision;
  const patch: Partial<Card> = { status };
  if (decision === 'edited' && edits) Object.assign(patch, edits);
  store.update('cards', card, patch);
  const ev = store.all('generation_events').find((e) => e.card_id === card.id);
  if (ev) store.update('generation_events', ev, { user_decision: decision, decided_at: nowIso() });
}

export function addManualCard(args: {
  course_id?: string | null;
  topic_id?: string | null;
  source_note_id?: string | null;
  term: string;
  definition: string;
}): Card {
  const courseId = args.course_id ?? null;
  const topics = courseId ? store.all('topics').filter((t) => t.course_id === courseId) : [];
  const topic = args.topic_id ?? topicForDate(topics, localDateString(new Date(), prefs.get().tz))?.id ?? null;
  return store.insert('cards', {
    id: newId(), user_id: store.userId, course_id: courseId, topic_id: topic,
    term: args.term.trim(), definition: args.definition.trim(), card_type: 'term_def', cloze_text: null,
    origin: 'manual', status: 'accepted', source_note_id: args.source_note_id ?? null, source_span_start: null,
    source_span_end: null, created_at: nowIso(),
  });
}

/** Correcting a card you already kept — unlike `decideCard`, this doesn't touch status or eval history. */
export function updateCard(card: Card, patch: { term: string; definition: string }): Card {
  return store.update('cards', card, { term: patch.term.trim(), definition: patch.definition.trim() });
}

export function deleteCard(card: Card) {
  store.remove('cards', card);
  store.purgeLocal('card_reviews', (r) => r.card_id === card.id);
}

export function examTargets(): ExamTarget[] {
  const coverage = store.all('exam_coverage');
  return store.all('exams').map((e) => ({
    examId: e.id, title: e.title, at: new Date(e.happens_at),
    topicIds: new Set(coverage.filter((c) => c.exam_id === e.id).map((c) => c.topic_id)),
  }));
}

/** Rate a card; the next due date is scheduled backward from the exam it feeds. */
export function reviewCard(card: Card, rating: Rating, now = new Date()): CardReview {
  const reviews = store.all('card_reviews').filter((r) => r.card_id === card.id);
  const exam = nextExamFor(card.topic_id, examTargets(), now);
  const state = stateFromReviews(reviews);
  const s = nextReview(state, rating, now, exam?.at, { dueAt: state.dueAt });
  return store.insert('card_reviews', {
    id: newId(), card_id: card.id, reviewed_at: now.toISOString(), rating,
    interval_days: s.interval_days, ease: s.ease, due_at: s.due_at.toISOString(),
  });
}

// ---------------------------------------------------------------- waiting on
export function addWaitingOn(args: { what: string; courseId?: string | null; nudgeInDays?: number }): WaitingOn {
  const now = Date.now();
  return store.insert('waiting_on', {
    id: newId(), user_id: store.userId, course_id: args.courseId ?? null, what: args.what,
    sent_at: new Date(now).toISOString(),
    nudge_at: new Date(now + (args.nudgeInDays ?? 3) * MS.DAY).toISOString(), resolved_at: null,
  });
}
export function resolveWaitingOn(w: WaitingOn) {
  store.update('waiting_on', w, { resolved_at: nowIso() });
}
export function deleteWaitingOn(w: WaitingOn) {
  store.remove('waiting_on', w);
}

// ---------------------------------------------------------------- grading setup
// The college's own system is the official record; these let the student say what it says.
export function setOfficialGrade(course: Course, g: { percent: number | null; letter: string | null } | null): Course {
  const has = g && (g.percent != null || (g.letter && g.letter.trim()));
  logMetric('official_grade_set', { cleared: !has });
  return store.update('courses', course, {
    official_grade: has ? { percent: g!.percent, letter: g!.letter?.trim() || null, as_of: nowIso() } : null,
  });
}

export function setGradingScale(course: Course, scale: GradeBand[] | null): Course {
  const clean = scale
    ?.map((b) => ({ letter: b.letter.trim(), floor: Math.max(0, Math.min(100, b.floor)) }))
    .filter((b) => b.letter);
  return store.update('courses', course, { grading_scale: clean && clean.length > 1 ? clean : null });
}

export function updateComponent(c: GradeComponent, patch: Partial<Pick<GradeComponent, 'name' | 'weight' | 'drop_lowest' | 'expected_count'>>): GradeComponent {
  return store.update('grade_components', c, { ...patch, source: 'manual' });
}

export function addComponent(courseId: string, args: { name: string; weight: number }): GradeComponent {
  return store.insert('grade_components', {
    id: newId(), course_id: courseId, name: args.name.trim(), weight: Math.max(0, Math.min(1, args.weight)),
    expected_count: null, drop_lowest: 0, source: 'manual',
  });
}

export function deleteComponent(c: GradeComponent) {
  store.remove('grade_components', c);
  // assignments keep existing, just unlinked (the server does this via ON DELETE SET NULL)
  store.patchLocal('assignments', (a) => a.component_id === c.id, { component_id: null });
}
