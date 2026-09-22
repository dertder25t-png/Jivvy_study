import { describe, expect, it } from 'vitest';
import { extractCandidates } from './extract';
import { evaluateGeneration } from './pipeline';
import { clozeBlanked } from './reject';
import { RULES_MODEL, rewriteLocally, sentences } from './rewrite';

/** Run Stages 1–3 on a note and return the cards, keyed by term. */
function run(note: string) {
  const candidates = extractCandidates(note);
  const response = rewriteLocally(candidates);
  const items = evaluateGeneration({ candidates, response, existing: [] });
  return { response, items, byTerm: new Map(items.map((i) => [i.card?.term ?? '', i])) };
}

describe('rule-based rewrite (Stage 2, no AI)', () => {
  const note = `# Operant conditioning
Operant conditioning is a type of learning in which behavior is strengthened or weakened by its consequences. It was studied by Skinner.

**Reinforcement** — a consequence that increases the likelihood of a behavior.
**Extinction**: according to the professor, the gradual weakening of a learned response when reinforcement stops (e.g. a rat stops pressing the lever).
Negative reinforcement: the removal of an unpleasant stimulus to increase a behavior, and it is often confused with punishment.
- Pavlov – studied classical conditioning using dogs and a bell
- B. F. Skinner – developed the operant chamber to study rats
Homeostasis refers to the tendency of the body to maintain a stable internal environment, which involves feedback loops, hormones, temperature regulation, fluid balance, blood sugar, and many other interacting systems across organs.
The mitochondria (the organelle where cellular respiration produces most of the cell's ATP) is important.
| Mitosis | Cell division that produces two identical daughter cells |
Photosynthesis: Photosynthesis is how plants turn light into chemical energy.
`;

  it('turns every pattern in a realistic note into a card Stage 3 accepts', () => {
    const { items, response } = run(note);
    expect(response.model).toBe(RULES_MODEL);
    expect(items).toHaveLength(10);
    expect(items.filter((i) => i.rejectedBy)).toEqual([]);
  });

  it('drops the "X is" subject and rewrites possessive pronouns so the card stands alone', () => {
    const card = run(note).byTerm.get('Operant conditioning')!.card!;
    expect(card.definition).toBe('A type of learning in which behavior is strengthened or weakened by the consequences.');
  });

  it('strips "according to the professor" and e.g. asides', () => {
    expect(run(note).byTerm.get('Extinction')!.card!.definition).toBe(
      'The gradual weakening of a learned response when reinforcement stops.',
    );
  });

  it('keeps only the first clause of a compound definition', () => {
    expect(run(note).byTerm.get('Negative reinforcement')!.card!.definition).toBe(
      'The removal of an unpleasant stimulus to increase a behavior.',
    );
  });

  it('cuts an over-long definition before "which", not in the middle of a list', () => {
    expect(run(note).byTerm.get('Homeostasis')!.card!.definition).toBe(
      'The tendency of the body to maintain a stable internal environment.',
    );
  });

  it('drops a definition that restates its own term', () => {
    expect(run(note).byTerm.get('Photosynthesis')!.card!.definition).toBe('How plants turn light into chemical energy.');
  });

  it('makes a fill-in-the-blank for a fact about a person', () => {
    const item = [...run(note).items].find((i) => i.card?.cloze_text?.includes('Pavlov'))!;
    expect(item.card!.card_type).toBe('cloze');
    expect(clozeBlanked(item.card!.cloze_text!)).toBe('[…] studied classical conditioning using dogs and a bell.');
    expect(item.card!.term).toBe('Classical conditioning using dogs');
  });

  it('never invents words that are not in the note', () => {
    const noteWords = new Set(note.toLowerCase().match(/[a-z']+/g));
    noteWords.add('the'); // "its" → "the" is the only substitution
    for (const i of run(note).items) {
      for (const w of i.card!.definition.toLowerCase().match(/[a-z']+/g)!) expect(noteWords).toContain(w);
    }
  });

  it('leaves passages it cannot fix for Stage 3 to reject, with a reason', () => {
    const { items } = run('Entropy: it goes up over time and they say nobody can stop it happening anywhere.');
    expect(items).toHaveLength(1);
    expect(items[0].rejectedBy).toBe('pronoun');
  });

  it('splits sentences without breaking on abbreviations', () => {
    expect(sentences('Dr. Smith uses e.g. rats. Then mice.')).toEqual(['Dr. Smith uses e.g. rats.', 'Then mice.']);
  });
});
