// Card check — runs on the device, no AI. Looks over a set's cards and suggests fixes that make them
// easier to learn: split an answer that's too much to recall in one go (long lists into groups of
// about three, long multi-sentence answers into one idea per card), drop duplicates, blank out an
// answer that gives itself away, swap a card whose question is on the wrong side, and flag very long
// or often-missed cards to reword. Each suggestion says why, and shows exactly what applying it does.
import type { Card } from '@/types/db';
import { sentences } from './rewrite';
import { normalize, wordCount } from './text';

/** A list answer with more items than this is split. 3-4 short items are fine to recall together. */
export const MAX_LIST_ITEMS = 4;
/** Items per card when a list is split. */
export const LIST_CHUNK = 3;
/** Above this, an answer made of several sentences is split into one idea (sentence group) per card. */
export const MAX_ANSWER_WORDS = 25;
const SENTENCE_CHUNK_WORDS = 20;
const SHORT_SENTENCE = 6;
/** Too long to learn well even when it can't be split safely. */
const VERY_LONG_ANSWER = 40;
const VERY_LONG_TERM = 30;

export interface CardPart {
  term: string;
  definition: string;
}

export type AdviceKind = 'duplicate' | 'split' | 'swap' | 'circular' | 'shorten' | 'hard';

export interface CardAdvice {
  kind: AdviceKind;
  cardId: string;
  title: string;
  reason: string;
  /** What applying it does; null = advice only (edit the card by hand). */
  fix: { type: 'split'; parts: CardPart[] } | { type: 'delete' } | { type: 'update'; term: string; definition: string } | null;
  /** Higher first. */
  priority: number;
}

export interface CheckInput {
  card: Pick<Card, 'id' | 'term' | 'definition' | 'created_at'>;
  /** Times it's been missed (rated "again"). */
  misses: number;
  /** Which set it's in, for "also in …". */
  setTitle?: string;
}

// ---------------------------------------------------------------- splitting

const BULLET = /^\s*(?:[-*•–·]|\(?\d{1,2}[.)]|\(?[a-z][.)])\s+/i;

interface ListShape {
  items: string[];
  /** One item per line in the original — keep it that way in the parts. */
  lines: boolean;
}

/** Reads an answer as a list, if it is one: one item per line, "1. a 2. b 3. c", "a; b; c", or "a, b, c and d". */
export function listItems(answer: string): ListShape | null {
  const lines = answer.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 3) {
    if (/:$/.test(lines[0]) && !BULLET.test(lines[0])) lines.shift(); // "The twelve tribes:" is a lead-in
    const items = lines.map((l) => l.replace(BULLET, '').trim()).filter(Boolean);
    if (items.length >= 3) return { items, lines: true };
  }

  const flat = answer.replace(/\s+/g, ' ').trim().replace(/[.;]$/, '');
  const body = flat.replace(/^[^:]{2,60}:\s+/, ''); // drop a lead-in: "Three kinds: a, b, c"

  // "1. a 2. b 3. c" / "1) a 2) b"
  const numbered = body.split(/(?:^|\s)\(?\d{1,2}[.)]\s+/).map((s) => s.trim().replace(/[,;]$/, '')).filter(Boolean);
  if (/(?:^|\s)\(?1[.)]\s/.test(body) && numbered.length >= 3) return { items: numbered, lines: false };

  const semi = body.split(/\s*;\s*/).filter(Boolean);
  if (semi.length >= 3 && semi.every((s) => wordCount(s) <= 12)) return { items: semi, lines: false };

  const commas = body.split(/\s*,\s*/).filter(Boolean);
  if (commas.length >= 3) {
    const last = commas.pop()!.replace(/^(?:and|or)\s+/i, '');
    const tail = last.split(/\s+(?:and|or)\s+/i);
    const items = [...commas, ...(tail.length === 2 ? tail : [last])].map((s) => s.trim()).filter(Boolean);
    if (items.length >= 4 && items.every((s) => wordCount(s) <= 5)) return { items, lines: false };
  }
  return null;
}

/** n items into groups of at most `size`, as even as possible (7 → 3, 2, 2). */
function balanced<T>(list: T[], size: number): T[][] {
  const groups = Math.ceil(list.length / size);
  const base = Math.floor(list.length / groups);
  const extra = list.length % groups;
  const out: T[][] = [];
  let at = 0;
  for (let g = 0; g < groups; g++) {
    const n = base + (g < extra ? 1 : 0);
    out.push(list.slice(at, at + n));
    at += n;
  }
  return out;
}

/** "(1–3 of 9)", "(part 2 of 3)" — the label split parts carry, which isn't part of the answer itself. */
const PART_LABEL = /\s*\((?:part\s+)?\d+(?:[–-]\d+)?\s+of\s+\d+\)\s*$/i;

export function stripPartLabel(text: string): string {
  return text.replace(PART_LABEL, '');
}

/**
 * How to split a card whose answer is too much to recall at once, or null if it's fine (or can't be
 * split safely). Lists of more than MAX_LIST_ITEMS go into groups of about three; long answers made of
 * several sentences go into one idea per card. The question stays on every part, labelled "(1–3 of 9)".
 */
