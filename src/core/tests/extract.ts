// Stage 1 of test generation: extract question concepts from notes (deterministic, $0).
// Similar to flashcard extraction but optimized for identifying concepts that make good test questions.

import { words, STOPWORDS, stem } from '../flashcards/text';

export interface QuestionCandidate {
  concept: string;
  context: string;
  span_start: number;
  span_end: number;
  pattern_type: 'bold_term' | 'definition' | 'list_item' | 'heading_concept';
  confidence: number; // 0.0-1.0
}

// Patterns that work well for test questions
const BOLD_PATTERN = /\*\*([^*]+)\*\*|\*([^*]+)\*|__([^_]+)__|_([^_]+)_/g;
const DEFINITION_PATTERN = /([^:\n]+):\s*(.{20,150}?)(?:\n|$)/g;
const LIST_PATTERN = /^[\s]*[•\-\*]\s+([^:\n]+):?\s*(.{10,100}?)$/gm;
const HEADING_PATTERN = /^#+\s+([^:\n]+)$/gm;

function normalize(s: string): string {
  return s.trim().replace(/[*_`~]/g, '').toLowerCase();
}

function isQualityConcept(concept: string): boolean {
  // Filter out junk concepts
  if (concept.length < 3 || concept.length > 80) return false;
  if (/^(the|a|an|and|or|but|if|what|when|where|why|how)$/i.test(concept)) return false;
  const w = words(concept).filter(w => !STOPWORDS.has(w.toLowerCase()));
  return w.length >= 1 && w.length <= 8;
}

/** Extract bolded/italicized terms as potential question concepts. */
export function extractBoldConcepts(body: string): QuestionCandidate[] {
  const results: QuestionCandidate[] = [];
  let match;
  const regex = new RegExp(BOLD_PATTERN);
  while ((match = regex.exec(body)) !== null) {
    const term = match[1] || match[2] || match[3] || match[4];
    if (!term || !isQualityConcept(term)) continue;

    const start = match.index;
    const end = match.index + match[0].length;
    const context = body.slice(Math.max(0, start - 40), Math.min(body.length, end + 100)).trim();

    results.push({
      concept: term.trim(),
      context,
      span_start: start,
      span_end: end,
      pattern_type: 'bold_term',
      confidence: 0.8,
    });
  }
  return results;
}

/** Extract definitions in "Term: definition" format. */
export function extractDefinitions(body: string): QuestionCandidate[] {
  const results: QuestionCandidate[] = [];
  let match;
  const regex = new RegExp(DEFINITION_PATTERN);
  while ((match = regex.exec(body)) !== null) {
    const term = match[1].trim();
    if (!isQualityConcept(term)) continue;

    const start = match.index;
    const end = match.index + match[0].length;
    const context = match[0];

    results.push({
      concept: term,
      context,
      span_start: start,
      span_end: end,
      pattern_type: 'definition',
      confidence: 0.9,
    });
  }
  return results;
}

/** Extract bulleted/numbered list items as concepts. */
export function extractListItems(body: string): QuestionCandidate[] {
  const results: QuestionCandidate[] = [];
  let match;
  const regex = new RegExp(LIST_PATTERN);
  while ((match = regex.exec(body)) !== null) {
    const concept = match[1].trim();
    if (!isQualityConcept(concept)) continue;

    const start = match.index;
    const end = match.index + match[0].length;
    const context = match[0];

    results.push({
      concept,
      context,
      span_start: start,
      span_end: end,
      pattern_type: 'list_item',
      confidence: 0.75,
    });
  }
  return results;
}

/** Extract heading + following paragraph as concept. */
export function extractHeadingConcepts(body: string): QuestionCandidate[] {
  const results: QuestionCandidate[] = [];
  const paragraphs = body.split('\n\n');

  for (let i = 0; i < paragraphs.length - 1; i++) {
    const para = paragraphs[i].trim();
    if (!para.startsWith('#')) continue;

    const headingMatch = para.match(/^#+\s+([^:\n]+)/);
    if (!headingMatch) continue;

    const concept = headingMatch[1].trim();
    if (!isQualityConcept(concept)) continue;

    const nextPara = paragraphs[i + 1].trim().slice(0, 150);
    const start = body.indexOf(para);
    const end = start + para.length;
    const context = `${para}\n\n${nextPara}`;

    results.push({
      concept,
      context,
      span_start: start,
      span_end: end,
      pattern_type: 'heading_concept',
      confidence: 0.85,
    });
  }
  return results;
}

/** Extract all question candidates from a note. */
export function extractCandidates(body: string): QuestionCandidate[] {
  const candidates = [
    ...extractDefinitions(body),
    ...extractListItems(body),
    ...extractBoldConcepts(body),
    ...extractHeadingConcepts(body),
  ];

  // Deduplicate by normalized concept
  const seen = new Map<string, QuestionCandidate>();
  for (const c of candidates) {
    const key = normalize(c.concept);
    const existing = seen.get(key);
    if (!existing || c.confidence > existing.confidence) {
      seen.set(key, c);
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.span_start - a.span_start);
}
