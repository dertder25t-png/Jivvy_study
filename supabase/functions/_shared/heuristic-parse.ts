// Heuristic syllabus parser — no AI, pure regex and keyword matching.
// Designed for ~80% accuracy on typical syllabi; requires user confirmation before saving.

import type { ParsedSyllabus } from './syllabus-schema.ts';

interface HeuristicContext {
  text: string;
  termStarts?: string; // YYYY-MM-DD
  termEnds?: string;
  timezone?: string;
}

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
  const emailMatch = text.match(/(?:instructor|professor|prof)[^\n]*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i)
    ?? text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(?:edu|ac\.[a-z]{2}))/i);
  const email = emailMatch?.[1] || null;

  const patterns = [
    /(?:instructor|professor|prof):\s*(.+?)(?:\n|$)/i,
    /(?:taught by|taught by):\s*(.+?)(?:\n|$)/i,
    /Dr\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
    /Prof\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const name = match[1].replace(/\(?[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\)?/, '').replace(/[\s,;|·-]+$/, '').trim();
      if (name) return { name, email };
    }
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

// ---------------------------------------------------------------- dates & times

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_NAME = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
const NUMERIC_DATE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;
const NAMED_DATE = new RegExp(`\\b${MONTH_NAME}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'i');

interface Found { iso: string; index: number; length: number }

/** The year a month/day falls in, judged by the term (a Spring term's "Jan 15" is next year). */
function yearFor(month: number, day: number, ctx: HeuristicContext): number {
  const starts = ctx.termStarts ? new Date(`${ctx.termStarts}T00:00:00Z`) : null;
  const ends = ctx.termEnds ? new Date(`${ctx.termEnds}T00:00:00Z`) : null;
  const fallback = starts?.getUTCFullYear() ?? new Date().getUTCFullYear();
  if (!starts || !ends) return fallback;
  const slack = 45 * 86_400_000;
  for (const y of [starts.getUTCFullYear(), ends.getUTCFullYear()]) {
    const d = Date.UTC(y, month - 1, day);
    if (d >= starts.getTime() - slack && d <= ends.getTime() + slack) return y;
  }
  return fallback;
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** First date in a line: "9/4", "9/4/26", "Sep 18", "Thursday, September 24, 2026". */
function findDate(line: string, ctx: HeuristicContext): Found | null {
  const hits: Found[] = [];
  const n = line.match(NUMERIC_DATE);
  if (n && n.index !== undefined) {
    const m = parseInt(n[1]);
    const d = parseInt(n[2]);
    const y = n[3] ? parseInt(n[3].length === 2 ? `20${n[3]}` : n[3]) : yearFor(m, d, ctx);
    const v = iso(y, m, d);
    if (v) hits.push({ iso: v, index: n.index, length: n[0].length });
  }
  const w = line.match(NAMED_DATE);
  if (w && w.index !== undefined) {
    const m = MONTHS[w[1].toLowerCase().replace('.', '').slice(0, w[1].toLowerCase().startsWith('sept') ? 4 : 3)];
    const d = parseInt(w[2]);
    const y = w[3] ? parseInt(w[3]) : yearFor(m, d, ctx);
    const v = m ? iso(y, m, d) : null;
    if (v) hits.push({ iso: v, index: w.index, length: w[0].length });
  }
  return hits.sort((a, b) => a.index - b.index)[0] ?? null;
}

/** "11:59pm", "10:30 AM", "5pm", "noon" → "HH:MM". */
function findTime(line: string): string | null {
  if (/\bnoon\b/i.test(line)) return '12:00';
  if (/\bmidnight\b/i.test(line)) return '23:59';
  const m = line.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/i) ?? line.match(/\b(\d{1,2}):(\d{2})\b(?!\s*%)/);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = m[2] ?? '00';
  const ap = m[3]?.toLowerCase().replace(/\./g, '');
  if (h > 23 || parseInt(min) > 59) return null;
  if (ap === 'pm' && h !== 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}

// ---------------------------------------------------------------- lines

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•▪◦·]|\d+[.)])\s+/, '').trim()).filter(Boolean);
}

/**
 * Lines to look for deadlines in. A schedule-table row ("Week 3 | Jan 27 | Lab Report 1 due") is
 * split into its cells, each carrying the row's date, so "Lab Report 1 due (Jan 27)" reads like any other line.
 */
function itemLines(text: string, ctx: HeuristicContext): string[] {
  const out: string[] = [];
  for (const l of lines(text)) {
    const cells = l.split(/\s*(?:\||\t)\s*/).map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) {
      out.push(l);
      continue;
    }
    const dateCell = cells.find((c) => findDate(c, ctx));
    for (const c of cells) {
      if (c === dateCell) continue;
      out.push(dateCell && !findDate(c, ctx) ? `${c} (${dateCell})` : c);
    }
  }
  return out;
}

/** The label before the details: "Homework 1: Chapter 1 questions, due 9/4" → "Homework 1: Chapter 1 questions". */
function titleOf(line: string, ctx: HeuristicContext): string {
  let t = line;
  const due = t.search(/[,;(]?\s*[-–—]?\s*\b(?:due|submit(?:ted)?|deadline|turn(?:ed)? in)\b/i);
  if (due > 0) t = t.slice(0, due);
  else {
    const d = findDate(t, ctx);
    if (d && d.index > 0) t = t.slice(0, d.index).replace(/\b(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\.?,?\s*$/i, '');
  }
  t = t.replace(/[\s,;:(\-–—]+$/, '').replace(/\s*\([^)]*\)\s*$/, '');
  return t.replace(/[\s,;:(\-–—]+$/, '').trim() || line.trim();
}

/** Grading lines ("Exams 45%") and long prose aren't deadlines. */
const isWeightLine = (l: string) => /\d\s*%/.test(l) && !/\bdue\b/i.test(l);

// ---------------------------------------------------------------- grading

/** "Exams 45%", "Quizzes: 20%", "Participation ....... 15%", "20% – Research paper". */
function extractGradeComponents(text: string): ParsedSyllabus['grade_components'] {
  const components: ParsedSyllabus['grade_components'] = [];
  const seen = new Set<string>();
  const NAME = "([A-Za-z][A-Za-z &/'’()-]{1,45}?)";
  const nameFirst = new RegExp(`^${NAME}\\s*[:\\-–—.]*\\s*(\\d{1,3}(?:\\.\\d+)?)\\s*%(?:\\s*\\([^)]*\\))?\\s*$`);
  const pctFirst = new RegExp(`^(\\d{1,3}(?:\\.\\d+)?)\\s*%\\s*[:\\-–—]?\\s*${NAME}\\s*$`);
  // "GRADING: Lab reports 25%, Homework 15%, Exams 40%" → one piece per category.
  const pieces = lines(text).flatMap((l) =>
    (l.match(/%/g) ?? []).length > 1 ? l.replace(/^[A-Za-z ]{2,30}:\s*(?=.*%)/, '').split(/\s*[,;]\s*(?:and\s+)?|\s+and\s+/) : [l],
  );
  for (const l of pieces) {
    let name: string | null = null;
    let pct = 0;
    const a = l.match(nameFirst);
    const b = a ? null : l.match(pctFirst);
    if (a) [name, pct] = [a[1], parseFloat(a[2])];
    else if (b) [name, pct] = [b[2], parseFloat(b[1])];
    if (!name) continue;
    name = name.replace(/\s*\(\s*\d*\s*\)\s*$/, '').replace(/[\s.:–—-]+$/, '').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key) || pct <= 0 || pct > 100 || /^(total|grade|a|b|c|d|f)$/i.test(name)) continue;
    seen.add(key);
    components.push({ name, weight: Math.round(pct * 10) / 1000, expected_count: null, drop_lowest: 0 });
  }
  // A letter-grade scale ("A 90%") isn't grading weights: those sum far past 100%.
  const total = components.reduce((sum, c) => sum + c.weight, 0);
  if (total > 1.5) return [];
  if (total > 1.05) for (const c of components) c.weight = Math.round((c.weight / total) * 1000) / 1000;
  return components.slice(0, 20);
}

/** "Quizzes" ↔ "Quiz 2", "Exams" ↔ "Exam 1", "Research paper" ↔ "Research Paper: proposal". */
function matchGradeComponent(title: string, components: ParsedSyllabus['grade_components']): string | null {
  const t = title.toLowerCase();
  for (const c of components) {
    const stem = c.name.toLowerCase().replace(/zzes$/, 'z').replace(/(?<=[sx]|ch|sh)es$/, '').replace(/s$/, '');
    if (stem.length >= 3 && t.includes(stem)) return c.name;
  }
  return null;
}

// ---------------------------------------------------------------- assignments & exams

const ASSIGNMENT_START =
  /^(?:homework|hw|assignment|quiz|project|research paper|term paper|paper|essay|problem set|pset|lab report|lab|discussion(?: post| board)?|reading response|response paper|presentation|reflection|worksheet|case study|portfolio)\b/i;
const EXAM_START = /^(?:final|mid-?term|exam(?:ination)?|test)\b/i;

function inferAssignmentType(title: string): (typeof import('./syllabus-schema.ts').ASSIGNMENT_TYPES)[number] {
  const lower = title.toLowerCase();
  if (lower.includes('quiz')) return 'quiz';
  if (/paper|essay/.test(lower)) return 'paper';
  if (lower.includes('project')) return 'project';
  if (lower.includes('discussion')) return 'discussion';
  if (lower.includes('reading')) return 'reading';
  if (/\bexam|\btest\b|\bfinal\b/.test(lower)) return 'exam';
  return 'other';
}

/** Is this line a deliverable rather than a sentence that happens to mention one? */
function looksLikeItem(l: string, start: RegExp, ctx: HeuristicContext): boolean {
  if (!start.test(l) || isWeightLine(l) || l.length > 200) return false;
  const rest = l.replace(start, '');
  return !!findDate(l, ctx) || /^\s*(?:#?\s*\d+|[A-Z])?\s*[:\-–—]/.test(rest) || /^\s*#?\s*\d+\b/.test(rest);
}

function extractAssignments(text: string, ctx: HeuristicContext, components: ParsedSyllabus['grade_components']): ParsedSyllabus['assignments'] {
  const out: ParsedSyllabus['assignments'] = [];
  const seen = new Set<string>();
  for (const l of itemLines(text, ctx)) {
    if (EXAM_START.test(l) || !looksLikeItem(l, ASSIGNMENT_START, ctx)) continue;
    const title = titleOf(l, ctx);
    if (seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    const date = findDate(l, ctx);
    out.push({
      title,
      type: inferAssignmentType(title),
      due_date: date?.iso ?? null,
      due_time: date ? findTime(l.slice(date.index + date.length)) ?? findTime(l.slice(0, date.index).replace(/^.*\b(?:due|at)\b/i, '')) : null,
      due_week: l.match(/\bweek\s+(\d{1,2})\b/i) ? parseInt(l.match(/\bweek\s+(\d{1,2})\b/i)![1]) : null,
      due_is_approximate: !date,
      points_possible: l.match(/\b(\d{1,4})\s*(?:points?|pts?)\b/i) ? parseInt(l.match(/\b(\d{1,4})\s*(?:points?|pts?)\b/i)![1]) : null,
      component_name: matchGradeComponent(title, components),
      estimated_minutes: null,
    });
  }
  return out.slice(0, 60);
}

function extractExams(text: string, ctx: HeuristicContext): ParsedSyllabus['exams'] {
  const out: ParsedSyllabus['exams'] = [];
  const seen = new Set<string>();
  for (const l of itemLines(text, ctx)) {
    if (!looksLikeItem(l, EXAM_START, ctx)) continue;
    const colon = l.search(/[:–—]|\s-\s/);
    const title = (colon > 0 && colon < 40 ? l.slice(0, colon) : titleOf(l, ctx)).trim();
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    const date = findDate(l, ctx);
    const chapters = l.match(/\b(?:weeks?|chapters?|ch\.?|units?)\s*(\d{1,2})\s*(?:[-–—]|to|through)\s*(\d{1,2})/i);
    out.push({
      title,
      date: date?.iso ?? null,
      time: date ? findTime(l.slice(date.index + date.length)) : findTime(l),
      is_cumulative: /cumulative|comprehensive/i.test(l),
      location: l.match(/\b(?:room|in)\s+([A-Z][A-Za-z]*\s*\d{2,4}[A-Z]?)\b/)?.[1] ?? null,
      covers_weeks: chapters && /week/i.test(chapters[0])
        ? Array.from({ length: Math.max(0, parseInt(chapters[2]) - parseInt(chapters[1]) + 1) }, (_, k) => parseInt(chapters[1]) + k).slice(0, 20)
        : [],
      covers_topics: chapters && !/week/i.test(chapters[0]) ? [chapters[0]] : [],
    });
  }
  return out.slice(0, 12);
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
  const instructor = extractInstructor(text);

  return {
    course: {
      name: courseName,
      code: extractCourseCode(text),
      section: text.match(/\bsection\s*#?\s*([A-Z0-9-]{1,6})\b/i)?.[1] ?? null,
      instructor_name: instructor.name,
      instructor_email: instructor.email,
      term_hint: text.match(/\b(?:Fall|Spring|Summer|Winter)\s+\d{4}\b/i)?.[0] ?? null,
      starts_on: ctx.termStarts || null,
      ends_on: ctx.termEnds || null,
    },
    meetings: extractMeetings(text),
    grade_components: gradeComponents,
    assignments: extractAssignments(text, ctx, gradeComponents),
    exams: extractExams(text, ctx),
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
