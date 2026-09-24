// Row shapes mirror supabase/migrations/0001_init.sql (snake_case on purpose:
// the same objects flow to Postgres and to the local demo store unchanged).

import type { OutlineNode } from '@/core/outline';

export type ISODate = string; // 'YYYY-MM-DD'
export type ISODateTime = string; // full ISO-8601 timestamp

export interface User {
  id: string;
  email: string | null;
  school_id: string | null;
  timezone: string;
  plan: string;
  created_at: ISODateTime;
}

export interface Term {
  id: string;
  user_id: string;
  name: string;
  starts_on: ISODate;
  ends_on: ISODate;
}

export interface ClassMeeting {
  days: string[]; // 'Mon' | 'Tue' | ...
  start: string; // 'HH:MM' 24h
  end: string;
  location?: string | null;
}

/** One rung of a grading scale: the lowest percent that still earns this letter. */
export interface GradeBand {
  letter: string;
  floor: number;
}

/**
 * The grade as shown by the student's college — the official record. We can't read that system,
 * so the student copies it in; ours is only ever an estimate. Either or both fields may be set.
 */
export interface OfficialGrade {
  percent: number | null;
  letter: string | null;
  as_of: ISODateTime;
}

export interface Course {
  id: string;
  user_id: string;
  term_id: string | null;
  name: string;
  code: string | null;
  section: string | null;
  instructor_name: string | null;
  instructor_email: string | null;
  color: string;
  meetings: ClassMeeting[];
  /** Optional (added later): the college's own number, and this course's grading scale. */
  official_grade?: OfficialGrade | null;
  grading_scale?: GradeBand[] | null;
  created_at: ISODateTime;
}

export type ParseStatus = 'pending' | 'ok' | 'partial' | 'failed';

export interface Syllabus {
  id: string;
  course_id: string;
  file_path: string | null;
  content_hash: string | null;
  raw_text: string | null;
  parsed: unknown;
  parse_status: ParseStatus;
  parse_version: number;
  parsed_at: ISODateTime | null;
}

export interface GradeComponent {
  id: string;
  course_id: string;
  name: string;
  weight: number; // 0.25 = 25%
  expected_count: number | null;
  drop_lowest: number;
  source: 'syllabus' | 'manual' | string;
}

export type AssignmentType = 'reading' | 'paper' | 'quiz' | 'exam' | 'discussion' | 'project' | 'other';
export type AssignmentStatus = 'todo' | 'in_progress' | 'submitted' | 'graded' | 'dismissed';

export interface Assignment {
  id: string;
  course_id: string;
  component_id: string | null;
  title: string;
  type: AssignmentType | string;
  due_at: ISODateTime | null;
  due_is_approximate: boolean;
  points_possible: number | null;
  points_earned: number | null;
  status: AssignmentStatus;
  estimated_minutes: number | null;
  actual_minutes: number | null;
  source: 'syllabus' | 'manual' | 'capture' | string;
  created_at: ISODateTime;
}

export interface Exam {
  id: string;
  course_id: string;
  assignment_id: string | null;
  title: string;
  happens_at: ISODateTime;
  is_cumulative: boolean;
  location: string | null;
}

export interface ExamCoverage {
  exam_id: string;
  topic_id: string;
}

export interface Quiz {
  id: string;
  course_id: string;
  assignment_id: string | null;
  title: string;
  type: string | null; // online, paper, in_class, other
  frequency: string | null;
  due_at: ISODateTime | null;
  due_is_approximate: boolean;
  points_possible: number | null;
  created_at: ISODateTime;
}

export interface QuizCoverage {
  quiz_id: string;
  topic_id: string;
}

export interface LatePolicy {
  accepted?: boolean;
  window_hours?: number | null;
  penalty_per_day?: number | null; // 0.10 = 10% per day
  notes?: string | null;
}

export interface AttendancePolicy {
  allowed_absences?: number | null;
  penalty?: string | null;
}

export interface CoursePolicy {
  course_id: string;
  late_policy: LatePolicy;
  attendance_policy: AttendancePolicy;
  notes: string | null;
}

export interface Absence {
  id: string;
  course_id: string;
  happened_on: ISODate;
  excused: boolean;
}

export interface Topic {
  id: string;
  course_id: string;
  week_no: number | null;
  starts_on: ISODate | null;
  ends_on: ISODate | null;
  title: string;
  readings: string | null;
  source: 'syllabus' | 'manual' | string;
}

