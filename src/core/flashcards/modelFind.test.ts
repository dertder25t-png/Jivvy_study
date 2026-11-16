import { describe, expect, it } from 'vitest';
import { extractCandidates } from './extract';
import { foundToCandidates, groundedShare, noteBlocks } from './modelFind';
import { evaluateGeneration } from './pipeline';

const note = `# Memory
So today we talked about memory. Short term memory only holds about 7 items for 20-30 seconds unless you rehearse them. Chunking is grouping info into bigger meaningful units so you can remember more. Exam is on friday!!
Also Ebbinghaus found that we forget most new info within a day, the forgetting curve.

# Learning
**Reinforcement** — a consequence that increases the likelihood of a behavior.
`;

describe('a note with no definitions', () => {
  it('keeps nothing the model makes up for a grocery list', () => {
    const list = 'Grocery list: eggs, milk. Call mom at 5 and ask about the weekend plans.';
    const blocks = noteBlocks(list);
    // What the model actually said for this note.
    const found = [
      { block_id: 'b1', term: 'Eggs', definition: 'Food that is needed for making omelets.' },
      { block_id: 'b1', term: 'Call mom', definition: "Tell mom you're going to the store." },
      { block_id: 'b1', term: '5', definition: 'Time to call mom.' },
    ];
    expect(foundToCandidates(list, blocks, found, []).cards).toEqual([]);
  });
});

describe('noteBlocks', () => {
  it('splits at headings and keeps offsets that point back into the note', () => {
    const blocks = noteBlocks(note);
    expect(blocks).toHaveLength(2);
    for (const b of blocks) expect(note.slice(b.start, b.end)).toBe(b.text);
    expect(blocks[0].text.startsWith('# Memory')).toBe(true);
    expect(blocks[1].text.startsWith('# Learning')).toBe(true);
  });

  it('cuts very long sections into pieces the model can read', () => {
    const long = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} has quite a few words in it to make the section long enough to split.`).join('\n\n');
    const blocks = noteBlocks(long);
    expect(blocks.length).toBeGreaterThan(1);
    for (const b of blocks) expect(b.text.length).toBeLessThanOrEqual(900);
  });
});

describe('foundToCandidates', () => {
  const blocks = noteBlocks(note);
  const rules = extractCandidates(note);
  // What the model actually said for this note, junk included.
  const found = [
    { block_id: 'b1', term: 'short term memory', definition: 'holds about 7 items for 20-30 seconds unless rehearsed.' },
    { block_id: 'b1', term: 'chunking', definition: 'groups information into bigger meaningful units to remember more.' },
    { block_id: 'b1', term: 'exam', definition: 'on friday.' },
    { block_id: 'b1', term: 'forgetting curve', definition: 'most new info is forgotten within a day.' },
    { block_id: 'b1', term: 'Working memory', definition: 'a limited system that manipulates information during complex tasks.' },
    { block_id: 'b1', term: 'Chunking', definition: 'grouping info into meaningful units.' },
    { block_id: 'b2', term: 'Reinforcement', definition: 'a consequence that increases the likelihood of a behavior.' },
    { block_id: 'b1', term: 'Memory', definition: 'what we talked about today in class.' },
    { block_id: 'b1', term: 'Ebbinghaus', definition: 'a German scientist who invented nonsense syllables in 1885.' },
  ];
  const { candidates, cards } = foundToCandidates(note, blocks, found, rules);
  const terms = cards.map((c) => c.term);

  it('keeps real definitions the rules missed, including a bold term buried under a heading', () => {
    expect(terms).toEqual(['Short term memory', 'Chunking', 'Forgetting curve', 'Reinforcement']);
  });

  it('drops labels, made-up terms, made-up facts, repeats, and what the rules already found', () => {
    expect(terms).not.toContain('Exam'); // a label, not a term
    expect(terms).not.toContain('Working memory'); // not in the note
    expect(terms).not.toContain('Ebbinghaus'); // "German", "1885"… not in the note
    expect(terms.filter((t) => t === 'Chunking')).toHaveLength(1);
    expect(terms).not.toContain('Memory'); // the heading rule already made this card
  });

  it('points each card at the line it came from and passes the normal checks', () => {
    for (const c of candidates) {
      expect(c.pattern_type).toBe('model_found');
      expect(note.slice(c.span_start, c.span_end)).toBe(c.text);
      expect(c.text.toLowerCase()).toContain(c.term_hint!.toLowerCase().split(' ')[0]);
    }
    const items = evaluateGeneration({ candidates, response: { cards, model: 'npu:test', prompt_version: 'x', raw_output: null }, existing: [] });
    expect(items.filter((i) => i.rejectedBy).map((i) => i.card?.term)).toEqual([]);
  });

  it('measures how much of a definition comes from the note', () => {
    expect(groundedShare('holds about 7 items unless rehearsed', note)).toBe(1);
    expect(groundedShare('a German scientist from 1885', note)).toBeLessThan(0.6);
  });
});
