import { beforeEach, describe, expect, it } from 'vitest';
import type { Note } from '@/types/db';
import { EMPTY_ROWS, applyOps, classifyFailure, keyCols, reconcile, store, type Backend, type Op, type OutboxStorage, type Rows } from './store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>;

const note = (id: string, over: Partial<Note> = {}): Note => ({
  id, user_id: 'u1', course_id: null, topic_id: null, parent_note_id: null, title: id, body: '',
  captured_via: 'in_app', course_inferred: false, outline: null, test_date: null,
  created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-20T00:00:00Z', ...over,
});

/** A stand-in for Supabase: its own copy of the rows, and a switch to make writes fail. */
function fakeServer(initial: Partial<Rows> = {}) {
  const rows: Rows = { ...EMPTY_ROWS(), ...initial };
  let failWith: ((op: Op['op']) => unknown) | null = null;
  let loadGate: Promise<void> | null = null;
  const sent: string[] = [];
  const same = (t: keyof Rows, r: AnyRow, m: AnyRow) => keyCols(t).every((c) => r[c] === m[c]);
  const backend: Backend = {
    mode: 'supabase',
    userId: 'u1',
    async loadAll() {
      if (loadGate) await loadGate;
      return JSON.parse(JSON.stringify(rows)) as Rows;
    },
    async insert(t, list) {
      const err = failWith?.('insert');
      if (err) throw err;
      sent.push(`insert ${t} ${list.map((r) => r.id).join(',')}`);
      (rows[t] as AnyRow[]).push(...JSON.parse(JSON.stringify(list)));
    },
    async update(t, match, patch) {
      const err = failWith?.('update');
      if (err) throw err;
      sent.push(`update ${t} ${match.id}`);
      rows[t] = (rows[t] as AnyRow[]).map((r) => (same(t, r, match) ? { ...r, ...patch } : r)) as never;
    },
    async remove(t, match) {
      const err = failWith?.('remove');
      if (err) throw err;
      sent.push(`remove ${t} ${match.id}`);
      rows[t] = (rows[t] as AnyRow[]).filter((r) => !same(t, r, match)) as never;
    },
  };
  return {
    backend, rows, sent,
    fail: (f: typeof failWith) => { failWith = f; },
    holdLoads: () => {
      let open!: () => void;
      loadGate = new Promise((r) => (open = r));
      return () => { loadGate = null; open(); };
    },
  };
}

const memoryOutbox = (initial: Op[] = []): OutboxStorage & { saved: Op[] } => {
  const box = { saved: initial, async load() { return box.saved; }, async save(ops: Op[]) { box.saved = [...ops]; } };
  return box;
};

// The exact failure seen in production: the app sent a column the server's schema didn't have yet.
const schemaBehind = Object.assign(new Error("Could not find the 'outline' column of 'notes' in the schema cache"), { status: 400, code: 'PGRST204' });

beforeEach(() => store.reset());

describe('classifyFailure', () => {
  it('keeps work the server may accept later, and only drops what it never will', () => {
    expect(classifyFailure('insert', schemaBehind)).toBe('stuck');
    expect(classifyFailure('insert', { status: 0, code: '' })).toBe('retry'); // offline
    expect(classifyFailure('update', { status: 401, code: 'PGRST301' })).toBe('retry'); // sign-in expired
    expect(classifyFailure('update', { status: 503 })).toBe('retry');
    expect(classifyFailure('insert', { status: 409, code: '23505' })).toBe('done'); // already there
    expect(classifyFailure('update', { status: 409, code: '23505' })).toBe('drop');
    expect(classifyFailure('insert', { status: 409, code: '23503' })).toBe('drop'); // parent is gone
    expect(classifyFailure('insert', { status: 403, code: '42501' })).toBe('drop'); // RLS
    expect(classifyFailure('insert', { status: 404, code: 'PGRST205' })).toBe('stuck'); // table missing
  });
});

