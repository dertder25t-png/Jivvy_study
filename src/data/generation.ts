// One place that runs the card pipeline for a note (used by the side panel and the
// full-screen review): Stage 1 extract → Stage 2 rewrite → Stage 3 reject → save as
// PENDING cards + a generation_event for every candidate. Nothing enters the deck
// until a human approves it (Stage 4).
import { extractCandidates } from '@/core/flashcards/extract';
import { evaluateGeneration, funnel, mergeRewrites } from '@/core/flashcards/pipeline';
import { rewriteLocally } from '@/core/flashcards/rewrite';
import type { Note } from '@/types/db';
import { logMetric, saveGeneratedBatch } from './actions';
import { foundToCandidates, noteBlocks, type FoundTerm } from '@/core/flashcards/modelFind';
import { stemmedTokens } from '@/core/flashcards/text';
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
  /** Whether the local model answered at all (false = helper not running). */
  modelRan?: boolean;
}

export interface GenerateOptions {
  /** Skip passages this note already made cards from (automatic runs, and the "find" button). */
  onlyNew?: boolean;
  /**
   * Have the local model read every part of the note, even parts it has read before
   * (the "Find cards in this note" button). Otherwise it only reads new or changed parts.
   */
  readAll?: boolean;
  /** Long notes are read a few parts at a time: (parts read, total parts). */
  onProgress?: (done: number, total: number) => void;
}

/** Parts of a note sent to the helper per request, so long notes show progress and never time out. */
const BLOCKS_PER_CALL = 6;

/**
 * `note` must already be saved with its current body (spans point into it).
 * Returns null when there was nothing new to do (only with `onlyNew`).
 */
export function generateForNote(note: Note): Promise<GenerationSummary>;
export function generateForNote(note: Note, opts: GenerateOptions): Promise<GenerationSummary | null>;
export function generateForNote(note: Note, opts: GenerateOptions = {}): Promise<GenerationSummary | null> {
  // One run at a time: a run started while another is going (say, the button pressed during an
  // automatic run) waits for it, then sees the cards it made — so nothing is made twice.
  const run = queue.then(() => {
    // Re-read the note: it may have been edited while waiting in line.
    const latest = store.all('notes').find((n) => n.id === note.id) ?? note;
    return generateNow(latest, opts);
  });
  queue = run.catch(() => undefined);
  return run;
}

let queue: Promise<unknown> = Promise.resolve();

async function generateNow(note: Note, opts: GenerateOptions): Promise<GenerationSummary | null> {
  if (!note.course_id) throw new Error('File this note under a class first.');
  let candidates = extractCandidates(note.body);
  const events = store.all('generation_events').filter((e) => e.source_note_id === note.id);
  // Passages this note already made cards from (by either the rules or the model).
  const seenText = new Set(opts.onlyNew ? events.map((e) => e.candidate_text) : []);
  candidates = candidates.filter((c) => !seenText.has(c.text));
  const existing = store
    .all('cards')
    .filter((k) => k.course_id === note.course_id && k.status !== 'rejected')
    .map((k) => ({ term: k.term, definition: k.definition }));
  // Terms this note already has a card for — kept, waiting, or skipped — so the model doesn't
  // suggest them again (a skipped card stays skipped).
  const noteTerms = new Set(
    store.all('cards').filter((k) => k.source_note_id === note.id).map((k) => stemmedTokens(k.term).join(' ')),
  );

  const rules = rewriteLocally(candidates);
  const ai = candidates.length ? await rewriteWithLocalAi(candidates) : null;
  let response = ai ? mergeRewrites(ai, rules, existing) : rules;
  let modelRan = !!ai;

  // With the local model on: also let it read the note for definitions the patterns missed.
  // (Skipped if the helper didn't answer above — no point waiting on it twice.)
  if (ai || candidates.length === 0) {
    const all = noteBlocks(note.body);
    const blocks = await unreadBlocks(note.id, all, opts.readAll || !opts.onlyNew);
    const found: FoundTerm[] = [];
    let model: string | null = null;
    for (let i = 0; i < blocks.length; i += BLOCKS_PER_CALL) {
      opts.onProgress?.(i, blocks.length);
      const part = blocks.slice(i, i + BLOCKS_PER_CALL);
      const spotted = await findWithLocalAi(part);
      if (!spotted) break; // helper stopped or not running: keep what we have
      model = spotted.model;
      found.push(...spotted.found);
      void markBlocksRead(note.id, part);
    }
    if (blocks.length) opts.onProgress?.(blocks.length, blocks.length);
    if (model) {
      modelRan = true;
      const extra = foundToCandidates(note.body, all, found, extractCandidates(note.body));
      const fresh = extra.candidates.filter(
        (c) => !seenText.has(c.text) && !noteTerms.has(stemmedTokens(c.term_hint ?? '').join(' ')),
      );
      const keep = new Set(fresh.map((c) => c.id));
      if (fresh.length) {
        candidates = [...candidates, ...fresh];
        response = {
          ...response,
          cards: [...response.cards, ...extra.cards.filter((c) => keep.has(c.candidate_id))],
          model: response.model === model ? response.model : `${model}+${response.model}`,
        };
      }
    }
  }
  if (candidates.length === 0) return opts.onlyNew && !opts.readAll ? null : { total: 0, survived: 0, byReason: {}, model: response.model, modelRan };

  // An automatic run is quick; if the note changed meanwhile, the next pause will redo it.
  const current = store.all('notes').find((n) => n.id === note.id);
  if (opts.onlyNew && !opts.readAll && current && current.body !== note.body) return null;

  const items = evaluateGeneration({ candidates, response, existing });
  saveGeneratedBatch(note, items);

  const f = funnel(items);
  logMetric('cards_generated', {
    candidates: candidates.length, survived: f.survived, byReason: f.byReason,
    model: response.model,
  });
  return { ...f, model: response.model, modelRan };
}
