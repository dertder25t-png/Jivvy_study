import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@/types/db';

vi.mock('@react-native-async-storage/async-storage', () => {
  const mem = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => mem.get(k) ?? null,
      setItem: async (k: string, v: string) => void mem.set(k, v),
      removeItem: async (k: string) => void mem.delete(k),
    },
  };
});

vi.mock('react-native', () => ({
  Platform: { OS: 'web', select: (o: Record<string, unknown>) => o.web ?? o.default },
  AppState: { addEventListener: () => ({ remove() {} }) },
}));

vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }));

const { store, EMPTY_ROWS } = await import('./store');
const { prefs } = await import('./prefs');
const { generateForNote } = await import('./generation');
const { fileNote } = await import('./actions');

const body = `# Memory
So today we talked about memory. Short term memory only holds about 7 items for 20-30 seconds unless you rehearse them. Chunking is grouping info into bigger meaningful units so you can remember more.
`;

const note: Note = {
  id: 'n1', user_id: 'local', course_id: 'c1', topic_id: null, parent_note_id: null, title: 'Memory', body,
  captured_via: 'in_app', course_inferred: false, outline: null, test_date: null,
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
};

/** A stand-in for the local helper: slow enough that two runs overlap. */
function fakeHelper() {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    const path = new URL(url).pathname;
    calls.push(path);
    await new Promise((r) => setTimeout(r, 20));
    const req = JSON.parse(init.body);
    const json =
      path === '/find'
        ? {
            model: 'npu:test',
            found: req.blocks.flatMap((b: { id: string }) => [
              { block_id: b.id, term: 'Short term memory', definition: 'Holds about 7 items for 20-30 seconds unless rehearsed.' },
              { block_id: b.id, term: 'Chunking', definition: 'Grouping info into bigger meaningful units to remember more.' },
            ]),
          }
        : { model: 'npu:test', prompt_version: 'v', cards: [] };
    return { ok: true, json: async () => json } as Response;
  });
  return calls;
}

beforeEach(async () => {
  await store.init({
    mode: 'local', userId: 'local',
    loadAll: async () => ({ ...EMPTY_ROWS(), notes: [note] }),
    insert: async () => {}, update: async () => {}, remove: async () => {},
  } as never);
  prefs.set({ localAiEnabled: true });
});

describe('finding cards with the local model', () => {
  it('makes each card once even when the automatic run and the button overlap', async () => {
    fakeHelper();
    const [auto, button] = await Promise.all([
      generateForNote(note, { onlyNew: true }),
      generateForNote(note, { onlyNew: true, readAll: true }),
    ]);
    expect(auto?.survived).toBe(3); // the heading rule's "Memory" card + the model's two
    expect(button?.survived ?? 0).toBe(0);
    const terms = store.all('cards').map((k) => k.term).sort();
    expect(terms).toEqual(['Chunking', 'Memory', 'Short term memory']);
  });

  it('pressing the button again finds nothing new, and a skipped card stays skipped', async () => {
    fakeHelper();
    await generateForNote(note, { onlyNew: true, readAll: true });
    const chunk = store.all('cards').find((k) => k.term === 'Chunking')!;
    store.update('cards', chunk, { status: 'rejected' });
    const again = await generateForNote(note, { onlyNew: true, readAll: true });
    expect(again?.survived).toBe(0);
    expect(store.all('cards')).toHaveLength(3);
  });

  it('says so when the helper is not running', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('connection refused'); });
    const f = await generateForNote(note, { onlyNew: true, readAll: true });
    expect(f?.modelRan).toBe(false);
    expect(store.all('cards').map((k) => k.term)).toEqual(['Memory']); // the rules still work
  });

  it('works for a note with no class, and the cards follow the note when it gets one', async () => {
    fakeHelper();
    const unfiled = store.update('notes', note, { course_id: null });
    const f = await generateForNote(unfiled, { onlyNew: true, readAll: true });
    expect(f?.survived).toBe(3);
    expect(store.all('cards').every((k) => k.course_id === null)).toBe(true);
    fileNote(store.all('notes')[0], 'c9');
    expect(store.all('cards').every((k) => k.course_id === 'c9')).toBe(true);
  });
});
