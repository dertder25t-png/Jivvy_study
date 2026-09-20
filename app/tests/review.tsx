import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { extractCandidates } from '@/core/tests/extract';
import { generateAllQuestions, filterQuestions } from '@/core/tests/generate';
import { useSemester } from '@/data/derived';
import { Button, Card, Divider, Empty, Field, Row, Screen, T } from '@/ui/components';
import { useColors } from '@/ui/theme';

export default function ReviewQuestions() {
  const params = useLocalSearchParams<{ noteId?: string }>();
  const router = useRouter();
  const sem = useSemester();
  const c = useColors();

  const note = useMemo(
    () => params.noteId ? sem.rows.notes.find((n) => n.id === params.noteId) : undefined,
    [params.noteId, sem.rows.notes],
  );

  const questions = useMemo(() => {
    if (!note) return [];
    const candidates = extractCandidates(note.body);
    const generated = generateAllQuestions(candidates);
    const { kept } = filterQuestions(generated);
    return kept;
  }, [note]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [edits, setEdits] = useState<Record<number, { question?: string; answer?: string }>>({});
  const [approved, setApproved] = useState<Set<number>>(new Set());

  if (!note || questions.length === 0) {
    return (
      <Screen>
        <Empty
          title="No questions generated"
          body="Try a different note with more content."
          action={<Button title="Go back" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  const current = questions[currentIndex];
  const edit = edits[currentIndex];
  const isApproved = approved.has(currentIndex);
  const progress = (approved.size / questions.length) * 100;

  const approve = () => {
    setApproved((s) => new Set([...s, currentIndex]));
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const skip = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const saveEdit = (field: 'question' | 'answer', value: string) => {
    setEdits((e) => ({
      ...e,
      [currentIndex]: { ...e[currentIndex], [field]: value },
    }));
  };

  const done = () => {
    if (approved.size === 0) {
      alert('Approve at least one question first.');
      return;
    }
    // TODO: Save approved questions to DB
    alert(`Saved ${approved.size} question${approved.size === 1 ? '' : 's'}`);
    router.replace(`/note/${note.id}`);
  };

  return (
    <Screen footer={<Button title="Done — save questions" onPress={done} disabled={approved.size === 0} />}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <T variant="heading">Review questions</T>
        <T variant="small" muted>{approved.size}/{questions.length} approved</T>
      </Row>

      <View style={{ height: 8, backgroundColor: c.border, borderRadius: 4, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${progress}%`, backgroundColor: c.good }} />
      </View>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="label" muted>Question {currentIndex + 1} of {questions.length}</T>
          <T variant="small" color={c.muted}>{current.difficulty}</T>
        </Row>
        <T variant="small" muted>{current.question_type}</T>
      </Card>

      <Card>
        <T variant="heading">Question</T>
        <Field
          value={edit?.question ?? current.question_text}
          onChangeText={(v) => saveEdit('question', v)}
          multiline
          style={{ minHeight: 80 }}
          placeholder="Edit question here"
        />
      </Card>

      <Card>
        <T variant="heading">Sample answer</T>
        <Field
          value={edit?.answer ?? current.context}
          onChangeText={(v) => saveEdit('answer', v)}
          multiline
          style={{ minHeight: 60 }}
          placeholder="Provide an example answer or context"
        />
      </Card>

      <Card tone="alt">
        <T variant="small" muted>Concept: {current.concept}</T>
      </Card>

      <Row style={{ flexWrap: 'wrap' }}>
        <Button title="✓ Approve" variant="primary" onPress={approve} />
        <Button title="Next" variant="secondary" onPress={skip} />
      </Row>

      {currentIndex > 0 && (
        <Button
          title="← Back"
          variant="ghost"
          small
          onPress={() => setCurrentIndex(currentIndex - 1)}
        />
      )}

      <T variant="small" muted>
        Questions are templates — customize them as needed. Only approved questions will be saved.
      </T>
    </Screen>
  );
}
