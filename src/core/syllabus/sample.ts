// A believable two-course semester, generated relative to "today" so the demo
// is always in week 4 with a crunch week (2 exams + a paper + a project) ahead.
// Used by local demo mode, tests, and the "Try a sample syllabus" button.
import type { ParsedSyllabus } from './types';
import { addDaysYmd, localDateString, weekStartYmd } from '../time';

export interface SampleSemester {
  term: { name: string; starts_on: string; ends_on: string };
  syllabi: ParsedSyllabus[];
}

export function buildSampleSemester(now: Date, tz: string): SampleSemester {
  const today = localDateString(now, tz);
  const week1 = addDaysYmd(weekStartYmd(today), -21); // we're in week 4
  // d(week, dow): dow 1 = Monday … 7 = Sunday
  const d = (week: number, dow: number) => addDaysYmd(week1, (week - 1) * 7 + (dow - 1));
  const year = Number(week1.slice(0, 4));
  const month = Number(week1.slice(5, 7));
  const season = month <= 5 ? 'Spring' : month <= 7 ? 'Summer' : 'Fall';

  const psychTopics = [
    'Introduction & research methods',
    'Biological bases of behavior',
    'Sensation and perception',
    'Learning: classical conditioning',
    'Learning: operant conditioning',
    'Memory',
    'Midterm 1 review',
    'Cognition and language',
    'Human development',
    'Personality',
    'Social psychology',
    'Midterm 2 review',
    'Stress and health',
    'Psychological disorders',
    'Therapy and treatment',
    'Final review',
  ];

  const psych: ParsedSyllabus = {
    course: {
      name: 'Introduction to Psychology',
      code: 'PSY 2301',
      section: '003',
      instructor_name: 'Dr. Reyes',
      instructor_email: 'a.reyes@university.edu',
      term_hint: `${season} ${year}`,
      starts_on: d(1, 1),
      ends_on: d(16, 5),
    },
    meetings: [{ days: ['Tue', 'Thu'], start: '09:30', end: '10:45', location: 'Hall 210' }],
    grade_components: [
      { name: 'Midterm exams', weight: 0.3, expected_count: 2, drop_lowest: 0 },
      { name: 'Final exam', weight: 0.25, expected_count: 1, drop_lowest: 0 },
      { name: 'Quizzes', weight: 0.15, expected_count: 8, drop_lowest: 2 },
      { name: 'Research paper', weight: 0.2, expected_count: 1, drop_lowest: 0 },
      { name: 'Discussion posts', weight: 0.1, expected_count: 10, drop_lowest: 0 },
    ],
    assignments: [
      ...[2, 3, 4, 5, 6, 8, 9, 10].map((w, i) => ({
        title: `Quiz ${i + 1}`,
        type: 'quiz' as const,
        due_date: d(w, 5),
        due_time: '23:59',
        due_week: null,
        due_is_approximate: false,
        points_possible: 10,
        component_name: 'Quizzes',
        estimated_minutes: 30,
      })),
      {
        title: 'Research paper',
        type: 'paper' as const,
        due_date: d(7, 5),
        due_time: '23:59',
        due_week: null,
        due_is_approximate: false,
        points_possible: 100,
        component_name: 'Research paper',
        estimated_minutes: 300,
      },
      ...[2, 4, 6].map((w, i) => ({
        title: `Discussion post ${i + 1}`,
        type: 'discussion' as const,
        due_date: d(w, 3),
        due_time: '23:59',
        due_week: null,
        due_is_approximate: false,
        points_possible: 10,
        component_name: 'Discussion posts',
        estimated_minutes: 30,
      })),
      {
        title: 'Reading: Ch. 8 (Learning)',
        type: 'reading' as const,
        due_date: null,
        due_time: null,
        due_week: 5,
        due_is_approximate: true,
        points_possible: null,
        component_name: null,
        estimated_minutes: 60,
      },
    ],
    exams: [
      { title: 'Midterm 1', date: d(7, 4), time: '09:30', is_cumulative: false, location: 'Hall 210', covers_weeks: [1, 2, 3, 4, 5, 6], covers_topics: [] },
      { title: 'Midterm 2', date: d(12, 4), time: '09:30', is_cumulative: false, location: 'Hall 210', covers_weeks: [8, 9, 10, 11], covers_topics: [] },
      { title: 'Final exam', date: d(16, 4), time: '10:00', is_cumulative: true, location: 'Hall 210', covers_weeks: [], covers_topics: [] },
    ],
    topics: psychTopics.map((title, i) => ({
      week_no: i + 1,
      starts_on: d(i + 1, 1),
      title,
      readings: i === 4 ? 'Ch. 8, pp. 285–320' : `Ch. ${i + 1}`,
    })),
    policies: {
      late: { accepted: true, window_hours: 72, penalty_per_day: 0.1, notes: null },
      attendance: { allowed_absences: 3, penalty: 'Final grade drops one letter for each absence beyond three.' },
      notes: 'The two lowest quiz scores are dropped. Extensions on the research paper are available if you ask before the due date.',
    },
    warnings: [],
  };

  const bio: ParsedSyllabus = {
    course: {
      name: 'General Biology I',
      code: 'BIO 1408',
      section: '01',
      instructor_name: 'Prof. Okafor',
      instructor_email: 'okafor@university.edu',
      term_hint: `${season} ${year}`,
      starts_on: d(1, 1),
      ends_on: d(16, 5),
    },
    meetings: [{ days: ['Mon', 'Wed', 'Fri'], start: '11:00', end: '11:50', location: 'Science 105' }],
    grade_components: [
      { name: 'Exams', weight: 0.5, expected_count: 3, drop_lowest: 0 },
      { name: 'Lab reports', weight: 0.25, expected_count: 5, drop_lowest: 1 },
      { name: 'Quizzes', weight: 0.15, expected_count: 10, drop_lowest: 2 },
      { name: 'Lab project', weight: 0.1, expected_count: 1, drop_lowest: 0 },
    ],
    assignments: [
      ...[2, 4, 6, 9, 11].map((w, i) => ({
        title: `Lab report ${i + 1}`,
        type: 'paper' as const,
        due_date: d(w, 2),
        due_time: '17:00',
        due_week: null,
        due_is_approximate: false,
        points_possible: 50,
        component_name: 'Lab reports',
        estimated_minutes: 150,
      })),
      {
        title: 'Lab project',
        type: 'project' as const,
        due_date: d(7, 2),
        due_time: '17:00',
        due_week: null,
        due_is_approximate: false,
        points_possible: 100,
        component_name: 'Lab project',
        estimated_minutes: 480,
      },
      ...[2, 3, 5, 6, 8].map((w, i) => ({
        title: `Quiz ${i + 1}`,
        type: 'quiz' as const,
        due_date: d(w, 1),
        due_time: '23:59',
        due_week: null,
        due_is_approximate: false,
        points_possible: 10,
        component_name: 'Quizzes',
        estimated_minutes: 25,
      })),
    ],
    exams: [
      { title: 'Exam 1', date: d(7, 3), time: '11:00', is_cumulative: false, location: 'Science 105', covers_weeks: [1, 2, 3, 4, 5, 6], covers_topics: [] },
      { title: 'Exam 2', date: d(12, 3), time: '11:00', is_cumulative: false, location: 'Science 105', covers_weeks: [], covers_topics: [] },
      { title: 'Final exam', date: d(16, 3), time: '11:00', is_cumulative: true, location: 'Science 105', covers_weeks: [], covers_topics: [] },
    ],
    topics: [
      'Scientific method & chemistry of life',
      'Water and macromolecules',
      'Cell structure',
      'Membranes and transport',
      'Cellular respiration',
      'Photosynthesis',
      'Exam 1 review',
      'Cell cycle and mitosis',
      'Meiosis and genetics',
      'DNA replication',
      'Gene expression',
      'Exam 2 review',
      'Evolution',
      'Ecology',
      'Human impact',
      'Final review',
    ].map((title, i) => ({ week_no: i + 1, starts_on: d(i + 1, 1), title, readings: null })),
    policies: {
      late: { accepted: true, window_hours: 48, penalty_per_day: 0.2, notes: null },
      attendance: { allowed_absences: null, penalty: null },
      notes: null,
    },
    warnings: ['Exam 2 topics were not listed in the syllabus.'],
  };

  return {
    term: { name: `${season} ${year}`, starts_on: d(1, 1), ends_on: d(16, 7) },
    syllabi: [psych, bio],
  };
}

