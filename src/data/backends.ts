import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TableName } from '@/types/db';
import { EMPTY_ROWS, keyCols, type Backend, type Op, type OutboxStorage, type Rows, type SyncFailure } from './store';

// ---------------------------------------------------------------------------
// Local backend: everything lives on this device (demo mode / no account).
// ---------------------------------------------------------------------------
const LOCAL_KEY = 'studyapp.local.v1';

export function createLocalBackend(): Backend {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Rows | null = null;

  const flush = () => {
    if (!pending) return;
    const data = pending;
    pending = null;
    AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(data)).catch(() => {});
  };

  return {
    mode: 'local',
    userId: 'local',
    async loadAll() {
      try {
        const raw = await AsyncStorage.getItem(LOCAL_KEY);
        if (!raw) return EMPTY_ROWS();
        return { ...EMPTY_ROWS(), ...(JSON.parse(raw) as Partial<Rows>) };
      } catch {
        return EMPTY_ROWS();
      }
    },
    async insert() {},
    async update() {},
    async remove() {},
    persist(rows) {
      pending = rows;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 250);
    },
  };
}

export async function clearLocalData() {
  await AsyncStorage.removeItem(LOCAL_KEY);
}

// ---------------------------------------------------------------------------
// Supabase backend
// ---------------------------------------------------------------------------
const TABLES: TableName[] = [
  'terms', 'courses', 'syllabi', 'grade_components', 'assignments', 'exams', 'exam_coverage',
  'quizzes', 'quiz_coverage', 'course_policies', 'absences', 'topics', 'notes', 'cards', 'card_reviews',
  'questions', 'generation_events', 'waiting_on', 'metric_events', 'learn_progress',
];

// Big text columns we don't need to pull on every launch.
const OMIT_ON_LOAD: Partial<Record<TableName, string>> = {
  syllabi: 'id,course_id,file_path,content_hash,parse_status,parse_version,parsed_at',
};

interface Result {
  error: { message: string; code?: string } | null;
  status: number;
}

/** A PostgREST error as a thrown Error that keeps the HTTP status (0 = never reached the server) and code. */
function failure(res: Result): Error & SyncFailure {
  return Object.assign(new Error(res.error?.message ?? 'Request failed'), { status: res.status, code: res.error?.code });
}

/** The table isn't on the server yet (a migration still to run) — as opposed to any other failure. */
const isMissingTable = (code: string | undefined) => code === 'PGRST205' || code === '42P01';

export function createSupabaseBackend(client: SupabaseClient, userId: string): Backend {
  /** Runs a request; if the sign-in expired while the app sat in the background, renews it and tries once more. */
  const run = async (request: () => PromiseLike<Result>) => {
    let res = await request();
    if (res.error && res.status === 401) {
      await client.auth.refreshSession().catch(() => {});
      res = await request();
    }
    if (res.error) throw failure(res);
  };

  return {
    mode: 'supabase',
    userId,
    async loadAll() {
      const out = EMPTY_ROWS() as unknown as Record<string, unknown[]>;
      await Promise.all(
        TABLES.map(async (t) => {
          // Page through — PostgREST caps responses at 1000 rows.
          const rows: unknown[] = [];
          for (let from = 0; ; from += 1000) {
            const res = await client
              .from(t)
              .select(OMIT_ON_LOAD[t] ?? '*')
              .range(from, from + 999);
            if (res.error) {
              if (isMissingTable(res.error.code)) {
                console.warn(`[sync] the server has no "${t}" table yet — run the latest migration`);
                break;
              }
              throw failure(res);
            }
            rows.push(...(res.data ?? []));
            if (!res.data || res.data.length < 1000) break;
          }
          out[t] = rows;
        }),
      );
      return out as unknown as Rows;
    },
    async insert(table, rows) {
      await run(() => client.from(table).insert(rows));
    },
    async update(table, match, patch) {
      await run(() => {
        let q = client.from(table).update(patch);
        for (const c of keyCols(table)) q = q.eq(c, match[c] as string);
        return q;
      });
    },
    async remove(table, match) {
      await run(() => {
        let q = client.from(table).delete();
        for (const c of keyCols(table)) q = q.eq(c, match[c] as string);
        return q;
      });
    },
  };
}

export const asyncOutbox = (key = 'studyapp.outbox.v1'): OutboxStorage => ({
  async load() {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw ? (JSON.parse(raw) as Op[]) : [];
    } catch {
      return [];
    }
  },
  async save(ops) {
    await AsyncStorage.setItem(key, JSON.stringify(ops));
  },
});
