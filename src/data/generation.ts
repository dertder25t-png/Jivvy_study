// One place that runs the card pipeline for a note (used by the side panel and the
// full-screen review): Stage 1 extract → Stage 2 rewrite → Stage 3 reject → save as
// PENDING cards + a generation_event for every candidate. Nothing enters the deck
// until a human approves it (Stage 4).
import { extractCandidates } from '@/core/flashcards/extract';
import { evaluateGeneration, funnel, mergeRewrites } from '@/core/flashcards/pipeline';
import { rewriteLocally } from '@/core/flashcards/rewrite';
import type { Note } from '@/types/db';
import { logMetric, saveGeneratedBatch } from './actions';
import { foundToCandidates, noteBlocks } from '@/core/flashcards/modelFind';
import { findWithLocalAi, markBlocksRead, rewriteWithLocalAi, unreadBlocks } from './localAi';
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
  /** 'rules', or the local model's name when it wrote some of the cards. */
  model?: string;
}

/**
 * `note` must already be saved with its current body (spans point into it).
 * `onlyNew`: skip passages this note already made cards from (used when cards are made
 * automatically while you type — so the laptop only works on what you just wrote).
 * Returns null when there was nothing new to do.
 */
export function generateForNote(note: Note): Promise<GenerationSummary>;
export function generateForNote(note: Note, opts: { onlyNew?: boolean }): Promise<GenerationSummary | null>;
export async function generateForNote(note: Note, opts: { onlyNew?: boolean } = {}): Promise<GenerationSummary | null> {
  if (!note.course_id) throw new Error('File this note under a class first.');
  let candidates = extractCandidates(note.body);
  // Passages this note already made cards from (by either the rules or the model).
  const seenText = new Set(
    opts.onlyNew
      ? store.all('generation_events').filter((e) => e.source_note_id === note.id).map((e) => e.candidate_text)
      : [],
  );
  candidates = candidates.filter((c) => !seenText.has(c.text));
  const existing = store
    .all('cards')
    .filter((k) => k.course_id === note.course_id && k.status !== 'rejected')
    .map((k) => ({ term: k.term, definition: k.definition }));

  const rules = rewriteLocally(candidates);
  const ai = candidates.length ? await rewriteWithLocalAi(candidates) : null;
  let response = ai ? mergeRewrites(ai, rules, existing) : rules;

  // With the local model on: also let it read the note for definitions the patterns missed.
  // (Skipped if the helper didn't answer above — no point waiting on it twice.)
  if (ai || candidates.length === 0) {
    const blocks = await unreadBlocks(note.id, noteBlocks(note.body), !opts.onlyNew);
    const spotted = blocks.length ? await findWithLocalAi(blocks) : null;
    if (spotted) {
      void markBlocksRead(note.id, blocks);
      const extra = foundToCandidates(note.body, blocks, spotted.found, extractCandidates(note.body));
      const fresh = extra.candidates.filter((c) => !seenText.has(c.text));
      const keep = new Set(fresh.map((c) => c.id));
      if (fresh.length) {
        candidates = [...candidates, ...fresh];
        response = {
          ...response,
          cards: [...response.cards, ...extra.cards.filter((c) => keep.has(c.candidate_id))],
          model: response.model === spotted.model ? response.model : `${spotted.model}+${response.model}`,
        };
      }
    }
  }
  if (candidates.length === 0) return opts.onlyNew ? null : { total: 0, survived: 0, byReason: {}, model: response.model };

  // The note may have been edited while the model ran; only save against the text we read.
  const current = store.all('notes').find((n) => n.id === note.id);
  if (opts.onlyNew && current && current.body !== note.body) return null;

  const items = evaluateGeneration({ candidates, response, existing });
  saveGeneratedBatch(note, items);

  const f = funnel(items);
  logMetric('cards_generated', {
    candidates: candidates.length, survived: f.survived, byReason: f.byReason,
    model: response.model,
  });
  return { ...f, model: response.model };
}