export interface Note {
  id: string;
  user_id: string;
  course_id: string | null;
  topic_id: string | null;
  /** null for a top-level note; otherwise the note this one is nested under. */
  parent_note_id: string | null;
  title: string | null;
  body: string;
  captured_via: 'widget' | 'voice' | 'share' | 'in_app' | string;
  course_inferred: boolean;
  /** Every note is a bullet outline. `body` holds a mirrored nested-markdown rendering of
   * this tree, kept in sync on every edit, for search/flashcards/export to read as plain text. */
  outline: OutlineNode[] | null;
  /** Optional test date for this set — feeds the days-until-test study pacing in Learn mode. */
  test_date: ISODateTime | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type CardType = 'term_def' | 'cloze';
export type CardStatus = 'pending' | 'accepted' | 'rejected' | 'edited';

export interface Card {
  id: string;
  user_id: string;
  /** null when the card isn't filed under any class — flashcards work standalone. */
  course_id: string | null;
  topic_id: string | null;
  term: string;
  definition: string;
  card_type: CardType;
  cloze_text: string | null;
  origin: 'generated' | 'manual';
  status: CardStatus;
  source_note_id: string | null;
  source_span_start: number | null;
  source_span_end: number | null;
  created_at: ISODateTime;
}

export type QuestionType = 'short_answer' | 'essay' | 'multiple_choice' | 'fill_blank' | 'true_false';
export type QuestionStatus = 'pending' | 'accepted' | 'rejected' | 'edited';

export interface Question {
  id: string;
  user_id: string;
  course_id: string;
  topic_id: string | null;
  quiz_id: string | null;
  concept: string;
  question_type: QuestionType;
  question_text: string;
  answer_text: string | null;
  answer_options: string[] | null; // for multiple choice
  context: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  origin: 'generated' | 'manual';
  status: QuestionStatus;
  source_note_id: string | null;
  source_span_start: number | null;
  source_span_end: number | null;
  created_at: ISODateTime;
}

export type Rating = 1 | 2 | 3 | 4; // again | hard | good | easy

export interface CardReview {
  id: string;
  card_id: string;
  reviewed_at: ISODateTime;
  rating: Rating;
  interval_days: number;
  ease: number;
  due_at: ISODateTime;
}

export type PatternType =
  | 'bold_term'
  | 'colon_def'
  | 'is_defined_as'
  | 'heading_body'
  | 'glossary_row'
  | 'named_list_item'
  | 'parenthetical_def';

export interface GenerationEvent {
  id: string;
  user_id: string;
  card_id: string | null;
  source_note_id: string | null;
  span_start: number | null;
  span_end: number | null;
  candidate_text: string;
  pattern_type: PatternType;
  model: string | null;
  prompt_version: string | null;
  raw_output: unknown;
  auto_rejected_by: string | null;
  user_decision: 'accepted' | 'rejected' | 'edited' | null;
  decided_at: ISODateTime | null;
  created_at: ISODateTime;
}

export interface WaitingOn {
  id: string;
  user_id: string;
  course_id: string | null;
  what: string;
  sent_at: ISODateTime;
  nudge_at: ISODateTime;
  resolved_at: ISODateTime | null;
}

export interface MetricEvent {
  id: string;
  user_id: string;
  kind: string;
  payload: Record<string, unknown>;
  created_at: ISODateTime;
}

export type LearnDirection = 'term_to_def' | 'def_to_term' | 'mixed';
export type LearnGrade = 'easy' | 'good' | 'struggling';

/** How one card went in Learn mode, the last time it was finished there. */
export interface LearnMark {
  grade: LearnGrade;
  /** Share of the answer's words recalled from memory, 0-1. */
  accuracy: number;
  at: ISODateTime;
  /** Times it was missed ("Struggling") before it stuck, in that pocket. */
  misses?: number;
  /** It came back as a spaced review of a card already learned, not as a new card. */
  review?: boolean;
}

/**
 * Where you are in Learn mode for one set of cards, so it picks up where you left off on any
 * device. One row per (user, scope): `scope_key` names the cards ('note:<id>', 'exam:<id>', …).
 */
export interface LearnProgress {
  user_id: string;
  scope_key: string;
  pocket_size: number;
  direction: LearnDirection;
  /** Cards finished this round, by card id. */
  done: Record<string, LearnMark>;
  /** The pocket being worked through, in order (card ids). */
  pocket: string[];
  /** When that pocket started: a card is finished in it once graded after this. null = long ago. */
  pocket_started_at: ISODateTime | null;
  /** Shuffled order: the same seed gives the same order on every device. null = the set's own order. */
  shuffle_seed: string | null;
  /** Goes up each time you start the set over. */
  round: number;
  started_at: ISODateTime;
  updated_at: ISODateTime;
}

/** Every client-visible table, keyed by its Postgres name. */
export interface Tables {
  terms: Term;
  courses: Course;
  syllabi: Syllabus;
  grade_components: GradeComponent;
  assignments: Assignment;
  exams: Exam;
  exam_coverage: ExamCoverage;
  quizzes: Quiz;
  quiz_coverage: QuizCoverage;
  course_policies: CoursePolicy;
  absences: Absence;
  topics: Topic;
  notes: Note;
  cards: Card;
  card_reviews: CardReview;
  questions: Question;
  generation_events: GenerationEvent;
  waiting_on: WaitingOn;
  metric_events: MetricEvent;
  learn_progress: LearnProgress;
}

export type TableName = keyof Tables;
