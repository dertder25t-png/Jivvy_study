// Runs the server's syllabus parser (supabase/functions/_shared/heuristic-parse.ts) on realistic
// syllabi. It has no Deno-only imports, so it runs here too.
import { describe, expect, it } from 'vitest';
import { parseHeuristic } from '../../../supabase/functions/_shared/heuristic-parse';
import { coerceParsed } from '../../../supabase/functions/_shared/syllabus-schema';

const PSY = `PSY 2301: Introduction to Psychology
Fall 2026 · Section 004
Instructor: Dr. Maria Reyes  (mreyes@university.edu)
Class meets TR 11:00-12:15pm in Liberal Arts 210

Course description
This course introduces the scientific study of behavior and mental processes. Papers must be typed and
double-spaced. Your final grade is based on the categories below.

Grading
Exams 45%
Quizzes 20%
Research paper 20%
Participation 15%

Assignments
Homework 1: Chapter 1 reading questions, due 9/4 at 11:59pm
Homework 2: Research methods worksheet, due Sep 18
Research Paper: Topic proposal due Oct 2
Quiz 1 - due 9/11
Quiz 2 - due 10/9

Exams
Exam 1: Thursday, September 24 (chapters 1-4)
Midterm Exam: October 22
Final Exam: December 10, 10:30am, cumulative

Late work policy
Late work is accepted up to 3 days late with a 10% per day penalty.
`;

const term = { termStarts: '2026-08-24', termEnds: '2026-12-12' };

describe('syllabus parser on a realistic syllabus', () => {
  const parsed = coerceParsed(parseHeuristic({ text: PSY, ...term, timezone: 'America/Chicago' }));

  it('does not crash when a syllabus lists several assignments', () => {
    expect(parsed.assignments.length).toBeGreaterThanOrEqual(5);
  });

  it('reads the course', () => {
    expect(parsed.course.code).toBe('PSY 2301');
    expect(parsed.course.name).toBe('Introduction to Psychology');
    expect(parsed.course.instructor_email).toBe('mreyes@university.edu');
  });

  it('reads the grade weights', () => {
    const w = Object.fromEntries(parsed.grade_components.map((c) => [c.name, c.weight]));
    expect(w).toEqual({ Exams: 0.45, Quizzes: 0.2, 'Research paper': 0.2, Participation: 0.15 });
  });

  it('keeps the assignment names and reads numeric and month-name due dates in the term year', () => {
    const byTitle = Object.fromEntries(parsed.assignments.map((a) => [a.title, a]));
    expect(byTitle['Homework 1: Chapter 1 reading questions']?.due_date).toBe('2026-09-04');
    expect(byTitle['Homework 1: Chapter 1 reading questions']?.due_time).toBe('23:59');
    expect(byTitle['Homework 2: Research methods worksheet']?.due_date).toBe('2026-09-18');
    expect(byTitle['Research Paper: Topic proposal']?.due_date).toBe('2026-10-02');
    expect(byTitle['Quiz 1']?.type).toBe('quiz');
    expect(byTitle['Quiz 1']?.due_date).toBe('2026-09-11');
  });

  it('links assignments to their grade category', () => {
    const hw = parsed.assignments.find((a) => a.title.startsWith('Quiz 2'));
    expect(hw?.component_name).toBe('Quizzes');
  });

  it('does not invent assignments or exams from ordinary sentences', () => {
    const titles = [...parsed.assignments.map((a) => a.title), ...parsed.exams.map((e) => e.title)];
    expect(titles.some((t) => /must be typed|final grade|categories/i.test(t))).toBe(false);
  });

  it('reads exams with their dates', () => {
    const byTitle = Object.fromEntries(parsed.exams.map((e) => [e.title, e]));
    expect(Object.keys(byTitle).sort()).toEqual(['Exam 1', 'Final Exam', 'Midterm Exam']);
    expect(byTitle['Exam 1'].date).toBe('2026-09-24');
    expect(byTitle['Midterm Exam'].date).toBe('2026-10-22');
    expect(byTitle['Final Exam'].date).toBe('2026-12-10');
    expect(byTitle['Final Exam'].time).toBe('10:30');
    expect(byTitle['Final Exam'].is_cumulative).toBe(true);
  });

  it('uses the right year for a spring term that starts in January', () => {
    const spring = coerceParsed(parseHeuristic({
      text: PSY.replace('Fall 2026', 'Spring 2027').replace('Final Exam: December 10', 'Final Exam: May 6'),
      termStarts: '2027-01-11', termEnds: '2027-05-14',
    }));
    expect(spring.exams.find((e) => e.title === 'Final Exam')?.date).toBe('2027-05-06');
  });
});

const BIO = `BIO 1408 - General Biology I
Spring 2027
Professor: James Okafor, jokafor@college.edu
Lecture: MWF 9:00-9:50am, Science Hall 120

GRADING: Lab reports 25%, Homework 15%, Exams 40%, Final exam 20%

Grading scale: A 90-100%, B 80-89%, C 70-79%

Schedule
Week 1 | Jan 13 | Intro, the scientific method
Week 3 | Jan 27 | Lab Report 1 due
Week 5 | Feb 10 | Exam 1 (chapters 1-5)
Week 9 | Mar 10 | Midterm
Homework 4 due 3/24 by 5pm
Final exam - Monday, May 10, 8:00 AM, Science Hall 120
`;

describe('a syllabus written differently', () => {
  const parsed = coerceParsed(parseHeuristic({ text: BIO, termStarts: '2027-01-11', termEnds: '2027-05-14' }));

  it('reads grade weights written on one line, and ignores the letter-grade scale', () => {
    const w = Object.fromEntries(parsed.grade_components.map((c) => [c.name, c.weight]));
    expect(w).toEqual({ 'Lab reports': 0.25, Homework: 0.15, Exams: 0.4, 'Final exam': 0.2 });
  });

  it('reads deadlines from a schedule table', () => {
    const items = [...parsed.assignments.map((a) => [a.title, a.due_date]), ...parsed.exams.map((e) => [e.title, e.date])];
    expect(items).toEqual(expect.arrayContaining([
      ['Lab Report 1', '2027-01-27'],
      ['Homework 4', '2027-03-24'],
      ['Exam 1', '2027-02-10'],
      ['Midterm', '2027-03-10'],
      ['Final exam', '2027-05-10'],
    ]));
    expect(parsed.assignments.find((a) => a.title === 'Homework 4')?.due_time).toBe('17:00');
  });

  it('reads the course header', () => {
    expect(parsed.course.code).toBe('BIO 1408');
    expect(parsed.course.name).toBe('General Biology I');
    expect(parsed.course.instructor_email).toBe('jokafor@college.edu');
    expect(parsed.course.term_hint).toBe('Spring 2027');
  });
});
