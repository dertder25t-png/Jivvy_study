// Client for the two edge functions. Provider details never reach the app —
// the app only knows "parse this syllabus" and "rewrite these candidates".
import { getSupabase } from '@/data/supabase';
import { store } from '@/data/store';
import { newId } from '@/data/id';
import type { ParsedSyllabus } from '@/core/syllabus/types';
import { coerceParsed } from '@/core/syllabus/types';
import type { Candidate } from '@/core/flashcards/extract';
import { heuristicRewrite, type RewriteResponse } from '@/core/flashcards/pipeline';

export interface ParseResult {
  parsed: ParsedSyllabus;
  contentHash: string;
  cacheHit: boolean;
  rawText: string;
  filePath: string | null;
}

export type ParseInput =
  | { kind: 'text'; text: string }
  | { kind: 'file'; uri: string; name: string; mime: string };

export class BackendUnavailableError extends Error {
  constructor() {
    super('Syllabus parsing needs the backend. Connect Supabase, or try the sample syllabus.');
  }
}

export async function parseSyllabus(
  input: ParseInput,
  ctx: { term: { name: string; starts_on: string; ends_on: string }; tz: string },
): Promise<ParseResult> {
  if (store.mode !== 'supabase') throw new BackendUnavailableError();
  const sb = getSupabase();

  let filePath: string | null = null;
  let body: Record<string, unknown> = { term: ctx.term, timezone: ctx.tz };

  if (input.kind === 'text') {
    body.text = input.text;
  } else {
    const blob = await (await fetch(input.uri)).blob();
    const safe = input.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    filePath = `${store.userId}/${newId()}-${safe}`;
    const up = await sb.storage.from('syllabi').upload(filePath, blob, { contentType: input.mime, upsert: false });
    if (up.error) throw up.error;
    body = { ...body, storage_path: filePath, mime: input.mime };
  }

  const { data, error } = await sb.functions.invoke('parse-syllabus', { body });
  if (error) {
    // supabase-js hides the JSON body of non-2xx responses in `context`
    const ctxRes = (error as { context?: Response }).context;
    let message = error.message;
    try {
      const j = await ctxRes?.json();
      if (j?.error) message = j.error;
    } catch {
      /* keep generic message */
    }
    throw new Error(message);
  }
  return {
    parsed: coerceParsed(data.parsed),
    contentHash: data.content_hash,
    cacheHit: !!data.cache_hit,
    rawText: data.raw_text ?? (input.kind === 'text' ? input.text : ''),
    filePath,
  };
}

export interface RewriteResult extends RewriteResponse {
  /** Set when we fell back to the offline heuristic instead of the model. */
  fellBack: boolean;
}

/** Stage 2. Falls back to the deterministic heuristic when offline / in demo mode. */
export async function rewriteCards(candidates: Candidate[]): Promise<RewriteResult> {
  if (store.mode === 'supabase') {
    try {
      const { data, error } = await getSupabase().functions.invoke('rewrite-cards', {
        body: {
          candidates: candidates.map((c) => ({
            id: c.id, pattern_type: c.pattern_type, text: c.text, term_hint: c.term_hint, body_hint: c.body_hint,
          })),
        },
      });
      if (error) throw error;
      return { ...(data as RewriteResponse), fellBack: false };
    } catch (e) {
      console.warn('[rewriteCards] falling back to heuristic:', (e as Error).message);
    }
  }
  return { ...heuristicRewrite(candidates), fellBack: true };
}
