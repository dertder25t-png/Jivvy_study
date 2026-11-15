// A safety net for note text: earlier versions of each note, kept on this device. A version is saved
// when you start editing a note, then at most every few minutes while you type, and always right before
// a big chunk of text disappears — so an accidental select-all-delete (or a bad sync) can be undone.
// Capped in size so it can never crowd out the app's own data in browser storage.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'studyapp.noteHistory.v1';
const EVERY_MS = 5 * 60_000;
const PER_NOTE = 25;
const MAX_CHARS = 1_500_000;

export interface NoteVersion {
  at: string;
  title: string | null;
  body: string;
}

type History = Record<string, NoteVersion[]>;

let cache: History | null = null;
let loading: Promise<History> | null = null;

async function load(): Promise<History> {
  if (cache) return cache;
  loading ??= AsyncStorage.getItem(KEY)
    .then((raw) => (raw ? (JSON.parse(raw) as History) : {}))
    .catch(() => ({}))
    .then((h) => {
      cache = h;
      return h;
    });
  return loading;
}

function prune(h: History) {
  for (const id of Object.keys(h)) h[id] = h[id].slice(-PER_NOTE);
  const all = Object.entries(h).flatMap(([id, vs]) => vs.map((v) => ({ id, v })));
  let size = all.reduce((s, x) => s + x.v.body.length + (x.v.title?.length ?? 0) + 40, 0);
  if (size <= MAX_CHARS) return;
  all.sort((a, b) => a.v.at.localeCompare(b.v.at));
  for (const { id, v } of all) {
    if (size <= MAX_CHARS) break;
    // keep at least the newest version of every note
    if (h[id].length <= 1) continue;
    h[id] = h[id].filter((x) => x !== v);
    size -= v.body.length + (v.title?.length ?? 0) + 40;
  }
}

async function save(h: History) {
  prune(h);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(h));
  } catch {
    // storage full: drop the oldest half and try once more; history is a convenience, never a blocker
    for (const id of Object.keys(h)) h[id] = h[id].slice(Math.floor(h[id].length / 2));
    await AsyncStorage.setItem(KEY, JSON.stringify(h)).catch(() => {});
  }
}

/** Did this edit throw away a lot of text? Then the version before it is worth keeping. */
export function bigLoss(before: string, after: string): boolean {
  const lost = before.length - after.length;
  return lost >= 200 || (before.length >= 40 && after.length < before.length * 0.5);
}

/**
 * Called with the note's text as it was *before* a save. Keeps it when it's the first version, when the
 * last kept one is a few minutes old, or when the save is about to remove a lot.
 */
export async function rememberVersion(
  noteId: string, prev: { title: string | null; body: string }, next: { body: string }, now = new Date(), force = false,
) {
  if (!prev.body.trim() && !prev.title?.trim()) return;
  const h = await load();
  const list = h[noteId] ?? [];
  const last = list[list.length - 1];
  if (last && last.body === prev.body && (last.title ?? '') === (prev.title ?? '')) return;
  const stale = !last || now.getTime() - new Date(last.at).getTime() >= EVERY_MS;
  if (!force && !stale && !bigLoss(prev.body, next.body)) return;
  h[noteId] = [...list, { at: now.toISOString(), title: prev.title, body: prev.body }];
  await save(h);
}

/** Newest first. */
export async function versionsOf(noteId: string): Promise<NoteVersion[]> {
  const h = await load();
  return [...(h[noteId] ?? [])].reverse();
}