describe('applyOps', () => {
  it('replays inserts, updates and removes, and is safe to replay twice', () => {
    const ops: Op[] = [
      { op: 'insert', table: 'notes', rows: [note('a'), note('b')] },
      { op: 'update', table: 'notes', match: { id: 'a' }, patch: { title: 'A!' } },
      { op: 'remove', table: 'notes', match: { id: 'b' } },
    ];
    const once = applyOps(EMPTY_ROWS(), ops);
    expect(once.notes.map((n) => [n.id, n.title])).toEqual([['a', 'A!']]);
    expect(applyOps(once, ops).notes.map((n) => [n.id, n.title])).toEqual([['a', 'A!']]);
  });
});

describe('reconcile', () => {
  it('keeps identity when nothing changed, and swaps only rows that did', () => {
    const prev = { ...EMPTY_ROWS(), notes: [note('a'), note('b')] };
    const same = { ...EMPTY_ROWS(), notes: [note('b'), note('a')] }; // server order differs
    expect(reconcile(prev, same)).toBe(prev);

    const next = reconcile(prev, { ...EMPTY_ROWS(), notes: [note('a'), note('b', { title: 'changed' }), note('c')] });
    expect(next.notes[0]).toBe(prev.notes[0]);
    expect(next.notes.map((n) => n.title)).toEqual(['a', 'changed', 'c']);
    expect(next.cards).toBe(prev.cards);
  });
});

describe('store sync', () => {
  it('holds a write the server rejects for a schema mismatch — in order, visibly — and sends it once fixed', async () => {
    const server = fakeServer();
    await store.init(server.backend, memoryOutbox());
    server.fail((op) => (op === 'insert' ? schemaBehind : null));

    store.insert('notes', note('n1'));
    store.update('notes', note('n1'), { title: 'Cell biology' });
    await store.flush();

    expect(server.rows.notes).toEqual([]);
    expect(store.syncStatus()).toMatchObject({ pending: 2, error: schemaBehind.message });
    expect(store.all('notes').map((n) => n.title)).toEqual(['Cell biology']);

    server.fail(null); // the migration ran
    await store.flush();
    expect(server.sent).toEqual(['insert notes n1', 'update notes n1']);
    expect(server.rows.notes[0].title).toBe('Cell biology');
    expect(store.syncStatus()).toMatchObject({ pending: 0, error: null });
  });

  it("still shows changes that haven't reached the server after a reload", async () => {
    const server = fakeServer({ notes: [note('old')] });
    server.fail(() => schemaBehind);
    const box = memoryOutbox([{ op: 'insert', table: 'notes', rows: [note('queued')] }]);
    await store.init(server.backend, box);
    expect(store.all('notes').map((n) => n.id)).toEqual(['old', 'queued']);
    expect(box.saved).toHaveLength(1);
  });

  it('pulls in changes made on another device', async () => {
    const server = fakeServer({ notes: [note('a')] });
    await store.init(server.backend, memoryOutbox());
    server.rows.notes.push(note('from-phone'));
    server.rows.notes[0] = { ...server.rows.notes[0], title: 'renamed on phone' };
    await store.refresh();
    expect(store.all('notes').map((n) => n.title)).toEqual(['renamed on phone', 'from-phone']);
  });

  it('a refresh that finds nothing new leaves the rows untouched', async () => {
    const server = fakeServer({ notes: [note('a')] });
    await store.init(server.backend, memoryOutbox());
    const before = store.snapshot();
    await store.refresh();
    expect(store.snapshot()).toBe(before);
  });

  it('keeps edits made while a refresh is loading', async () => {
    const server = fakeServer({ notes: [note('a')] });
    await store.init(server.backend, memoryOutbox());
    const release = server.holdLoads();
    const pending = store.refresh();
    await Promise.resolve();
    store.update('notes', store.all('notes')[0], { title: 'typed during refresh' });
    store.insert('notes', note('b'));
    store.purgeLocal('notes', (n) => n.id === 'nothing');
    release();
    await pending;
    expect(store.all('notes').map((n) => [n.id, n.title])).toEqual([['a', 'typed during refresh'], ['b', 'b']]);
  });
});
