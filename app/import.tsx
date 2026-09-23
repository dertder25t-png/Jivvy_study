import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import {
  getFileType, parseCSV, parseJSON, parseQuizletPaste, parseTextFile, parseTSV, validateImportedCard,
  type ImportedNote, type QuizletCard,
} from '@/core/importNotes';
import { addManualCard, createNote, saveNote } from '@/data/actions';
import { useSemester } from '@/data/derived';
import { Button, Card, Chip, Divider, Empty, Field, Row, Screen, Segmented, T } from '@/ui/components';
import { CalendarField } from '@/ui/CalendarField';
import { Columns, useLayout } from '@/ui/layout';
import { useColors } from '@/ui/theme';

type Tab = 'flashcards' | 'notes';
type CardMode = 'paste' | 'file';

const TERM_SEPS = [
  { label: 'Tab', value: '\t' },
  { label: 'Comma', value: ',' },
  { label: 'Dash', value: ' - ' },
  { label: 'Colon', value: ':' },
  { label: 'Custom…', value: 'custom' },
];
const CARD_SEPS = [
  { label: 'New line', value: '\n' },
  { label: 'Semicolon', value: ';' },
  { label: 'Custom…', value: 'custom' },
];

const PREVIEW_COUNT = 6;

async function readPickedFile(types: string[]): Promise<{ name: string; content: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: types });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset.uri) throw new Error('No file URI');
  const content = await (await fetch(asset.uri)).text();
  return { name: asset.name || 'file.txt', content };
}

