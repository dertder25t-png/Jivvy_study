import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Card, Chip, Row, Screen, Section, T } from '@/ui/components';
import { useColors } from '@/ui/theme';
import { prefs } from '@/data/prefs';
import type { PocketRecommendation, StudyDirection } from '@/core/learning';

const DIRECTIONS: Array<{ key: StudyDirection; label: string; hint: string }> = [
  { key: 'term_to_def', label: 'Term → Definition', hint: 'See the term, type the definition.' },
  { key: 'def_to_term', label: 'Definition → Term', hint: 'See the definition, type the term.' },
  { key: 'mixed', label: 'Mixed', hint: 'Each card picks a side — good for testing you both ways.' },
];

interface PocketSetupProps {
  recommendation: PocketRecommendation;
  totalCards: number;
  direction: StudyDirection;
  onDirectionChange: (d: StudyDirection) => void;
  onStart: (size: number) => void;
}

export default function PocketSetup({ recommendation, totalCards, direction, onDirectionChange, onStart }: PocketSetupProps) {
  const remembered = prefs.get().learnPocketSize;
  const [selected, setSelected] = useState(remembered && remembered <= totalCards ? remembered : recommendation.recommended);
  const c = useColors();

  const choose = (size: number) => {
    setSelected(size);
    prefs.set({ learnPocketSize: size });
  };

  const presets = [3, 5, 10, 15, 20, 30, 50].filter((n) => n <= totalCards);

  return (
    <Screen maxWidth={760}
      footer={
        <Button
          title={`Study ${selected} cards`}
          onPress={() => onStart(selected)}
          variant="primary"
        />
      }
    >
      <View style={{ gap: 12 }}>
        <Section title="Learn Mode">
          <T>
            Type out flashcard definitions twice: first while visible, then from memory. Great for
            retention through active recall!
          </T>
        </Section>

        <Card>
          <View style={{ gap: 12 }}>
            <View>
              <T variant="heading" style={{ marginBottom: 8 }}>
                Cards per pocket: {selected}
              </T>
              <T variant="small" muted>
                {recommendation.rationale}
              </T>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {presets.map((size) => (
                <Pressable
                  key={size}
                  onPress={() => choose(size)}
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
                <Chip key={d.key} label={d.label} selected={direction === d.key} onPress={() => onDirectionChange(d.key)} />
              ))}
            </Row>
            <T variant="small" muted>{DIRECTIONS.find((d) => d.key === direction)?.hint}</T>
          </View>
        </Card>

        <Card>
          <View style={{ gap: 8 }}>
            <T variant="heading">How it works</T>
            <T variant="small" style={{ lineHeight: 20 }}>
              <T variant="small" style={{ fontWeight: '600' }}>Phase 1: </T>
              See the card and definition. Type out the definition while it's visible.
            </T>
            <T variant="small" style={{ lineHeight: 20 }}>
              <T variant="small" style={{ fontWeight: '600' }}>Phase 2: </T>
              Definition hides. Continue typing from memory to test your recall.
            </T>
            <T variant="small" style={{ lineHeight: 20 }}>
              <T variant="small" style={{ fontWeight: '600' }}>Rate yourself: </T>
              Easy, Good, or Struggling. This helps track progress.
            </T>
          </View>
        </Card>
      </View>
    </Screen>
  );
}
