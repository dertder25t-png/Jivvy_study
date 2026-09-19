// Test factories (also handy for the demo seed). Not imported by app code.
import type { Assignment, Card, CardReview, Course, Exam, GradeComponent, Topic } from '@/types/db';

let n = 0;
const id = (p: string) => `${p}-${++n}`;

export function mkCourse(over: Partial<Course> = {}): Course {
  return {
    id: id('course'),
    user_id: 'u1',
    term_id: null,
    name: 'Intro Psychology',
    code: 'PSY 2301',
    section: null,
    instructor_name: 'Dr. Reyes',
    instructor_email: 'reyes@uni.edu',
    color: '#4F46E5',
    meetings: [],
    created_at: '2026-08-20T00:00:00Z',
    ...over,
  };
}

export function mkComponent(course_id: string, over: Partial<GradeComponent> = {}): GradeComponent {
  return {
    id: id('comp'),
    course_id,
    name: 'Exams',
    weight: 0.4,
    expected_count: null,
    drop_lowest: 0,
    source: 'syllabus',
    ...over,
  };
}

export function mkAssignment(course_id: string, over: Partial<Assignment> = {}): Assignment {
  return {
    id: id('asg'),
    course_id,
    component_id: null,
    title: 'Assignment',
    type: 'other',
    due_at: null,
    due_is_approximate: false,
    points_possible: null,
    points_earned: null,
    status: 'todo',
    estimated_minutes: null,
    actual_minutes: null,
    source: 'syllabus',
    created_at: '2026-08-20T00:00:00Z',
    ...over,
  };
}

export function mkExam(course_id: string, over: Partial<Exam> = {}): Exam {
  return {
    id: id('exam'),
    course_id,
    assignment_id: null,
    title: 'Midterm',
    happens_at: '2026-10-15T15:00:00Z',
    is_cumulative: false,
    location: null,
    ...over,
  };
}

export function mkTopic(course_id: string, over: Partial<Topic> = {}): Topic {
  return {
    id: id('topic'),
    course_id,
    week_no: 1,
    starts_on: null,
    ends_on: null,
    title: 'Topic',
    readings: null,
    source: 'syllabus',
    ...over,
  };
}

export function mkCard(course_id: string, over: Partial<Card> = {}): Card {
  return {
    id: id('card'),
    user_id: 'u1',
    course_id,
    topic_id: null,
    term: 'Term',
    definition: 'A definition.',
    card_type: 'term_def',
    cloze_text: null,
    origin: 'manual',
    status: 'accepted',
    source_note_id: null,
    source_span_start: null,
    source_span_end: null,
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

export function mkReview(card_id: string, over: Partial<CardReview> = {}): CardReview {
  return {
    id: id('rev'),
    card_id,
    reviewed_at: '2026-09-10T00:00:00Z',
    rating: 3,
    interval_days: 1,
    ease: 2.5,
    due_at: '2026-09-11T00:00:00Z',
    ...over,
  };
}
