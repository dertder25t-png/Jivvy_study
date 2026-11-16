// Stage 1b — definitions the local model spotted that the pattern rules (extract.ts) missed:
// plain sentences like "Chunking is grouping info into bigger units…" in the middle of a paragraph.
//
// The model only *suggests*. Everything here is checked against the note itself, so a model that
// makes something up can't put it in front of the student:
//   * the term has to appear in that part of the note;
//   * most of the definition's words have to come from the note;
//   * labels ("Exam", "Homework") and terms the rules already found are skipped.
// Survivors become ordinary candidates (pattern 'model_found') with cards already written, and go
// through the same Stage 3 checks and approve gate as everything else.
import type { Candidate } from './extract';
import type { RewriteResponse } from './pipeline';
import { STOPWORDS, containsStemmed, stem, stemmedTokens, stripMarkdown, wordCount, words } from './text';

export interface NoteBlock {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface FoundTerm {
  block_id: string;
  term: string;
  definition: string;
}

/** Roughly what fits the model's input on the NPU (~250 tokens). */
const MAX_BLOCK_CHARS = 900;

/**
 * The note cut into blocks the model reads one at a time: a heading with the paragraphs under it,
 * split at blank lines when it gets too long. Each keeps its offsets so cards point back at the note.
 */
export function noteBlocks(body: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let start = -1;
  let end = 0;
  const flush = () => {
    if (start >= 0) {
      const text = body.slice(start, end);
      if (wordCount(text) >= 6) blocks.push({ id: `b${blocks.length + 1}`, start, end, text });
    }
    start = -1;
  };
  const re = /[^\n]*(\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) && m[0].length > 0) {
    const lineStart = m.index;
    const line = m[0].replace(/\r?\n$/, '');
    const lineEnd = lineStart + line.length;
    const heading = /^\s*#{1,6}\s/.test(line);
    const blank = line.trim() === '';
    if (heading || (blank && start >= 0 && end - start > MAX_BLOCK_CHARS / 2)) flush();
    if (!blank) {
      if (start >= 0 && lineEnd - start > MAX_BLOCK_CHARS) flush();
      if (start < 0) start = lineStart;
      end = lineEnd;
    }
  }
  flush();
  return blocks;
}

/** Labels and filler that aren't study terms even when a note says "Exam: Friday". */
const NOT_TERMS = new Set([
  'exam', 'exams', 'test', 'quiz', 'homework', 'hw', 'assignment', 'due', 'date', 'today', 'note', 'notes', 'reminder',
  'todo', 'to do', 'reading', 'lecture', 'class', 'chapter', 'example', 'summary', 'topic', 'professor', 'office hours',
]);

function contentWords(s: string): string[] {
  return words(s).map((w) => w.toLowerCase()).filter((w) => !STOPWORDS.has(w));
}

/** Share of the definition's content words (stemmed) that appear in the source text. */
export function groundedShare(definition: string, source: string): number {
  const src = new Set(stemmedTokens(source));
  // The light stemmer misses some pairs ("rehearse"/"rehearsed"), so a shared 5-letter start counts too.
  const prefixes = new Set([...src].filter((w) => w.length >= 5).map((w) => w.slice(0, 5)));
  const cw = contentWords(definition);
  if (cw.length === 0) return 0;
  const inNote = (w: string) => src.has(stem(w)) || (w.length >= 5 && prefixes.has(stem(w).slice(0, 5)));
  return cw.filter(inNote).length / cw.length;
}

const MIN_GROUNDED = 0.6;

/** Where the term appears in the block: the whole line it's on (so the card links back to it). */
function lineSpan(body: string, block: NoteBlock, term: string): [number, number] | null {
  let offset = block.start;
  for (const line of block.text.split('\n')) {
    if (containsStemmed(stripMarkdown(line), term)) return [offset, offset + line.length];
    offset += line.length + 1;
  }
  return null;
}

/**
 * Turn the model's suggestions into candidates plus ready-written cards.
 * `ruleCandidates` are what the pattern rules found; terms they already cover are skipped.
 */
export function foundToCandidates(
  body: string,
  blocks: NoteBlock[],
  found: FoundTerm[],
  ruleCandidates: Candidate[],
): { candidates: Candidate[]; cards: RewriteResponse['cards'] } {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const known = ruleCandidates.map((c) => c.term_hint ?? '').filter(Boolean);
  const candidates: Candidate[] = [];
  const cards: RewriteResponse['cards'] = [];
  const seen = new Set<string>();

  for (const f of found) {
    const block = byId.get(f.block_id);
    const term = stripMarkdown(f.term ?? '').replace(/^(?:the|a|an)\s+/i, '').replace(/[.:;,]+$/, '').trim();
    const definition = (f.definition ?? '').trim();
    if (!block || !term || !definition) continue;
    const key = stemmedTokens(term).join(' ');
    if (!key || seen.has(key) || NOT_TERMS.has(term.toLowerCase())) continue;
    if (wordCount(term) > 6 || wordCount(definition) < 4) continue;
    if ((term.match(/[A-Za-z]/g) ?? []).length < 3) continue; // "5", "x", "A1"
    if (known.some((k) => stemmedTokens(k).join(' ') === key)) continue;
    if (!containsStemmed(stripMarkdown(block.text), term)) continue; // made-up term
    if (groundedShare(definition, block.text) < MIN_GROUNDED) continue; // made-up facts
    const span = lineSpan(body, block, term);
    if (!span) continue;
    seen.add(key);

    const id = `m${candidates.length + 1}`;
    const def = definition.charAt(0).toUpperCase() + definition.slice(1);
    candidates.push({
      id, pattern_type: 'model_found', span_start: span[0], span_end: span[1],
      text: body.slice(span[0], span[1]), term_hint: term, body_hint: def,
    });
    cards.push({
      candidate_id: id, term: term.charAt(0).toUpperCase() + term.slice(1),
      definition: /[.!?]$/.test(def) ? def : `${def}.`, card_type: 'term_def', cloze_text: null, confidence: 0.8,
    });
  }
  return { candidates, cards };
}
