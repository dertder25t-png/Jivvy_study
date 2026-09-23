import { beforeEach, describe, expect, it } from 'vitest';
import type { Note } from '@/types/db';
import {
  EMPTY_ROWS, GIVE_UP_AFTER_MS, applyOps, classifyFailure, keyCols, othersChanged, reconcile, store,
  type Backend, type Op, type OutboxStorage, type Rows,
} from './store';

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
  // The change counter (migration 0011): every accepted write bumps it and records who made it.
  const counter = { version: 0, changedBy: null as string | null, loads: 0 };
  const bump = (by: string | null) => {
    counter.version++;
    counter.changedBy = by;
  };
  const same = (t: keyof Rows, r: AnyRow, m: AnyRow) => keyCols(t).every((c) => r[c] === m[c]);
  const backend: Backend = {
    mode: 'supabase',
    userId: 'u1',
    clientId: 'this-device',
    async loadAll() {
      if (loadGate) await loadGate;
      counter.loads++;
      return JSON.parse(JSON.stringify(rows)) as Rows;
    },
    async syncVersion() {
      return counter.version ? { version: counter.version, changedBy: counter.changedBy } : null;
    },
    async insert(t, list) {
      const err = failWith?.('insert');
      if (err) throw err;
      sent.push(`insert ${t} ${list.map((r) => r.id).join(',')}`);
      (rows[t] as AnyRow[]).push(...JSON.parse(JSON.stringify(list)));
      bump('this-device');
    },
    async update(t, match, patch) {
      const err = failWith?.('update');
      if (err) throw err;
      sent.push(`update ${t} ${match.id}`);
      rows[t] = (rows[t] as AnyRow[]).map((r) => (same(t, r, match) ? { ...r, ...patch } : r)) as never;
      bump('this-device');
    },
    async remove(t, match) {
      const err = failWith?.('remove');
      if (err) throw err;
      sent.push(`remove ${t} ${match.id}`);
      rows[t] = (rows[t] as AnyRow[]).filter((r) => !same(t, r, match)) as never;
      bump('this-device');
    },
  };
  return {
    backend, rows, sent, counter,
    /** Another device writes directly to the server. */
    otherDevice: (change: () => void) => {
      change();
      bump('phone');
    },
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

describe('keyCols', () => {
  // Must match the primary keys in supabase/migrations: loads are ordered by these columns, and a
  // table without an `id` column that isn't listed breaks the whole load ("column ... .id does not exist").
  it('knows the primary key of every table without an id column', () => {
    expect(keyCols('exam_coverage')).toEqual(['exam_id', 'topic_id']);
    expect(keyCols('quiz_coverage')).toEqual(['quiz_id', 'topic_id']);
    expect(keyCols('course_policies')).toEqual(['course_id']);
    expect(keyCols('learn_progress')).toEqual(['user_id', 'scope_key']);
  });

  it('keeps join-table rows apart on a refresh', () => {
    const row = (quiz_id: string, topic_id: string) => ({ quiz_id, topic_id });
    const prev = { ...EMPTY_ROWS(), quiz_coverage: [row('q1', 't1')] };
    const next = reconcile(prev, { ...EMPTY_ROWS(), quiz_coverage: [row('q1', 't1'), row('q1', 't2'), row('q2', 't1')] });
    expect(next.quiz_coverage).toHaveLength(3);
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
    const box = memoryOutbox([{ op: 'insert', table: 'notes', rows: [note('queued')], at: Date.now() - 60_000 }]);
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

  it("gives up on a write the server has refused for over a day (or one left by an older app), so the rest syncs", async () => {
    const server = fakeServer();
    server.fail((op) => (op === 'insert' ? schemaBehind : null));
    const dayAgo = Date.now() - GIVE_UP_AFTER_MS - 1000;
    const box = memoryOutbox([
      { op: 'insert', table: 'notes', rows: [note('ancient')], at: dayAgo },
      { op: 'insert', table: 'notes', rows: [note('legacy')] },
      { op: 'update', table: 'notes', match: { id: 'old' }, patch: { title: 'renamed' }, at: Date.now() },
    ]);
    server.rows.notes.push(note('old'));
    await store.init(server.backend, box);
    expect(server.sent).toEqual(['update notes old']);
    expect(box.saved).toEqual([]);
  });
});

describe('change counter', () => {
  it('only another device moving the counter means there is something to fetch', () => {
    const seen = { version: 10, own: 3 };
    expect(othersChanged(seen, { version: 10, changedBy: 'phone' }, 3, 'me')).toBe(false); // nothing new
    expect(othersChanged(seen, { version: 12, changedBy: 'me' }, 5, 'me')).toBe(false); // just my two writes
    expect(othersChanged(seen, { version: 13, changedBy: 'me' }, 5, 'me')).toBe(true); // mine + someone else's
    expect(othersChanged(seen, { version: 11, changedBy: 'phone' }, 3, 'me')).toBe(true);
    expect(othersChanged({ version: 0, own: 0 }, null, 0, 'me')).toBe(false); // brand-new account
  });

  it("doesn't re-download for this device's own writes, and does for another device's", async () => {
    const server = fakeServer({ notes: [note('a')] });
    await store.init(server.backend, memoryOutbox());
    expect(server.counter.loads).toBe(1);

    store.update('notes', store.all('notes')[0], { title: 'typed here' });
    await store.flush();
    await store.checkForChanges();
    expect(server.counter.loads).toBe(1); // one tiny request, no download

    server.otherDevice(() => server.rows.notes.push(note('from-phone')));
    await store.checkForChanges();
    expect(server.counter.loads).toBe(2);
    expect(store.all('notes').map((n) => n.id)).toEqual(['a', 'from-phone']);

    await store.checkForChanges();
    expect(server.counter.loads).toBe(2); // caught up
  });
});
