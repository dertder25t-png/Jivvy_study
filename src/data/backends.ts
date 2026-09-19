import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TableName } from '@/types/db';
import { EMPTY_ROWS, keyCols, type Backend, type Op, type OutboxStorage, type Rows } from './store';

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
  'course_policies', 'absences', 'topics', 'notes', 'cards', 'card_reviews', 'generation_events',
  'waiting_on', 'metric_events',
];

// Big text columns we don't need to pull on every launch.
const OMIT_ON_LOAD: Partial<Record<TableName, string>> = {
  syllabi: 'id,course_id,file_path,content_hash,parse_status,parse_version,parsed_at',
};

export function createSupabaseBackend(client: SupabaseClient, userId: string): Backend {
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
            const { data, error } = await client
              .from(t)
              .select(OMIT_ON_LOAD[t] ?? '*')
              .range(from, from + 999);
            if (error) throw error;
            rows.push(...(data ?? []));
            if (!data || data.length < 1000) break;
          }
          out[t] = rows;
        }),
      );
      return out as unknown as Rows;
    },
    async insert(table, rows) {
      const { error } = await client.from(table).insert(rows);
      if (error) throw error;
    },
    async update(table, match, patch) {
      let q = client.from(table).update(patch);
      for (const c of keyCols(table)) q = q.eq(c, match[c] as string);
      const { error } = await q;
      if (error) throw error;
    },
    async remove(table, match) {
      let q = client.from(table).delete();
      for (const c of keyCols(table)) q = q.eq(c, match[c] as string);
      const { error } = await q;
      if (error) throw error;
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
