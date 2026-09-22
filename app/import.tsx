import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import {
  getFileType, parseCSV, parseJSON, parseQuizletPaste, parseTextFile, parseTSV, validateImportedCard,
  type ImportedNote, type QuizletCard,
} from '@/core/importNotes';
import { addManualCard, createNote, saveNote } from '@/data/actions';
import { useSemester } from '@/data/derived';
import { Button, Card, Chip, Empty, Field, Row, Screen, Section, T } from '@/ui/components';
import { useColors } from '@/ui/theme';

type Tab = 'notes' | 'flashcards';
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

export default function ImportScreen() {
  const c = useColors();
  const router = useRouter();
  const sem = useSemester();
  const [activeTab, setActiveTab] = useState<Tab>('notes');
  const [cardMode, setCardMode] = useState<CardMode>('paste');
  const [notes, setNotes] = useState<ImportedNote[]>([]);
  const [cards, setCards] = useState<QuizletCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [sourceNoteTitle, setSourceNoteTitle] = useState('');
  const [courseId, setCourseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Paste (Quizlet-style) state
  const [pasteText, setPasteText] = useState('');
  const [termSep, setTermSep] = useState('\t');
  const [customTermSep, setCustomTermSep] = useState('');
  const [cardSep, setCardSep] = useState('\n');
  const [customCardSep, setCustomCardSep] = useState('');

  const resetCards = () => {
    setCards([]);
    setError(null);
  };

  const pickFile = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await DocumentPicker.getDocumentAsync({
        // Wildcards (text/*) keep the OS file dialog from hiding files whose exact MIME type
        // it doesn't register for an extension (very common for .csv/.md on Windows) — we still
        // validate by extension below, so this only affects what's selectable, not what's accepted.
        type: activeTab === 'notes'
          ? ['text/plain', 'text/markdown', 'text/x-markdown', 'text/*', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/pdf']
          : ['text/csv', 'text/tab-separated-values', 'text/plain', 'text/*', 'application/json'],
      });

      if (result.canceled) {
        setLoading(false);
        return;
      }

      const asset = result.assets[0];
      if (!asset.uri) throw new Error('No file URI');

      const response = await fetch(asset.uri);
      const content = await response.text();
      const name = asset.name || 'file.txt';
      const lower = name.toLowerCase();

      if (activeTab === 'notes') {
        const fileType = getFileType(name);
        if (fileType === 'text' || fileType === 'markdown') {
          setNotes([parseTextFile(content, name)]);
        } else {
          throw new Error(`.${lower.split('.').pop()} isn't supported yet. Use a .txt or .md file for now.`);
        }
      } else if (lower.endsWith('.tsv')) {
        setCards(parseTSV(content).filter(validateImportedCard));
      } else if (lower.endsWith('.csv')) {
        setCards(parseCSV(content).filter(validateImportedCard));
      } else if (lower.endsWith('.json')) {
        setCards(parseJSON(content).filter(validateImportedCard));
      } else if (lower.endsWith('.txt')) {
        // A saved copy-paste export: try tab-delimited first (most common), then comma.
        const tabbed = parseQuizletPaste(content, '\t', '\n').filter(validateImportedCard);
        setCards(tabbed.length > 0 ? tabbed : parseQuizletPaste(content, ',', '\n').filter(validateImportedCard));
      } else {
        throw new Error('Please upload a CSV, TSV, JSON, or TXT file.');
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong reading that file.');
    } finally {
      setLoading(false);
    }
  };

  const parsePaste = () => {
    setError(null);
    const t = termSep === 'custom' ? customTermSep : termSep;
    const cs = cardSep === 'custom' ? customCardSep : cardSep;
    if (!t) {
      setError('Enter the separator that sits between a term and its definition.');
      return;
    }
    if (!cs) {
      setError('Enter the separator that sits between cards.');
      return;
    }
    if (!pasteText.trim()) {
      setError('Paste some text first.');
      return;
    }
    const parsed = parseQuizletPaste(pasteText, t, cs).filter(validateImportedCard);
    if (parsed.length === 0) {
      setError("Couldn't find any term/definition pairs. Check the separators match what you pasted.");
      return;
    }
    setCards(parsed);
  };

  const importNotes = async () => {
    if (notes.length === 0) return;

    try {
      setLoading(true);
      for (const note of notes) {
        const created = createNote({
          body: note.body,
          via: 'import',
        });
        if (note.title && created) {
          saveNote(created, { title: note.title });
        }
      }
      alert(`Successfully imported ${notes.length} note(s)`);
      setNotes([]);
      router.push('/notes');
    } catch (err: any) {
      alert(`Error importing: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const importCards = async () => {
    if (cards.length === 0) return;

    try {
      setLoading(true);

      // Create source note if title provided
      let sourceNoteId: string | null = null;
      if (sourceNoteTitle.trim()) {
        const sourceNote = createNote({
          body: 'Imported flashcards',
          via: 'import',
          explicitCourseId: courseId,
        });
        if (sourceNote) {
          saveNote(sourceNote, { title: sourceNoteTitle });
          sourceNoteId = sourceNote.id;
        }
      }

      for (const card of cards) {
        addManualCard({ course_id: courseId, term: card.term, definition: card.definition, source_note_id: sourceNoteId });
      }

      alert(`Successfully imported ${cards.length} card(s)`);
      setCards([]);
      setPasteText('');
      setSourceNoteTitle('');
      router.push('/study');
    } catch (err: any) {
      alert(`Error importing: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      {/* Tab selector */}
      <Row gap={8} style={{ marginBottom: 16 }}>
        <Pressable
          onPress={() => {
            setActiveTab('notes');
            resetCards();
          }}
          style={{ flex: 1 }}
        >
          <View
            style={{
              paddingVertical: 12,
              paddingHorizontal: 16,
              backgroundColor: activeTab === 'notes' ? c.primary : c.surface,
              borderRadius: 8,
              alignItems: 'center',
            }}
          >
            <T style={{ color: activeTab === 'notes' ? c.onPrimary : c.text, fontWeight: '600' }}>
              Notes
            </T>
          </View>
        </Pressable>

        <Pressable
          onPress={() => {
            setActiveTab('flashcards');
            setNotes([]);
          }}
          style={{ flex: 1 }}
        >
          <View
            style={{
              paddingVertical: 12,
              paddingHorizontal: 16,
              backgroundColor: activeTab === 'flashcards' ? c.primary : c.surface,
              borderRadius: 8,
              alignItems: 'center',
            }}
          >
            <T style={{ color: activeTab === 'flashcards' ? c.onPrimary : c.text, fontWeight: '600' }}>
              Flashcards
            </T>
          </View>
        </Pressable>
      </Row>

      {/* Content */}
      <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
        {activeTab === 'notes' ? (
          <Section title="Import Notes">
            <View style={{ gap: 12 }}>
              <T muted variant="small">
                Upload .txt or .md files to import them as notes. Each file becomes one note.
              </T>

              <Button
                title={loading ? 'Reading file…' : 'Choose File'}
                onPress={pickFile}
                disabled={loading}
              />
              {error ? <T variant="small" color={c.warn}>{error}</T> : null}

              {notes.length > 0 && (
                <>
                  <Card>
                    <T variant="body" style={{ fontWeight: '600' }}>
                      {notes[0].title || 'Untitled Note'}
                    </T>
                    <T variant="small" muted numberOfLines={3}>
                      {notes[0].body.slice(0, 150)}...
                    </T>
                  </Card>

                  <Button
                    title={`Import ${notes.length} Note(s)`}
                    onPress={importNotes}
                    disabled={loading}
                  />
                </>
              )}

              {notes.length === 0 && (
                <Empty title="No file selected" body="Choose a .txt or .md file to get started" />
              )}
            </View>
          </Section>
        ) : (
          <Section title="Import Flashcards">
            <View style={{ gap: 12 }}>
              <T muted variant="small">
                Paste straight from Quizlet, or upload a CSV, TSV, JSON, or TXT file. Cards don't need a
                class — file them under one now, or leave them loose and add that later.
              </T>

              <Row gap={8}>
                <Chip label="Paste text" selected={cardMode === 'paste'} onPress={() => { setCardMode('paste'); resetCards(); }} />
                <Chip label="Upload a file" selected={cardMode === 'file'} onPress={() => { setCardMode('file'); resetCards(); }} />
              </Row>

              {cardMode === 'paste' ? (
                <View style={{ gap: 10 }}>
                  <Field
                    label="Paste your cards"
                    value={pasteText}
                    onChangeText={setPasteText}
                    placeholder={'Term 1[Tab]Definition 1\nTerm 2[Tab]Definition 2'}
                    multiline
                    style={{ minHeight: 140 }}
                  />

                  <View style={{ gap: 6 }}>
                    <T variant="small" muted>Between a term and its definition</T>
                    <Row style={{ flexWrap: 'wrap' }}>
                      {TERM_SEPS.map((s) => (
                        <Chip key={s.value} label={s.label} small selected={termSep === s.value} onPress={() => setTermSep(s.value)} />
                      ))}
                    </Row>
                    {termSep === 'custom' ? (
                      <Field value={customTermSep} onChangeText={setCustomTermSep} placeholder="e.g. ::" />
                    ) : null}
                  </View>

                  <View style={{ gap: 6 }}>
                    <T variant="small" muted>Between cards</T>
                    <Row style={{ flexWrap: 'wrap' }}>
                      {CARD_SEPS.map((s) => (
                        <Chip key={s.value} label={s.label} small selected={cardSep === s.value} onPress={() => setCardSep(s.value)} />
                      ))}
                    </Row>
                    {cardSep === 'custom' ? (
                      <Field value={customCardSep} onChangeText={setCustomCardSep} placeholder="e.g. ;" />
                    ) : null}
                  </View>

                  <Button title="Preview cards" variant="secondary" onPress={parsePaste} disabled={!pasteText.trim()} />
                  {error ? <T variant="small" color={c.warn}>{error}</T> : null}
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  <Button
                    title={loading ? 'Reading file…' : 'Choose File'}
                    onPress={pickFile}
                    disabled={loading}
                  />
                  {error ? <T variant="small" color={c.warn}>{error}</T> : null}
                </View>
              )}

              {cards.length > 0 && (
                <>
                  <View
                    style={{
                      backgroundColor: c.surfaceAlt,
                      borderRadius: 8,
                      padding: 12,
                      maxHeight: 200,
                    }}
                  >
                    <ScrollView>
                      {cards.slice(0, 5).map((card, i) => (
                        <View
                          key={i}
                          style={{
                            marginBottom: i < cards.length - 1 ? 12 : 0,
                            paddingBottom: i < cards.length - 1 ? 12 : 0,
                            borderBottomWidth: i < cards.length - 1 ? 1 : 0,
                            borderBottomColor: c.border,
                          }}
                        >
                          <T variant="small" style={{ fontWeight: '600' }}>
                            {card.term}
                          </T>
                          <T variant="small" muted>
                            {card.definition}
                          </T>
                        </View>
                      ))}
                      {cards.length > 5 && (
                        <T variant="small" muted>
                          +{cards.length - 5} more cards
                        </T>
                      )}
                    </ScrollView>
                  </View>

                  <View style={{ gap: 12 }}>
                    <View style={{ gap: 6 }}>
                      <T variant="small" muted>File under a class? (optional)</T>
                      <Row style={{ flexWrap: 'wrap' }}>
                        <Chip label="No class" selected={courseId === null} onPress={() => setCourseId(null)} />
                        {sem.rows.courses.map((k) => (
                          <Chip key={k.id} label={k.code ?? k.name} color={k.color} selected={courseId === k.id} onPress={() => setCourseId(k.id)} />
                        ))}
                      </Row>
                    </View>

                    <Field
                      label="Source note (optional)"
                      placeholder="e.g., Biology 101 - Chapter 5"
                      value={sourceNoteTitle}
                      onChangeText={setSourceNoteTitle}
                    />

                    <Button
                      title={`Import ${cards.length} Card(s)`}
                      onPress={importCards}
                      disabled={loading}
                    />
                  </View>
                </>
              )}

              {cards.length === 0 && cardMode === 'file' && (
                <Empty title="No file selected" body="Choose a CSV, TSV, JSON, or TXT file to get started" />
              )}
            </View>
          </Section>
        )}
      </ScrollView>
    </Screen>
  );
}
