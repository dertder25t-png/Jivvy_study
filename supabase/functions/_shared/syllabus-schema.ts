// Single source of truth for the syllabus parse contract.
// Zero imports on purpose: the Deno edge function imports this with a `.ts`
// extension, and the Expo app imports it via src/core/syllabus/types.ts.

/** Bump to invalidate every cached parse and trigger a reparse. */
export const SYLLABUS_PARSE_VERSION = 1;

export const ASSIGNMENT_TYPES = ['reading', 'paper', 'quiz', 'discussion', 'project', 'exam', 'other'] as const;

export interface ParsedSyllabus {
  course: {
    name: string;
    code: string | null;
    section: string | null;
    instructor_name: string | null;
    instructor_email: string | null;
    term_hint: string | null; // e.g. "Fall 2026"
    starts_on: string | null; // YYYY-MM-DD
    ends_on: string | null;
  };
  meetings: Array<{
    days: string[]; // ["Tue","Thu"]
    start: string | null; // HH:MM 24h
    end: string | null;
    location: string | null;
  }>;
  grade_components: Array<{
    name: string;
    weight: number; // 0–1 (0.25 = 25%)
    expected_count: number | null;
    drop_lowest: number;
  }>;
  assignments: Array<{
    title: string;
    type: (typeof ASSIGNMENT_TYPES)[number];
    due_date: string | null; // YYYY-MM-DD
    due_time: string | null; // HH:MM 24h
    due_week: number | null; // "Week 6" with no calendar date
    due_is_approximate: boolean;
    points_possible: number | null;
    component_name: string | null;
    estimated_minutes: number | null;
  }>;
  exams: Array<{
    title: string;
    date: string | null;
    time: string | null;
    is_cumulative: boolean;
    location: string | null;
    covers_weeks: number[];
    covers_topics: string[];
  }>;
  topics: Array<{
    week_no: number | null;
    starts_on: string | null;
    title: string;
    readings: string | null;
  }>;
  policies: {
    late: {
      accepted: boolean | null;
      window_hours: number | null;
      penalty_per_day: number | null; // 0.10 = 10% per day
      notes: string | null;
    };
    attendance: { allowed_absences: number | null; penalty: string | null };
    notes: string | null; // extensions offered, drop rules, anything else worth remembering
  };
  warnings: string[]; // things the parser wasn't sure about
}

const nullable = (type: string) => ({ type: [type, 'null'] });

/**
 * JSON Schema for structured output. Follows the structured-outputs subset:
 * every object closed (`additionalProperties: false`) with all keys required,
 * no min/max constraints; optional values are expressed as nullable.
 */
