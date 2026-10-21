import React, { useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import { Button, Card, Chip, Field, Row, Screen, Section, T } from '@/ui/components';
import { copyTimeSeconds, MAX_COPY_SPEED, MIN_COPY_SPEED, type StudyDirection } from '@/core/learning';
import { prefs } from '@/data/prefs';
import { useColors } from '@/ui/theme';

/** The slider covers everyday typing speeds; the box takes anything from MIN to MAX. */
const SLIDER_MIN = 1;
const SLIDER_MAX = MAX_COPY_SPEED;
const clampSpeed = (n: number) => Math.min(MAX_COPY_SPEED, Math.max(MIN_COPY_SPEED, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Drag or tap along the track to pick a value (steps of 0.5). */
function SpeedSlider({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const c = useColors();
  const width = useRef(1);
  const pick = (x: number) => {
    const t = Math.min(1, Math.max(0, x / width.current));
    onChange(Math.round((SLIDER_MIN + t * (SLIDER_MAX - SLIDER_MIN)) * 2) / 2);
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => pick(e.nativeEvent.locationX),
      onPanResponderMove: (e) => pick(e.nativeEvent.locationX),
    }),
  ).current;
  const t = (Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, value)) - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN);
  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => { width.current = Math.max(1, e.nativeEvent.layout.width); }}
      style={{ height: 32, justifyContent: 'center', flex: 1 }}
      accessibilityRole="adjustable"
      accessibilityLabel="Typing speed"
    >
      <View pointerEvents="none" style={{ height: 6, borderRadius: 3, backgroundColor: c.border }}>
        <View style={{ width: `${t * 100}%`, height: 6, borderRadius: 3, backgroundColor: c.primary }} />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', left: `${t * 100}%`, marginLeft: -10, width: 20, height: 20, borderRadius: 10,
          backgroundColor: c.primary, borderWidth: 2, borderColor: c.bg,
        }}
      />
    </View>
  );
}

const DIRECTIONS: Array<{ key: StudyDirection; label: string; hint: string }> = [
  { key: 'term_to_def', label: 'Answer with the definition', hint: "You're shown the term and type its definition." },
  { key: 'def_to_term', label: 'Answer with the term', hint: "You're shown the definition and type the term it describes." },
  { key: 'mixed', label: 'Mix both', hint: 'Each card asks one way or the other — the card always says which.' },
];

interface PocketSetupProps {
  totalCards: number;
  initialDirection: StudyDirection;
  initialShuffle: boolean;
  onStart: (direction: StudyDirection, shuffle: boolean) => void;
  /** Present when changing settings mid-set (rather than the first time): progress so far + ways out. */
  editing?: {
    learned: number;
    onRestart: () => void;
    onReshuffle: () => void;
    onCancel: () => void;
  };
  /** Card check found things to fix in this set. */
  advice?: { count: number; onOpen: () => void };
  /** With a study plan, says what today's cards are (the plan sets them). */
  planNote?: string;
}

/** Asked once per set. After that Learn goes straight to your cards; this only comes back from "Options". */
export default function PocketSetup({
  totalCards, initialDirection, initialShuffle, onStart, editing, advice, planNote,
}: PocketSetupProps) {
  const [direction, setDirection] = useState<StudyDirection>(initialDirection);
  const [shuffle, setShuffle] = useState(initialShuffle);
  const [speed, setSpeed] = useState(() => clampSpeed(prefs.get().learnCopySpeed || 3));
  const [speedText, setSpeedText] = useState(String(round1(speed)));
  const setSpeedFromSlider = (n: number) => {
    setSpeed(n);
    setSpeedText(String(n));
  };

  return (
    <Screen maxWidth={760}
      footer={
        <View style={{ gap: 8 }}>
          <Button
            title={editing ? 'Save and keep going' : 'Start learning'}
            onPress={() => {
              prefs.set({ learnCopySpeed: speed });
              onStart(direction, shuffle);
            }}
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
              ? `You've learned ${editing.learned} of ${totalCards} cards in this set, and that progress stays. New settings apply to your next card.`
              : "Type each answer twice: first while you can see it, then from memory. Learn works out how many cards you need each day, and next time it picks up right where you left off."}
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

        {planNote ? (
          <Card>
            <T variant="small" muted>{planNote}</T>
          </Card>
        ) : null}

        <Card>
          <View style={{ gap: 8 }}>
            <T variant="heading">Copy speed</T>
            <Row style={{ alignItems: 'center', gap: 12 }}>
              <SpeedSlider value={speed} onChange={setSpeedFromSlider} />
              <Field
                value={speedText}
                keyboardType="decimal-pad"
                accessibilityLabel="Typing speed, characters per second"
                style={{ width: 72, textAlign: 'right' }}
                onChangeText={(v) => {
                  setSpeedText(v);
                  const n = Number(v);
                  if (v.trim() !== '' && !Number.isNaN(n) && n > 0) setSpeed(clampSpeed(n));
                }}
                onBlur={() => setSpeedText(String(round1(speed)))}
              />
            </Row>
            <T variant="small" muted>
              {`${round1(speed)} characters a second — lower gives you longer to copy each answer, higher (up to ${MAX_COPY_SPEED}) pushes you. A 100-character answer stays up about ${copyTimeSeconds('x'.repeat(100), '', speed)}s (the timer also pauses while you type).`}
            </T>
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
