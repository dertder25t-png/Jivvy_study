// Getting your data out (download) and getting device data into an account (import).
// Pure functions over plain row objects, so both directions are testable.
import type { TableName } from '@/types/db';

export type RowsLike = Partial<Record<TableName, Array<Record<string, unknown>>>>;

/** Parents before children, so every foreign key resolves as rows are inserted. */
export const IMPORT_ORDER: TableName[] = [
  'terms', 'courses', 'syllabi', 'grade_components', 'assignments', 'topics', 'exams', 'exam_coverage',
  'quizzes', 'quiz_coverage', 'course_policies', 'absences', 'notes', 'cards', 'card_reviews',
  'questions', 'generation_events', 'waiting_on', 'metric_events',
];

/** table → [column, parent table] for the relationships that would otherwise fail on insert. */
const FKS: Partial<Record<TableName, Array<[string, TableName, boolean]>>> = {
  // [column, parent, nullable]
  courses: [['term_id', 'terms', true]],
  syllabi: [['course_id', 'courses', false]],
  grade_components: [['course_id', 'courses', false]],
  assignments: [['course_id', 'courses', false], ['component_id', 'grade_components', true]],
  topics: [['course_id', 'courses', false]],
  exams: [['course_id', 'courses', false], ['assignment_id', 'assignments', true]],
  exam_coverage: [['exam_id', 'exams', false], ['topic_id', 'topics', false]],
  quizzes: [['course_id', 'courses', false], ['assignment_id', 'assignments', true]],
  quiz_coverage: [['quiz_id', 'quizzes', false], ['topic_id', 'topics', false]],
  course_policies: [['course_id', 'courses', false]],
  absences: [['course_id', 'courses', false]],
  notes: [['course_id', 'courses', true], ['topic_id', 'topics', true], ['parent_note_id', 'notes', true]],
  cards: [['course_id', 'courses', true], ['topic_id', 'topics', true], ['source_note_id', 'notes', true]],
  card_reviews: [['card_id', 'cards', false]],
  questions: [['course_id', 'courses', false], ['topic_id', 'topics', true], ['quiz_id', 'quizzes', true], ['source_note_id', 'notes', true]],
  generation_events: [['card_id', 'cards', true], ['source_note_id', 'notes', true]],
  waiting_on: [['course_id', 'courses', true]],
};

const PK: Partial<Record<TableName, string>> = { exam_coverage: 'exam_id', course_policies: 'course_id' };

export interface ExportFile {
  app: 'study-app';
  version: 1;
  exported_at: string;
  counts: Record<string, number>;
  tables: RowsLike;
}

/** Everything the student owns, as one JSON document. */
export function buildExport(rows: RowsLike, now: Date): ExportFile {
  const tables: RowsLike = {};
  const counts: Record<string, number> = {};
  for (const t of IMPORT_ORDER) {
    const list = rows[t] ?? [];
    tables[t] = list;
    counts[t] = list.length;
  }
  return { app: 'study-app', version: 1, exported_at: now.toISOString(), counts, tables };
}

export function exportFileName(now: Date): string {
  return `study-app-data-${now.toISOString().slice(0, 10)}.json`;
}

function keyOf(table: TableName, row: Record<string, unknown>): string {
  if (table === 'exam_coverage') return `${row.exam_id}:${row.topic_id}`;
  if (table === 'quiz_coverage') return `${row.quiz_id}:${row.topic_id}`;
  return String(row[PK[table] ?? 'id']);
}

export interface PreparedImport {
  rows: RowsLike;
  imported: number;
  /** Rows dropped because a parent they point at is missing, or they already exist. */
  skipped: number;
}

/**
 * Makes device data safe to insert into an account: drops anything whose required parent is missing,
 * nulls optional links that dangle, and skips rows the account already has (so importing twice is harmless).
 */
export function prepareImport(local: RowsLike, existing: RowsLike = {}): PreparedImport {
  const have = new Map<TableName, Set<string>>();
  for (const t of IMPORT_ORDER) have.set(t, new Set((existing[t] ?? []).map((r) => keyOf(t, r))));

  const out: RowsLike = {};
  let imported = 0;
  let skipped = 0;

  for (const t of IMPORT_ORDER) {
    const kept: Array<Record<string, unknown>> = [];
    for (const original of local[t] ?? []) {
      const row = { ...original };
      const k = keyOf(t, row);
      if (have.get(t)!.has(k)) {
        skipped++;
        continue;
      }
      let ok = true;
      for (const [col, parent, nullable] of FKS[t] ?? []) {
        const v = row[col];
        if (v == null) {
          if (!nullable) ok = false;
          continue;
        }
        if (!have.get(parent)!.has(String(v))) {
          if (nullable) row[col] = null;
          else ok = false;
        }
      }
      if (!ok) {
        skipped++;
        continue;
      }
      kept.push(row);
      have.get(t)!.add(k);
      imported++;
    }
    out[t] = kept;
  }
  return { rows: out, imported, skipped };
}

/** Is there anything worth offering to import? (A course is the real signal; loose notes alone are not.) */
export function hasMeaningfulData(rows: RowsLike): boolean {
  return (rows.courses?.length ?? 0) > 0 || (rows.notes?.length ?? 0) > 0 || (rows.cards?.length ?? 0) > 0;
}
