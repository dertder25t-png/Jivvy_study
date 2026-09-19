import { describe, expect, it } from 'vitest';
import { checkCard, isCompound, type CardDraft } from './reject';
import { evaluateGeneration, funnel, heuristicRewrite } from './pipeline';
import { extractCandidates } from './extract';

const card = (over: Partial<CardDraft> = {}): CardDraft => ({
  term: 'Operant conditioning',
  definition: 'Learning in which consequences shape how often a behavior occurs.',
  card_type: 'term_def',
  cloze_text: null,
  confidence: 0.9,
  ...over,
});

describe('checkCard (stage 3)', () => {
  it('accepts a clean card', () => {
    expect(checkCard(card(), [])).toBeNull();
  });

  it('rejects circular definitions, stem-insensitively', () => {
    expect(checkCard(card({ definition: 'A form of operant conditioning used in labs.' }), [])).toBe('circular');
    expect(checkCard(card({ term: 'Condition', definition: 'Something that is conditioned by rewards.' }), [])).toBe('circular');
  });

  it('allows a partial overlap with a multi-word term', () => {
    expect(checkCard(card({ definition: 'Learning that happens through conditioning by rewards and penalties.' }), [])).toBeNull();
  });

  it('rejects overlong definitions and terms', () => {
    const long = Array.from({ length: 26 }, (_, i) => `word${i}`).join(' ');
    expect(checkCard(card({ definition: long }), [])).toBe('too_long');
    expect(checkCard(card({ term: 'one two three four five six seven' }), [])).toBe('term_too_long');
  });

  it('rejects sentence-like terms', () => {
    expect(checkCard(card({ term: 'This is a claim.' }), [])).toBe('term_is_sentence');
  });

  it('detects compound definitions', () => {
    expect(isCompound('A stimulus that predicts a reward, and the animal learns to approach it quickly.')).toBe(true);
    expect(isCompound('Learning that links two events; the learner then expects the second.')).toBe(true);
    expect(isCompound('A reward that is given, and then removed, over time.')).toBe(false);
    expect(checkCard(card({ definition: 'Learning by consequences; the learner repeats what works.' }), [])).toBe('compound');
  });

  it('rejects duplicates against the existing deck', () => {
    const deck = [{ term: 'Operant conditioning', definition: 'Learning in which consequences shape how often a behavior occurs.' }];
    expect(checkCard(card(), deck)).toBe('duplicate');
    expect(checkCard(card({ definition: 'Learning where consequences change how often behavior occurs.' }), deck)).toBe('duplicate');
  });

  it('keeps contrast pairs — near-identical definitions under different terms are not duplicates', () => {
    const deck = [{ term: 'Reinforcement', definition: 'A consequence that increases the likelihood of a behavior being repeated.' }];
    const punishment = card({ term: 'Punishment', definition: 'A consequence that decreases the likelihood of a behavior being repeated.' });
    expect(checkCard(punishment, deck)).toBeNull();

    const positive = [{ term: 'Positive reinforcement', definition: 'Adding a pleasant stimulus after a behavior occurs.' }];
    const negative = card({ term: 'Negative reinforcement', definition: 'Removing an unpleasant stimulus after a behavior occurs.' });
    expect(checkCard(negative, positive)).toBeNull();
  });

  it('flags the same term again even with reworded definition, and synonym cards with identical definitions', () => {
    const deck = [{ term: 'Operant conditioning', definition: 'Learning in which consequences shape how often a behavior occurs.' }];
    expect(checkCard(card({ definition: 'Learning where consequences change how often behavior occurs.' }), deck)).toBe('duplicate');
    expect(checkCard(card({ term: 'Instrumental learning', definition: 'Learning in which consequences shape how often a behavior occurs.' }), deck)).toBe('duplicate');
  });

  it('rejects degenerate terms', () => {
    expect(checkCard(card({ term: 'the' }), [])).toBe('degenerate_term');
    expect(checkCard(card({ term: 'It' }), [])).toBe('degenerate_term');
    expect(checkCard(card({ term: '42' }), [])).toBe('degenerate_term');
  });

  it('rejects meta-language', () => {
    expect(checkCard(card({ definition: 'The lecture explains that behavior follows its consequences.' }), [])).toBe('meta_language');
    expect(checkCard(card({ definition: 'According to Skinner, behavior follows its consequences.' }), [])).toBe('meta_language');
  });

  it('rejects pronouns', () => {
    expect(checkCard(card({ definition: 'It changes behavior through consequences.' }), [])).toBe('pronoun');
  });

  it('allows generic we/you — only dangling references count as pronouns', () => {
    expect(checkCard(card({ term: 'Schema', definition: 'A mental framework that organizes what we know about the world.' }), [])).toBeNull();
    expect(checkCard(card({ term: 'Schema', definition: 'A framework that organizes what you already know.' }), [])).toBeNull();
    expect(checkCard(card({ definition: 'They shape behavior through consequences.' }), [])).toBe('pronoun');
    expect(checkCard(card({ definition: 'This changes behavior through consequences.' }), [])).toBe('pronoun');
  });

  it('rejects low confidence and empty output', () => {
    expect(checkCard(card({ confidence: 0.3 }), [])).toBe('low_confidence');
    expect(checkCard(card({ definition: '' }), [])).toBe('empty_output');
    expect(checkCard(null, [])).toBe('empty_output');
  });

  it('validates cloze cards', () => {
    const ok = card({
      card_type: 'cloze',
      definition: 'Extinction is the weakening of a learned response when reinforcement stops.',
      cloze_text: '{{c1::Extinction}} is the weakening of a learned response when reinforcement stops.',
      term: 'Extinction',
    });
    expect(checkCard(ok, [])).toBeNull();
    expect(checkCard({ ...ok, cloze_text: 'No blank anywhere in this sentence at all.' }, [])).toBe('invalid_cloze');
  });
});

