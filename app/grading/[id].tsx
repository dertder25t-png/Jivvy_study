import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  SCALE_PRESETS, DEFAULT_SCALE, courseScale, formatPercent, gradeBand, reconcile, targetBands,
} from '@/core/grades';
import { relativeTime } from '@/core/time';
import { addComponent, deleteComponent, setGradingScale, setOfficialGrade, updateComponent } from '@/data/actions';
import { useSemester } from '@/data/derived';
import { Badge, Button, Card, Chip, Divider, Empty, Field, Row, Screen, Section, T } from '@/ui/components';
import { CommitText, NumberField, PercentField } from '@/ui/fields';
import { useColors } from '@/ui/theme';
import type { GradeBand } from '@/types/db';

/**
 * Your college's own system is the official record for grades — this app can't see it and doesn't
 * pretend to. Here you copy in what the portal says, tell us its scale, and fix the weights if the
 * college counts things differently than the syllabus.
 */
export default function GradingSetup() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sem = useSemester();
  const c = useColors();
  const course = sem.courseById.get(id);
  const comps = (sem.componentsByCourse.get(id) ?? []).slice().sort((a, b) => b.weight - a.weight);
  const grade = sem.grades.get(id);
  const scale = courseScale(course);
  const official = course?.official_grade ?? null;

  // ---- official grade draft ----
  const [pct, setPct] = useState(official?.percent != null ? String(official.percent) : '');
  const [letter, setLetter] = useState(official?.letter ?? '');
  const [saved, setSaved] = useState(false);
  // ---- scale draft ----
  const [bands, setBands] = useState<GradeBand[]>(scale);
  const [scaleSaved, setScaleSaved] = useState(false);
  // ---- new component ----
  const [newName, setNewName] = useState('');
  const [newWeight, setNewWeight] = useState<number | null>(null);

  useEffect(() => {
    setBands(courseScale(course));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.grading_scale]);

  if (!course) return <Screen><Empty title="Course not found" /></Screen>;

  const pctNum = pct.trim() === '' ? null : Number(pct);
  const pctValid = pctNum == null || (!Number.isNaN(pctNum) && pctNum >= 0 && pctNum <= 200);
  const canSave = pctValid && (pctNum != null || letter.trim() !== '');
  const preview = reconcile(grade?.percent ?? null, canSave ? { percent: pctNum, letter: letter.trim() || null, as_of: '' } : official, scale);
  const totalWeight = Math.round(comps.reduce((s, k) => s + k.weight, 0) * 100);

  const saveOfficial = () => {
    setOfficialGrade(course, { percent: pctNum, letter: letter.trim() || null });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const usingCustom = !!course.grading_scale?.length;
  const setBand = (i: number, patch: Partial<GradeBand>) => setBands((b) => b.map((x, xi) => (xi === i ? { ...x, ...patch } : x)));

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Grading setup', headerTintColor: course.color }} />
      <View style={{ gap: 4 }}>
        <T variant="title">{course.code ?? course.name}</T>
        <T muted>
          Your college's own system holds the official grade — we can't see it. Copy in what it shows and we'll keep it front and center, and use it to make the math line up.
        </T>
      </View>

      {/* ---------------- official grade ---------------- */}
      <Section title="Official grade (from your college)">
        <Card>
          <Row style={{ alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Field label="Percent" value={pct} onChangeText={setPct} keyboardType="decimal-pad" placeholder="88.4" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Letter" value={letter} onChangeText={setLetter} autoCapitalize="characters" placeholder="B+" />
            </View>
          </Row>
          <Row style={{ flexWrap: 'wrap' }}>
            {bands.map((b) => (
              <Chip key={b.letter} label={b.letter} small selected={letter.trim().toUpperCase() === b.letter.toUpperCase()} onPress={() => setLetter(b.letter)} />
            ))}
          </Row>
          <T variant="small" muted>Enter whichever your portal shows — a percent, a letter, or both. Percent lets us line our math up with yours.</T>
          {!pctValid ? <T variant="small" color={c.warn}>That doesn't look like a percent.</T> : null}
          {preview.message ? (
            <T variant="small" color={preview.kind === 'close' ? c.good : c.warn}>
              {grade?.percent != null ? `Our estimate: ${formatPercent(grade.percent)} (${gradeBand(grade.percent, scale).letter}). ` : ''}{preview.message}
            </T>
          ) : grade?.percent == null ? (
            <T variant="small" muted>Once you've entered some grades we'll compare against your college's number.</T>
          ) : null}
          <Row>
            <Button title={saved ? 'Saved' : 'Save official grade'} onPress={saveOfficial} disabled={!canSave} style={{ flex: 1 }} />
            {official ? <Button title="Clear" variant="ghost" onPress={() => { setOfficialGrade(course, null); setPct(''); setLetter(''); }} /> : null}
          </Row>
          {official ? <T variant="small" muted>Last updated {relativeTime(official.as_of, sem.now, sem.tz)}. Update it whenever the portal changes.</T> : null}
        </Card>
      </Section>

      {/* ---------------- scale ---------------- */}
      <Section title="Grading scale" right={<Badge label={usingCustom ? 'custom' : 'A–F 90/80/70/60'} tone={usingCustom ? 'primary' : 'alt'} />}>
        <Card>
          <T variant="small" muted>Where does each letter start at your college? This drives letter grades and "what do I need?" targets.</T>
          <Row style={{ flexWrap: 'wrap' }}>
            {SCALE_PRESETS.map((p) => (
              <Chip key={p.key} label={p.label} small onPress={() => setBands(p.scale)} />
            ))}
          </Row>
          <View style={{ gap: 6 }}>
            {bands.map((b, i) => (
              <Row key={`${i}`} gap={8}>
                <View style={{ width: 70 }}>
                  <CommitText value={b.letter} onCommit={(v) => setBand(i, { letter: v })} />
                </View>
                <T muted>starts at</T>
                <NumberField value={b.floor} onCommit={(n) => setBand(i, { floor: n })} width={72} />
                <T muted>%</T>
                <Pressable onPress={() => setBands((x) => x.filter((_, xi) => xi !== i))} hitSlop={8} accessibilityLabel={`Remove ${b.letter}`}>
                  <T muted style={{ fontSize: 20, paddingHorizontal: 6 }}>×</T>
                </Pressable>
              </Row>
            ))}
          </View>
          <Row style={{ flexWrap: 'wrap' }}>
            <Button title="Add a letter" small variant="secondary" onPress={() => setBands((x) => [...x, { letter: '', floor: 0 }])} />
            <Button
              title={scaleSaved ? 'Saved' : 'Save scale'}
              small
              onPress={() => {
                const same = JSON.stringify([...bands].sort((a, b) => b.floor - a.floor)) === JSON.stringify(DEFAULT_SCALE);
                setGradingScale(course, same ? null : bands);
                setScaleSaved(true);
                setTimeout(() => setScaleSaved(false), 2000);
              }}
            />
            {usingCustom ? <Button title="Reset to A–F" small variant="ghost" onPress={() => { setGradingScale(course, null); setBands(DEFAULT_SCALE); }} /> : null}
          </Row>
          {bands.some((b) => b.floor === 0) ? null : <T variant="small" color={c.warn}>Add a bottom rung that starts at 0 (usually F) so every percent has a letter.</T>}
          <T variant="small" muted>Targets available: {targetBands(bands).map((b) => b.letter).join(', ') || '—'}.</T>
        </Card>
      </Section>

      {/* ---------------- weights ---------------- */}
      <Section title="What counts toward the grade" right={<Badge label={`${totalWeight}%`} tone={Math.abs(totalWeight - 100) <= 1 ? 'good' : 'warn'} />}>
        <Card>
          <T variant="small" muted>
            Straight from the syllabus. Change anything your college counts differently — the estimate and "what do I need?" follow.
          </T>
          {comps.length === 0 ? <T variant="small" muted>Nothing yet — add the parts of the grade below.</T> : null}
          {comps.map((k, i) => (
            <View key={k.id}>
              {i > 0 ? <Divider /> : null}
              <View style={{ gap: 8, paddingVertical: 8 }}>
                <Row>
                  <View style={{ flex: 1 }}>
                    <CommitText value={k.name} onCommit={(v) => updateComponent(k, { name: v })} />
                  </View>
                  <PercentField value={k.weight} onCommit={(n) => updateComponent(k, { weight: Math.max(0, Math.min(1, n / 100)) })} />
                  <T muted>%</T>
                </Row>
                <Row>
                  <T variant="small" muted style={{ flex: 1 }}>
                    Drop the lowest {k.drop_lowest > 0 ? k.drop_lowest : 'none'}
                  </T>
                  <Button title="−" small variant="secondary" onPress={() => updateComponent(k, { drop_lowest: Math.max(0, k.drop_lowest - 1) })} disabled={k.drop_lowest <= 0} />
                  <Button title="+" small variant="secondary" onPress={() => updateComponent(k, { drop_lowest: k.drop_lowest + 1 })} />
                  <Button title="Remove" small variant="ghost" onPress={() => deleteComponent(k)} />
                </Row>
              </View>
            </View>
          ))}
          <Divider />
          <T variant="label" muted>Add a part</T>
          <Row>
            <View style={{ flex: 1 }}>
              <Field value={newName} onChangeText={setNewName} placeholder="e.g. Participation" />
            </View>
            <NumberField value={newWeight} onCommit={setNewWeight} placeholder="%" />
            <T muted>%</T>
          </Row>
          <Button
            title="Add"
            small
            variant="secondary"
            disabled={!newName.trim() || newWeight == null}
            onPress={() => { addComponent(id, { name: newName, weight: (newWeight ?? 0) / 100 }); setNewName(''); setNewWeight(null); }}
          />
          {Math.abs(totalWeight - 100) > 1 ? (
            <T variant="small" color={c.warn}>These add up to {totalWeight}%, not 100%. That's fine if your college does it that way — otherwise check them.</T>
          ) : null}
        </Card>
      </Section>
    </Screen>
  );
}
