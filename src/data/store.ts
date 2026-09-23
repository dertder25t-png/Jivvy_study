// One in-memory, observable copy of the user's data, backed by a swappable
// Backend (on-device for demo/offline, Supabase for accounts). A student's whole
// semester is a few thousand rows, so the UI reads synchronously from memory and
// writes go through optimistically. Writes the server hasn't accepted yet wait in
// an outbox, and are replayed on top of every fresh load — so a change never
// vanishes from view just because it hasn't reached the server. `refresh()` pulls
// in what other devices changed.
import { useSyncExternalStore } from 'react';
import type { TableName, Tables } from '@/types/db';

export type Rows = { [K in TableName]: Tables[K][] };

export const EMPTY_ROWS = (): Rows => ({
  terms: [], courses: [], syllabi: [], grade_components: [], assignments: [], exams: [],
  exam_coverage: [], quizzes: [], quiz_coverage: [], course_policies: [], absences: [], topics: [], notes: [], cards: [],
  card_reviews: [], questions: [], generation_events: [], waiting_on: [], metric_events: [], learn_progress: [],
});

/** Tables whose rows carry a user_id column. */
export const USER_TABLES = new Set<TableName>([
  'terms', 'courses', 'notes', 'cards', 'questions', 'generation_events', 'waiting_on', 'metric_events', 'learn_progress',
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>;

/** Columns that uniquely identify a row of each table. */
const KEY_COLS: Partial<Record<TableName, string[]>> = {
  exam_coverage: ['exam_id', 'topic_id'],
  course_policies: ['course_id'],
  learn_progress: ['user_id', 'scope_key'],
};

export function keyCols(table: TableName): string[] {
  return KEY_COLS[table] ?? ['id'];
}

export function matchOf(table: TableName, row: AnyRow): AnyRow {
  return Object.fromEntries(keyCols(table).map((c) => [c, row[c]]));
}

function keyOf(table: TableName, row: AnyRow): string {
  return keyCols(table).map((c) => String(row[c])).join('\u0000');
}

/** The account's change counter (see migration 0011): bumped by the server on every write. */
export interface SyncVersion {
  version: number;
  /** The device (x-client-id) behind the latest change. */
  changedBy: string | null;
}

export interface Backend {
  mode: 'local' | 'supabase';
  userId: string;
  /** Tags this device's writes, so it can tell them from other devices'. */
  clientId?: string;
  loadAll(): Promise<Rows>;
  /** Every row of one table, including history loadAll leaves out (for "Download my data"). */
  loadTable?(table: TableName): Promise<AnyRow[]>;
  /** The change counter; 'unsupported' when the server doesn't have one. */
  syncVersion?(): Promise<SyncVersion | 'unsupported' | null>;
  insert(table: TableName, rows: AnyRow[]): Promise<void>;
  update(table: TableName, match: AnyRow, patch: AnyRow): Promise<void>;
  remove(table: TableName, match: AnyRow): Promise<void>;
  /** Local backend persists the whole snapshot; remote backends omit this. */
  persist?(rows: Rows): void;
}

export type Op = (
  | { op: 'insert'; table: TableName; rows: AnyRow[] }
  | { op: 'update'; table: TableName; match: AnyRow; patch: AnyRow }
  | { op: 'remove'; table: TableName; match: AnyRow }
) & {
  /** When it was queued (ms). A write the server keeps refusing is given up on after a day. */
  at?: number;
};

/** Tables whose writes the server doesn't count in the change counter (write-only logging). */
export const UNCOUNTED_TABLES = new Set<TableName>(['metric_events']);

/** How long a write the server keeps refusing is retried before it's dropped so the rest can sync. */
export const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Did someone else change the account since `seen`? The counter moved by more than this device's own
 * accepted writes, or the latest change came from another device.
 */
export function othersChanged(
  seen: { version: number; own: number },
  now: SyncVersion | null,
  ownWrites: number,
  clientId: string,
): boolean {
  const version = now?.version ?? 0;
  if (version === seen.version) return false;
  return version > seen.version + (ownWrites - seen.own) || (now?.changedBy ?? null) !== clientId;
}

export interface OutboxStorage {
  load(): Promise<Op[]>;
  save(ops: Op[]): Promise<void>;
}

/** A failed backend call: the HTTP status (0 = never reached the server) and the Postgres/PostgREST code. */
export interface SyncFailure {
  status?: number;
  code?: string;
  message?: string;
}

/**
 * What to do with a write the server didn't take:
 *   done  — an insert hit a duplicate key: the row is already there (an earlier attempt landed)
 *   drop  — the data itself can never be accepted (constraint, row-level security, bad value)
 *   retry — offline, timeout, rate limit, server hiccup, expired sign-in: quietly try again later
 *   stuck — anything else, e.g. the server's schema is behind the app. Keep it (and everything after
 *           it, in order) and tell the student, rather than throwing their work away.
 */
export function classifyFailure(op: Op['op'], err: unknown): 'done' | 'drop' | 'retry' | 'stuck' {
  const e = (err ?? {}) as SyncFailure;
  const code = typeof e.code === 'string' ? e.code : '';
  if (code === '23505' && op === 'insert') return 'done';
  // Postgres SQLSTATE class 22 (bad data), 23 (integrity), 42501 (row-level security)
  if (/^(22|23)[0-9A-Z]{3}$/.test(code) || code === '42501') return 'drop';
  const status = typeof e.status === 'number' ? e.status : 0;
  if (status === 0 || status === 401 || status === 408 || status === 429 || status >= 500) return 'retry';
  return 'stuck';
}

/** Replays writes on top of `rows`. Idempotent: an insert whose row is already there is skipped. */
export function applyOps(rows: Rows, ops: Op[]): Rows {
  if (ops.length === 0) return rows;
  const out = { ...rows } as Record<TableName, AnyRow[]>;
  for (const op of ops) {
    const t = op.table;
    const list = out[t] ?? [];
    if (op.op === 'insert') {
      const have = new Set(list.map((r) => keyOf(t, r)));
      const fresh = op.rows.filter((r) => !have.has(keyOf(t, r)));
      if (fresh.length > 0) out[t] = [...list, ...fresh];
    } else if (op.op === 'update') {
      out[t] = list.map((r) => (sameKey(t, r, op.match) ? { ...r, ...op.patch } : r));
    } else {
      out[t] = list.filter((r) => !sameKey(t, r, op.match));
    }
  }
  return out as unknown as Rows;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as AnyRow);
  const kb = Object.keys(b as AnyRow);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as AnyRow)[k], (b as AnyRow)[k]));
}

