import { describe, expect, it } from 'vitest';
import {
  buildVault, checkboxKey, enterKey, firstLineTitle, indentKey, noteMarkdown, noteToMarkdownFile, safeFileName, toggleTask, uniqueName, wrapKey,
} from './noteText';
import { bodyToOutline, outlineToMarkdown } from './outline';
import { crc32, makeZip } from './zip';

const at = (text: string, pos: number) => ({ start: pos, end: pos });

describe('noteMarkdown (existing notes keep every word)', () => {
  it('uses the body an outline note already mirrored', () => {
    const outline = bodyToOutline('- Cells\n  - Nucleus\n  - [x] Mitochondria');
    const body = outlineToMarkdown(outline);
    expect(noteMarkdown({ body, outline })).toBe('- Cells\n  - Nucleus\n  - [x] Mitochondria');
  });
  it('falls back to the tree only when the body is empty', () => {
    expect(noteMarkdown({ body: '', outline: bodyToOutline('- kept') })).toBe('- kept');
    expect(noteMarkdown({ body: '', outline: bodyToOutline('') })).toBe('');
    expect(noteMarkdown({ body: '', outline: null })).toBe('');
  });
});

describe('enterKey', () => {
  it('continues a bullet', () => {
    const r = enterKey('- one', at('- one', 5))!;
    expect(r.text).toBe('- one\n- ');
    expect(r.sel.start).toBe(8);
  });
  it('keeps indentation and numbers', () => {
    expect(enterKey('  1. a', at('', 6))!.text).toBe('  1. a\n  2. ');
  });
  it('starts a fresh checkbox', () => {
    expect(enterKey('- [x] done', at('', 10))!.text).toBe('- [x] done\n- [ ] ');
  });
  it('an empty item ends the list', () => {
    const r = enterKey('- a\n- ', at('', 6))!;
    expect(r.text).toBe('- a\n');
    expect(r.sel.start).toBe(4);
  });
  it('an empty nested item outdents first', () => {
    expect(enterKey('- a\n  - ', at('', 8))!.text).toBe('- a\n- ');
  });
  it('plain lines get a plain newline', () => {
    expect(enterKey('hello', at('', 5))).toBeNull();
  });
});

describe('indentKey', () => {
  it('nests a list item by two spaces', () => {
    const r = indentKey('- a\n- b', at('', 7), false);
    expect(r.text).toBe('- a\n  - b');
    expect(r.sel.start).toBe(9);
  });
  it('outdents', () => {
    expect(indentKey('- a\n  - b', at('', 9), true).text).toBe('- a\n- b');
  });
  it('indents every selected line', () => {
    const r = indentKey('- a\n- b\n- c', { start: 0, end: 7 }, false);
    expect(r.text).toBe('  - a\n  - b\n- c');
    expect(r.sel).toEqual({ start: 2, end: 11 });
  });
  it('inserts spaces mid plain text', () => {
    expect(indentKey('ab', at('', 1), false).text).toBe('a  b');
  });
});

describe('wrapKey', () => {
  it('wraps and unwraps', () => {
    const w = wrapKey('a word here', { start: 2, end: 6 }, '**');
    expect(w.text).toBe('a **word** here');
    expect(wrapKey(w.text, w.sel, '**').text).toBe('a word here');
  });
});

describe('toggleTask', () => {
  it('flips the n-th checkbox only, skipping code', () => {
    const md = '- [ ] a\n```\n- [ ] not me\n```\n- [x] b';
    expect(toggleTask(md, 1)).toBe('- [ ] a\n```\n- [ ] not me\n```\n- [ ] b');
    expect(toggleTask(md, 0)).toBe('- [x] a\n```\n- [ ] not me\n```\n- [x] b');
  });
});

describe('file names', () => {
  it('strips characters files cannot have', () => {
    expect(safeFileName('a/b: c?')).toBe('a b c');
    expect(safeFileName('  ...  ')).toBe('Untitled');
  });
  it('dedupes', () => {
    const t = new Set<string>();
    expect([uniqueName('A', t), uniqueName('a', t), uniqueName('A', t)]).toEqual(['A', 'a 2', 'A 3']);
  });
  it('titles untitled notes from their first line', () => {
    expect(firstLineTitle('\n- [ ] **Read** ch 3\nmore')).toBe('Read ch 3');
  });
});

