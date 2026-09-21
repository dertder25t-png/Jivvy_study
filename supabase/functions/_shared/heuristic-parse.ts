// Heuristic syllabus parser — no AI, pure regex and keyword matching.
// Designed for ~80% accuracy on typical syllabi; requires user confirmation before saving.

import type { ParsedSyllabus } from './syllabus-schema.ts';

interface HeuristicContext {
  text: string;
  termStarts?: string; // YYYY-MM-DD
  termEnds?: string;
  timezone?: string;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_PATTERNS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT = ['M', 'T', 'W', 'R', 'Th', 'F', 'Sa', 'Su'];

/** Extract course name (usually in title or early paragraphs). */
function extractCourseName(text: string): string {
  // Look for "CS 101: Introduction to..." or similar
  const patterns = [
    /^[A-Z]{2,4}\s+\d{3,4}[A-Z]?\s*[-:]\s*(.+?)$/m,
    /^Course:\s*(.+?)$/m,
    /^Course Name:\s*(.+?)$/m,
    /^# (.+)$/m,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  const lines = text.split('\n').filter((l) => l.trim().length > 0 && l.length < 100);
  return lines[0]?.trim() || 'Untitled Course';
}

/** Extract course code like "CS 101" or "PSYCH 3B". */
function extractCourseCode(text: string): string | null {
  const match = text.match(/^[A-Z]{2,4}\s+\d{3,4}[A-Z]?/m);
  return match?.[0]?.trim() || null;
}

/** Extract instructor name(s). */
function extractInstructor(text: string): { name: string | null; email: string | null } {
  const emailMatch = text.match(/(?:instructor|professor|professor|prof).*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  const email = emailMatch?.[1] || null;

  const patterns = [
    /(?:instructor|professor|prof):\s*(.+?)(?:\n|$)/i,
    /(?:taught by|taught by):\s*(.+?)(?:\n|$)/i,
    /Dr\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
    /Prof\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return { name: match[1].trim(), email };
  }

  return { name: null, email };
}

/** Extract meeting times like "TR 2:00-3:15pm" or "M,W,F 10:00 AM". */
function extractMeetings(text: string): ParsedSyllabus['meetings'] {
  const meetings: ParsedSyllabus['meetings'] = [];

  // Pattern: "TR 2:00-3:15pm" or "MWF 10:00am-11:00am"
  const timePattern =
    /(?:meets?|class(?:\s+times?)?|schedule).*?([MTWRFS]{1,3}|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s+(\d{1,2}):(\d{2})\s*(?:am|pm|-|to)\s*(\d{1,2}):(\d{2})\s*(am|pm)?/gi;

  let match;
  while ((match = timePattern.exec(text)) !== null) {
    const dayStr = match[1].toUpperCase();
    const days = parseDayString(dayStr);
    if (days.length === 0) continue;

    const startHour = parseInt(match[2]);
    const startMin = match[3];
    const endHour = parseInt(match[4]);
    const endMin = match[5];
    const ampm = match[6]?.toLowerCase() || 'am';

    const startTime = formatTime(startHour, startMin, ampm);
    const endTime = formatTime(endHour, endMin, ampm);

    meetings.push({
      days,
      start: startTime,
      end: endTime,
      location: extractLocationNearby(text, match.index) || null,
    });
  }

  return meetings.slice(0, 5); // Max 5 meeting slots
}

function parseDayString(dayStr: string): string[] {
  const days: string[] = [];
  const upper = dayStr.toUpperCase();

  if (upper.match(/M(?!on)/)) days.push('Mon');
  if (upper.match(/T(?!h|u)/)) days.push('Tue');
  if (upper.match(/W/)) days.push('Wed');
  if (upper.match(/R|Th/)) days.push('Thu');
  if (upper.match(/F/)) days.push('Fri');
  if (upper.match(/S(?!u)/)) days.push('Sat');
  if (upper.match(/Su|U/)) days.push('Sun');

  return days;
}

function formatTime(hour: number, min: string, ampm: string): string {
  const h = ampm === 'pm' && hour !== 12 ? hour + 12 : ampm === 'am' && hour === 12 ? 0 : hour;
  return `${String(h).padStart(2, '0')}:${min}`;
}

function extractLocationNearby(text: string, index: number): string | null {
  const snippet = text.substring(index, index + 200);
  const match = snippet.match(/(?:location|room|building):\s*(.+?)(?:\n|$)/i);
  return match?.[1]?.trim() || null;
}

/** Extract grade components like "40% Midterm, 35% Final, 25% Participation". */
function extractGradeComponents(text: string): ParsedSyllabus['grade_components'] {
  const components: ParsedSyllabus['grade_components'] = [];
  const patterns = [/(\d{1,3})%\s+([A-Za-z\s&]+?)(?:\n|,|$)/g, /([A-Za-z\s&]+?):\s*(\d{1,3})%/g];

  const seen = new Set<string>();

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const percent = pattern === patterns[0] ? parseInt(match[1]) : parseInt(match[2]);
      const name = (pattern === patterns[0] ? match[2] : match[1]).trim();

      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());

      if (percent > 0 && percent <= 100 && name.length < 50) {
        components.push({
          name,
          weight: percent / 100,
          expected_count: null,
          drop_lowest: 0,
        });
      }
    }
  }

  // Normalize: if total > 100%, scale down
  const total = components.reduce((sum, c) => sum + c.weight, 0);
  if (total > 1.05) {
    for (const c of components) {
      c.weight = c.weight / total;
    }
  }

  return components.slice(0, 20);
}

/** Extract assignments and deadlines. */
function extractAssignments(text: string): ParsedSyllabus['assignments'] {
  const assignments: ParsedSyllabus['assignments'] = [];

  // Pattern: "Assignment 1: Due Sept 15" or "Quiz 3 - Due 11/22 11:59pm"
  const assignmentPattern =
    /(?:assignment|homework|quiz|project|paper|essay|problem set|ps)\s*#?\s*(\d+|[A-Z])?:?\s*(.+?)(?:\n|$)/gi;

  let match;
  while ((match = assignmentPattern.exec(text)) !== null) {
    const title = match[2].trim();
    const dateMatch = title.match(
      /(?:due|submit|deadline).*?(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})/i,
    );

    const due_date = dateMatch ? extractDate(dateMatch, text) : null;

    assignments.push({
      title,
      type: inferAssignmentType(title),
      due_date,
      due_time: extractTimeFromString(title),
      due_week: extractWeekNumber(title),
      due_is_approximate: !due_date,
      points_possible: extractPoints(title),
      component_name: matchGradeComponent(title, assignments),
      estimated_minutes: null,
    });
  }