export const SYLLABUS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['course', 'meetings', 'grade_components', 'assignments', 'exams', 'topics', 'policies', 'warnings'],
  properties: {
    course: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'code', 'section', 'instructor_name', 'instructor_email', 'term_hint', 'starts_on', 'ends_on'],
      properties: {
        name: { type: 'string' },
        code: nullable('string'),
        section: nullable('string'),
        instructor_name: nullable('string'),
        instructor_email: nullable('string'),
        term_hint: nullable('string'),
        starts_on: nullable('string'),
        ends_on: nullable('string'),
      },
    },
    meetings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['days', 'start', 'end', 'location'],
        properties: {
          days: { type: 'array', items: { type: 'string', enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] } },
          start: nullable('string'),
          end: nullable('string'),
          location: nullable('string'),
        },
      },
    },
    grade_components: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'weight', 'expected_count', 'drop_lowest'],
        properties: {
          name: { type: 'string' },
          weight: { type: 'number' },
          expected_count: nullable('integer'),
          drop_lowest: { type: 'integer' },
        },
      },
    },
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title', 'type', 'due_date', 'due_time', 'due_week', 'due_is_approximate',
          'points_possible', 'component_name', 'estimated_minutes',
        ],
        properties: {
          title: { type: 'string' },
          type: { type: 'string', enum: [...ASSIGNMENT_TYPES] },
          due_date: nullable('string'),
          due_time: nullable('string'),
          due_week: nullable('integer'),
          due_is_approximate: { type: 'boolean' },
          points_possible: nullable('number'),
          component_name: nullable('string'),
          estimated_minutes: nullable('integer'),
        },
      },
    },
    exams: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'date', 'time', 'is_cumulative', 'location', 'covers_weeks', 'covers_topics'],
        properties: {
          title: { type: 'string' },
          date: nullable('string'),
          time: nullable('string'),
          is_cumulative: { type: 'boolean' },
          location: nullable('string'),
          covers_weeks: { type: 'array', items: { type: 'integer' } },
          covers_topics: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    topics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['week_no', 'starts_on', 'title', 'readings'],
        properties: {
          week_no: nullable('integer'),
          starts_on: nullable('string'),
          title: { type: 'string' },
          readings: nullable('string'),
        },
      },
    },
    policies: {
      type: 'object',
      additionalProperties: false,
      required: ['late', 'attendance', 'notes'],
      properties: {
        late: {
          type: 'object',
          additionalProperties: false,
          required: ['accepted', 'window_hours', 'penalty_per_day', 'notes'],
          properties: {
            accepted: nullable('boolean'),
            window_hours: nullable('number'),
            penalty_per_day: nullable('number'),
            notes: nullable('string'),
          },
        },
        attendance: {
          type: 'object',
          additionalProperties: false,
          required: ['allowed_absences', 'penalty'],
          properties: { allowed_absences: nullable('integer'), penalty: nullable('string') },
        },
        notes: nullable('string'),
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
} as const;

/** Fill defaults / drop junk so downstream code can trust the shape, even for old cached parses. */
export function coerceParsed(input: unknown): ParsedSyllabus {
  const x = (input ?? {}) as Partial<ParsedSyllabus>;
  const course = (x.course ?? {}) as Partial<ParsedSyllabus['course']>;
  if (!course.name || typeof course.name !== 'string') throw new Error('Parse result has no course name');
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    course: {
      name: course.name,
      code: course.code ?? null,
      section: course.section ?? null,
      instructor_name: course.instructor_name ?? null,
      instructor_email: course.instructor_email ?? null,
      term_hint: course.term_hint ?? null,
      starts_on: course.starts_on ?? null,
      ends_on: course.ends_on ?? null,
    },
    meetings: arr<ParsedSyllabus['meetings'][number]>(x.meetings).map((m) => ({
      days: arr<string>(m.days),
      start: m.start ?? null,
      end: m.end ?? null,
      location: m.location ?? null,
    })),
    grade_components: arr<ParsedSyllabus['grade_components'][number]>(x.grade_components)
      .filter((c) => c && typeof c.name === 'string' && typeof c.weight === 'number')
      .map((c) => ({ ...c, expected_count: c.expected_count ?? null, drop_lowest: c.drop_lowest ?? 0 })),
    assignments: arr<ParsedSyllabus['assignments'][number]>(x.assignments)
      .filter((a) => a && typeof a.title === 'string')
      .map((a) => ({
        title: a.title,
        type: (ASSIGNMENT_TYPES as readonly string[]).includes(a.type) ? a.type : 'other',
        due_date: a.due_date ?? null,
        due_time: a.due_time ?? null,
        due_week: a.due_week ?? null,
        due_is_approximate: !!a.due_is_approximate,
        points_possible: a.points_possible ?? null,
        component_name: a.component_name ?? null,
        estimated_minutes: a.estimated_minutes ?? null,
      })),
    exams: arr<ParsedSyllabus['exams'][number]>(x.exams)
      .filter((e) => e && typeof e.title === 'string')
      .map((e) => ({
        title: e.title,
        date: e.date ?? null,
        time: e.time ?? null,
        is_cumulative: !!e.is_cumulative,
        location: e.location ?? null,
        covers_weeks: arr<number>(e.covers_weeks),
        covers_topics: arr<string>(e.covers_topics),
      })),
    topics: arr<ParsedSyllabus['topics'][number]>(x.topics)
      .filter((t) => t && typeof t.title === 'string')
      .map((t) => ({ week_no: t.week_no ?? null, starts_on: t.starts_on ?? null, title: t.title, readings: t.readings ?? null })),
    policies: {
      late: {
        accepted: x.policies?.late?.accepted ?? null,
        window_hours: x.policies?.late?.window_hours ?? null,
        penalty_per_day: x.policies?.late?.penalty_per_day ?? null,
        notes: x.policies?.late?.notes ?? null,
      },
      attendance: {
        allowed_absences: x.policies?.attendance?.allowed_absences ?? null,
        penalty: x.policies?.attendance?.penalty ?? null,
      },
      notes: x.policies?.notes ?? null,
    },
    warnings: arr<string>(x.warnings),
  };
}
