import React, { useDeferredValue, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { extractCandidates } from '@/core/flashcards/extract';
import { addManualCard, decideCard, deleteCard, fileNote } from '@/data/actions';
import { useSemester } from '@/data/derived';
import { REJECT_REASON_TEXT, generateForNote, type GenerationSummary } from '@/data/generation';
import type { Card as CardRow, Note } from '@/types/db';
import { Badge, Button, Chip, Field, Row, T } from './components';
import type { AutoCardsState } from './useAutoCards';
import { radius, space, useColors } from './theme';

export const PANEL_WIDTH = 320;

/**
 * The flashcard workspace that sits beside a note while you write. Everything here
 * works on the note in front of you: see what definitions it contains, make cards
 * on demand, approve them in place, and add your own — without leaving the page.
 */
export function NoteCardsPanel({
  note, body, ensureSaved, onClose, auto,
}: {
  note: Note | null;
  body: string;
  /** Flushes the current text to storage (creating the note if needed) and returns it. */
  ensureSaved: () => Note | null;
  onClose: () => void;
  /** Cards made by the local model while you type (see useAutoCards). */
  auto?: AutoCardsState;
}) {
  const c = useColors();
  const router = useRouter();
  const sem = useSemester();

  const deferred = useDeferredValue(body);
  const candidates = useMemo(() => extractCandidates(deferred), [deferred]);

  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<GenerationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFound, setShowFound] = useState(false);
  const [editing, setEditing] = useState<CardRow | null>(null);
  const [eTerm, setETerm] = useState('');
  const [eDef, setEDef] = useState('');
  const [mTerm, setMTerm] = useState('');
  const [mDef, setMDef] = useState('');

  const cards = note ? sem.rows.cards.filter((k) => k.source_note_id === note.id) : [];
  const pending = cards.filter((k) => k.status === 'pending');
  const kept = cards.filter((k) => k.status === 'accepted' || k.status === 'edited');
  const course = note?.course_id ? sem.courseById.get(note.course_id) : undefined;

  const makeLabel = candidates.length === 0 ? 'Make cards' : `Make ${candidates.length} card${candidates.length === 1 ? '' : 's'}`;

  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);

  const generate = async () => {
    const saved = ensureSaved();
    if (!saved) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    setScanNote(null);
    try {
      if (auto?.ai) {
        // "Find cards in this note": the local model reads the whole note — no typing needed —
        // and only cards for things that don't have one yet come back.
        const f = await generateForNote(saved, { onlyNew: true, readAll: true, onProgress: (d, t) => setProgress([d, t]) });
        if (f && !f.modelRan) {
          setError('The local AI helper isn’t running on this laptop. Start it with scripts/npu-cards/start.sh, then try again.');
        } else if (!f || f.survived === 0) {
          setScanNote('Nothing new found — everything defined in this note already has a card.');
        } else {
          setSummary(f);
        }
      } else {
        setSummary(await generateForNote(saved));
      }
    } catch (e) {
      setError((e as Error).message || 'Something went wrong making cards.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const addManual = () => {
    const saved = ensureSaved();
    if (!saved || !mTerm.trim() || !mDef.trim()) return;
    addManualCard({ course_id: saved.course_id, topic_id: saved.topic_id, source_note_id: saved.id, term: mTerm, definition: mDef });
    setMTerm('');
    setMDef('');
  };

  const startEdit = (k: CardRow) => {
    setEditing(k);
    setETerm(k.term);
    setEDef(k.definition);
  };

  const label = (text: string, extra?: React.ReactNode) => (
    <Row style={{ justifyContent: 'space-between', marginTop: space.md }}>
      <T variant="label" muted>{text}</T>
      {extra}
    </Row>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.surface, borderRightWidth: 1, borderRightColor: c.border }}>
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <Row gap={8}>
          <Ionicons name="albums-outline" size={18} color={c.muted} />
          <T variant="heading">Flashcards</T>
        </Row>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hide flashcards">
          <Ionicons name="chevron-back" size={22} color={c.muted} />
        </Pressable>
      </Row>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 0, gap: space.sm }} keyboardShouldPersistTaps="handled">
        {/* ---------------- what's in this note ---------------- */}
        {label('In this note')}
        <T variant="body">
          {candidates.length === 0
            ? auto?.ai ? 'No set-out definitions' : 'No definitions yet'
            : `${candidates.length} definition${candidates.length === 1 ? '' : 's'} found`}
        </T>
        {candidates.length === 0 && auto?.ai ? (
          <T variant="small" muted>The local model can still find terms written in plain sentences.</T>
        ) : candidates.length === 0 ? (
          <T variant="small" muted>
            Write a term and its meaning — <T variant="small" style={{ fontWeight: '700' }}>**Term** — meaning</T>, “Term: meaning”, or “X refers to…” — and it shows up here.
          </T>
        ) : (
          <>
            <Pressable onPress={() => setShowFound((v) => !v)}>
              <T variant="small" color={c.primary}>{showFound ? 'Hide' : 'See what we found'}</T>
            </Pressable>
            {showFound
              ? candidates.slice(0, 10).map((cand) => (
                  <View key={cand.id} style={{ backgroundColor: c.surfaceAlt, borderRadius: radius.md, padding: 10, gap: 4 }}>
                    <Badge label={cand.pattern_type.replace(/_/g, ' ')} />
                    <T variant="small" numberOfLines={3}>{cand.text}</T>
                  </View>
                ))
              : null}
          </>
        )}

        {note && !note.course_id && sem.rows.courses.length > 0 ? (
          <View style={{ gap: 6 }}>
            <T variant="small" muted>File this under a class? (optional — cards work fine without one)</T>
            <Row style={{ flexWrap: 'wrap' }}>
              {sem.rows.courses.map((k) => <Chip key={k.id} label={k.code ?? k.name} small color={k.color} onPress={() => fileNote(note, k.id)} />)}
            </Row>
          </View>
        ) : null}

        <Button
          title={
            auto?.ai
              ? busy
                ? progress && progress[1] > 1 ? `Reading your note… ${Math.min(progress[0] + 1, progress[1])} of ${progress[1]}` : 'Reading your note…'
                : 'Find cards in this note'
              : busy ? 'Making cards…' : makeLabel
          }
          onPress={generate}
          loading={busy}
          disabled={busy || (candidates.length === 0 && !auto?.ai) || (!!auto?.ai && !body.trim())}
          small
        />
        {auto?.ai && !busy && !summary && !scanNote && !error ? (
          <T variant="small" muted>The local model reads the whole note and suggests a card for each term it explains.</T>
        ) : null}
        {scanNote ? <T variant="small" muted>{scanNote}</T> : null}
        {auto?.on ? (
          <Row gap={6}>
            <Ionicons name="hardware-chip-outline" size={14} color={c.muted} />
            <T variant="small" muted style={{ flex: 1 }}>
              {auto.busy
                ? 'Making cards from what you just wrote…'
                : auto.last
                  ? `Made ${auto.last.survived} card${auto.last.survived === 1 ? '' : 's'} from what you just wrote`
                  : 'Cards appear here when you pause typing'}
            </T>
          </Row>
        ) : null}
        {error ? <T variant="small" color={c.warn}>{error}</T> : null}
        {summary ? (
          <View style={{ gap: 2 }}>
            <T variant="small" muted>
              {summary.survived} ready for your OK · {summary.total - summary.survived} filtered out
              {summary.model && summary.model !== 'rules' ? ' · written on this laptop’s NPU' : ''}
            </T>
            {Object.entries(summary.byReason).map(([k, v]) => (
              <T key={k} variant="small" muted>· {v} {REJECT_REASON_TEXT[k] ?? k}</T>
            ))}
          </View>
        ) : null}

        {/* ---------------- approve gate ---------------- */}
        {pending.length > 0 ? (
          <>
            {label(`Waiting for your OK · ${pending.length}`)}
            {pending.map((k) => (
              <View key={k.id} style={{ backgroundColor: c.warnSoft, borderRadius: radius.md, padding: 12, gap: 8 }}>
                {editing?.id === k.id ? (
                  <>
                    <Field value={eTerm} onChangeText={setETerm} />
                    <Field value={eDef} onChangeText={setEDef} multiline style={{ minHeight: 70 }} />
                    <Row>
                      <Button title="Cancel" small variant="secondary" onPress={() => setEditing(null)} style={{ flex: 1 }} />
                      <Button
                        title="Save"
                        small
                        onPress={() => { decideCard(k, 'edited', { term: eTerm.trim() || k.term, definition: eDef.trim() || k.definition }); setEditing(null); }}
                        style={{ flex: 1 }}
                      />
                    </Row>
                  </>
                ) : (
                  <>
                    <T variant="body" style={{ fontWeight: '700' }}>{k.term}</T>
                    <T variant="small">{k.definition}</T>
                    <Row>
                      <Button title="Skip" small variant="secondary" onPress={() => decideCard(k, 'rejected')} style={{ flex: 1 }} />
                      <Button title="Edit" small variant="secondary" onPress={() => startEdit(k)} style={{ flex: 1 }} />
                      <Button title="Keep" small onPress={() => decideCard(k, 'accepted')} style={{ flex: 1 }} />
                    </Row>
                  </>
                )}
              </View>
            ))}
            {pending.length > 1 && note ? (
              <Button title="Keep all" small variant="ghost" onPress={() => pending.forEach((k) => decideCard(k, 'accepted'))} />
            ) : null}
          </>
        ) : null}

        {/* ---------------- kept ---------------- */}
        {kept.length > 0 ? (
          <>
            {label(`From this note · ${kept.length}`)}
            {kept.map((k) => (
              <Row key={k.id} style={{ alignItems: 'flex-start', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <T variant="small" style={{ fontWeight: '700' }}>{k.term}</T>
                  <T variant="small" muted numberOfLines={2}>{k.definition}</T>
                </View>
                <Pressable onPress={() => deleteCard(k)} hitSlop={8} accessibilityLabel={`Delete card ${k.term}`}>
                  <Ionicons name="close" size={16} color={c.muted} />
                </Pressable>
              </Row>
            ))}
            <Button title="Study these" small variant="secondary" onPress={() => router.push(`/cards/review?noteId=${note?.id}&order=weakest&limit=${Math.max(kept.length, 1)}`)} />
          </>
        ) : null}

        {/* ---------------- add your own ---------------- */}
        {label('Add your own')}
        <Field value={mTerm} onChangeText={setMTerm} placeholder="Term" />
        <Field value={mDef} onChangeText={setMDef} placeholder="Definition" multiline style={{ minHeight: 64 }} />
        <Button title="Add card" small variant="secondary" onPress={addManual} disabled={!mTerm.trim() || !mDef.trim()} />
        {course ? <T variant="small" muted>Files under {course.code ?? course.name}, this week’s topic.</T> : null}

        {pending.length > 0 && note ? (
          <Pressable onPress={() => router.push(`/cards/generate?noteId=${note.id}`)} style={{ marginTop: space.sm }}>
            <T variant="small" color={c.primary}>Review one at a time, full screen →</T>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