  return assignments.slice(0, 50);
}

function extractDate(match: RegExpMatchArray, context: string): string | null {
  // Simplified date extraction; a real implementation would handle month names, year inference, etc.
  if (match[1] && match[2]) {
    const month = parseInt(match[1]);
    const day = parseInt(match[2]);
    const year = match[3] ? (match[3].length === 2 ? '20' + match[3] : match[3]) : '2026';
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

function extractTimeFromString(str: string): string | null {
  const match = str.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!match) return null;
  const hour = parseInt(match[1]);
  const min = match[2];
  const ampm = match[3]?.toLowerCase() || 'am';
  const h = ampm === 'pm' && hour !== 12 ? hour + 12 : ampm === 'am' && hour === 12 ? 0 : hour;
  return `${String(h).padStart(2, '0')}:${min}`;
}

function extractWeekNumber(str: string): number | null {
  const match = str.match(/week\s+(\d+)/i);
  return match ? parseInt(match[1]) : null;
}

function extractPoints(str: string): number | null {
  const match = str.match(/(\d+)\s*(?:points?|pts?|%)/);
  return match ? parseInt(match[1]) : null;
}

function matchGradeComponent(assignmentTitle: string, gradeComponents: ParsedSyllabus['grade_components']): string | null {
  for (const comp of gradeComponents) {
    if (assignmentTitle.toLowerCase().includes(comp.name.toLowerCase())) {
      return comp.name;
    }
  }
  return null;
}

function inferAssignmentType(title: string): (typeof import('./syllabus-schema.ts').ASSIGNMENT_TYPES)[number] {
  const lower = title.toLowerCase();
  if (lower.includes('quiz')) return 'quiz';
  if (lower.includes('paper')) return 'paper';
  if (lower.includes('project')) return 'project';
  if (lower.includes('discussion')) return 'discussion';
  if (lower.includes('reading')) return 'reading';
  if (lower.includes('exam') || lower.includes('test') || lower.includes('final')) return 'exam';
  return 'other';
}

/** Extract exams with dates and coverage. */
function extractExams(text: string): ParsedSyllabus['exams'] {
  const exams: ParsedSyllabus['exams'] = [];

  const examPattern = /(?:exam|final|midterm|test)\s*(?:#\s*)?(\d+|[A-Z])?:?\s*(.+?)(?:\n|$)/gi;

  let match;
  while ((match = examPattern.exec(text)) !== null) {
    const title = match[2].trim();
    const dateMatch = title.match(/(\d{1,2})[\/\-](\d{1,2})/);
    const date = dateMatch ? extractDate(dateMatch, text) : null;
    const time = extractTimeFromString(title);

    const isCumulative = /cumulative|comprehensive|all|entire|semester/i.test(title);
    const coversMatch = title.match(/(?:weeks?|chapters?|topics?).*?(\d+)[–\-]?(\d+)?/i);
    const covers_weeks = coversMatch ? [parseInt(coversMatch[1])] : [];

    exams.push({
      title,
      date,
      time,
      is_cumulative: isCumulative,
      location: null,
      covers_weeks,
      covers_topics: [],
    });
  }

  return exams.slice(0, 10);
}

/** Extract late policies. */
function extractLatePolicies(text: string): ParsedSyllabus['policies']['late'] {
  const latePattern = /(?:late|overdue|tardy|delinquent)\s*(?:work|assignment|submission|policy).*?(.+?)(?:\n\n|\n[A-Z]|$)/is;
  const match = text.match(latePattern);
  const lateText = match?.[1] || '';

  const accepted = /(?:will|can|may)\s+(?:accept|take)/.test(lateText) && !lateText.match(/(?:will\s+)?not\s+(?:accept|take)/);
  const penaltyMatch = lateText.match(/(\d+)%\s+(?:per|each)\s+(?:day|late)/i);
  const penalty_per_day = penaltyMatch ? parseInt(penaltyMatch[1]) / 100 : null;

  const windowMatch = lateText.match(/(\d+)\s*(?:hour|day|week)s?/i);
  const window_hours = windowMatch ? parseInt(windowMatch[1]) * (windowMatch[0].includes('day') ? 24 : 1) : null;

  return {
    accepted: accepted || null,
    window_hours,
    penalty_per_day,
    notes: lateText.substring(0, 200) || null,
  };
}

/** Extract study materials, textbooks, resources. */
function extractStudyMaterials(text: string): string[] {
  const materials: string[] = [];

  // Look for required/recommended readings
  const readingPattern =
    /(?:required|recommended|required reading|assigned|textbook|text|book|material|resource).*?:?\s*(.+?)(?:\n|$)/gi;

  let match;
  while ((match = readingPattern.exec(text)) !== null) {
    const line = match[1].trim();
    if (line.length > 10 && line.length < 300) {
      materials.push(line);
    }
  }

  // Look for URLs to resources
  const urlPattern = /https?:\/\/[^\s)]+/g;
  const urls = text.match(urlPattern) || [];
  materials.push(...urls.slice(0, 10));

  // Look for library/database resources
  const dbPattern = /(?:database|library|access|platform):\s*(.+?)(?:\n|$)/gi;
  while ((match = dbPattern.exec(text)) !== null) {
    materials.push(match[1].trim());
  }

  return [...new Set(materials)].slice(0, 20); // Unique, max 20
}

/** Main heuristic parser. */
export function parseHeuristic(ctx: HeuristicContext): ParsedSyllabus {
  const text = ctx.text;

  const courseName = extractCourseName(text);
  const gradeComponents = extractGradeComponents(text);
  const studyMaterials = extractStudyMaterials(text);

  return {
    course: {
      name: courseName,
      code: extractCourseCode(text),
      section: null,
      instructor_name: extractInstructor(text).name,
      instructor_email: extractInstructor(text).email,
      term_hint: null,
      starts_on: ctx.termStarts || null,
      ends_on: ctx.termEnds || null,
    },
    meetings: extractMeetings(text),
    grade_components: gradeComponents,
    assignments: extractAssignments(text),
    exams: extractExams(text),
    quizzes: [], // Quizzes are tricky; they'll fall into assignments for now
    test_info: {
      formats: [],
      preparation_notes: studyMaterials.join(' | ') || null,
      retake_policy: null,
    },
    topics: [],
    policies: {
      late: extractLatePolicies(text),
      attendance: { allowed_absences: null, penalty: null },
      notes: `Study materials found: ${studyMaterials.length > 0 ? studyMaterials.slice(0, 3).join('; ') : 'none'}`,
    },
    warnings: [
      'This parse used heuristics only (no AI). Please review carefully and edit before saving.',
      `Found ${studyMaterials.length} study materials/resources.`,
      'Dates are best-effort; manually verify assignment due dates and exam dates.',
      'Grade weights may be approximate if not clearly stated.',
    ],
  };
}
