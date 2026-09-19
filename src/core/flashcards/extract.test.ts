import { describe, expect, it } from 'vitest';
import { extractCandidates } from './extract';

const types = (body: string) => extractCandidates(body).map((c) => c.pattern_type);

describe('extractCandidates (stage 1)', () => {
  it('drops narrative prose entirely', () => {
    const body = `Today the professor walked in late and talked about her weekend.
Then we moved on to the next slide and she asked if anyone had questions about the exam.
Remember to bring a pencil on Thursday.`;
    expect(extractCandidates(body)).toEqual([]);
  });

  it('finds bold_term with dash, colon and "is"', () => {
    const body = [
      '**Reinforcement** — a consequence that increases the likelihood of a behavior.',
      '- **Punishment**: a consequence that decreases the likelihood of a behavior.',
      'In this unit, **extinction** is the gradual weakening of a learned response.',
    ].join('\n');
    const c = extractCandidates(body);
    expect(c.map((x) => x.pattern_type)).toEqual(['bold_term', 'bold_term', 'bold_term']);
    expect(c.map((x) => x.term_hint)).toEqual(['Reinforcement', 'Punishment', 'extinction']);
    // spans point back to the exact source text
    for (const cand of c) expect(body.slice(cand.span_start, cand.span_end)).toBe(cand.text);
  });

  it('does not treat bold text without an explanation as a term', () => {
    expect(extractCandidates('**Important!** Study this.')).toEqual([]);
  });

  it('finds colon_def and ignores label lines', () => {
    const body = `Classical conditioning: learning that occurs when a neutral stimulus becomes associated with a meaningful one.
Note: the exam is next Thursday at 9am in the main hall.
Due: Friday before midnight, submitted through the portal.`;
    const c = extractCandidates(body);
    expect(c).toHaveLength(1);
    expect(c[0].pattern_type).toBe('colon_def');
    expect(c[0].term_hint).toBe('Classical conditioning');
  });

  it('finds is_defined_as phrasing', () => {
    const body =
      'Homeostasis refers to the tendency of an organism to maintain a stable internal state. Later we saw examples.';
    const c = extractCandidates(body);
    expect(c).toHaveLength(1);
    expect(c[0].pattern_type).toBe('is_defined_as');
    expect(c[0].term_hint).toBe('Homeostasis');
    expect(c[0].text).not.toContain('Later');
  });

  it('skips pronoun subjects for "means"', () => {
    expect(extractCandidates('This means that we should review the chapter before Friday.')).toEqual([]);
  });

  it('finds heading_body but not generic headings', () => {
    const body = `## Operant conditioning
Learning in which behavior is strengthened or weakened by its consequences.

## Summary
Everything above will be on the midterm, so make sure you read all of it.`;
    const c = extractCandidates(body);
    expect(c).toHaveLength(1);
    expect(c[0].pattern_type).toBe('heading_body');
    expect(c[0].term_hint).toBe('Operant conditioning');
  });

  it('finds glossary_row and skips header + separator', () => {
    const body = `| Term | Definition |
|------|------------|
| Schema | A mental framework that organizes knowledge |
| Assimilation | Fitting new information into an existing schema |`;
    const c = extractCandidates(body);
    expect(c.map((x) => x.pattern_type)).toEqual(['glossary_row', 'glossary_row']);
    expect(c.map((x) => x.term_hint)).toEqual(['Schema', 'Assimilation']);
  });

  it('finds named_list_item only for runs of 2+', () => {
    const run = `1. Sensorimotor – birth to two years, learning through senses and actions
2. Preoperational – two to seven years, symbolic thought without logic`;
    expect(types(run)).toEqual(['named_list_item', 'named_list_item']);
    expect(types('1. Sensorimotor – birth to two years, learning through senses and actions')).toEqual([]);
  });

  it('finds parenthetical_def', () => {
    const body = 'Neurons rely on myelination (the process by which axons are wrapped in a fatty insulating sheath) for speed.';
    const c = extractCandidates(body);
    expect(c).toHaveLength(1);
    expect(c[0].pattern_type).toBe('parenthetical_def');
    expect(c[0].term_hint).toContain('myelination');
  });

  it('never returns overlapping spans', () => {
    const body = `## Reinforcement
**Reinforcement** — a consequence that increases the likelihood of a behavior.
- **Positive**: adding a pleasant stimulus after a behavior occurs.
- **Negative**: removing an unpleasant stimulus after a behavior occurs.`;
    const c = extractCandidates(body);
    for (let i = 1; i < c.length; i++) expect(c[i].span_start).toBeGreaterThanOrEqual(c[i - 1].span_end);
  });
});
