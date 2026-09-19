// Account operations. Every network call goes through here so screens stay simple and errors are
// translated once (src/core/auth.ts). Nothing here logs credentials.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Platform, Share } from 'react-native';
import { friendlyAuthError, normalizeEmail } from '@/core/auth';
import { IMPORT_ORDER, buildExport, exportFileName, hasMeaningfulData, prepareImport, type RowsLike } from '@/core/exportData';
import { getSupabase, isSupabaseConfigured } from './supabase';
import { prefs } from './prefs';
import { store } from './store';
import type { TableName } from '@/types/db';

export { friendlyAuthError };

const LOCAL_KEY = 'studyapp.local.v1'; // must match backends.ts

export type CodeKind = 'signup' | 'email';

export async function signUpWithPassword(args: { email: string; password: string; name?: string }): Promise<'signed_in' | 'needs_code'> {
  const { data, error } = await getSupabase().auth.signUp({
    email: normalizeEmail(args.email),
    password: args.password,
    options: args.name?.trim() ? { data: { full_name: args.name.trim() } } : undefined,
  });
  if (error) throw error;
  if (data.session) return 'signed_in';
  // With email confirmation on, an existing address comes back as a user with no identities.
  if (data.user && (data.user.identities?.length ?? 1) === 0) throw new Error('User already registered');
  return 'needs_code';
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithPassword({ email: normalizeEmail(email), password });
  if (error) throw error;
}

/** Emails a one-time code to an EXISTING account (also the way back in after forgetting a password). */
export async function sendSignInCode(email: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOtp({ email: normalizeEmail(email), options: { shouldCreateUser: false } });
  if (error) throw error;
}

export async function verifyCode(email: string, code: string, type: CodeKind): Promise<void> {
  const { error } = await getSupabase().auth.verifyOtp({ email: normalizeEmail(email), token: code.replace(/\s/g, ''), type });
  if (error) throw error;
}

export async function resendSignupCode(email: string): Promise<void> {
  const { error } = await getSupabase().auth.resend({ type: 'signup', email: normalizeEmail(email) });
  if (error) throw error;
}

export async function changePassword(newPassword: string): Promise<void> {
  const { error } = await getSupabase().auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export interface AccountInfo {
  email: string | null;
  name: string | null;
  createdAt: string | null;
}

export async function currentAccount(): Promise<AccountInfo | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await getSupabase().auth.getUser();
  const u = data.user;
  if (!u) return null;
  return {
    email: u.email ?? null,
    name: (u.user_metadata as { full_name?: string } | undefined)?.full_name ?? null,
    createdAt: u.created_at ?? null,
  };
}

export async function saveProfile(args: { name: string; timezone: string }): Promise<void> {
  prefs.set({ studentName: args.name.trim(), tz: args.timezone });
  if (store.mode !== 'supabase') return;
  const sb = getSupabase();
  await sb.auth.updateUser({ data: { full_name: args.name.trim() } });
  await sb.from('users').update({ timezone: args.timezone }).eq('id', store.userId); // best effort
}

/** Permanently deletes the account and everything in it (server-side, via the delete-account function). */
export async function deleteAccount(): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.functions.invoke('delete-account', { body: { confirm: 'DELETE' } });
  if (error) {
    let message = error.message;
    try {
      const j = await (error as { context?: Response }).context?.json();
      if (j?.error) message = j.error;
    } catch {
      /* keep generic */
    }
    throw new Error(message);
  }
  await sb.auth.signOut({ scope: 'local' });
}

// ------------------------------------------------------------------ export
export function exportJson(now = new Date()): string {
  return JSON.stringify(buildExport(store.snapshot() as unknown as RowsLike, now), null, 2);
}

/** Web: saves a .json file. Phones: opens the share sheet with the JSON. */
export async function downloadMyData(): Promise<void> {
  const now = new Date();
  const json = exportJson(now);
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName(now);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else {
    await Share.share({ title: exportFileName(now), message: json });
  }
}

// ------------------------------------------------------------------ bring device data into the account
export async function readLocalRows(): Promise<RowsLike | null> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as RowsLike) : null;
  } catch {
    return null;
  }
}

export async function importLocalData(): Promise<{ imported: number; skipped: number }> {
  if (store.mode !== 'supabase') throw new Error('Sign in first.');
  const local = await readLocalRows();
  if (!local) return { imported: 0, skipped: 0 };
  const prepared = prepareImport(local, store.snapshot() as unknown as RowsLike);
  for (const table of IMPORT_ORDER) {
    const rows = prepared.rows[table] ?? [];
    for (let i = 0; i < rows.length; i += 400) {
      // parents first, in chunks; the store stamps user_id and queues the writes (offline-safe)
      store.insertMany(table as TableName, rows.slice(i, i + 400) as never);
    }
  }
  prefs.set({ localImport: 'done' });
  return { imported: prepared.imported, skipped: prepared.skipped };
}

export interface LocalDataOffer {
  courses: number;
  notes: number;
  cards: number;
}

/** Non-null when signed in, this device holds data, and the student hasn't dealt with it yet. */
export function useLocalDataOffer(): LocalDataOffer | null {
  const [offer, setOffer] = useState<LocalDataOffer | null>(null);
  const [state, setState] = useState(prefs.get().localImport);
  useEffect(() => prefs.subscribe(() => setState(prefs.get().localImport)), []);
  useEffect(() => {
    let live = true;
    if (store.mode !== 'supabase' || state !== 'pending') {
      setOffer(null);
      return;
    }
    void readLocalRows().then((rows) => {
      if (!live) return;
      setOffer(rows && hasMeaningfulData(rows) ? { courses: rows.courses?.length ?? 0, notes: rows.notes?.length ?? 0, cards: rows.cards?.length ?? 0 } : null);
    });
    return () => {
      live = false;
    };
  }, [state]);
  return offer;
}
