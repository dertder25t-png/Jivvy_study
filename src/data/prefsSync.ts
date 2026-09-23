// Study settings follow the account to every device. They're kept on the signed-in user's
// metadata (Supabase stores it with the account), so no table is needed. The newest change wins.
import type { SupabaseClient } from '@supabase/supabase-js';
import { prefs, SYNCED_PREFS, type Prefs } from './prefs';

type SyncedKey = (typeof SYNCED_PREFS)[number];
type Synced = Partial<Pick<Prefs, SyncedKey>>;

export interface RemotePrefs {
  values: Synced;
  updated_at: string;
}

const pick = (p: Prefs): Synced => Object.fromEntries(SYNCED_PREFS.map((k) => [k, p[k]])) as Synced;
const isSynced = (k: string): k is SyncedKey => (SYNCED_PREFS as readonly string[]).includes(k);

let applying = false;

/** Adopt the account's settings if they changed more recently than this device's. Returns whether it did. */
export function adoptRemotePrefs(remote: RemotePrefs | null | undefined): boolean {
  if (!remote?.updated_at || !remote.values) return false;
  const mine = prefs.get().prefsUpdatedAt;
  if (mine && mine >= remote.updated_at) return false;
  const values = Object.fromEntries(Object.entries(remote.values).filter(([k]) => isSynced(k))) as Synced;
  applying = true;
  try {
    prefs.set({ ...values, prefsUpdatedAt: remote.updated_at });
  } finally {
    applying = false;
  }
  return true;
}

async function push(client: SupabaseClient) {
  const p = prefs.get();
  const updated_at = p.prefsUpdatedAt ?? new Date().toISOString();
  if (!p.prefsUpdatedAt) prefs.set({ prefsUpdatedAt: updated_at });
  const study_prefs: RemotePrefs = { values: pick(p), updated_at };
  await client.auth.updateUser({ data: { study_prefs } });
}

/** Pull the account's settings; if the account has none yet, give it this device's. */
export async function pullPrefs(client: SupabaseClient): Promise<void> {
  try {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return;
    const remote = (data.user.user_metadata as { study_prefs?: RemotePrefs } | undefined)?.study_prefs;
    if (remote) adoptRemotePrefs(remote);
    else await push(client);
  } catch {
    /* offline — try again on the next sync */
  }
}

/** Send this device's setting changes to the account (debounced). Returns a stop function. */
export function watchPrefs(client: SupabaseClient): () => void {
  let last = JSON.stringify(pick(prefs.get()));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = prefs.subscribe(() => {
    const now = JSON.stringify(pick(prefs.get()));
    if (now === last) return;
    last = now;
    if (applying) return; // came from the account — nothing to send back
    prefs.set({ prefsUpdatedAt: new Date().toISOString() });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void push(client).catch(() => {}), 1500);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