export default function ImportScreen() {
  const c = useColors();
  const router = useRouter();
  const sem = useSemester();
  const { isPhone } = useLayout();
  const [tab, setTab] = useState<Tab>('flashcards');
  const [cardMode, setCardMode] = useState<CardMode>('paste');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // flashcards
  const [pasteText, setPasteText] = useState('');
  const [termSep, setTermSep] = useState('\t');
  const [customTermSep, setCustomTermSep] = useState('');
  const [cardSep, setCardSep] = useState('\n');
  const [customCardSep, setCustomCardSep] = useState('');
  const [fileCards, setFileCards] = useState<QuizletCard[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [setTitle, setSetTitle] = useState('');
  const [courseId, setCourseId] = useState<string | null>(null);
  const [testDate, setTestDate] = useState<string | null>(null);

  // notes
  const [notes, setNotes] = useState<ImportedNote[]>([]);

  const t = termSep === 'custom' ? customTermSep : termSep;
  const cs = cardSep === 'custom' ? customCardSep : cardSep;

  // Live preview: re-parse as you paste or change separators — no separate "preview" step.
  const pastedCards = useMemo(
    () => (pasteText.trim() && t && cs ? parseQuizletPaste(pasteText, t, cs).filter(validateImportedCard) : []),
    [pasteText, t, cs],
  );
  const cards = cardMode === 'paste' ? pastedCards : fileCards;

  const pickCardFile = async () => {
    setError(null);
    setLoading(true);
    try {
      // Wildcards (text/*) keep the OS file dialog from hiding files whose exact MIME type
      // it doesn't register for an extension (common for .csv on Windows); we validate by extension below.
      const file = await readPickedFile(['text/csv', 'text/tab-separated-values', 'text/plain', 'text/*', 'application/json']);
      if (!file) return;
      const lower = file.name.toLowerCase();
      let parsed: QuizletCard[];
      if (lower.endsWith('.tsv')) parsed = parseTSV(file.content);
      else if (lower.endsWith('.csv')) parsed = parseCSV(file.content);
      else if (lower.endsWith('.json')) parsed = parseJSON(file.content);
      else if (lower.endsWith('.txt')) {
        // A saved copy-paste export: try tab-delimited first (most common), then comma.
        const tabbed = parseQuizletPaste(file.content, '\t', '\n');
        parsed = tabbed.filter(validateImportedCard).length > 0 ? tabbed : parseQuizletPaste(file.content, ',', '\n');
      } else throw new Error('Please upload a CSV, TSV, JSON, or TXT file.');
      const valid = parsed.filter(validateImportedCard);
      if (valid.length === 0) throw new Error("Couldn't find any term/definition pairs in that file.");
      setFileCards(valid);
      setFileName(file.name);
      if (!setTitle.trim()) setSetTitle(file.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      setError((err as Error).message || 'Something went wrong reading that file.');
    } finally {
      setLoading(false);
    }
  };

  const pickNoteFile = async () => {
    setError(null);
    setLoading(true);
    try {
      const file = await readPickedFile(['text/plain', 'text/markdown', 'text/x-markdown', 'text/*']);
      if (!file) return;
      const type = getFileType(file.name);
      if (type !== 'text' && type !== 'markdown') {
        throw new Error(`.${file.name.split('.').pop()} isn't supported yet. Use a .txt or .md file for now.`);
      }
      setNotes([parseTextFile(file.content, file.name)]);
    } catch (err) {
      setError((err as Error).message || 'Something went wrong reading that file.');
    } finally {
      setLoading(false);
    }
  };

  const importCards = () => {
    if (cards.length === 0 || !setTitle.trim()) return;
    // Every import becomes a named set, so it stays a group in the deck instead of loose cards.
    const note = createNote({ body: 'Imported flashcards', via: 'import', explicitCourseId: courseId, testDate });
    saveNote(note, { title: setTitle.trim() });
    for (const card of cards) {
      addManualCard({ course_id: courseId, term: card.term, definition: card.definition, source_note_id: note.id });
    }
    router.replace('/study');
  };

  const importNotes = () => {
    for (const n of notes) {
      const created = createNote({ body: n.body, via: 'import' });
      if (n.title) saveNote(created, { title: n.title });
    }
    router.replace('/notes');
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    setError(null);
  };

  const sepChips = (
    options: typeof TERM_SEPS, value: string, onChange: (v: string) => void, custom: string, onCustom: (v: string) => void, placeholder: string,
  ) => (
    <>
      <Row style={{ flexWrap: 'wrap' }}>
        {options.map((s) => <Chip key={s.value} label={s.label} small selected={value === s.value} onPress={() => onChange(s.value)} />)}
      </Row>
      {value === 'custom' ? <Field value={custom} onChangeText={onCustom} placeholder={placeholder} style={{ maxWidth: 200 }} /> : null}
    </>
  );

  // ---------------------------------------------------------------- flashcards: source
  const source = (
    <Card>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <T variant="heading">1. Add your cards</T>
        <Segmented
          options={[{ key: 'paste', label: 'Paste' }, { key: 'file', label: 'Upload file' }]}
          value={cardMode}
          onChange={(m) => { setCardMode(m); setError(null); }}
        />
      </Row>

      {cardMode === 'paste' ? (
        <View style={{ gap: 12 }}>
          <Field
            value={pasteText}
            onChangeText={setPasteText}
            placeholder={'Paste from Quizlet or a spreadsheet, e.g.\nTerm 1[Tab]Definition 1\nTerm 2[Tab]Definition 2'}
            multiline
            style={{ minHeight: isPhone ? 160 : 260, fontSize: isPhone ? 16 : 14, lineHeight: isPhone ? 22 : 20 }}
          />
          <View style={{ gap: 6 }}>
            <T variant="small" muted>Between a term and its definition</T>
            {sepChips(TERM_SEPS, termSep, setTermSep, customTermSep, setCustomTermSep, 'e.g. ::')}
          </View>
          <View style={{ gap: 6 }}>
            <T variant="small" muted>Between cards</T>
            {sepChips(CARD_SEPS, cardSep, setCardSep, customCardSep, setCustomCardSep, 'e.g. ;')}
          </View>
          {pasteText.trim() && pastedCards.length === 0 ? (
            <T variant="small" color={c.warn}>No term/definition pairs found yet — check the separators match what you pasted.</T>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: 10, alignItems: 'flex-start' }}>
          <T variant="small" muted>CSV, TSV, JSON or TXT. The first column is the term, the second the definition.</T>
          <Button title={loading ? 'Reading file…' : fileName ? 'Choose a different file' : 'Choose file'} variant="secondary" onPress={pickCardFile} disabled={loading} />
          {fileName ? <T variant="small" muted>{fileName} · {fileCards.length} cards</T> : null}
        </View>
      )}
      {error ? <T variant="small" color={c.warn}>{error}</T> : null}
    </Card>
  );

  // ---------------------------------------------------------------- flashcards: details + import
  const details = (
    <Card>
      <T variant="heading">2. Name the set</T>

      <Field label="Set title" placeholder="e.g., Biology 101 – Chapter 5" value={setTitle} onChangeText={setSetTitle} />

      <View style={{ gap: 6 }}>
        <T variant="label" muted>Test date (optional)</T>
        <CalendarField valueIso={testDate} onChange={setTestDate} tz={sem.tz} now={sem.now} label="When's the test?" />
        <T variant="small" muted>Learn mode paces your study to this date.</T>
      </View>

      {sem.rows.courses.length > 0 ? (
        <View style={{ gap: 6 }}>
          <T variant="label" muted>Class (optional)</T>
          <Row style={{ flexWrap: 'wrap' }}>
            <Chip label="No class" small selected={courseId === null} onPress={() => setCourseId(null)} />
            {sem.rows.courses.map((k) => (
              <Chip key={k.id} label={k.code ?? k.name} small color={k.color} selected={courseId === k.id} onPress={() => setCourseId(k.id)} />
            ))}
          </Row>
        </View>
      ) : null}

      <Divider />

      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="label" muted>Preview</T>
        <T variant="small" muted>{cards.length} card{cards.length === 1 ? '' : 's'}</T>
      </Row>
      {cards.length === 0 ? (
        <T variant="small" muted>Cards show up here as soon as they're recognized.</T>
      ) : (
        <View style={{ gap: 8 }}>
          {cards.slice(0, PREVIEW_COUNT).map((card, i) => (
            <View key={i} style={{ gap: 2, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.border }}>
              <T variant="small" style={{ fontWeight: '600' }} numberOfLines={2}>{card.term}</T>
              <T variant="small" muted numberOfLines={3}>{card.definition}</T>
            </View>
          ))}
          {cards.length > PREVIEW_COUNT ? <T variant="small" muted>+{cards.length - PREVIEW_COUNT} more</T> : null}
        </View>
      )}

      <Button
        title={cards.length === 0 ? 'Import cards' : `Import ${cards.length} card${cards.length === 1 ? '' : 's'}`}
        onPress={importCards}
        disabled={cards.length === 0 || !setTitle.trim()}
      />
      {cards.length > 0 && !setTitle.trim() ? <T variant="small" muted>Give the set a title to import it.</T> : null}
    </Card>
  );

  // ---------------------------------------------------------------- notes
  const notesPane = (
    <Card>
      <T variant="heading">Import notes</T>
      <T variant="small" muted>Upload a .txt or .md file. Each file becomes one note, filed by class automatically.</T>
      <View style={{ alignItems: 'flex-start' }}>
        <Button title={loading ? 'Reading file…' : 'Choose file'} variant="secondary" onPress={pickNoteFile} disabled={loading} />
      </View>
      {error ? <T variant="small" color={c.warn}>{error}</T> : null}
      {notes.length > 0 ? (
        <>
          <Card tone="alt">
            <T variant="body" style={{ fontWeight: '600' }}>{notes[0].title || 'Untitled note'}</T>
            <T variant="small" muted numberOfLines={4}>{notes[0].body.slice(0, 280)}</T>
          </Card>
          <Button title={`Import ${notes.length} note${notes.length === 1 ? '' : 's'}`} onPress={importNotes} />
        </>
      ) : (
        <Empty title="No file selected" body="Choose a .txt or .md file to get started." />
      )}
    </Card>
  );

  return (
    <Screen>
      <View style={{ gap: 6 }}>
        <Segmented
          options={[{ key: 'flashcards', label: 'Flashcards' }, { key: 'notes', label: 'Notes' }]}
          value={tab}
          onChange={switchTab}
          stretch={isPhone}
        />
        {tab === 'flashcards' ? (
          <T variant="small" muted>
            Paste straight from Quizlet or upload a file. Every import becomes a named set in your deck — a class is optional.
          </T>
        ) : null}
      </View>

      {tab === 'flashcards' ? <Columns main={source} side={details} sideWidth={400} /> : <View style={{ maxWidth: 720 }}>{notesPane}</View>}
    </Screen>
  );
}
