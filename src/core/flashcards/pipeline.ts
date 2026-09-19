// Glue for stages 2–4: model output in, reviewable cards + eval events out.
import type { PatternType } from '@/types/db';
import type { Candidate } from './extract';
import { checkCard, type CardDraft, type ExistingCard, type RejectReason } from './reject';
import { capitalize, wordCount } from './text';

/** What the rewrite step returns (from the edge function, or the local fallback). */
export interface RewriteResponse {
  cards: Array<CardDraft & { candidate_id: string }>;
  model: string;
  prompt_version: string;
  raw_output: unknown;
}

export interface GeneratedItem {
  candidate: Candidate;
  pattern_type: PatternType;
  /** null when the model produced nothing for this candidate. */
  card: CardDraft | null;
  /** Which Stage-3 filter killed it, if any (also 'no_output'). */
  rejectedBy: RejectReason | 'no_output' | null;
  model: string;
  prompt_version: string;
  /** The model's raw card object for this candidate, kept for the eval set. */
  raw: unknown;
}

/**
 * Stage 3. Every candidate yields at least one item — accepted, auto-rejected, or
 * "no_output" — so `generation_events` records the full funnel, not just survivors.
 */
export function evaluateGeneration(args: {
  candidates: Candidate[];
  response: RewriteResponse;
  existing: ExistingCard[];
  minConfidence?: number;
}): GeneratedItem[] {
  const { candidates, response, minConfidence } = args;
  const pool: ExistingCard[] = [...args.existing];
  const byCandidate = new Map<string, RewriteResponse['cards']>();
  for (const c of response.cards ?? []) {
    const list = byCandidate.get(c.candidate_id) ?? [];
    list.push(c);
    byCandidate.set(c.candidate_id, list);
  }

  const items: GeneratedItem[] = [];
  for (const cand of candidates) {
    const outs = byCandidate.get(cand.id) ?? [];
    const base = {
      candidate: cand,
      pattern_type: cand.pattern_type,
      model: response.model,
      prompt_version: response.prompt_version,
    };
    if (outs.length === 0) {
      items.push({ ...base, card: null, rejectedBy: 'no_output', raw: null });
      continue;
    }
    for (const out of outs) {
      const draft: CardDraft = {
        term: out.term?.trim() ?? '',
        definition: out.definition?.trim() ?? '',
        card_type: out.card_type === 'cloze' ? 'cloze' : 'term_def',
        cloze_text: out.cloze_text ?? null,
        confidence: Number(out.confidence ?? 0),
      };
      const reason = checkCard(draft, pool, minConfidence);
      if (!reason) pool.push({ term: draft.term, definition: draft.definition });
      items.push({ ...base, card: draft, rejectedBy: reason, raw: out });
    }
  }
  return items;
}

/** Funnel counts for the UI and the §9 auto-rejection metric. */
export function funnel(items: GeneratedItem[]): { total: number; survived: number; byReason: Record<string, number> } {
  const byReason: Record<string, number> = {};
  let survived = 0;
  for (const i of items) {
    if (!i.rejectedBy) survived++;
    else byReason[i.rejectedBy] = (byReason[i.rejectedBy] ?? 0) + 1;
  }
  return { total: items.length, survived, byReason };
}

// ---------------------------------------------------------------------------
// Offline / no-backend fallback for Stage 2. It does NOT try to be smart:
// it lifts the extractor's own hints into the card shape and lets Stage 3
// filter. Used in local demo mode and when the LLM call fails.
// ---------------------------------------------------------------------------

export const HEURISTIC_MODEL = 'heuristic';
export const HEURISTIC_PROMPT_VERSION = 'heuristic-v1';

function firstSentence(s: string): string {
  const m = s.match(/^(.+?[.!?])(?:\s|$)/);
  return (m ? m[1] : s).trim();
}

function tidyDefinition(body: string): string {
  const d = firstSentence(body)
    .replace(/^(?:is|are|refers to|means)\s+/i, '')
    .replace(/[.\s]+$/, '');
  return capitalize(d) + '.';
}

export function heuristicRewrite(candidates: Candidate[]): RewriteResponse {
  const cards: RewriteResponse['cards'] = [];
  for (const c of candidates) {
    if (!c.term_hint || !c.body_hint) continue;
    const term = c.term_hint.replace(/[.:;!?]+$/, '').trim();
    const definition = tidyDefinition(c.body_hint);
    if (wordCount(term) === 0) continue;
    cards.push({
      candidate_id: c.id,
      term: capitalize(term),
      definition,
      card_type: 'term_def',
      cloze_text: null,
      confidence: 0.7,
    });
  }
  return { cards, model: HEURISTIC_MODEL, prompt_version: HEURISTIC_PROMPT_VERSION, raw_output: { cards } };
}