/**
 * Folds freshly loaded rows into what's on screen: unchanged rows keep their identity and their place
 * (new ones go at the end), and a table with no changes keeps its array — so a refresh that finds
 * nothing new re-renders nothing.
 */
export function reconcile(prev: Rows, next: Rows): Rows {
  let changed = false;
  const out = { ...prev } as Record<TableName, AnyRow[]>;
  for (const t of Object.keys(next) as TableName[]) {
    const before = (prev[t] ?? []) as AnyRow[];
    const incoming = new Map((next[t] as AnyRow[]).map((r) => [keyOf(t, r), r]));
    const merged: AnyRow[] = [];
    let same = true;
    for (const p of before) {
      const k = keyOf(t, p);
      const n = incoming.get(k);
      if (!n) {
        same = false;
        continue;
      }
      incoming.delete(k);
      if (deepEqual(n, p)) merged.push(p);
      else {
        merged.push(n);
        same = false;
      }
    }
    for (const n of incoming.values()) {
      merged.push(n);
      same = false;
    }
    if (!same) {
      out[t] = merged;
      changed = true;
    }
  }
  return changed ? (out as unknown as Rows) : prev;
}

export interface SyncStatus {
  mode: 'local' | 'supabase' | null;
  /** Writes made on this device that the server hasn't confirmed yet. */
  pending: number;
  /** Why those writes aren't going through, when it isn't just being offline. */
  error: string | null;
  /** Last time this device finished pulling from the server (ms since epoch). */
  lastSyncedAt: number | null;
}

class Store {
  private rows: Rows = EMPTY_ROWS();
  private backend: Backend | null = null;
  private listeners = new Set<() => void>();
  private outbox: Op[] = [];
  private outboxStorage: OutboxStorage | null = null;
  private flushing: Promise<void> | null = null;
  private refreshing: Promise<void> | null = null;
  /** While a refresh is loading: every change made meanwhile, replayed on top of what it loads. */
  private journal: Array<(rows: Rows) => Rows> | null = null;
  private status: SyncStatus = { mode: null, pending: 0, error: null, lastSyncedAt: null };
  /** Writes of this device the server accepted (on counted tables). */
  private ownWrites = 0;
  /** The change counter as of the last full load, and ownWrites at that moment. null = unknown. */
  private seen: { version: number; own: number } | null = null;
  ready = false;
  pendingWrites = 0;
  syncError: string | null = null;
  lastSyncedAt: number | null = null;

  get mode(): 'local' | 'supabase' | null {
    return this.backend?.mode ?? null;
  }
  get userId(): string {
    return this.backend?.userId ?? 'local';
  }

