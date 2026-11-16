import { describe, expect, it } from 'vitest';
import { extractCandidates } from './extract';
import { evaluateGeneration, mergeRewrites, type RewriteResponse } from './pipeline';
import { RULES_MODEL, rewriteLocally } from './rewrite';

const note = `**Reinforcement** — a consequence that increases the likelihood of a behavior.
**Extinction**: the gradual weakening of a learned response when reinforcement stops.
`;

function modelSaid(cards: RewriteResponse['cards']): RewriteResponse {
  return { cards, model: 'npu:test', prompt_version: 'npu-v1', raw_output: null };
}

describe('merging local-model cards with the rules', () => {
  const candidates = extractCandidates(note);
  const rules = rewriteLocally(candidates);
  const [a, b] = candidates;

  it('uses the model card when it passes, and the rules card when the model slips', () => {
    const model = modelSaid([
      { candidate_id: a.id, term: 'Reinforcement', definition: 'Any consequence that makes a behavior more likely to happen again.', card_type: 'term_def', cloze_text: null, confidence: 0.85 },
      // circular: repeats its own term, so Stage 3 would reject it
      { candidate_id: b.id, term: 'Extinction', definition: 'Extinction is when extinction happens.', card_type: 'term_def', cloze_text: null, confidence: 0.85 },
    ]);
    const merged = mergeRewrites(model, rules, []);
    expect(merged.model).toBe(`npu:test+${RULES_MODEL}`);
    const items = evaluateGeneration({ candidates, response: merged, existing: [] });
    expect(items).toHaveLength(2); // one card per passage, never two
    expect(items.filter((i) => i.rejectedBy)).toEqual([]);
    expect(items[0].card!.definition).toMatch(/^Any consequence/);
    expect(items[1].card!.definition).toBe(rules.cards.find((c) => c.candidate_id === b.id)!.definition);
  });

  it('is just the rules when the model produced nothing usable', () => {
    const merged = mergeRewrites(modelSaid([]), rules, []);
    expect(merged.model).toBe(RULES_MODEL);
    expect(merged.cards).toEqual(rules.cards);
  });
});
