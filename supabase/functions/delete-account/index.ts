// delete-account — permanently removes the signed-in user and everything they own.
// Deleting the auth user cascades to public.users and from there to every table (see the migrations),
// so this only has to clear uploaded files first (storage isn't covered by foreign keys).
import { authenticate, corsHeaders, HttpError, json } from '../_shared/common.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    const ctx = await authenticate(req);
    const body = await req.json().catch(() => ({}));
    if (body.confirm !== 'DELETE') throw new HttpError(400, 'Confirmation required');

    // uploaded syllabi live under "<user id>/"
    const { data: files } = await ctx.admin.storage.from('syllabi').list(ctx.userId, { limit: 1000 });
    if (files && files.length > 0) {
      await ctx.admin.storage.from('syllabi').remove(files.map((f: { name: string }) => `${ctx.userId}/${f.name}`));
    }

    const { error } = await ctx.admin.auth.admin.deleteUser(ctx.userId);
    if (error) throw new HttpError(500, 'Could not delete the account. Nothing else was changed — please try again.');
    console.log(JSON.stringify({ fn: 'delete-account', deleted: true })); // never log who
    return json({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('delete-account failed:', (e as Error).message);
    return json({ error: 'Something went wrong deleting the account.' }, 500);
  }
});
