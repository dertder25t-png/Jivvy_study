// While you write: once you pause, hand the passages you just added to the local model and drop
// the results into "Waiting for your OK". Only runs when the local helper is switched on in
// Settings, only on new passages, and never while the page is in the background — so the NPU
// does a few seconds of work per pause and is idle the rest of the time.
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { wordCount } from '@/core/flashcards/text';
import { generateForNote, type GenerationSummary } from '@/data/generation';
import { usePrefs } from '@/data/prefs';
import type { Note } from '@/types/db';

const PAUSE_MS = 6000;

export interface AutoCardsState {
  /** The local model is switched on (it can find definitions the patterns miss). */
  ai: boolean;
  /** …and makes cards by itself while you write. */
  on: boolean;
  busy: boolean;
  /** The last automatic run that made something. */
  last: GenerationSummary | null;
}

export function useAutoCards(body: string, ensureSaved: () => Note | null): AutoCardsState {
  const p = usePrefs();
  const on = p.localAiEnabled && p.localAiAuto;
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<GenerationSummary | null>(null);
  const running = useRef(false);
  // Only react to typing: opening a note isn't a reason to start the model
  // ("Find cards in this note" is there for reading a note you didn't just write).
  const opened = useRef(body);

  useEffect(() => {
    if (body === opened.current) return;
    // The model can find definitions the patterns don't, so any real text is worth a look.
    if (!on || wordCount(body) < 6) return;
    const t = setTimeout(async () => {
      if (running.current) return;
      if (Platform.OS === 'web' && typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const note = ensureSaved();
      if (!note) return;
      running.current = true;
      setBusy(true);
      try {
        const f = await generateForNote(note, { onlyNew: true });
        if (f && f.survived > 0) setLast(f);
      } catch {
        /* automatic: stay quiet, the "Make cards" button still reports errors */
      } finally {
        running.current = false;
        setBusy(false);
      }
    }, PAUSE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, on]);

  return { ai: p.localAiEnabled, on, busy, last };
}
