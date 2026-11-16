// Glue for stages 2–4: rewritten cards in, reviewable cards + eval events out.
import type { PatternType } from '@/types/db';
import type { Candidate } from './extract';
import { checkCard, type CardDraft, type ExistingCard, type RejectReason } from './reject';

/** What the rewrite step returns (see rewrite.ts). `model`/`prompt_version` name the rule set used. */
export interface RewriteResponse {
  cards: Array<CardDraft & { candidate_id: string }>;
  model: string;
  prompt_version: string;
  raw_output: unknown;
}

export interface GeneratedItem {
  candidate: Candidate;
  pattern_type: PatternType;
  /** null when the rewrite produced nothing for this candidate. */
  card: CardDraft | null;
  /** Which Stage-3 filter killed it, if any (also 'no_output'). */
  rejectedBy: RejectReason | 'no_output' | null;
  model: string;
  prompt_version: string;
  /** The raw rewritten card for this candidate, kept for the eval set. */
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

/**
 * Model cards with the rules as a safety net, one card per passage: take the model's card when it
 * passes Stage 3, otherwise the rule-based one (so a model slip never costs a card the rules had).
 */
export function mergeRewrites(model: RewriteResponse, rules: RewriteResponse, existing: ExistingCard[], minConfidence?: number): RewriteResponse {
  const fromModel = new Map(model.cards.map((c) => [c.candidate_id, c]));
  const fromRules = new Map(rules.cards.map((c) => [c.candidate_id, c]));
  const ids = new Set([...fromRules.keys(), ...fromModel.keys()]);
  const cards: RewriteResponse['cards'] = [];
  let used = 0;
  for (const id of ids) {
    const m = fromModel.get(id);
    const ok = m && !checkCard({ ...m, card_type: m.card_type === 'cloze' ? 'cloze' : 'term_def' }, existing, minConfidence);
    const pick = ok ? m : fromRules.get(id) ?? m;
    if (ok) used++;
    if (pick) cards.push(pick);
  }
  return {
    cards,
    model: used === 0 ? rules.model : used === ids.size ? model.model : `${model.model}+${rules.model}`,
    prompt_version: used === 0 ? rules.prompt_version : model.prompt_version,
    raw_output: { model: model.raw_output, rules: rules.raw_output },
  };
}
