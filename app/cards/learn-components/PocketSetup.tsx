import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Button, Card, Screen, Section, T } from '@/ui/components';
import { useColors } from '@/ui/theme';
import type { PocketRecommendation } from '@/core/learning';

interface PocketSetupProps {
  recommendation: PocketRecommendation;
  totalCards: number;
  onStart: (size: number) => void;
}

export default function PocketSetup({ recommendation, totalCards, onStart }: PocketSetupProps) {
  const [selected, setSelected] = useState(recommendation.recommended);
  const c = useColors();

  const presets = [3, 5, 10, 15, 20, 30, 50].filter((n) => n <= totalCards);

  return (
    <Screen
      footer={
        <Button
          title={`Study ${selected} cards`}
          onPress={() => onStart(selected)}
          variant="primary"
        />
      }
    >
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
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
      </ScrollView>
    </Screen>
  );
}
