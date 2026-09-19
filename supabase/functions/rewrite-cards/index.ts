// rewrite-cards — Stage 2 of the flashcard pipeline: FORMATTING ONLY.
// Stage 1 (deterministic extraction) and Stage 3 (programmatic rejection) run in the app;
// this function only rewrites candidates a program already chose. One batched call per note.
//
// Cost control (§6.5): on-demand only, per-candidate content-hash cache, one call per note,
// soft daily cap. Privacy (§10): the cache holds the *rewritten card text* for a passage, keyed
// by a hash, scoped to the school — never the note itself. Set CARD_CACHE=off to disable it.
import { authenticate, cacheGet, cachePut, corsHeaders, HttpError, json, sha256 } from '../_shared/common.ts';
import { getLlm, LlmError, models } from '../_shared/llm.ts';
import {
  CARDS_JSON_SCHEMA, PROMPT_VERSION, REWRITE_SYSTEM_PROMPT,
  type RewriteCandidateIn, type RewriteCardOut,
} from '../_shared/cards-schema.ts';

const MAX_CANDIDATES = 60;
const MAX_TEXT = 1200;
const DAILY_NOTE_CAP = Number(Deno.env.get('DAILY_NOTE_GEN_CAP') ?? '25'); // soft cap on the free tier

type Cached = Omit<RewriteCardOut, 'candidate_id'>[];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    const ctx = await authenticate(req);
    const body = await req.json().catch(() => ({}));
    const candidates: RewriteCandidateIn[] = (Array.isArray(body.candidates) ? body.candidates : [])
      .filter((c: RewriteCandidateIn) => c && typeof c.id === 'string' && typeof c.text === 'string' && c.text.trim())
      .slice(0, MAX_CANDIDATES)
      .map((c: RewriteCandidateIn) => ({ ...c, text: c.text.slice(0, MAX_TEXT) }));
    if (candidates.length === 0) throw new HttpError(400, 'No candidates to rewrite');

    // ---- soft daily cap: distinct notes generated from today ----
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { data: today } = await ctx.userDb
      .from('generation_events').select('source_note_id').gte('created_at', startOfDay.toISOString()).limit(2000);
    const notesToday = new Set((today ?? []).map((r: { source_note_id: string | null }) => r.source_note_id)).size;
    if (notesToday >= DAILY_NOTE_CAP) {
      throw new HttpError(429, `You've reached today's flashcard limit (${DAILY_NOTE_CAP} notes). It resets tomorrow.`);
    }

    // ---- per-candidate cache ----
    const useCache = (Deno.env.get('CARD_CACHE') ?? 'on') !== 'off';
    const out: RewriteCardOut[] = [];
    const misses: RewriteCandidateIn[] = [];
    const hashes = new Map<string, string>();
    let hits = 0;

    for (const c of candidates) {
      const h = await sha256(c.text);
      hashes.set(c.id, h);
      const cached = useCache ? ((await cacheGet(ctx, 'cards', h, PROMPT_VERSION)) as Cached | null) : null;
      if (cached) {
        hits++;
        for (const card of cached) out.push({ ...card, candidate_id: c.id });
      } else {
        misses.push(c);
      }
    }

    // ---- one batched call for everything not cached ----
    let model = 'cache';
    let raw: RewriteCardOut[] = [];
    if (misses.length > 0) {
      model = models.cards();
      const result = await getLlm().completeJson<{ cards: RewriteCardOut[] }>({
        model,
        system: REWRITE_SYSTEM_PROMPT,
        user: 'Candidates (JSON):\n' + JSON.stringify(
          misses.map((c) => ({ candidate_id: c.id, pattern: c.pattern_type, passage: c.text })),
        ),
        schema: CARDS_JSON_SCHEMA as unknown as Record<string, unknown>,
        maxTokens: 8000,
      });
      raw = (result.data.cards ?? []).filter((c) => misses.some((m) => m.id === c.candidate_id));
      out.push(...raw);
      console.log(JSON.stringify({ fn: 'rewrite-cards', user: ctx.userId, candidates: misses.length, hits, ...result.usage, model: result.model }));

      if (useCache) {
        for (const m of misses) {
          const forThis: Cached = raw
            .filter((c) => c.candidate_id === m.id)
            .map(({ candidate_id: _id, ...rest }) => rest);
          await cachePut(ctx, 'cards', hashes.get(m.id)!, PROMPT_VERSION, forThis);
        }
      }
    }

    return json({ cards: out, model, prompt_version: PROMPT_VERSION, raw_output: { cards: out }, cache_hits: hits });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof LlmError) return json({ error: e.message }, e.retryable ? 503 : 502);
    console.error('rewrite-cards failed:', (e as Error).message);
    return json({ error: 'Something went wrong making cards.' }, 500);
  }
});
