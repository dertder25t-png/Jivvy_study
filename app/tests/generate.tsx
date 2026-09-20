import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { extractCandidates } from '@/core/tests/extract';
import { generateAllQuestions, filterQuestions } from '@/core/tests/generate';
import { useSemester } from '@/data/derived';
import { Button, Card, Empty, ProgressBar, Row, Screen, Section, T } from '@/ui/components';
import { useColors } from '@/ui/theme';

export default function GenerateTestQuestions() {
  const params = useLocalSearchParams<{ noteId?: string }>();
  const router = useRouter();
  const sem = useSemester();
  const c = useColors();

  const note = useMemo(
    () => params.noteId ? sem.rows.notes.find((n) => n.id === params.noteId) : undefined,
    [params.noteId, sem.rows.notes],
  );

  const [step, setStep] = useState<'extracting' | 'generating' | 'reviewing' | 'error'>('extracting');
  const [error, setError] = useState<string | null>(null);

  const processing = useMemo(() => {
    if (!note) return null;

    try {
      // Stage 1: Extract concepts
      const candidates = extractCandidates(note.body);
      if (candidates.length === 0) {
        setError('No question concepts found in this note. Try notes with definitions, lists, or bolded terms.');
        setStep('error');
        return null;
      }

      // Stage 2: Generate questions
      const generated = generateAllQuestions(candidates);
      if (generated.length === 0) {
        setError('Could not generate questions from these concepts.');
        setStep('error');
        return null;
      }

      // Stage 3: Filter
      const { kept } = filterQuestions(generated);
      if (kept.length === 0) {
        setError('No questions passed quality checks. Try a different note.');
        setStep('error');
        return null;
      }

      return { candidates: candidates.length, generated: generated.length, kept: kept.length, questions: kept };
    } catch (e) {
      setError((e as Error).message || 'Something went wrong');
      setStep('error');
      return null;
    }
  }, [note]);

  const proceed = () => {
    if (processing && processing.questions) {
      // Save to pending questions and navigate to review
      router.push(`/tests/review?noteId=${note!.id}`);
    }
  };

  if (!note) {
    return (
      <Screen>
        <Empty title="No note selected" body="Start from a note." action={<Button title="Go back" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Section title="Generate practice questions">
        <Card>
          <T variant="body">{note.title || 'Untitled note'}</T>
          <T variant="small" muted>{Math.round(note.body.length / 100)} hundred words</T>
        </Card>
      </Section>

      {step === 'extracting' && (
        <Card tone="primary">
          <T variant="label" color={c.primary}>Analyzing your note…</T>
          <T variant="body">Finding definitions, lists, and key concepts.</T>
          <ProgressBar value={0.3} color={c.primary} />
        </Card>
      )}

      {step === 'generating' && (
        <Card tone="primary">
          <T variant="label" color={c.primary}>Generating questions…</T>
          <T variant="body">Creating varied question types (short answer, essay, true/false).</T>
          <ProgressBar value={0.6} color={c.primary} />
        </Card>
      )}

      {step === 'reviewing' && (
        <Card tone="primary">
          <T variant="label" color={c.primary}>Ready to review</T>
          <T variant="body">Found {processing?.candidates ?? 0} concepts.</T>
          <T variant="body">Generated {processing?.generated ?? 0} questions.</T>
          <T variant="body" style={{ fontWeight: '600' }}>
            {processing?.kept ?? 0} passed quality checks.
          </T>
        </Card>
      )}

      {step === 'error' && (
        <Card tone="warn">
          <T variant="small">{error}</T>
        </Card>
      )}

      {processing && step === 'reviewing' && (
        <Card>
          <T variant="heading">Question preview (first 3)</T>
          {processing.questions.slice(0, 3).map((q, i) => (
            <View key={i} style={{ gap: 8, marginBottom: 12 }}>
              <T variant="body" style={{ fontWeight: '600' }}>{q.question_text}</T>
              <T variant="small" muted>{q.question_type} · {q.difficulty}</T>
            </View>
          ))}
        </Card>
      )}

      <Row style={{ flexWrap: 'wrap' }}>
        <Button title="Go back" variant="secondary" onPress={() => router.back()} />
        {processing && step === 'reviewing' && (
          <Button
            title={`Review ${processing.kept} question${processing.kept === 1 ? '' : 's'}`}
            onPress={proceed}
          />
        )}
      </Row>

      <T variant="small" muted>
        Questions are generated using template-based patterns — no AI cost. You'll review and edit them before they're saved.
      </T>
    </Screen>
  );
}
