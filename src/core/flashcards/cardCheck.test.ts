import { describe, expect, it } from 'vitest';
import { blankTerm, checkCards, listItems, splitCard, stripPartLabel, type CheckInput } from './cardCheck';

const input = (id: string, term: string, definition: string, over: Partial<CheckInput> = {}): CheckInput => ({
  card: { id, term, definition, created_at: `2026-09-2${id.length % 10}T00:00:00Z` },
  misses: 0,
  ...over,
});

describe('listItems', () => {
  it('reads one-per-line, numbered, semicolon and comma lists', () => {
    expect(listItems('Reuben\nSimeon\nLevi\nJudah')?.items).toEqual(['Reuben', 'Simeon', 'Levi', 'Judah']);
    expect(listItems('The tribes:\n1. Reuben\n2. Simeon\n3. Levi')?.items).toEqual(['Reuben', 'Simeon', 'Levi']);
    expect(listItems('1) love 2) joy 3) peace')?.items).toEqual(['love', 'joy', 'peace']);
    expect(listItems('fear of loss; pride; envy')?.items).toEqual(['fear of loss', 'pride', 'envy']);
    expect(listItems('Love, joy, peace, patience and kindness')?.items).toEqual(['love', 'joy', 'peace', 'patience', 'kindness'].map((w, i) => (i === 0 ? 'Love' : w)));
  });

  it("doesn't mistake an ordinary sentence for a list", () => {
    expect(listItems('The powerhouse of the cell, where respiration happens.')).toBeNull();
    expect(listItems('Moses led the Israelites out of Egypt, across the Red Sea, and to Sinai where he received the law.')).toBeNull();
  });
});

describe('splitCard', () => {
  it('splits a long list into even groups of about three, keeping the question on each part', () => {
    const parts = splitCard('Name the fruits of the Spirit?', 'love, joy, peace, patience, kindness, goodness, faithfulness, gentleness, self-control');
    expect(parts).toEqual([
      { term: 'Name the fruits of the Spirit? (1–3 of 9)', definition: 'love, joy, peace' },
      { term: 'Name the fruits of the Spirit? (4–6 of 9)', definition: 'patience, kindness, goodness' },
      { term: 'Name the fruits of the Spirit? (7–9 of 9)', definition: 'faithfulness, gentleness, self-control' },
    ]);
  });

  it('keeps line-per-item lists as lines, and balances uneven groups', () => {
    const parts = splitCard('Days of creation', 'light\nsky\nland\nsun and moon\nfish and birds\nanimals and people\nrest');
    expect(parts?.map((p) => p.definition)).toEqual(['light\nsky\nland', 'sun and moon\nfish and birds', 'animals and people\nrest']);
  });

  it('leaves short lists and short answers alone', () => {
    expect(splitCard('Primary colors', 'red, yellow, blue')).toBeNull();
    expect(splitCard('Who led the Exodus?', 'Moses')).toBeNull();
  });

  it('splits a long multi-sentence answer into one idea per card', () => {
    const parts = splitCard(
      'Abraham',
      'He was called by God to leave his home in Ur and go to Canaan. God promised him descendants as many as the stars. He was willing to offer Isaac as a sacrifice.',
    );
    expect(parts?.length).toBe(3);
    expect(parts?.[0].term).toBe('Abraham (part 1 of 3)');
    expect(parts?.[2].definition).toBe('He was willing to offer Isaac as a sacrifice.');
  });

  it("re-splitting a part doesn't stack labels", () => {
    expect(stripPartLabel('Days of creation (1–3 of 7)')).toBe('Days of creation');
    expect(stripPartLabel('Abraham (part 2 of 3)')).toBe('Abraham');
  });
});

describe('blankTerm', () => {
  it('blanks a short term that appears in its own answer', () => {
    expect(blankTerm('Covenant', 'A covenant is a binding promise between God and people')).toBe('A ___ is a binding promise between God and people');
    expect(blankTerm('Who was the first king of Israel?', 'Saul, the first king of Israel')).toBeNull(); // questions aren't "terms"
    expect(blankTerm('Sabbath', 'The seventh day, set apart for rest')).toBeNull();
  });
});

describe('checkCards', () => {
  it("flags the newer copy of a duplicate (never the oldest), even across sets", () => {
    const old = input('a', 'Who built the ark?', 'Noah', { setTitle: 'Bible test 1' });
    const copy = { ...input('bb', 'who built the ark', 'Noah.', { setTitle: 'Bible test 1 (again)' }), card: { id: 'bb', term: 'who built the ark', definition: 'Noah.', created_at: '2026-09-25T00:00:00Z' } };
    const advice = checkCards([old, copy]);
    expect(advice).toHaveLength(1);
    expect(advice[0]).toMatchObject({ kind: 'duplicate', cardId: 'bb', fix: { type: 'delete' } });
    expect(advice[0].reason).toContain('"Bible test 1"');
  });

  it('puts splits for cards you keep missing first, and explains why', () => {
    const list = 'love, joy, peace, patience, kindness, goodness, faithfulness, gentleness, self-control';
    const advice = checkCards([
      input('a', 'Fruits of the Spirit', list),
      input('b', 'Missed list', list.replace('love', 'hope'), { misses: 3 }),
    ]);
    expect(advice.map((x) => x.cardId)).toEqual(['b', 'a']);
    expect(advice[0].title).toBe('Long list — split into 3 cards');
    expect(advice[0].reason).toContain('missed it 3 times');
  });

  it('suggests swapping a flipped card and blanking a giveaway answer', () => {
    const advice = checkCards([
      input('a', 'Noah', 'Who built the ark?'),
      input('b', 'Covenant', 'A covenant is a binding promise between God and people'),
    ]);
    expect(advice.find((x) => x.cardId === 'a')).toMatchObject({ kind: 'swap', fix: { type: 'update', term: 'Who built the ark?', definition: 'Noah' } });
    expect(advice.find((x) => x.cardId === 'b')?.kind).toBe('circular');
  });

  it('leaves normal question-and-answer cards alone, and flags ones that keep slipping', () => {
    const advice = checkCards([
      input('a', 'What did God create on the fourth day of creation according to Genesis?', 'The sun, moon and stars'),
      input('b', 'Who was swallowed by a great fish?', 'Jonah', { misses: 4 }),
    ]);
    expect(advice).toHaveLength(1);
    expect(advice[0]).toMatchObject({ kind: 'hard', cardId: 'b', fix: null });
  });
});
