// Talks to the optional card helper on this laptop (scripts/npu-cards): a small model on the
// NPU that rewrites note passages into cards. Only used when switched on in Settings, so the app
// never probes the local network for anyone else. If the helper isn't running, callers get null
// and fall back to the built-in rules.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Candidate } from '@/core/flashcards/extract';
import type { FoundTerm, NoteBlock } from '@/core/flashcards/modelFind';
import type { RewriteResponse } from '@/core/flashcards/pipeline';
import { prefs } from './prefs';

export const LOCAL_AI_URL = 'http://127.0.0.1:8765';

async function call(path: string, init: RequestInit, ms: number): Promise<Response | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(LOCAL_AI_URL + path, { ...init, signal: ctl.signal });
    return r.ok ? r : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export interface LocalAiStatus {
  model: string;
  device: string;
  loaded: boolean;
}

/** Is the helper running? (For the Settings screen.) */
export async function localAiStatus(): Promise<LocalAiStatus | null> {
  const r = await call('/health', { method: 'GET' }, 2000);
  return r ? ((await r.json()) as LocalAiStatus) : null;
}

/** Stage 2 on the NPU. null = switched off, not running, or failed (use the rules instead). */
export async function rewriteWithLocalAi(candidates: Candidate[]): Promise<RewriteResponse | null> {
  if (!prefs.get().localAiEnabled || candidates.length === 0) return null;
  const body = JSON.stringify({
    candidates: candidates.map((c) => ({ id: c.id, text: c.text, term_hint: c.term_hint })),
  });
  // Generous: the first call after the helper has been idle reloads the model.
  const r = await call('/cards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, 120_000);
  if (!r) return null;
  try {
    const j = (await r.json()) as { cards: RewriteResponse['cards']; model: string; prompt_version: string };
    return { cards: j.cards ?? [], model: j.model, prompt_version: j.prompt_version, raw_output: j };
  } catch {
    return null;
  }
}

/** Stage 1b on the NPU: definitions the model spots in each block (checked against the note later). */
export async function findWithLocalAi(blocks: NoteBlock[]): Promise<{ found: FoundTerm[]; model: string } | null> {
  if (!prefs.get().localAiEnabled || blocks.length === 0) return null;
  const body = JSON.stringify({ blocks: blocks.map((b) => ({ id: b.id, text: b.text })) });
  const r = await call('/find', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, 180_000);
  if (!r) return null;
  try {
    const j = (await r.json()) as { found: FoundTerm[]; model: string };
    return { found: Array.isArray(j.found) ? j.found : [], model: j.model };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- blocks already read
// So typing in one paragraph doesn't make the model re-read the whole note. Kept per device.
const SEEN_KEY = 'studyapp.aiSeenBlocks.v1';
const SEEN_PER_NOTE = 300;
let seen: Record<string, string[]> | null = null;

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}.${s.length}`;
}

async function seenFor(noteId: string): Promise<Set<string>> {
  if (!seen) {
    try {
      seen = JSON.parse((await AsyncStorage.getItem(SEEN_KEY)) ?? '{}') as Record<string, string[]>;
    } catch {
      seen = {};
    }
  }
  return new Set(seen[noteId] ?? []);
}

/** The blocks of this note the model hasn't read yet (all of them when `all`). */
export async function unreadBlocks(noteId: string, blocks: NoteBlock[], all = false): Promise<NoteBlock[]> {
  if (all) return blocks;
  const s = await seenFor(noteId);
  return blocks.filter((b) => !s.has(hash(b.text)));
}

export async function markBlocksRead(noteId: string, blocks: NoteBlock[]): Promise<void> {
  const s = await seenFor(noteId);
  for (const b of blocks) s.add(hash(b.text));
  seen![noteId] = [...s].slice(-SEEN_PER_NOTE);
  AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen)).catch(() => {});
}
