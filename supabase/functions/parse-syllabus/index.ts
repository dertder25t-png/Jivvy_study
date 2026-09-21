// parse-syllabus — the single highest-leverage function: everything downstream depends on it.
//
// Pipeline (spec §5.1):  extract text locally → hash → shared-cache lookup →
// (miss) heuristic parse → return for USER CONFIRMATION (the client never trusts it silently).
//
// Privacy: never log document content. Only ids, sizes and statuses.
// Cost: zero — uses regex & keyword matching, not AI.
import { authenticate, base64, cacheGet, cachePut, corsHeaders, HttpError, json, sha256, sha256Bytes } from '../_shared/common.ts';
import { extract } from '../_shared/extract.ts';
import type { LlmContent } from '../_shared/llm.ts';
import { coerceParsed, SYLLABUS_PARSE_VERSION, type ParsedSyllabus } from '../_shared/syllabus-schema.ts';
import { parseHeuristic } from '../_shared/heuristic-parse.ts';

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_CHARS = 120_000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    const ctx = await authenticate(req);
    const body = await req.json().catch(() => ({}));
    const term = body.term as { name: string; starts_on: string; ends_on: string } | undefined;
    if (!term?.starts_on || !term?.ends_on) throw new HttpError(400, 'term is required');

    // ---- 1. get text (or bytes for the vision path) ----
    let text: string | null = null;
    let visual: LlmContent | null = null;
    let hash = '';

    if (typeof body.text === 'string') {
      text = body.text;
    } else if (typeof body.storage_path === 'string') {
      const path: string = body.storage_path;
      if (!path.startsWith(`${ctx.userId}/`)) throw new HttpError(403, 'That file is not yours');
      const { data, error } = await ctx.admin.storage.from('syllabi').download(path);
      if (error || !data) throw new HttpError(404, 'Could not read the uploaded file');
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (bytes.length > MAX_BYTES) throw new HttpError(413, 'That file is too large (12 MB max)');

      const ex = await extract(bytes, String(body.mime ?? data.type ?? ''), path);
      if (ex.kind === 'text') text = ex.text;
      else if (ex.kind === 'image') visual = { type: 'image', mediaType: ex.mediaType, base64: base64(bytes) };
      else visual = { type: 'pdf', base64: base64(bytes) };
      if (visual) hash = await sha256Bytes(bytes);
    } else {
      throw new HttpError(400, 'Provide text or storage_path');
    }

    if (text != null) {
      if (text.trim().length < 200) throw new HttpError(422, "That doesn't look like a full syllabus — not enough text found.");
      text = text.slice(0, MAX_TEXT_CHARS);
      hash = await sha256(text);
    }

    // ---- 2. shared cache: same document, same school → parse once, serve everyone ----
    const version = String(SYLLABUS_PARSE_VERSION);
    const cached = await cacheGet(ctx, 'syllabus', hash, version);
    if (cached) {
      return json({ parsed: coerceParsed(cached), content_hash: hash, cache_hit: true, raw_text: text });
    }

    // ---- 3. heuristic parse (no AI, no cost) ----
    if (text == null) {
      throw new HttpError(422, "Heuristic parsing requires text. PDF/image parsing not supported (consider converting to text first).");
    }

    const parsed = coerceParsed(parseHeuristic({
      text,
      termStarts: term.starts_on,
      termEnds: term.ends_on,
      timezone: body.timezone as string | undefined,
    }));

    if (parsed.assignments.length + parsed.exams.length + parsed.quizzes.length + parsed.grade_components.length === 0) {
      throw new HttpError(422, "We couldn't find deadlines, exams, quizzes or grading info in that document. Try a different file or paste the text directly.");
    }

    await cachePut(ctx, 'syllabus', hash, version, parsed);
    console.log(JSON.stringify({ fn: 'parse-syllabus', user: ctx.userId, cache_hit: false, cost: 'free', method: 'heuristic' }));

    return json({ parsed, content_hash: hash, cache_hit: false, raw_text: text });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('parse-syllabus failed:', (e as Error).message);
    return json({ error: 'Something went wrong reading that syllabus.' }, 500);
  }
});
