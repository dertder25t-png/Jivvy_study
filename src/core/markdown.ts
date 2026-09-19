// A small markdown reader for the note "reading view". Deliberately NOT an editor and
// not a block model (spec §5.3: plain text + markdown, no blocks/databases/embeds) —
// notes stay plain text; this only decides how to *display* them.
//
// Supported: headings, paragraphs (soft line breaks kept), bullet / numbered / task lists
// (nested by indentation), blockquotes, Obsidian-style callouts (> [!note] Title), fenced
// code, horizontal rules, simple tables, and inline **bold**, *italic*, ~~strike~~,
// ==highlight==, `code`, [links](url) and [[wikilinks]].

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold' | 'italic' | 'strike' | 'mark'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] };

export interface ListItem {
  depth: number;
  ordered: boolean;
  /** 1-based number for ordered items. */
  n: number;
  task: null | boolean;
  inline: Inline[];
}

export type Block =
  | { t: 'heading'; level: number; inline: Inline[] }
  | { t: 'para'; inline: Inline[] }
  | { t: 'hr' }
  | { t: 'code'; lang: string; text: string }
  | { t: 'quote'; blocks: Block[] }
  | { t: 'callout'; kind: string; title: Inline[]; blocks: Block[] }
  | { t: 'list'; items: ListItem[] }
  | { t: 'table'; header: Inline[][]; rows: Inline[][][] };

// ---------------------------------------------------------------- inline
type Pattern = { re: RegExp; make: (m: RegExpExecArray) => Inline | Inline[] };

const PATTERNS: Pattern[] = [
  { re: /`([^`\n]+)`/, make: (m) => ({ t: 'code', v: m[1] }) },
  { re: /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/, make: (m) => ({ t: 'text', v: m[2] ?? m[1] }) },
  { re: /\[([^\]\n]+)\]\(([^)\s]+)\)/, make: (m) => ({ t: 'link', href: m[2], c: parseInline(m[1]) }) },
  { re: /(\*\*|__)(\S(?:.*?\S)?)\1/, make: (m) => ({ t: 'bold', c: parseInline(m[2]) }) },
  { re: /~~(\S(?:.*?\S)?)~~/, make: (m) => ({ t: 'strike', c: parseInline(m[1]) }) },
  { re: /==(\S(?:.*?\S)?)==/, make: (m) => ({ t: 'mark', c: parseInline(m[1]) }) },
  { re: /\*(\S(?:[^*\n]*?\S)?)\*/, make: (m) => ({ t: 'italic', c: parseInline(m[1]) }) },
  {
    // underscores only at word boundaries, so snake_case isn't italicised
    re: /(^|[\s(])_(\S(?:[^_\n]*?\S)?)_(?=$|[\s.,;:!?)])/,
    make: (m) => [...(m[1] ? [{ t: 'text' as const, v: m[1] }] : []), { t: 'italic', c: parseInline(m[2]) }],
  },
];

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let rest = src;
  const pushText = (v: string) => {
    if (!v) return;
    const last = out[out.length - 1];
    if (last?.t === 'text') last.v += v;
    else out.push({ t: 'text', v });
  };
  while (rest.length > 0) {
    let best: { m: RegExpExecArray; p: Pattern } | null = null;
    for (const p of PATTERNS) {
      const m = p.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { m, p };
    }
    if (!best) {
      pushText(rest);
      break;
    }
    pushText(rest.slice(0, best.m.index));
    const made = best.p.make(best.m);
    for (const node of Array.isArray(made) ? made : [made]) {
      if (node.t === 'text') pushText(node.v);
      else out.push(node);
    }
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

// ---------------------------------------------------------------- blocks
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*```\s*(\S*)\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function isBlockStart(line: string, next?: string): boolean {
  return (
    HEADING.test(line) || HR.test(line) || LIST.test(line) || FENCE.test(line) || /^\s*>/.test(line) ||
    (line.includes('|') && next !== undefined && TABLE_SEP.test(next))
  );
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence
      blocks.push({ t: 'code', lang: fence[1], text: body.join('\n') });
      continue;
    }

    const h = line.match(HEADING);
    if (h) {
      blocks.push({ t: 'heading', level: h[1].length, inline: parseInline(h[2]) });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const header = splitRow(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') rows.push(splitRow(lines[i++]).map(parseInline));
      blocks.push({ t: 'table', header, rows });
      continue;
    }

    if (/^\s*>/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) inner.push(lines[i++].replace(/^\s*>\s?/, ''));
      const callout = inner[0]?.match(/^\[!(\w+)\][+-]?\s*(.*)$/);
      if (callout) {
        blocks.push({
          t: 'callout',
          kind: callout[1].toLowerCase(),
          title: parseInline(callout[2] || callout[1][0].toUpperCase() + callout[1].slice(1).toLowerCase()),
          blocks: parseBlocks(inner.slice(1).join('\n')),
        });
      } else {
        blocks.push({ t: 'quote', blocks: parseBlocks(inner.join('\n')) });
      }
      continue;
    }

    if (LIST.test(line)) {
      const items: ListItem[] = [];
      const counters = new Map<number, number>();
      while (i < lines.length && LIST.test(lines[i])) {
        const m = lines[i].match(LIST)!;
        const indent = m[1].replace(/\t/g, '    ').length;
        const depth = Math.floor(indent / 2);
        const ordered = /\d/.test(m[2]);
        counters.set(depth, (counters.get(depth) ?? 0) + 1);
        for (const d of [...counters.keys()]) if (d > depth) counters.delete(d);
        let text = m[3];
        let task: boolean | null = null;
        const t = text.match(/^\[( |x|X)\]\s+(.*)$/);
        if (t) {
          task = t[1] !== ' ';
          text = t[2];
        }
        items.push({ depth, ordered, n: counters.get(depth)!, task, inline: parseInline(text) });
        i++;
      }
      blocks.push({ t: 'list', items });
      continue;
    }

    // paragraph: keep single line breaks (Obsidian's default reading behaviour)
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && (para.length === 0 || !isBlockStart(lines[i], lines[i + 1]))) {
      para.push(lines[i++].trim());
    }
    blocks.push({ t: 'para', inline: parseInline(para.join('\n')) });
  }
  return blocks;
}

/** "1,149 words · 7,387 characters" */
export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}
