import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface Ctx {
  userId: string;
  /** Acts as the user (RLS applies). */
  userDb: SupabaseClient;
  /** Service role — server-only: shared cache + storage reads. Never exposed to the client. */
  admin: SupabaseClient;
  schoolId: string | null;
}

/** Verifies the caller's JWT and builds the two clients. */
export async function authenticate(req: Request): Promise<Ctx> {
  const auth = req.headers.get('Authorization');
  if (!auth) throw new HttpError(401, 'Sign in required');
  const url = Deno.env.get('SUPABASE_URL')!;
  const userDb = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data, error } = await userDb.auth.getUser();
  if (error || !data.user) throw new HttpError(401, 'Sign in required');

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: profile } = await admin.from('users').select('school_id').eq('id', data.user.id).maybeSingle();
  return { userId: data.user.id, userDb, admin, schoolId: profile?.school_id ?? null };
}

/** Stable content hash. Whitespace-normalised so re-exports of the same document collide. */
export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text.replace(/\s+/g, ' ').trim());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return 'bytes:' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- shared cache (§6.5)
/** Cache entries hold parsed *document structure* only — never notes or user edits (§10). */
export async function cacheGet(
  ctx: Ctx, kind: 'syllabus' | 'cards', hash: string, version: string,
): Promise<unknown | null> {
  let q = ctx.admin.from('content_cache').select('id, payload, hit_count')
    .eq('content_hash', hash).eq('kind', kind).eq('parse_version', version);
  q = ctx.schoolId ? q.eq('school_id', ctx.schoolId) : q.is('school_id', null);
  const { data } = await q.maybeSingle();
  if (!data) return null;
  await ctx.admin.from('content_cache').update({ hit_count: (data.hit_count ?? 0) + 1 }).eq('id', data.id);
  return data.payload;
}

export async function cachePut(
  ctx: Ctx, kind: 'syllabus' | 'cards', hash: string, version: string, payload: unknown,
): Promise<void> {
  await ctx.admin.from('content_cache').insert({
    content_hash: hash, kind, school_id: ctx.schoolId, parse_version: version, payload,
  });
  // A concurrent insert of the same key trips the unique index; that's fine — first writer wins.
}
