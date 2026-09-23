import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Button, Card, ProgressBar, Row, Screen, Section, T } from '@/ui/components';
import { useLayout } from '@/ui/layout';
import { radius, space, useColors } from '@/ui/theme';
import type { Card as CardType } from '@/types/db';
import { directionForCard, type StudyDirection } from '@/core/learning';

interface FlashcardDrillProps {
  ids: string[];
  cards: CardType[];
  direction: StudyDirection;
  /** The first time a card is "Still learning" in this drill — so it comes back in Learn soon. */
  onMiss: (cardId: string) => void;
  onBack: () => void;
  onDone: () => void;
}

/**
 * Flip-card practice inside Learn mode. Flip, then "Got it" or "Still learning": the ones you're still
 * learning go to the back and come round again until every card is a "Got it".
 * Keys on the web: Space flips, 1 = still learning, 2 = got it.
 */
export default function FlashcardDrill({ ids, cards, direction, onMiss, onBack, onDone }: FlashcardDrillProps) {
  const c = useColors();
  const { isPhone } = useLayout();
  const byId = new Map(cards.map((k) => [k.id, k]));
  const [queue, setQueue] = useState(() => ids.filter((id) => byId.has(id)));
  const [total, setTotal] = useState(queue.length);
  const [flipped, setFlipped] = useState(false);
  const [missed, setMissed] = useState<Set<string>>(new Set());
  const [firstTry, setFirstTry] = useState(0);

  const card = byId.get(queue[0] ?? '');
  const side = card ? directionForCard(direction, card.id) : 'term_to_def';
  const front = card ? (side === 'term_to_def' ? card.term : card.definition) : '';
  const back = card ? (side === 'term_to_def' ? card.definition : card.term) : '';

  const answer = (gotIt: boolean) => {
    if (!card || !flipped) return;
    if (gotIt) {
      if (!missed.has(card.id)) setFirstTry((n) => n + 1);
      setQueue((q) => q.slice(1));
    } else {
      if (!missed.has(card.id)) {
        onMiss(card.id);
        setMissed((m) => new Set(m).add(card.id));
      }
      setQueue((q) => [...q.slice(1), q[0]]);
    }
    setFlipped(false);
  };

  // Keyboard on the web (no text box here, so single keys are safe).
  const keys = useRef({ answer, flip: () => setFlipped((f) => !f), active: Boolean(card) });
  keys.current = { answer, flip: () => setFlipped((f) => !f), active: Boolean(card) };
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (!keys.current.active) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        keys.current.flip();
      } else if (e.key === '1') keys.current.answer(false);
      else if (e.key === '2') keys.current.answer(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!card) {
    return (
      <Screen maxWidth={680}>
        <Section title="All solid 🎉">
          <T>
            {`You got all ${total} card${total === 1 ? '' : 's'}${firstTry === total ? ' on the first try' : ''}.`}
            {missed.size > 0 ? ` The ${missed.size} you had to go back to will come round again in Learn later today and over the next few days.` : ''}
          </T>
        </Section>
        <View style={{ gap: 8 }}>
          <Button title="Back to Learn" onPress={onBack} />
          <Button
            title="Go over them again"
            variant="secondary"
            onPress={() => {
              const again = ids.filter((id) => byId.has(id));
              setQueue(again);
              setTotal(again.length);
              setMissed(new Set());
              setFirstTry(0);
            }}
          />
          <Button title="Done for now" variant="ghost" onPress={onDone} />
        </View>
      </Screen>
    );
  }

  const confident = total - new Set(queue).size;

  return (
    <Screen
      maxWidth={680}
      footer={
        flipped ? (
          <Row gap={space.sm}>
            <Button title="Still learning" variant="secondary" onPress={() => answer(false)} style={{ flex: 1 }} />
            <Button title="Got it" onPress={() => answer(true)} style={{ flex: 1 }} />
          </Row>
        ) : (
          <Button title="Flip" onPress={() => setFlipped(true)} />
        )
      }
    >
      <View style={{ gap: space.lg, paddingTop: isPhone ? space.lg : space.xxl }}>
        <View style={{ gap: 6 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="small" muted>{confident} of {total} got it</T>
            <Pressable onPress={onBack} accessibilityRole="button" hitSlop={8}>
              <T variant="small" color={c.primary} style={{ fontWeight: '600' }}>Back to Learn</T>
            </Pressable>
          </Row>
          <ProgressBar value={confident / Math.max(1, total)} />
        </View>

        <Pressable onPress={() => setFlipped((f) => !f)} accessibilityRole="button" accessibilityLabel={flipped ? 'Show the front' : 'Flip the card'}>
          <Card style={{ minHeight: isPhone ? 260 : 320, justifyContent: 'center', padding: space.xl, gap: space.md }}>
            <T variant="label" muted>{side === 'term_to_def' ? 'Term' : 'Definition'}</T>
            <T variant="title">{front}</T>
            {flipped ? (
              <View style={{ gap: space.sm, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }}>
                <T variant="label" muted>{side === 'term_to_def' ? 'Definition' : 'Term'}</T>
                <T style={{ fontSize: 18, lineHeight: 26 }}>{back}</T>
              </View>
            ) : (
              <T variant="small" muted>Say it to yourself, then flip.</T>
            )}
          </Card>
        </Pressable>
        {Platform.OS === 'web' && !isPhone ? (
          <T variant="small" muted style={{ textAlign: 'center' }}>Space to flip · 1 still learning · 2 got it</T>
        ) : null}
        {missed.has(card.id) ? (
          <View style={{ alignSelf: 'center', paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.md, backgroundColor: c.surfaceAlt }}>
            <T variant="small" muted>Coming round again</T>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