/** Notes with real definitional structure, for trying flashcard generation. */
export const SAMPLE_NOTES: Array<{ course: 'PSY 2301' | 'BIO 1408'; topic: RegExp; body: string }> = [
  {
    course: 'PSY 2301',
    topic: /operant/i,
    body: `# Operant conditioning
Learning in which behavior is strengthened or weakened by the consequences that follow it.

**Reinforcement** — a consequence that increases the likelihood of a behavior being repeated.
**Punishment** — a consequence that decreases the likelihood of a behavior being repeated.
- **Positive reinforcement**: adding a pleasant stimulus after a behavior occurs.
- **Negative reinforcement**: removing an unpleasant stimulus after a behavior occurs.

Shaping refers to rewarding successive approximations of a target behavior.
Extinction is the gradual weakening of a learned response when reinforcement stops.

Skinner ran the box experiments with pigeons. Professor said the exam will have two short answers on this.

Schedules of reinforcement:
1. Fixed ratio – reinforcement after a set number of responses
2. Variable ratio – reinforcement after an unpredictable number of responses
3. Fixed interval – reinforcement for the first response after a set time
`,
  },
  {
    course: 'PSY 2301',
    topic: /classical/i,
    body: `## Classical conditioning
Learning that occurs when a neutral stimulus becomes associated with a meaningful one.

**Unconditioned stimulus (US)** — a stimulus that naturally triggers a response without learning.
**Conditioned stimulus (CS)** — a formerly neutral stimulus that now triggers a learned response.
Habituation: a decrease in response to a stimulus that is repeated over time.

| Term | Definition |
|------|------------|
| Acquisition | The initial stage in which a link between the stimuli is formed |
| Spontaneous recovery | The reappearance of an extinguished response after a rest period |
`,
  },
];