export function splitCard(term: string, definition: string): CardPart[] | null {
  const q = stripPartLabel(term.trim());
  const list = listItems(definition);
  if (list && list.items.length > MAX_LIST_ITEMS) {
    const total = list.items.length;
    let first = 1;
    return balanced(list.items, LIST_CHUNK).map((group) => {
      const last = first + group.length - 1;
      const label = group.length === 1 ? `(${first} of ${total})` : `(${first}–${last} of ${total})`;
      first = last + 1;
      return { term: `${q} ${label}`, definition: group.join(list.lines ? '\n' : ', ') };
    });
  }

  const flat = definition.replace(/\s+/g, ' ').trim();
  if (wordCount(flat) <= MAX_ANSWER_WORDS) return null;
  const parts = sentences(flat);
  if (parts.length < 2) return null;
  // One sentence per card; a very short one ("It was his first.") rides along with its neighbour.
  const groups: string[][] = [];
  for (const s of parts) {
    const cur = groups[groups.length - 1];
    const short = cur && (wordCount(s) < SHORT_SENTENCE || wordCount(cur.join(' ')) < SHORT_SENTENCE);
    if (cur && short && wordCount([...cur, s].join(' ')) <= SENTENCE_CHUNK_WORDS) cur.push(s);
    else groups.push([s]);
  }
  if (groups.length < 2) return null;
  return groups.map((g, i) => ({ term: `${q} (part ${i + 1} of ${groups.length})`, definition: g.join(' ') }));
}

// ---------------------------------------------------------------- other checks

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The answer with the term blanked out, if a short term appears word-for-word in it; else null. */
export function blankTerm(term: string, definition: string): string | null {
  const t = term.trim();
  if (t.length < 3 || wordCount(t) > 4 || wordCount(definition) < 4) return null;
  const re = new RegExp(`\\b${escapeRe(t)}(?:e?s)?\\b`, 'gi');
  if (!re.test(definition)) return null;
  const blanked = definition.replace(re, '___');
  return blanked.replace(/_/g, '').trim().length >= 3 ? blanked : null;
}

const dupKey = (c: CheckInput['card']) => `${normalize(c.term)}|${normalize(c.definition)}`;
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/**
 * Suggestions for `cards` (usually one set), most useful first. `everything` (all your cards) is used to
 * spot duplicates across sets; of identical cards, the oldest is kept and the newer copies flagged.
 */
export function checkCards(cards: CheckInput[], everything: CheckInput[] = cards): CardAdvice[] {
  const oldest = new Map<string, CheckInput>();
  for (const x of [...everything].sort((a, b) => Date.parse(a.card.created_at) - Date.parse(b.card.created_at) || a.card.id.localeCompare(b.card.id))) {
    const k = dupKey(x.card);
    if (k !== '|' && !oldest.has(k)) oldest.set(k, x);
  }

  const out: CardAdvice[] = [];
  for (const x of cards) {
    const { card, misses } = x;
    const slipped = misses > 0 ? ` You've missed it ${times(misses)}.` : '';

    const keep = oldest.get(dupKey(card));
    if (keep && keep.card.id !== card.id) {
      const elsewhere = keep.setTitle && keep.setTitle !== x.setTitle;
      out.push({
        kind: 'duplicate', cardId: card.id, title: 'Duplicate card',
        reason: elsewhere
          ? `The same card is also in "${keep.setTitle}". Studying both copies doubles the work for no gain.`
          : 'This set has the same card twice. Studying both copies doubles the work for no gain.',
        fix: { type: 'delete' }, priority: 90,
      });
      continue; // nothing else to say about a card we suggest removing
    }

    const parts = splitCard(card.term, card.definition);
    if (parts) {
      const list = listItems(card.definition);
      const isList = Boolean(list && list.items.length > MAX_LIST_ITEMS);
      out.push({
        kind: 'split', cardId: card.id,
        title: `${isList ? 'Long list' : 'Long answer'} — split into ${parts.length} cards`,
        reason: isList
          ? `${list!.items.length} items is a lot to recall in one go. Groups of about three are much easier to learn and to keep.${slipped}`
          : `${wordCount(card.definition)} words in one answer. One idea per card sticks better.${slipped}`,
        fix: { type: 'split', parts }, priority: 60 + Math.min(30, misses * 10),
      });
      continue;
    }

    if (card.definition.trim().endsWith('?') && !card.term.trim().endsWith('?')) {
      out.push({
        kind: 'swap', cardId: card.id, title: 'Question and answer look flipped',
        reason: 'The answer side is the question. Swapping them makes the card ask it.',
        fix: { type: 'update', term: card.definition, definition: card.term }, priority: 50,
      });
      continue;
    }

    const blanked = blankTerm(card.term, card.definition);
    if (blanked) {
      out.push({
        kind: 'circular', cardId: card.id, title: 'The answer gives itself away',
        reason: `The answer contains "${card.term.trim()}". Blanking it out makes you actually recall it.`,
        fix: { type: 'update', term: card.term, definition: blanked }, priority: 40,
      });
      continue;
    }

    const longTerm = wordCount(card.term) > VERY_LONG_TERM && !card.term.trim().endsWith('?');
    if (wordCount(card.definition) > VERY_LONG_ANSWER || longTerm) {
      out.push({
        kind: 'shorten', cardId: card.id, title: 'Very long card',
        reason: `There's a lot on this card and it can't be split cleanly. Try trimming it to the key idea.${slipped}`,
        fix: null, priority: 30 + Math.min(30, misses * 10),
      });
      continue;
    }

    if (misses >= 3) {
      out.push({
        kind: 'hard', cardId: card.id, title: `Keeps slipping — missed ${times(misses)}`,
        reason: 'Try rewording it in your own words, or adding a memory hook. Cards you write yourself are easier to remember.',
        fix: null, priority: 20 + misses,
      });
    }
  }
  return out.sort((a, b) => b.priority - a.priority);
}
