// Card check suggestions for every set, worked out on the device from the cards and how often each one
// has been missed. Shared by the deck, the Study tab, Learn mode and the Card check screen.
import { useMemo } from 'react';
import { checkCards, type CardAdvice, type CheckInput } from '@/core/flashcards/cardCheck';
import { usable } from '@/core/session';
import { useSemester } from './derived';
import { usePrefs } from './prefs';

/** Set key for cards not tied to a note ("Ungrouped cards"). */
export const NO_SET = 'none';

export interface CardAdviceIndex {
  all: CardAdvice[];
  /** By set: the note id, or NO_SET. */
  bySet: Map<string, CardAdvice[]>;
}

export function useCardAdvice(): CardAdviceIndex {
  const sem = useSemester();
  const { dismissedAdvice } = usePrefs();
  return useMemo(() => {
    const titles = new Map(sem.rows.notes.map((n) => [n.id, n.title || 'Untitled set']));
    const inputs: CheckInput[] = sem.cards.filter(usable).map((k) => ({
      card: k.card,
      misses: k.reviews.filter((r) => r.rating === 1).length,
      setTitle: k.card.source_note_id ? titles.get(k.card.source_note_id) : 'Ungrouped cards',
    }));
    const skipped = new Set(dismissedAdvice);
    const setOf = new Map(sem.cards.map((k) => [k.card.id, k.card.source_note_id ?? NO_SET]));
    const all = checkCards(inputs).filter((a) => !skipped.has(`${a.cardId}:${a.kind}`));
    const bySet = new Map<string, CardAdvice[]>();
    for (const a of all) {
      const key = setOf.get(a.cardId) ?? NO_SET;
      bySet.set(key, [...(bySet.get(key) ?? []), a]);
    }
    return { all, bySet };
  }, [sem.cards, sem.rows.notes, dismissedAdvice]);
}
