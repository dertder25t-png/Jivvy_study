import React, { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { extractCandidates } from '@/core/flashcards/extract';
import { clozeBlanked } from '@/core/flashcards/reject';
import { decideCard } from '@/data/actions';
import { REJECT_REASON_TEXT as REASONS, generateForNote } from '@/data/generation';
import { useSemester } from '@/data/derived';
import { Badge, Button, Card, Empty, Field, Row, Screen, T } from '@/ui/components';
import { useColors } from '@/ui/theme';
import type { Card as CardRow } from '@/types/db';
import { useSafeBack } from '@/ui/nav';

type Phase = 'idle' | 'working' | 'review' | 'done';

export default function GenerateCards() {
  const { noteId } = useLocalSearchParams<{ noteId: string }>();
  const sem = useSemester();
  const router = useRouter();
  const back = useSafeBack('/notes');
  const c = useColors();
  const note = sem.rows.notes.find((n) => n.id === noteId);

  const [phase, setPhase] = useState<Phase>('idle');
  const [summary, setSummary] = useState<{ total: number; survived: number; byReason: Record<string, number> } | null>(null);
  const [kept, setKept] = useState(0);
  const [editing, setEditing] = useState<CardRow | null>(null);
  const [eTerm, setETerm] = useState('');
  const [eDef, setEDef] = useState('');
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => (note ? extractCandidates(note.body) : []), [note?.body]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = sem.rows.cards.filter((k) => k.source_note_id === noteId && k.status === 'pending');
  const current = pending[0];
  const inReview = phase === 'review' || (phase === 'idle' && pending.length > 0);

  // swipe: right = keep, left = reject
  const x = useRef(new Animated.Value(0)).current;
  const decideRef = useRef<(d: 'accepted' | 'rejected') => void>(() => {});
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: Animated.event([null, { dx: x }], { useNativeDriver: false }),
      onPanResponderRelease: (_, g) => {
        if (g.dx > 110) decideRef.current('accepted');
        else if (g.dx < -110) decideRef.current('rejected');
        Animated.spring(x, { toValue: 0, useNativeDriver: false }).start();
      },
    }),
  ).current;

  if (!note) return <Screen maxWidth={760}><Empty title="Note not found" /></Screen>;
  const course = note.course_id ? sem.courseById.get(note.course_id) : undefined;

  const generate = async () => {
    setPhase('working');
    setError(null);
    try {
      const f = await generateForNote(note);
      setSummary(f);
      setKept(0);
      setPhase(f.survived > 0 ? 'review' : 'done');
    } catch (e) {
      setError((e as Error).message || 'Something went wrong making cards.');
      setPhase('idle');
    }
  };

  const decide = (d: 'accepted' | 'rejected') => {
    if (!current) return;
    decideCard(current, d);
    if (d === 'accepted') setKept((k) => k + 1);
    x.setValue(0);
    if (pending.length <= 1) setPhase('done');
  };
  decideRef.current = decide;

  const startEdit = () => {
    if (!current) return;
    setEditing(current);
    setETerm(current.term);
    setEDef(current.definition);
  };
  const saveEdit = () => {
    if (!editing) return;
    decideCard(editing, 'edited', { term: eTerm.trim() || editing.term, definition: eDef.trim() || editing.definition });
    setKept((k) => k + 1);
    setEditing(null);
    if (pending.length <= 1) setPhase('done');
  };

  const rotate = x.interpolate({ inputRange: [-200, 0, 200], outputRange: ['-6deg', '0deg', '6deg'] });
  const tint = x.interpolate({ inputRange: [-120, 0, 120], outputRange: ['#FDE68A', c.surface, '#BBF7D0'], extrapolate: 'clamp' });

  const showGenerate = phase === 'idle' && pending.length === 0 && candidates.length > 0;

  return (
    <Screen maxWidth={760} footer={showGenerate ? <Button title={`Make ${candidates.length} card${candidates.length === 1 ? '' : 's'}`} onPress={generate} /> : undefined}>
      <Stack.Screen options={{ title: course ? `Cards · ${course.code ?? course.name}` : 'Make flashcards' }} />

      {phase === 'idle' && pending.length === 0 ? (
        <>
          <Card>
            <T variant="label" muted>From this note</T>
            <T variant="title">{candidates.length} definition{candidates.length === 1 ? '' : 's'} found</T>
            <T muted>
              We only look at lines that actually define something — bold terms, “Term: meaning”, “X refers to…”, glossary tables.
              Everything else is left alone.
            </T>
          </Card>
          {candidates.slice(0, 6).map((cand) => (
            <Card key={cand.id} tone="alt">
              <Badge label={cand.pattern_type.replace(/_/g, ' ')} />
              <T variant="small" numberOfLines={3}>{cand.text}</T>
            </Card>
          ))}
          {candidates.length > 6 ? <T variant="small" muted>+{candidates.length - 6} more</T> : null}
          {candidates.length === 0 ? (
            <Empty title="No definitions to work with yet" body="Try bolding a term and putting its meaning after it, like  **Reinforcement** — a consequence that makes a behavior more likely." />
          ) : null}
          {error ? <Card tone="warn"><T variant="small">{error}</T></Card> : null}
        </>
      ) : null}

      {phase === 'working' ? <Empty title="Writing your cards…" body="Cleaning each definition up and filtering out anything shaky." /> : null}

      {inReview && current && !editing ? (
        <View style={{ gap: 16 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="small" muted>{pending.length} to go</T>
            <T variant="small" muted>Swipe right to keep, left to skip</T>
          </Row>
          <Animated.View
            {...pan.panHandlers}
            style={{
              transform: [{ translateX: x }, { rotate }], backgroundColor: tint, borderRadius: 20, padding: 24, gap: 14,
              borderWidth: 1, borderColor: c.border, minHeight: 240, justifyContent: 'center',
            }}
          >
            {current.card_type === 'cloze' ? (
              <>
                <T variant="label" muted>Fill in the blank</T>
                <T variant="title">{clozeBlanked(current.cloze_text ?? current.definition)}</T>
                <T muted>{clozeBlanked(current.cloze_text ?? '', true)}</T>
              </>
            ) : (
              <>
                <T variant="label" muted>Term</T>
                <T variant="title">{current.term}</T>
                <T variant="label" muted style={{ marginTop: 8 }}>Definition</T>
                <T variant="body">{current.definition}</T>
              </>
            )}
          </Animated.View>
          <Row>
            <Button title="Skip" variant="secondary" onPress={() => decide('rejected')} style={{ flex: 1 }} />
            <Button title="Edit" variant="secondary" onPress={startEdit} style={{ flex: 1 }} />
            <Button title="Keep" onPress={() => decide('accepted')} style={{ flex: 1 }} />
          </Row>
          <T variant="small" muted>Reading these is your first study pass. Every keep or skip helps us make better cards for you.</T>
        </View>
      ) : null}

      {editing ? (
        <Card>
          <Field label="Term" value={eTerm} onChangeText={setETerm} />
          <Field label="Definition" value={eDef} onChangeText={setEDef} multiline />
          <Row>
            <Button title="Cancel" variant="secondary" onPress={() => setEditing(null)} style={{ flex: 1 }} />
            <Button title="Save & keep" onPress={saveEdit} style={{ flex: 1 }} />
          </Row>
        </Card>
      ) : null}

      {phase === 'done' ? (
        <>
          <Card tone="good">
            <T variant="title">{summary && summary.survived === 0 ? 'No cards made the cut' : `Kept ${kept} card${kept === 1 ? '' : 's'}`}</T>
            {summary ? (
              <T muted>
                Found {summary.total} candidate{summary.total === 1 ? '' : 's'}; {summary.total - summary.survived} filtered out before you saw them.
              </T>
            ) : null}
          </Card>
          {summary && Object.keys(summary.byReason).length > 0 ? (
            <Card tone="alt">
              <T variant="label" muted>Filtered automatically</T>
              {Object.entries(summary.byReason).map(([k, v]) => (
                <T key={k} variant="small">{v} — {REASONS[k] ?? k}</T>
              ))}
            </Card>
          ) : null}
          <Button title="Study these now" onPress={() => router.replace(`/cards/review?noteId=${note.id}&order=weakest&limit=${Math.max(kept, 1)}`)} disabled={kept === 0} />
          <Button title="Done" variant="secondary" onPress={back} />
        </>
      ) : null}
    </Screen>
  );
}
