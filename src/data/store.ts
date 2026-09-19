// One in-memory, observable copy of the user's data, backed by a swappable
// Backend (on-device for demo/offline, Supabase for accounts). A student's whole
// semester is a few thousand rows, so the UI reads synchronously from memory and
// writes go through optimistically. Failed network writes wait in an outbox.
import { useSyncExternalStore } from 'react';
import type { TableName, Tables } from '@/types/db';

export type Rows = { [K in TableName]: Tables[K][] };

export const EMPTY_ROWS = (): Rows => ({
  terms: [], courses: [], syllabi: [], grade_components: [], assignments: [], exams: [],
  exam_coverage: [], course_policies: [], absences: [], topics: [], notes: [], cards: [],
  card_reviews: [], generation_events: [], waiting_on: [], metric_events: [],
});

/** Tables whose rows carry a user_id column. */
export const USER_TABLES = new Set<TableName>([
  'terms', 'courses', 'notes', 'cards', 'generation_events', 'waiting_on', 'metric_events',
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>;

/** Columns that uniquely identify a row of each table. */
const KEY_COLS: Partial<Record<TableName, string[]>> = {
  exam_coverage: ['exam_id', 'topic_id'],
  course_policies: ['course_id'],
};

export function keyCols(table: TableName): string[] {
  return KEY_COLS[table] ?? ['id'];
}

export function matchOf(table: TableName, row: AnyRow): AnyRow {
  return Object.fromEntries(keyCols(table).map((c) => [c, row[c]]));
}

export interface Backend {
  mode: 'local' | 'supabase';
  userId: string;
  loadAll(): Promise<Rows>;
  insert(table: TableName, rows: AnyRow[]): Promise<void>;
  update(table: TableName, match: AnyRow, patch: AnyRow): Promise<void>;
  remove(table: TableName, match: AnyRow): Promise<void>;
  /** Local backend persists the whole snapshot; remote backends omit this. */
  persist?(rows: Rows): void;
}

export type Op =
  | { op: 'insert'; table: TableName; rows: AnyRow[] }
  | { op: 'update'; table: TableName; match: AnyRow; patch: AnyRow }
  | { op: 'remove'; table: TableName; match: AnyRow };

export interface OutboxStorage {
  load(): Promise<Op[]>;
  save(ops: Op[]): Promise<void>;
}

/** Errors that will never succeed on retry (constraint / RLS / bad request), as opposed to being offline. */
function isPermanent(err: unknown): boolean {
  const e = err as { status?: number; code?: string } | undefined;
  if (!e) return false;
  if (typeof e.status === 'number' && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) return true;
  return typeof e.code === 'string' && /^\d{5}$/.test(e.code); // Postgres SQLSTATE
}

class Store {
  private rows: Rows = EMPTY_ROWS();
  private backend: Backend | null = null;
  private listeners = new Set<() => void>();
  private outbox: Op[] = [];
  private outboxStorage: OutboxStorage | null = null;
  private flushing = false;
  ready = false;
  pendingWrites = 0;

  get mode(): 'local' | 'supabase' | null {
    return this.backend?.mode ?? null;
  }
  get userId(): string {
    return this.backend?.userId ?? 'local';
  }

  async init(backend: Backend, outbox?: OutboxStorage) {
    this.backend = backend;
    this.outboxStorage = outbox ?? null;
    this.outbox = outbox ? await outbox.load() : [];
    this.rows = EMPTY_ROWS();
    // Push anything left from a previous offline session before pulling fresh data.
    await this.flush();
    this.rows = await backend.loadAll();
    this.ready = true;
    this.emit();
  }

  reset() {
    this.rows = EMPTY_ROWS();
    this.backend = null;
    this.ready = false;
    this.outbox = [];
    this.emit();
  }

  // ---- reads ------------------------------------------------------------
  all<K extends TableName>(table: K): Tables[K][] {
    return this.rows[table];
  }
  snapshot(): Rows {
    return this.rows;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit() {
    for (const l of this.listeners) l();
  }

  // ---- writes -----------------------------------------------------------
  insert<K extends TableName>(table: K, row: Tables[K]): Tables[K] {
    this.insertMany(table, [row]);
    return row;
  }

  insertMany<K extends TableName>(table: K, rows: Tables[K][]): Tables[K][] {
    if (rows.length === 0) return rows;
    const withUser = USER_TABLES.has(table)
      ? rows.map((r) => ({ ...(r as AnyRow), user_id: this.userId }) as unknown as Tables[K])
      : rows;
    this.rows = { ...this.rows, [table]: [...this.rows[table], ...withUser] };
    this.emit();
    this.write({ op: 'insert', table, rows: withUser as unknown as AnyRow[] });
    return withUser;
  }

  update<K extends TableName>(table: K, row: Tables[K], patch: Partial<Tables[K]>): Tables[K] {
    const match = matchOf(table, row as AnyRow);
    // Merge onto the latest stored row, not the caller's (possibly stale) copy.
    const latest = (this.rows[table] as Tables[K][]).find((r) => sameKey(table, r as AnyRow, match)) ?? row;
    const next = { ...latest, ...patch } as Tables[K];
    this.rows = {
      ...this.rows,
      [table]: this.rows[table].map((r) => (sameKey(table, r as AnyRow, match) ? next : r)),
    };
    this.emit();
    this.write({ op: 'update', table, match, patch: patch as AnyRow });
    return next;
  }

  remove<K extends TableName>(table: K, row: Tables[K]) {
    const match = matchOf(table, row as AnyRow);
    this.rows = { ...this.rows, [table]: this.rows[table].filter((r) => !sameKey(table, r as AnyRow, match)) };
    this.emit();
    this.write({ op: 'remove', table, match });
  }

  /** Drop rows from memory only (their deletion happens server-side via ON DELETE CASCADE). */
  purgeLocal<K extends TableName>(table: K, predicate: (r: Tables[K]) => boolean) {
    this.rows = { ...this.rows, [table]: this.rows[table].filter((r) => !predicate(r)) };
    this.emit();
    this.backend?.persist?.(this.rows);
  }

  /** Patch rows in memory only (server-side FKs do the equivalent, e.g. ON DELETE SET NULL). */
  patchLocal<K extends TableName>(table: K, predicate: (r: Tables[K]) => boolean, patch: Partial<Tables[K]>) {
    this.rows = {
      ...this.rows,
      [table]: this.rows[table].map((r) => (predicate(r) ? ({ ...r, ...patch } as Tables[K]) : r)),
    };
    this.emit();
    this.backend?.persist?.(this.rows);
  }

  // ---- persistence ------------------------------------------------------
  private write(op: Op) {
    const b = this.backend;
    if (!b) return;
    if (b.mode === 'local') {
      b.persist?.(this.rows);
      return;
    }
    this.outbox.push(op);
    void this.saveOutbox();
    void this.flush();
  }

  private async saveOutbox() {
    try {
      await this.outboxStorage?.save(this.outbox);
    } catch {
      /* storage unavailable — keep going in memory */
    }
  }

  /** Send queued writes in order. Stops at the first network failure; drops permanently-bad ops. */
  async flush() {
    const b = this.backend;
    if (!b || b.mode === 'local' || this.flushing) return;
    this.flushing = true;
    try {
      while (this.outbox.length > 0) {
        const op = this.outbox[0];
        this.pendingWrites = this.outbox.length;
        try {
          if (op.op === 'insert') await b.insert(op.table, op.rows);
          else if (op.op === 'update') await b.update(op.table, op.match, op.patch);
          else await b.remove(op.table, op.match);
          this.outbox.shift();
        } catch (err) {
          if (isPermanent(err)) {
            console.warn('[store] dropping rejected write', op.op, op.table, (err as Error)?.message);
            this.outbox.shift();
          } else {
            break; // offline — try again on next write / app foreground
          }
        }
      }
    } finally {
      this.pendingWrites = this.outbox.length;
      this.flushing = false;
      await this.saveOutbox();
      this.emit();
    }
  }
}

function sameKey(table: TableName, row: AnyRow, match: AnyRow): boolean {
  return keyCols(table).every((c) => row[c] === match[c]);
}

export const store = new Store();

/** Subscribe a component to one table. Rows are replaced (not mutated) so identity changes = re-render. */
export function useTable<K extends TableName>(table: K): Tables[K][] {
  return useSyncExternalStore(
    store.subscribe,
    () => store.all(table),
    () => store.all(table),
  );
}

/** Re-render on any change; returns the whole snapshot. */
export function useStoreSnapshot(): Rows {
  return useSyncExternalStore(store.subscribe, () => store.snapshot(), () => store.snapshot());
}
