// Stage 1 — deterministic candidate extraction ($0, no model).
//
// Finds definitional patterns and DROPS everything else. Narrative prose never
// reaches the model, which is what eliminates most junk cards. Every candidate
// carries its span in the source note so a card can link back to where it came from.
import type { PatternType } from '@/types/db';
import { PRONOUNS, STOPWORDS, stripMarkdown, words } from './text';

export interface Candidate {
  id: string;
  pattern_type: PatternType;
  span_start: number;
  span_end: number;
  /** Exact source text: body.slice(span_start, span_end). */
  text: string;
  term_hint: string | null;
  body_hint: string | null;
}

interface Line {
  text: string;
  start: number;
  end: number; // exclusive, newline excluded
}

const LABEL_WORDS = new Set([
  'note', 'notes', 'example', 'examples', 'tip', 'warning', 'reminder', 'todo', 'to do', 'homework', 'due', 'question',
  'questions', 'answer', 'see', 'chapter', 'week', 'date', 'summary', 'key point', 'important', 'remember', 'hint',
  'ex', 'eg', 'e.g', 'ie', 'i.e', 'source', 'sources', 'reading', 'readings', 'assignment', 'exam', 'quiz', 'agenda',
  'topic', 'topics', 'objective', 'objectives', 'goal', 'goals', 'time', 'location', 'room', 'professor', 'prof',
  'ta', 'email', 'phone', 'office hours', 'url', 'link', 'page', 'pg', 'slide', 'lecture',
]);

const GENERIC_HEADINGS = new Set([
  'notes', 'introduction', 'intro', 'summary', 'overview', 'agenda', 'homework', 'review', 'questions', 'todo',
  'to do', 'reminders', 'recap', 'conclusion', 'references', 'readings', 'reading', 'announcements', 'today',
  'outline', 'objectives', 'goals', 'example', 'examples', 'lecture',
]);

function splitLines(body: string): Line[] {
  const lines: Line[] = [];
  const re = /\r?\n/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    lines.push({ text: body.slice(start, m.index), start, end: m.index });
    start = m.index + m[0].length;
  }
  lines.push({ text: body.slice(start), start, end: body.length });
  return lines;
}

const LIST_MARKER = /^\s*(?:[-*•]|\d+[.)])\s+/;
const BULLET_ONLY = /^\s*(?:[-*•]|\d+[.)])\s+/;

function termOk(term: string, maxWords = 6): boolean {
  const w = words(term);
  if (w.length === 0 || w.length > maxWords) return false;
  if (w.every((x) => STOPWORDS.has(x.toLowerCase()))) return false;
  if (PRONOUNS.has(w[0].toLowerCase()) && w.length === 1) return false;
  if (/^[\d\s.,:;-]+$/.test(term)) return false;
  return true;
}

function isLabel(term: string): boolean {
  return LABEL_WORDS.has(term.trim().toLowerCase().replace(/[.:]+$/, ''));
}

