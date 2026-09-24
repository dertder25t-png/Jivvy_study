import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Card, Chip, Row, Screen, Section, T } from '@/ui/components';
import { useColors } from '@/ui/theme';
import type { PocketRecommendation, StudyDirection } from '@/core/learning';

const DIRECTIONS: Array<{ key: StudyDirection; label: string; hint: string }> = [
  { key: 'term_to_def', label: 'Answer with the definition', hint: "You're shown the term and type its definition." },
  { key: 'def_to_term', label: 'Answer with the term', hint: "You're shown the definition and type the term it describes." },
  { key: 'mixed', label: 'Mix both', hint: 'Each card asks one way or the other — the card always says which.' },
];

interface PocketSetupProps {
  recommendation: PocketRecommendation;
  totalCards: number;
  initialSize: number;
  initialDirection: StudyDirection;
  initialShuffle: boolean;
  onStart: (size: number, direction: StudyDirection, shuffle: boolean) => void;
  /** Present when changing settings mid-set (rather than the first time): progress so far + ways out. */
  editing?: {
    learned: number;
    onRestart: () => void;
    onReshuffle: () => void;
    onCancel: () => void;
  };
  /** Card check found things to fix in this set. */
  advice?: { count: number; onOpen: () => void };
  /** With a study plan, the plan sets how many cards a day — said here instead of a cards-per-day suggestion. */
  planNote?: string;
}

/** Asked once per set. After that Learn goes straight to your cards; this only comes back from "Options". */
export default function PocketSetup({
  recommendation, totalCards, initialSize, initialDirection, initialShuffle, onStart, editing, advice, planNote,
}: PocketSetupProps) {
  const [selected, setSelected] = useState(Math.max(1, Math.min(initialSize, totalCards)));
  const [direction, setDirection] = useState<StudyDirection>(initialDirection);
  const [shuffle, setShuffle] = useState(initialShuffle);
  const c = useColors();

  const presets = [...new Set([3, 5, 10, 15, 20, 30, 50, selected])].filter((n) => n <= totalCards).sort((a, b) => a - b);

  return (
    <Screen maxWidth={760}
      footer={
        <View style={{ gap: 8 }}>
          <Button
            title={editing ? 'Save and keep going' : `Study ${selected} cards at a time`}
            onPress={() => onStart(selected, direction, shuffle)}
            variant="primary"
          />
          {editing ? <Button title="Cancel" variant="ghost" onPress={editing.onCancel} /> : null}
        </View>
      }
    >
      <View style={{ gap: 12 }}>
        <Section title={editing ? 'Learn settings' : 'Learn Mode'}>
          <T>
            {editing
              ? `You've learned ${editing.learned} of ${totalCards} cards in this set, and that progress stays. A new pocket size starts with your next pocket.`
              : "Type each answer twice: first while you can see it, then from memory. You'll only set this up once — next time Learn picks up right where you left off."}
          </T>
        </Section>

        {advice && advice.count > 0 ? (
          <Card tone="warn">
            <T variant="heading">Card check: {advice.count} suggestion{advice.count === 1 ? '' : 's'}</T>
            <T variant="small">
              Some cards in this set are long lists, duplicates or give their answer away. Fixing them first makes the set
              easier to learn.
            </T>
            <Button title="Take a look" small variant="secondary" onPress={advice.onOpen} style={{ alignSelf: 'flex-start' }} />
          </Card>
        ) : null}

        <Card>
          <View style={{ gap: 12 }}>
            <View>
              <T variant="heading" style={{ marginBottom: 8 }}>
                Cards per pocket: {selected}
              </T>
              <T variant="small" muted>
                {planNote ?? recommendation.rationale}
              </T>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {presets.map((size) => (
                <Pressable
                  key={size}
                  onPress={() => setSelected(size)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 6,
                    backgroundColor: selected === size ? c.primary : c.surface,
                    borderColor: selected === size ? c.primary : c.border,
                    borderWidth: 1,
                  }}
                >
                  <T
                    style={{
                      color: selected === size ? c.onPrimary : c.text,
                      fontWeight: '500',
                      fontSize: 14,
                    }}
                  >
                    {size}
                  </T>
                </Pressable>
              ))}
            </View>
          </View>
        </Card>

        <Card>
          <View style={{ gap: 8 }}>
            <T variant="heading">What to type</T>
            <Row style={{ flexWrap: 'wrap' }}>
              {DIRECTIONS.map((d) => (
                <Chip key={d.key} label={d.label} selected={direction === d.key} onPress={() => setDirection(d.key)} />
              ))}
            </Row>
            <T variant="small" muted>{DIRECTIONS.find((d) => d.key === direction)?.hint}</T>
          </View>
        </Card>

        <Card>
          <View style={{ gap: 8 }}>
            <T variant="heading">Order</T>
            <Row style={{ flexWrap: 'wrap' }}>
              <Chip label="In order" selected={!shuffle} onPress={() => setShuffle(false)} />
              <Chip label="Shuffled" selected={shuffle} onPress={() => setShuffle(true)} />
            </Row>
            <T variant="small" muted>
              {shuffle
                ? 'A random order — the same on all your devices, and a new one each time you redo the set.'
                : 'The order the cards are in the set.'}
            </T>
            {editing && initialShuffle && shuffle ? (
              <Button title="Reshuffle now" small variant="ghost" onPress={editing.onReshuffle} style={{ alignSelf: 'flex-start' }} />
            ) : null}
          </View>
        </Card>

        {editing ? (
          <Card>
            <View style={{ gap: 8 }}>
              <T variant="heading">Start over</T>
              <T variant="small" muted>
                Go back to the first card and learn the whole set again. Your review history (and when cards come up in
                Review) is kept.
              </T>
              <Button title="Start this set over" variant="secondary" small onPress={editing.onRestart} style={{ alignSelf: 'flex-start' }} />
            </View>
          </Card>
        ) : (
          <Card>
            <View style={{ gap: 8 }}>
              <T variant="heading">How it works</T>
              <T variant="small" style={{ lineHeight: 20 }}>
                <T variant="small" style={{ fontWeight: '600' }}>Phase 1: </T>
                The card asks a question and shows you the answer. Copy the answer while it's visible.
              </T>
              <T variant="small" style={{ lineHeight: 20 }}>
                <T variant="small" style={{ fontWeight: '600' }}>Phase 2: </T>
                The answer hides. Type it again from memory to test your recall.
              </T>
              <T variant="small" style={{ lineHeight: 20 }}>
                <T variant="small" style={{ fontWeight: '600' }}>Rate yourself: </T>
                Easy, Good, or Struggling. This helps track progress.
              </T>
            </View>
          </Card>
        )}
      </View>
    </Screen>
  );
}
