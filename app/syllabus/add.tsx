import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { BackendUnavailableError, parseSyllabus, type ParseInput } from '@/api/functions';
import { normalizeParse } from '@/core/syllabus/normalize';
import { buildSampleSemester } from '@/core/syllabus/sample';
import { addSampleSemester, ensureSampleTerm, ensureTerm } from '@/data/actions';
import { pendingParse } from '@/data/pending';
import { prefs } from '@/data/prefs';
import { store } from '@/data/store';
import { Button, Card, Field, Screen, T } from '@/ui/components';
import { ensurePermission } from '@/notifications/schedule';

export default function AddSyllabus() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const backend = store.mode === 'supabase';

  const run = async (input: ParseInput, label: string) => {
    setError(null);
    setBusy(label);
    try {
      const now = new Date();
      const tz = prefs.get().tz;
      const term = ensureTerm(now);
      const result = await parseSyllabus(input, { term, tz });
      const normalized = normalizeParse(result.parsed, { term, tz, now });
      pendingParse.set({ result, normalized, termId: term.id });
      router.push('/syllabus/review');
    } catch (e) {
      setError(e instanceof BackendUnavailableError ? e.message : (e as Error).message || 'Something went wrong reading that.');
    } finally {
      setBusy(null);
    }
  };

  const pickFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets[0]) return;
    const f = res.assets[0];
    await run({ kind: 'file', uri: f.uri, name: f.name, mime: f.mimeType ?? 'application/pdf' }, 'file');
  };

  const pickPhoto = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('We need access to do that. You can change it in your device settings.');
      return;
    }
    const res = camera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    await run({ kind: 'file', uri: a.uri, name: a.fileName ?? 'syllabus.jpg', mime: a.mimeType ?? 'image/jpeg' }, 'photo');
  };

  const useSample = () => {
    addSampleSemester(new Date());
    void ensurePermission();
    router.replace('/');
  };

  /** Demo mode: push a sample parse through the same confirmation step a real syllabus goes through. */
  const previewConfirmation = () => {
    const now = new Date();
    const tz = prefs.get().tz;
    const term = ensureSampleTerm(now);
    const parsed = buildSampleSemester(now, tz).syllabi[0];
    pendingParse.set({
      result: { parsed, contentHash: null, cacheHit: false, rawText: '', filePath: null },
      normalized: normalizeParse(parsed, { term, tz, now }),
      termId: term.id,
    });
    router.push('/syllabus/review');
  };

  return (
    <Screen maxWidth={760}>
      <T variant="title">Upload once. Your semester exists.</T>
      <T muted>We read the syllabus and pull out every deadline, exam, grade weight, late policy and weekly topic. You confirm it before anything is saved.</T>

      {!backend ? (
        <Card tone="warn">
          <T variant="heading">Running in demo mode</T>
          <T variant="small" muted>
            Reading your own files needs the Supabase backend (see the README). Until then, load the sample semester to
            explore everything else.
          </T>
          <Button title="Load the sample semester" onPress={useSample} />
          <Button title="Preview the “look right?” step" variant="secondary" onPress={previewConfirmation} />
        </Card>
      ) : null}

      <View style={{ gap: 10 }}>
        <Button title="Choose a PDF or Word file" icon="📄" onPress={pickFile} loading={busy === 'file'} disabled={!!busy} variant={backend ? 'primary' : 'secondary'} />
        <Button title="Take a photo" icon="📷" variant="secondary" onPress={() => pickPhoto(true)} loading={busy === 'photo'} disabled={!!busy} />
        <Button title="Pick a photo or screenshot" icon="🖼️" variant="secondary" onPress={() => pickPhoto(false)} disabled={!!busy} />
      </View>

      <Card>
        <T variant="heading">Or paste the text</T>
        <Field value={text} onChangeText={setText} multiline placeholder="Paste the syllabus here…" style={{ minHeight: 160 }} />
        <Button title="Read it" onPress={() => run({ kind: 'text', text }, 'text')} disabled={text.trim().length < 200 || !!busy} loading={busy === 'text'} variant="secondary" />
        {text.trim().length > 0 && text.trim().length < 200 ? <T variant="small" muted>That looks short for a syllabus — paste the whole thing.</T> : null}
      </Card>

      {error ? (
        <Card tone="warn">
          <T variant="small">{error}</T>
        </Card>
      ) : null}
      <T variant="small" muted>
        Syllabi are private to you. If a classmate already uploaded the same document, we reuse the reading instead of processing it again.
      </T>
    </Screen>
  );
}