/** Span of the sentence inside `line` that contains offset `at` (offsets relative to line). */
function sentenceSpan(line: string, at: number): [number, number] {
  let s = 0;
  const before = line.slice(0, at);
  const m = [...before.matchAll(/[.!?]["')\]]?\s+/g)].pop();
  if (m && m.index !== undefined) s = m.index + m[0].length;
  const after = line.slice(at);
  const e = after.search(/[.!?]["')\]]?(?:\s|$)/);
  const end = e === -1 ? line.length : at + e + (after.slice(e).match(/^[.!?]["')\]]?/)?.[0].length ?? 1);
  return [s, end];
}

export function extractCandidates(body: string): Candidate[] {
  const lines = splitLines(body);
  const claimed: Array<[number, number]> = [];
  const found: Omit<Candidate, 'id' | 'text'>[] = [];

  const overlaps = (s: number, e: number) => claimed.some(([a, b]) => s < b && e > a);
  const add = (
    pattern_type: PatternType,
    span_start: number,
    span_end: number,
    term_hint: string | null,
    body_hint: string | null,
  ) => {
    if (span_end <= span_start || overlaps(span_start, span_end)) return false;
    claimed.push([span_start, span_end]);
    found.push({ pattern_type, span_start, span_end, term_hint, body_hint });
    return true;
  };

  // ---- 1. glossary_row: markdown table rows and tab-separated pairs ------------
  for (let i = 0; i < lines.length; i++) {
    const { text, start, end } = lines[i];
    const isSep = (t: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(t) && t.includes('-');
    if (/^\s*\|.+\|\s*$/.test(text)) {
      if (isSep(text)) continue;
      if (i + 1 < lines.length && isSep(lines[i + 1].text)) continue; // header row
      const cells = text.trim().replace(/^\||\|$/g, '').split('|').map((c) => stripMarkdown(c));
      if (cells.length >= 2 && termOk(cells[0]) && cells.slice(1).join(' ').length >= 8) {
        add('glossary_row', start, end, cells[0], cells.slice(1).join(' ').trim());
      }
    } else if (text.includes('\t')) {
      const m = text.match(/^\s*([^\t]{2,60}?)\t+(.{8,})$/);
      if (m && termOk(m[1])) add('glossary_row', start, end, stripMarkdown(m[1]), stripMarkdown(m[2]));
    }
  }

  // ---- 2. heading_body: "## Term" followed by an explanatory paragraph --------
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].text.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!h) continue;
    const term = stripMarkdown(h[1]);
    if (!termOk(term) || /[?]$/.test(term)) continue;
    if (GENERIC_HEADINGS.has(term.toLowerCase()) || /^(week|lecture|chapter|unit|module)\s+\d+/i.test(term)) continue;

    let j = i + 1;
    if (j < lines.length && lines[j].text.trim() === '') j++; // tolerate one blank line
    const first = lines[j];
    if (!first || /^\s*#/.test(first.text) || BULLET_ONLY.test(first.text) || /^\s*\|/.test(first.text)) continue;
    let last = j;
    while (last + 1 < lines.length && lines[last + 1].text.trim() !== '' && !/^\s*#/.test(lines[last + 1].text)) last++;
    const paragraph = lines
      .slice(j, last + 1)
      .map((l) => stripMarkdown(l.text))
      .join(' ');
    if (paragraph.length < 25) continue;
    add('heading_body', lines[i].start, lines[last].end, term, paragraph);
  }

  // ---- 3. bold_term: **Term** — explanation  /  *Term*: explanation -------------
  const tail = /^\s*(?::\s*|[-–—=]+\s*|\([^)]{1,40}\)\s*[:\-–—]?\s*|(?:is|are|refers? to|means|describes|involves)\b\s*)/i;
  for (const line of lines) {
    const boldRe = /(\*\*|__)([^*_\n]{2,60}?)\1/g;
    const italicRe = /(^|[^*\w])([*_])([^*_\s][^*_\n]{0,48}?[^*_\s]|[^*_\s])\2(?![*\w])/g;
    const hits: Array<{ term: string; after: number; at: number }> = [];
    for (const m of line.text.matchAll(boldRe)) {
      hits.push({ term: m[2], after: m.index! + m[0].length, at: m.index! });
    }
    for (const m of line.text.matchAll(italicRe)) {
      const at = m.index! + m[1].length;
      hits.push({ term: m[3], after: m.index! + m[0].length, at });
    }
    hits.sort((a, b) => a.at - b.at);
    for (const h of hits) {
      const rest = line.text.slice(h.after);
      if (!tail.test(rest) || rest.replace(tail, '').trim().length < 12) continue;
      if (!termOk(h.term) || isLabel(h.term)) continue;
      const [s, e] = sentenceSpan(line.text, h.at);
      const sentence = line.text.slice(s, e);
      const explanation = stripMarkdown(line.text.slice(h.after).replace(tail, ''));
      const startAbs = line.start + s + (sentence.match(LIST_MARKER)?.[0].length ?? 0);
      if (add('bold_term', startAbs, line.start + e, stripMarkdown(h.term), explanation)) break;
    }
  }

  // ---- 4. named_list_item: runs of ≥2 "Name – description" list items ----------
  const listItem = /^\s*(?:[-*•]|\d+[.)])\s+([^:–—\n]{2,50}?)\s*(?::|\s[-–—]\s)\s*(.{15,})$/;
  for (let i = 0; i < lines.length; ) {
    const run: number[] = [];
    let j = i;
    while (j < lines.length && listItem.test(lines[j].text)) run.push(j++);
    if (run.length >= 2) {
      for (const k of run) {
        const m = lines[k].text.match(listItem)!;
        const term = stripMarkdown(m[1]);
        if (!termOk(term) || isLabel(term)) continue;
        const markerLen = lines[k].text.match(LIST_MARKER)?.[0].length ?? 0;
        add('named_list_item', lines[k].start + markerLen, lines[k].end, term, stripMarkdown(m[2]));
      }
      i = j;
    } else {
      i = Math.max(j, i + 1);
    }
  }

  // ---- 5. colon_def: "Term: explanation" at line start ------------------------
  const colonDef = /^\s*(?:(?:[-*•]|\d+[.)])\s+)?([A-Za-z][^:\n]{1,50}?):\s+([A-Za-z0-9(].{14,})$/;
  for (const line of lines) {
    const m = line.text.match(colonDef);
    if (!m) continue;
    const term = stripMarkdown(m[1]);
    if (!termOk(term) || isLabel(term) || /https?$/i.test(term) || /[?!.]$/.test(term)) continue;
    const markerLen = line.text.match(LIST_MARKER)?.[0].length ?? 0;
    add('colon_def', line.start + markerLen, line.end, term, stripMarkdown(m[2]));
  }

  // ---- 6. is_defined_as: "X is defined as / refers to / means Y" --------------
  const isDef =
    /(?:^|[.!?]["')\]]?\s+)((?:the |a |an )?[A-Za-z][\w'’\- ]{1,55}?)\s+(?:is defined as|are defined as|is known as|are known as|is called|are called|is referred to as|refers to|refer to|means)\s+([^.!?\n]{8,}[.!?]?)/gi;
  for (const line of lines) {
    for (const m of line.text.matchAll(isDef)) {
      const term = m[1].replace(/^(the|a|an)\s+/i, '');
      const firstWord = words(term)[0]?.toLowerCase();
      if (!firstWord || PRONOUNS.has(firstWord) || !termOk(term)) continue;
      const termAt = m.index! + m[0].indexOf(m[1]);
      const endAt = m.index! + m[0].length;
      add('is_defined_as', line.start + termAt, line.start + endAt, stripMarkdown(term), stripMarkdown(m[2]));
    }
  }

  // ---- 7. parenthetical_def: "term (the process by which …)" ------------------
  const parenStart = /^(?:the|a|an|when|where|which|any|i\.e\.,?|meaning|defined as|refers to|also called)\b/i;
  for (const line of lines) {
    for (const m of line.text.matchAll(/\(([^()]{15,220})\)/g)) {
      if (!parenStart.test(m[1].trim())) continue;
      const before = line.text.slice(0, m.index!).trimEnd();
      const tokens = before.match(/[A-Za-z][A-Za-z'’\-]*/g) ?? [];
      const term = tokens.slice(-3).join(' ');
      if (!termOk(term, 4)) continue;
      const termAt = before.lastIndexOf(tokens.slice(-3)[0]);
      const [, e] = sentenceSpan(line.text, m.index! + m[0].length - 1);
      add('parenthetical_def', line.start + termAt, line.start + e, term, stripMarkdown(m[1]));
    }
  }

  return found
    .sort((a, b) => a.span_start - b.span_start)
    .map((c, i) => ({ ...c, id: `c${i + 1}`, text: body.slice(c.span_start, c.span_end) }));
}