describe('evaluateGeneration', () => {
  const body = `**Reinforcement** — a consequence that increases the likelihood of a behavior.
**Punishment** — a consequence that decreases the likelihood of a behavior.
**Shaping** — rewarding successive approximations of a target behavior.`;

  it('logs every candidate: survivors, auto-rejections and skips', () => {
    const cands = extractCandidates(body);
    expect(cands).toHaveLength(3);
    const response = {
      model: 'test',
      prompt_version: 'v-test',
      raw_output: {},
      cards: [
        { candidate_id: 'c1', term: 'Reinforcement', definition: 'A consequence that makes a behavior more likely.', card_type: 'term_def' as const, cloze_text: null, confidence: 0.9 },
        { candidate_id: 'c2', term: 'Punishment', definition: 'Punishment lowers the odds of a behavior.', card_type: 'term_def' as const, cloze_text: null, confidence: 0.9 },
        // c3 skipped by the model
      ],
    };
    const items = evaluateGeneration({ candidates: cands, response, existing: [] });
    expect(items.map((i) => i.rejectedBy)).toEqual([null, 'circular', 'no_output']);
    expect(funnel(items)).toEqual({ total: 3, survived: 1, byReason: { circular: 1, no_output: 1 } });
  });

  it('dedupes within a batch', () => {
    const cands = extractCandidates(body).slice(0, 2);
    const same = { term: 'Reinforcement', definition: 'A consequence that makes a behavior more likely.', card_type: 'term_def' as const, cloze_text: null, confidence: 0.9 };
    const response = {
      model: 't', prompt_version: 'v', raw_output: {},
      cards: [{ candidate_id: 'c1', ...same }, { candidate_id: 'c2', ...same }],
    };
    const items = evaluateGeneration({ candidates: cands, response, existing: [] });
    expect(items.map((i) => i.rejectedBy)).toEqual([null, 'duplicate']);
  });

  it('heuristic fallback produces cards Stage 3 can judge', () => {
    const cands = extractCandidates(body);
    const items = evaluateGeneration({ candidates: cands, response: heuristicRewrite(cands), existing: [] });
    expect(items).toHaveLength(3);
    expect(items.filter((i) => !i.rejectedBy).length).toBeGreaterThan(0);
    expect(items[0].card?.term).toBe('Reinforcement');
  });
});
