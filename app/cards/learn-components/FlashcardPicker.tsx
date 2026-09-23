import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Chip, Row, Screen, Section, T } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import type { Card as CardType } from '@/types/db';

interface FlashcardPickerProps {
  /** Every card in the set, in Learn order. */
  cards: CardType[];
  /** The ones studied today. */
  todayIds: string[];
  /** Ticked to start with — usually the ones you missed. */
  preselected: string[];
  onStart: (ids: string[]) => void;
  onCancel: () => void;
}

/** Part of Learn mode: pick the cards you don't feel sure about yet, then flip through them. */
export default function FlashcardPicker({ cards, todayIds, preselected, onStart, onCancel }: FlashcardPickerProps) {
  const c = useColors();
  const [scope, setScope] = useState<'today' | 'set'>(todayIds.length > 0 ? 'today' : 'set');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(preselected));

  const listed = useMemo(() => {
    const today = new Set(todayIds);
    return scope === 'today' ? cards.filter((k) => today.has(k.id)) : cards;
  }, [cards, todayIds, scope]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Keep the order of the set, and only what's ticked.
  const chosen = cards.filter((k) => picked.has(k.id)).map((k) => k.id);

  return (
    <Screen
      maxWidth={760}
      footer={
        <View style={{ gap: 8 }}>
          <Button
            title={chosen.length > 0 ? `Go over ${chosen.length} card${chosen.length === 1 ? '' : 's'}` : 'Pick some cards'}
            onPress={() => onStart(chosen)}
            disabled={chosen.length === 0}
          />
          <Button title="Back" variant="ghost" onPress={onCancel} />
        </View>
      }
    >
      <Section title="Flashcards">
        <T>
          Pick the cards you don't feel sure about yet. You'll flip through them until every one is a "Got it" — and any you
          miss come back in Learn later today and over the next few days.
        </T>
      </Section>

      <Row style={{ flexWrap: 'wrap' }}>
        <Chip label={`Studied today (${todayIds.length})`} selected={scope === 'today'} onPress={() => setScope('today')} />
        <Chip label={`Whole set (${cards.length})`} selected={scope === 'set'} onPress={() => setScope('set')} />
      </Row>
      <Row style={{ flexWrap: 'wrap' }}>
        {preselected.length > 0 ? (
          <Button title={`Just the ones I missed (${preselected.length})`} small variant="ghost" onPress={() => setPicked(new Set(preselected))} />
        ) : null}
        <Button title="Select all shown" small variant="ghost" onPress={() => setPicked(new Set([...picked, ...listed.map((k) => k.id)]))} />
        <Button title="Clear" small variant="ghost" onPress={() => setPicked(new Set())} />
      </Row>

      {listed.length === 0 ? (
        <T variant="small" muted>Nothing studied yet today — switch to the whole set.</T>
      ) : (
        <View style={{ borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, overflow: 'hidden' }}>
          {listed.map((k, i) => {
            const on = picked.has(k.id);
            return (
              <Pressable
                key={k.id}
                onPress={() => toggle(k.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md,
                  borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border,
                  backgroundColor: pressed ? c.surfaceAlt : on ? c.primarySoft : c.surface,
                })}
              >
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? c.primary : c.muted} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T variant="body" style={{ fontWeight: '600' }} numberOfLines={1}>{k.term}</T>
                  <T variant="small" muted numberOfLines={1}>{k.definition}</T>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