  async init(backend: Backend, outbox?: OutboxStorage) {
    this.backend = backend;
    this.flushing = null; // a flush/refresh still running for a previous account stops by itself
    this.refreshing = null;
    this.outboxStorage = outbox ?? null;
    this.outbox = outbox ? await outbox.load() : [];
    this.pendingWrites = this.outbox.length;
    this.syncError = null;
    this.rows = EMPTY_ROWS();
    this.seen = null;
    // Push anything left from a previous session before pulling fresh data.
    await this.flush();
    const version = await this.readVersion(backend);
    const own = this.ownWrites;
    // Whatever still hasn't gone through is shown anyway — it's queued, not lost.
    this.rows = applyOps(await backend.loadAll(), this.outbox);
    this.seen = baseline(version, own);
    if (backend.mode === 'supabase') this.lastSyncedAt = Date.now();
    this.ready = true;
    this.emit();
  }

  reset() {
    this.rows = EMPTY_ROWS();
    this.backend = null;
    this.ready = false;
    this.outbox = [];
    this.flushing = null;
    this.refreshing = null;
    this.journal = null;
    this.seen = null;
    this.pendingWrites = 0;
    this.syncError = null;
    this.lastSyncedAt = null;
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
    const s = this.status;
    if (s.mode !== this.mode || s.pending !== this.pendingWrites || s.error !== this.syncError || s.lastSyncedAt !== this.lastSyncedAt) {
      this.status = { mode: this.mode, pending: this.pendingWrites, error: this.syncError, lastSyncedAt: this.lastSyncedAt };
    }
    for (const l of this.listeners) l();
  }
  syncStatus = (): SyncStatus => this.status;

  /** Applies a change to memory now, and again on top of any refresh that's loading meanwhile. */
  private change(fn: (rows: Rows) => Rows) {
    this.rows = fn(this.rows);
    this.journal?.push(fn);
    this.emit();
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
    this.apply({ op: 'insert', table, rows: withUser as unknown as AnyRow[] });
    return withUser;
  }

  update<K extends TableName>(table: K, row: Tables[K], patch: Partial<Tables[K]>): Tables[K] {
    const match = matchOf(table, row as AnyRow);
    this.apply({ op: 'update', table, match, patch: patch as AnyRow });
    // The merged row, built on the latest stored copy rather than the caller's (possibly stale) one.
    return ((this.rows[table] as Tables[K][]).find((r) => sameKey(table, r as AnyRow, match)) ?? { ...row, ...patch }) as Tables[K];
  }

  remove<K extends TableName>(table: K, row: Tables[K]) {
    this.apply({ op: 'remove', table, match: matchOf(table, row as AnyRow) });
  }

  /** Drop rows from memory only (their deletion happens server-side via ON DELETE CASCADE). */
  purgeLocal<K extends TableName>(table: K, predicate: (r: Tables[K]) => boolean) {
    this.change((rows) => ({ ...rows, [table]: rows[table].filter((r) => !predicate(r)) }));
    this.backend?.persist?.(this.rows);
  }

  /** Patch rows in memory only (server-side FKs do the equivalent, e.g. ON DELETE SET NULL). */
  patchLocal<K extends TableName>(table: K, predicate: (r: Tables[K]) => boolean, patch: Partial<Tables[K]>) {
    this.change((rows) => ({
      ...rows,
      [table]: rows[table].map((r) => (predicate(r) ? ({ ...r, ...patch } as Tables[K]) : r)),
    }));
    this.backend?.persist?.(this.rows);
  }

  private apply(op: Op) {
    this.change((rows) => applyOps(rows, [op]));
    this.write(op);
  }

