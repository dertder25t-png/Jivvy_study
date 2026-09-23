// Flashcard "sets" are just cards grouped by the note they were made under. This groups
// cards into sets and describes a set's own test-date countdown — shared by the deck
// screen (browse/manage every set), the study tab (jump straight into one), and the
// study calendar (each set gets its own color so its test date is easy to spot).
import type { Card, Note } from '@/types/db';
import { clockTime, dayDiff, relativeTime } from './time';

export interface SetGroup {
  key: string;
  title: string;
  noteId: string | null;
  testDate: string | null;
  cards: Card[];
}

/** Groups cards by the note they were added under ("set title") so a big deck stays navigable. */
export function groupIntoSets(list: Card[], noteById: Map<string, Note>): SetGroup[] {
  const order: string[] = [];
  const m = new Map<string, SetGroup>();
  for (const k of list) {
    const key = k.source_note_id ?? '__ungrouped__';
    let g = m.get(key);
    if (!g) {
      const note = k.source_note_id ? noteById.get(k.source_note_id) : undefined;
      g = {
        key,
        title: k.source_note_id ? note?.title || 'Untitled set' : 'Ungrouped cards',
        noteId: k.source_note_id,
        testDate: note?.test_date ?? null,
        cards: [],
      };
      m.set(key, g);
      order.push(key);
    }
    g.cards.push(k);
  }
  return order.map((k) => m.get(k)!);
}

/** "5 days until your test (11:59 PM)", "Test tomorrow", "Test was 2 days ago" — a set's own countdown. */
export function testDateInfo(iso: string, now: Date, tz: string): { label: string; tone: 'warn' | 'default' } {
  const days = dayDiff(new Date(iso), now, tz);
  const at = clockTime(iso, tz);
  if (days < 0) return { label: `Test was ${relativeTime(iso, now, tz)}`, tone: 'default' };
  if (days === 0) return { label: `Test is today at ${at}`, tone: 'warn' };
  if (days === 1) return { label: `Test is tomorrow at ${at}`, tone: 'warn' };
  return { label: `${days} days until your test · ${at}`, tone: days <= 3 ? 'warn' : 'default' };
}

// A distinct, stable palette for coloring sets on the study calendar — separate from
// COURSE_COLORS (data/actions.ts) since core/ can't depend on the data layer.
const SET_COLORS = ['#4F46E5', '#0891B2', '#059669', '#D97706', '#DC2626', '#7C3AED', '#DB2777', '#0D9488'];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** A stable color for a set, keyed by its note id — used to color-code it on the study calendar. */
export function colorForSet(noteId: string): string {
  return SET_COLORS[hashCode(noteId) % SET_COLORS.length];
}
