import React, { useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { CardAdvice } from '@/core/flashcards/cardCheck';
import { applyAdvice, dismissAdvice, updateCard } from '@/data/actions';
import { NO_SET, useCardAdvice } from '@/data/cardAdvice';
import { useSemester } from '@/data/derived';
import { Badge, Button, Card, Empty, Field, Row, Screen, Section, T } from '@/ui/components';
import { useSafeBack } from '@/ui/nav';
import { radius, space, useColors } from '@/ui/theme';
import type { Card as CardRow } from '@/types/db';

const KIND_LABEL: Record<CardAdvice['kind'], string> = {
  duplicate: 'Duplicate',
  split: 'Too much at once',
  swap: 'Flipped',
  circular: 'Gives itself away',
  shorten: 'Very long',
  hard: 'Keeps slipping',
};

function applyLabel(a: CardAdvice): string {
  if (!a.fix) return '';
  if (a.fix.type === 'split') return `Split into ${a.fix.parts.length}`;
  if (a.fix.type === 'delete') return 'Delete this copy';
  return a.kind === 'swap' ? 'Swap them' : 'Blank it out';
}

function confirm(message: string, go: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(message)) go();
  } else {
    Alert.alert('Are you sure?', message, [{ text: 'Cancel', style: 'cancel' }, { text: 'Yes', style: 'destructive', onPress: go }]);
  }
}

/**
 * Card check: suggestions (worked out on the device) that make a set's cards easier to learn — split
 * long lists and answers, remove duplicates, fix cards that give the answer away. Each one says why and
 * shows exactly what applying it does; nothing changes until you choose.
 */
export default function CardCheck() {
  const { noteId } = useLocalSearchParams<{ noteId?: string }>();
  const sem = useSemester();
  const goBack = useSafeBack('/study');
  const advice = useCardAdvice();
  const c = useColors();
  const [editing, setEditing] = useState<string | null>(null);
  const [eTerm, setETerm] = useState('');
  const [eDef, setEDef] = useState('');

  const list = noteId ? advice.bySet.get(noteId) ?? [] : advice.all;
  const cardById = new Map(sem.rows.cards.map((k) => [k.id, k]));
  const title = !noteId ? 'All your cards' : noteId === NO_SET ? 'Ungrouped cards' : sem.rows.notes.find((n) => n.id === noteId)?.title || 'Untitled set';
  const splits = list.filter((a) => a.fix?.type === 'split');
  const duplicates = list.filter((a) => a.kind === 'duplicate');

  const startEdit = (k: CardRow) => {
    setEditing(k.id);
    setETerm(k.term);
    setEDef(k.definition);
  };
  const saveEdit = (k: CardRow) => {
    if (eTerm.trim() && eDef.trim()) updateCard(k, { term: eTerm, definition: eDef });
    setEditing(null);
  };

  const cardBox = (term: string, definition: string, faded = false) => (
    <View style={{ backgroundColor: c.surfaceAlt, borderRadius: radius.md, padding: space.sm, gap: 2, opacity: faded ? 0.6 : 1 }}>
      <T variant="body" style={{ fontWeight: '600' }}>{term}</T>
      <T variant="small" muted>{definition}</T>
    </View>
  );

  return (
    <Screen maxWidth={760} footer={<Button title="Done" variant="secondary" onPress={goBack} />}>
      <Stack.Screen options={{ title: 'Card check' }} />
      <Section title={title}>
        <T muted>
          {list.length === 0
            ? 'These cards look good — nothing to fix.'
            : `${list.length} suggestion${list.length === 1 ? '' : 's'} to make these cards easier to learn. Nothing changes until you choose.`}
        </T>
      </Section>

      {list.length === 0 ? (
        <Empty
          title="All clear 👍"
          body="Short answers, no duplicates, nothing giving itself away. Cards you keep missing will show up here with ideas."
        />
      ) : null}

      {splits.length > 1 || duplicates.length > 1 ? (
        <Row style={{ flexWrap: 'wrap' }}>
          {splits.length > 1 ? (
            <Button title={`Split all ${splits.length} long cards`} small onPress={() => splits.forEach(applyAdvice)} />
          ) : null}
          {duplicates.length > 1 ? (
            <Button
              title={`Delete all ${duplicates.length} duplicates`}
              small
              variant="secondary"
              onPress={() => confirm(`Delete ${duplicates.length} duplicate cards? The original of each stays.`, () => duplicates.forEach(applyAdvice))}
            />
          ) : null}
        </Row>
      ) : null}

      {list.map((a) => {
        const k = cardById.get(a.cardId);
        if (!k) return null;
        return (
          <Card key={`${a.cardId}:${a.kind}`}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T variant="heading" style={{ flex: 1 }}>{a.title}</T>
              <Badge label={KIND_LABEL[a.kind]} tone={a.kind === 'duplicate' || a.kind === 'split' ? 'warn' : 'alt'} />
            </Row>
            <T variant="small" muted>{a.reason}</T>

            {editing === k.id ? (
              <View style={{ gap: 8 }}>
                <Field value={eTerm} onChangeText={setETerm} placeholder="Term / question" multiline />
                <Field value={eDef} onChangeText={setEDef} placeholder="Definition / answer" multiline style={{ minHeight: 72 }} />
                <Row>
                  <Button title="Cancel" small variant="secondary" onPress={() => setEditing(null)} />
                  <Button title="Save" small onPress={() => saveEdit(k)} />
                </Row>
              </View>
            ) : (
              <>
                {cardBox(k.term, k.definition, a.fix?.type === 'delete')}
                {a.fix?.type === 'split' ? (
                  <View style={{ gap: 6, paddingLeft: space.sm, borderLeftWidth: 2, borderLeftColor: c.primary }}>
                    <T variant="label" muted>Becomes</T>
                    {a.fix.parts.map((p, i) => (
                      <View key={i}>{cardBox(p.term, p.definition)}</View>
                    ))}
                    <T variant="small" muted>The first part keeps this card's study history.</T>
                  </View>
                ) : a.fix?.type === 'update' ? (
                  <View style={{ gap: 6, paddingLeft: space.sm, borderLeftWidth: 2, borderLeftColor: c.primary }}>
                    <T variant="label" muted>Becomes</T>
                    {cardBox(a.fix.term, a.fix.definition)}
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }}>
                  {a.fix ? <Button title={applyLabel(a)} small onPress={() => applyAdvice(a)} /> : null}
                  <Button title={a.fix ? 'Edit instead' : 'Edit card'} small variant={a.fix ? 'ghost' : 'secondary'} onPress={() => startEdit(k)} />
                  <Button title="Skip" small variant="ghost" onPress={() => dismissAdvice(a)} />
                </View>
              </>
            )}
          </Card>
        );
      })}
    </Screen>
  );
}