  // ---- persistence ------------------------------------------------------
  private write(op: Op) {
    const b = this.backend;
    if (!b) return;
    if (b.mode === 'local') {
      b.persist?.(this.rows);
      return;
    }
    this.outbox.push({ ...op, at: Date.now() });
    this.pendingWrites = this.outbox.length;
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

  /**
   * Send queued writes in order. Stops at the first one that can't go through yet; drops permanently-bad
   * ones. A call while a flush is running waits for that one (which also sends anything queued meanwhile).
   */
  flush(): Promise<void> {
    const b = this.backend;
    if (!b || b.mode === 'local') return Promise.resolve();
    this.flushing ??= this.send(b).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async send(b: Backend) {
    try {
      while (this.outbox.length > 0 && this.backend === b) {
        const op = this.outbox[0];
        this.pendingWrites = this.outbox.length;
        try {
          if (op.op === 'insert') await b.insert(op.table, op.rows);
          else if (op.op === 'update') await b.update(op.table, op.match, op.patch);
          else await b.remove(op.table, op.match);
          this.outbox.shift();
          this.syncError = null;
          if (!UNCOUNTED_TABLES.has(op.table)) this.ownWrites++;
        } catch (err) {
          const verdict = classifyFailure(op.op, err);
          if (verdict === 'done') {
            this.outbox.shift();
          } else if (verdict === 'drop') {
            console.warn('[store] dropping rejected write', op.op, op.table, (err as Error)?.message);
            this.outbox.shift();
          } else if (verdict === 'stuck' && Date.now() - (op.at ?? 0) > GIVE_UP_AFTER_MS) {
            // Refused for over a day (or queued by an older version of the app): let the rest through.
            console.warn('[store] giving up on a write the server keeps refusing', op.op, op.table, (err as Error)?.message);
            this.outbox.shift();
          } else {
            if (verdict === 'stuck') {
              this.syncError = (err as Error)?.message || `The server turned down a change to ${op.table}.`;
              console.warn('[store] write not accepted; keeping it queued', op.op, op.table, this.syncError);
            }
            break; // try again on the next write, refresh, or app foreground
          }
        }
      }
    } finally {
      if (this.backend === b) {
        this.pendingWrites = this.outbox.length;
        if (this.outbox.length === 0) this.syncError = null;
        await this.saveOutbox();
        this.emit();
      }
    }
  }

  /**
   * Push ours, then pull everything and fold in what other devices changed. Changes made on this
   * device while it loads — and anything still queued — are replayed on top, so nothing on screen
   * goes backwards. Overlapping calls share one run; failures (offline) leave the screen as it was.
   */
  refresh(): Promise<void> {
    if (this.backend?.mode !== 'supabase' || !this.ready) return Promise.resolve();
    this.refreshing ??= this.pull().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async pull() {
    const b = this.backend!;
    this.journal = [];
    try {
      await this.flush();
      const version = await this.readVersion(b); // read first: anything after it is caught next time
      const own = this.ownWrites;
      const loaded = await b.loadAll();
      if (this.backend !== b || !this.journal) return; // signed out or switched accounts meanwhile
      const next = this.journal.reduce((rows, fn) => fn(rows), applyOps(loaded, this.outbox));
      this.rows = reconcile(this.rows, next);
      this.seen = baseline(version, own);
      this.lastSyncedAt = Date.now();
      this.emit();
    } catch {
      /* offline or the server is unreachable — keep what's on screen */
    } finally {
      if (this.backend === b) this.journal = null;
    }
  }

  /**
   * The cheap, frequent check: send anything queued, then ask the server for one small counter and
   * download everything only if another device changed something. Falls back to a full refresh when
   * there's no baseline yet or the server has no counter.
   */
  async checkForChanges(): Promise<void> {
    const b = this.backend;
    if (b?.mode !== 'supabase' || !this.ready) return;
    if (this.outbox.length > 0) await this.flush();
    if (!this.seen) return this.refresh();
    const version = await this.readVersion(b);
    if (this.backend !== b || version === undefined) return; // offline — try again later
    if (version === 'unsupported' || othersChanged(this.seen, version, this.ownWrites, b.clientId ?? '')) {
      return this.refresh();
    }
    this.seen = { version: version?.version ?? 0, own: this.ownWrites };
    this.lastSyncedAt = Date.now();
    this.emit();
  }

  /** undefined = couldn't ask (offline). */
  private async readVersion(b: Backend): Promise<SyncVersion | 'unsupported' | null | undefined> {
    if (!b.syncVersion) return 'unsupported';
    try {
      return await b.syncVersion();
    } catch {
      return undefined;
    }
  }

  /** Every row of a table, including history the app doesn't keep in memory (falls back to what it has). */
  async fetchAll<K extends TableName>(table: K): Promise<Tables[K][]> {
    try {
      if (this.backend?.loadTable) return (await this.backend.loadTable(table)) as Tables[K][];
    } catch {
      /* offline — export what's here */
    }
    return this.rows[table];
  }

  /** Last resort for a write the server will never take: forget it so the rest can sync. */
  async discardStuckWrite() {
    if (this.outbox.length === 0) return;
    this.outbox.shift();
    this.syncError = null;
    this.pendingWrites = this.outbox.length;
    await this.saveOutbox();
    this.emit();
    await this.refresh();
  }
}

function baseline(version: SyncVersion | 'unsupported' | null | undefined, own: number): { version: number; own: number } | null {
  if (version === undefined || version === 'unsupported') return null;
  return { version: version?.version ?? 0, own };
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

/** Whether this device's changes are reaching the account. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(store.subscribe, store.syncStatus, store.syncStatus);
}