describe('export', () => {
  const note = { id: 'n1', title: 'Cells: intro', body: '# Hi\ntext', course_id: 'c1', parent_note_id: null, created_at: '2026-09-01T10:00:00.000Z', updated_at: '2026-09-02T10:00:00.000Z' };
  it('writes properties then the untouched body', () => {
    const md = noteToMarkdownFile(note, { course: 'BIO 101' });
    expect(md).toBe('---\ntitle: "Cells: intro"\ncourse: BIO 101\ncreated: 2026-09-01T10:00:00.000Z\nupdated: 2026-09-02T10:00:00.000Z\n---\n\n# Hi\ntext\n');
  });
  it('builds a vault with course folders and parent links', () => {
    const files = buildVault(
      [note, { ...note, id: 'n2', title: 'Cells: intro', parent_note_id: 'n1', created_at: '2026-09-03T00:00:00Z' }, { ...note, id: 'n3', title: null, body: 'loose', course_id: null }],
      [{ id: 'c1', name: 'Biology', code: 'BIO 101' }],
    );
    expect(files.map((f) => f.path)).toEqual(['BIO 101 Biology/Cells intro.md', 'Inbox/loose.md', 'BIO 101 Biology/Cells intro 2.md']);
    expect(files[2].content).toContain('parent: "[[Cells intro]]"');
  });
});

describe('zip', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('lays out headers, data and the directory', () => {
    const z = makeZip([{ path: 'a.md', content: 'hé' }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const data = new TextEncoder().encode('hé');
    expect(z.length).toBe(30 + 4 + data.length + 46 + 4 + 22);
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50);
    expect(v.getUint16(z.length - 22 + 10, true)).toBe(1);
  });
});

describe('checkboxKey', () => {
  it('adds a box, ticks it, unticks it', () => {
    const a = checkboxKey('buy milk', at('', 3));
    expect(a.text).toBe('- [ ] buy milk');
    expect(a.sel.start).toBe(9);
    const b = checkboxKey(a.text, a.sel);
    expect(b.text).toBe('- [x] buy milk');
    expect(checkboxKey(b.text, b.sel).text).toBe('- [ ] buy milk');
    expect(checkboxKey('  - item', at('', 8)).text).toBe('  - [ ] item');
  });
});

// Every editing key must leave the rest of the note exactly as it was. Run each key at every cursor
// position of a realistic note and check nothing outside the edited line(s) changed.
describe('editing keys never touch text outside the current line', () => {
  const note = '# Title\n- a\n  - [ ] b\n  - \n- \n> quote\n> \n1. one\n\nplain line\n- last';
  const linesOf = (t: string) => t.split('\n');
  for (let pos = 0; pos <= note.length; pos++) {
    const lineNo = note.slice(0, pos).split('\n').length - 1;
    const check = (name: string, after: string | null, extraLines: number) => {
      if (after === null) return;
      const a = linesOf(note);
      const b = linesOf(after);
      it(`${name} @${pos}`, () => {
        expect(b.slice(0, lineNo)).toEqual(a.slice(0, lineNo));
        expect(b.slice(lineNo + 1 + extraLines)).toEqual(a.slice(lineNo + 1));
      });
    };
    const enter = enterKey(note, at('', pos));
    if (enter) check('enter', enter.text, linesOf(enter.text).length - linesOf(note).length);
    check('tab', indentKey(note, at('', pos), false).text, 0);
    check('shift-tab', indentKey(note, at('', pos), true).text, 0);
    check('checkbox', checkboxKey(note, at('', pos)).text, 0);
  }
  it('never loses a letter overall (Enter, Tab, Shift+Tab, Ctrl+Enter)', () => {
    const letters = (t: string) => t.replace(/^\s*\d+[.)]/gm, '').replace(/[^A-Za-z0-9]/g, '');
    const want = letters(note);
    for (let pos = 0; pos <= note.length; pos++) {
      for (const r of [enterKey(note, at('', pos)), indentKey(note, at('', pos), false), indentKey(note, at('', pos), true)]) {
        if (r) expect(letters(r.text)).toBe(want);
      }
      expect(letters(checkboxKey(note, at('', pos)).text).replace(/x/g, '')).toBe(want.replace(/x/g, ''));
    }
  });
});
