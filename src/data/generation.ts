// One place that runs the card pipeline for a note (used by the side panel and the
// full-screen review): Stage 1 extract → Stage 2 rewrite → Stage 3 reject → save as
// PENDING cards + a generation_event for every candidate. Nothing enters the deck
// until a human approves it (Stage 4).
import { rewriteCards } from '@/api/functions';
import { extractCandidates } from '@/core/flashcards/extract';
import { evaluateGeneration, funnel } from '@/core/flashcards/pipeline';
import type { Note } from '@/types/db';
import { logMetric, saveGeneratedBatch } from './actions';
import { store } from './store';

export const REJECT_REASON_TEXT: Record<string, string> = {
  circular: 'repeated the term in its own definition',
  too_long: 'definition too long',
  term_too_long: 'term too long',
  term_is_sentence: 'term was a sentence',
  compound: 'two ideas in one card',
  duplicate: 'already in your deck',
  degenerate_term: 'unclear term',
  meta_language: '“the lecture says…” phrasing',
  pronoun: 'vague “it/they” wording',
  invalid_cloze: 'broken fill-in-the-blank',
  low_confidence: 'not confident it was right',
  no_output: 'no clean card could be made',
  empty_output: 'came back empty',
};

export interface GenerationSummary {
  total: number;
  survived: number;
  byReason: Record<string, number>;
  fellBack: boolean;
}

/** `note` must already be saved with its current body (spans point into it). */
export async function generateForNote(note: Note): Promise<GenerationSummary> {
  if (!note.course_id) throw new Error('File this note under a class first.');
  const candidates = extractCandidates(note.body);
  const existing = store
    .all('cards')
    .filter((k) => k.course_id === note.course_id && k.status !== 'rejected')
    .map((k) => ({ term: k.term, definition: k.definition }));

  const response = await rewriteCards(candidates);
  const items = evaluateGeneration({ candidates, response, existing });
  saveGeneratedBatch(note, items);

  const f = funnel(items);
  logMetric('cards_generated', {
    candidates: candidates.length, survived: f.survived, byReason: f.byReason,
    model: response.model, fell_back: response.fellBack,
  });
  return { ...f, fellBack: response.fellBack };
}
