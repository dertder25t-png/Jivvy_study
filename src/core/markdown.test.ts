import { describe, expect, it } from 'vitest';
import { countWords, parseBlocks, parseInline, type Inline } from './markdown';

const flat = (nodes: Inline[]): string =>
  nodes
    .map((n) => (n.t === 'text' || n.t === 'code' ? n.v : flat(n.c)))
    .join('');

describe('parseInline', () => {
  it('handles bold, italic, strike, highlight and code', () => {
    const n = parseInline('a **bold** and *ital* and ~~gone~~ and ==hot== and `x`');
    expect(n.map((x) => x.t)).toEqual(['text', 'bold', 'text', 'italic', 'text', 'strike', 'text', 'mark', 'text', 'code']);
  });
  it('nests italic inside bold and keeps snake_case intact', () => {
    const [b] = parseInline('**very _important_ thing**');
    expect(b.t).toBe('bold');
    expect(parseInline('use snake_case_names here')).toEqual([{ t: 'text', v: 'use snake_case_names here' }]);
  });
  it('renders links and wikilinks as their label', () => {
    expect(parseInline('[[Note title|shown]]')).toEqual([{ t: 'text', v: 'shown' }]);
    const [l] = parseInline('[site](https://x.dev)');
    expect(l).toMatchObject({ t: 'link', href: 'https://x.dev' });
  });
  it('does not treat stray asterisks or lone bullets as emphasis', () => {
    expect(flat(parseInline('2 * 3 * 4'))).toBe('2 * 3 * 4');
    expect(flat(parseInline('**unterminated'))).toBe('**unterminated');
  });
});

describe('parseBlocks', () => {
  it('parses the structure from a real study note', () => {
    const md = `# Bible Doctrines II
## 1. Introduction: Why Study?
Studying doctrines is essential:
- **To Discern Truth:** frameworks
  - **Chronological:** start to finish
  - **Expositional:** broad-reaching
- To Mature

> [!info] Branches of Systematic Theology
> - **Anthropology:** Man created
> - **Hamartiology:** Man fallen

---
1. First
2. Second
   1. Nested`;
    const b = parseBlocks(md);
    expect(b.map((x) => x.t)).toEqual(['heading', 'heading', 'para', 'list', 'callout', 'hr', 'list']);
    const list = b[3];
    expect(list.t === 'list' && list.items.map((i) => i.depth)).toEqual([0, 1, 1, 0]);
    const callout = b[4];
    expect(callout.t === 'callout' && callout.kind).toBe('info');
    expect(callout.t === 'callout' && flat(callout.title)).toBe('Branches of Systematic Theology');
    expect(callout.t === 'callout' && callout.blocks[0].t).toBe('list');
    const ordered = b[6];
    expect(ordered.t === 'list' && ordered.items.map((i) => `${i.depth}:${i.n}`)).toEqual(['0:1', '0:2', '1:1']);
  });

  it('keeps single line breaks inside a paragraph', () => {
    const [p] = parseBlocks('line one\nline two');
    expect(p.t === 'para' && flat(p.inline)).toBe('line one\nline two');
  });

  it('parses tasks, quotes, code fences and tables', () => {
    const b = parseBlocks('- [ ] todo\n- [x] done\n\n> plain quote\n\n```js\nconst a = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |');
    expect(b.map((x) => x.t)).toEqual(['list', 'quote', 'code', 'table']);
    const list = b[0];
    expect(list.t === 'list' && list.items.map((i) => i.task)).toEqual([false, true]);
    const code = b[2];
    expect(code.t === 'code' && code.text).toBe('const a = 1;');
    const table = b[3];
    expect(table.t === 'table' && table.rows).toHaveLength(1);
  });

  it('never loops or throws on messy input', () => {
    expect(() => parseBlocks('```\nunclosed\n> [!x]\n|||\n- \n#\n')).not.toThrow();
    expect(parseBlocks('')).toEqual([]);
  });

  it('counts words', () => {
    expect(countWords('  one two\nthree ')).toBe(3);
    expect(countWords('')).toBe(0);
  });
});
