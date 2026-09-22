import { describe, expect, it } from 'vitest';
import { parseCSV, parseJSON, parseQuizletPaste, parseTSV, validateImportedCard } from './importNotes';

describe('parseCSV', () => {
  it('splits term,definition rows and skips a header', () => {
    const csv = 'term,definition\nMitosis,Cell division that produces two identical cells\nMeiosis,Cell division that produces gametes';
    expect(parseCSV(csv)).toEqual([
      { term: 'Mitosis', definition: 'Cell division that produces two identical cells' },
      { term: 'Meiosis', definition: 'Cell division that produces gametes' },
    ]);
  });

  it('handles quoted fields containing the delimiter', () => {
    const csv = '"Newton\'s law","Force, mass, and acceleration"';
    expect(parseCSV(csv)).toEqual([{ term: "Newton's law", definition: 'Force, mass, and acceleration' }]);
  });

  it('joins extra comma-separated parts into the definition', () => {
    const csv = 'Term,part one,part two';
    expect(parseCSV(csv)).toEqual([{ term: 'Term', definition: 'part one, part two' }]);
  });
});

describe('parseTSV', () => {
  it('splits tab-separated rows (Quizlet export format)', () => {
    const tsv = 'Photosynthesis\tHow plants convert light into energy\nRespiration\tHow cells release energy';
    expect(parseTSV(tsv)).toEqual([
      { term: 'Photosynthesis', definition: 'How plants convert light into energy' },
      { term: 'Respiration', definition: 'How cells release energy' },
    ]);
  });
});

describe('parseJSON', () => {
  it('handles a plain array of term/definition objects', () => {
    expect(parseJSON('[{"term":"A","definition":"first"},{"term":"B","definition":"second"}]')).toEqual([
      { term: 'A', definition: 'first' },
      { term: 'B', definition: 'second' },
    ]);
  });

  it('handles alternate key names (q/a, word/def, front/back)', () => {
    expect(parseJSON('[{"q":"A","a":"first"},{"word":"B","def":"second"},{"front":"C","back":"third"}]')).toEqual([
      { term: 'A', definition: 'first' },
      { term: 'B', definition: 'second' },
      { term: 'C', definition: 'third' },
    ]);
  });

  it('handles wrapped shapes like {flashcards: [...]} and {cards: [...]}', () => {
    expect(parseJSON('{"flashcards":[{"word":"A","definition":"first"}]}')).toEqual([{ term: 'A', definition: 'first' }]);
    expect(parseJSON('{"cards":[{"term":"A","definition":"first"}]}')).toEqual([{ term: 'A', definition: 'first' }]);
  });

  it('handles [term, definition] tuples', () => {
    expect(parseJSON('[["A","first"],["B","second"]]')).toEqual([
      { term: 'A', definition: 'first' },
      { term: 'B', definition: 'second' },
    ]);
  });

  it('returns an empty array for invalid JSON instead of throwing', () => {
    expect(parseJSON('not json')).toEqual([]);
  });
});

describe('parseQuizletPaste', () => {
  it('parses tab-between-term-and-definition, newline-between-cards (Quizlet default)', () => {
    const pasted = 'Mitosis\tCell division that produces two identical cells\nMeiosis\tCell division that produces gametes';
    expect(parseQuizletPaste(pasted)).toEqual([
      { term: 'Mitosis', definition: 'Cell division that produces two identical cells' },
      { term: 'Meiosis', definition: 'Cell division that produces gametes' },
    ]);
  });

  it('supports custom separators', () => {
    const pasted = 'Mitosis::cell division; Meiosis::gamete formation';
    expect(parseQuizletPaste(pasted, '::', ';')).toEqual([
      { term: 'Mitosis', definition: 'cell division' },
      { term: 'Meiosis', definition: 'gamete formation' },
    ]);
  });

  it('falls back to a comma or dash when the chosen separator is missing from a row', () => {
    const pasted = 'Mitosis - cell division\nMeiosis, gamete formation';
    expect(parseQuizletPaste(pasted, '\t', '\n')).toEqual([
      { term: 'Mitosis', definition: 'cell division' },
      { term: 'Meiosis', definition: 'gamete formation' },
    ]);
  });

  it('skips blank rows and rows without a recognizable separator', () => {
    const pasted = 'Mitosis\tcell division\n\njust some prose with no separator';
    expect(parseQuizletPaste(pasted)).toEqual([{ term: 'Mitosis', definition: 'cell division' }]);
  });
});

describe('validateImportedCard', () => {
  it('rejects cards missing a term or definition', () => {
    expect(validateImportedCard({ term: 'A', definition: 'b' })).toBe(true);
    expect(validateImportedCard({ term: '', definition: 'b' })).toBe(false);
    expect(validateImportedCard({ term: 'A', definition: '  ' })).toBe(false);
  });
});
