// A real calendar dropdown + time stepper for picking a date+time (e.g. a flashcard
// set's test date). Replaces free-text "YYYY-MM-DD" entry, which silently did nothing
// if you typed anything the strict format didn't match.
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Row, T } from './components';
import { DAY_CELL_WIDTH, MonthHeader, firstOfMonth, monthCells } from './calendarGrid';
import { radius, space, useColors } from './theme';
import { localDateString, zonedParts, zonedToUtc } from '@/core/time';

function formatClock(h: number, min: number): string {
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, '0')} ${suffix}`;
}

function StepButton({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.sm,
        backgroundColor: pressed ? c.border : c.surface, borderWidth: 1, borderColor: c.border,
      })}
    >
      <T variant="small" style={{ fontWeight: '600', fontSize: 12 }}>{label}</T>
    </Pressable>
  );
}

export function CalendarField({
  valueIso, onChange, tz, now, label = 'Set date',
}: {
  valueIso: string | null;
  onChange: (iso: string | null) => void;
  tz: string;
  now: Date;
  label?: string;
}) {
  const c = useColors();
  const todayYmd = localDateString(now, tz);
  const [open, setOpen] = useState(false);
  const [draftYmd, setDraftYmd] = useState(todayYmd);
  const [draftHour, setDraftHour] = useState(23);
  const [draftMinute, setDraftMinute] = useState(59);
  const [viewYmd, setViewYmd] = useState(firstOfMonth(todayYmd));

  const openPicker = () => {
    const base = valueIso ? localDateString(new Date(valueIso), tz) : todayYmd;
    const parts = valueIso ? zonedParts(new Date(valueIso), tz) : null;
    setDraftYmd(base);
    setDraftHour(parts ? parts.h : 23);
    setDraftMinute(parts ? parts.min : 59);
    setViewYmd(firstOfMonth(base));
    setOpen(true);
  };

  const adjustMinute = (delta: number) => {
    const total = (((draftHour * 60 + draftMinute + delta) % 1440) + 1440) % 1440;
    setDraftHour(Math.floor(total / 60));
    setDraftMinute(total % 60);
  };

  const save = () => {
    const hhmm = `${String(draftHour).padStart(2, '0')}:${String(draftMinute).padStart(2, '0')}`;
    onChange(zonedToUtc(draftYmd, hhmm, tz).toISOString());
    setOpen(false);
  };

  const clear = () => {
    onChange(null);
    setOpen(false);
  };

  if (!open) {
    const parts = valueIso ? zonedParts(new Date(valueIso), tz) : null;
    const text = valueIso && parts
      ? `${new Date(valueIso).toLocaleDateString(undefined, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · ${formatClock(parts.h, parts.min)}`
      : label;
    return (
      <Row gap={8} style={{ flexWrap: 'wrap' }}>
        <Pressable
          onPress={openPicker}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14,
            borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
            backgroundColor: pressed ? c.surfaceAlt : c.surface,
          })}
        >
          <Ionicons name="calendar-outline" size={16} color={valueIso ? c.primary : c.muted} />
          <T variant="small" style={{ fontWeight: '600', color: valueIso ? c.text : c.muted }}>{text}</T>
          <Ionicons name="chevron-down" size={14} color={c.muted} />
        </Pressable>
        {valueIso ? <Button title="Clear" small variant="ghost" onPress={() => onChange(null)} /> : null}
      </Row>
    );
  }

  return (
    <View
      style={{
        width: '100%', maxWidth: 360, gap: space.sm, backgroundColor: c.surfaceAlt,
        borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: c.border,
      }}
    >
      <MonthHeader viewYmd={viewYmd} onChange={setViewYmd} />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {monthCells(viewYmd).map((cell) => {
          const selected = cell.ymd === draftYmd;
          const isToday = cell.ymd === todayYmd;
          return (
            <View key={cell.ymd} style={{ width: DAY_CELL_WIDTH, alignItems: 'center', paddingVertical: 2 }}>
              <Pressable
                onPress={() => setDraftYmd(cell.ymd)}
                accessibilityRole="button"
                accessibilityLabel={cell.ymd}
                accessibilityState={{ selected }}
                style={({ pressed }) => ({
                  width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: selected ? c.primary : pressed ? c.border : 'transparent',
                  borderWidth: isToday && !selected ? 1 : 0, borderColor: c.primary,
                  opacity: cell.inMonth ? 1 : 0.35,
                })}
              >
                <T variant="small" style={{ color: selected ? c.onPrimary : c.text, fontWeight: isToday || selected ? '700' : '400' }}>
                  {cell.day}
                </T>
              </Pressable>
            </View>
          );
        })}
      </View>

      <View style={{ gap: 6, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: c.border }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="small" muted>Time</T>
          <T variant="body" style={{ fontWeight: '700' }}>{formatClock(draftHour, draftMinute)}</T>
        </Row>
        <Row gap={6} style={{ justifyContent: 'space-between' }}>
          <StepButton label="−1h" onPress={() => adjustMinute(-60)} />
          <StepButton label="−15m" onPress={() => adjustMinute(-15)} />
          <StepButton label="+15m" onPress={() => adjustMinute(15)} />
          <StepButton label="+1h" onPress={() => adjustMinute(60)} />
        </Row>
      </View>

      <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
        {valueIso ? <Button title="Clear" small variant="ghost" onPress={clear} /> : <View />}
        <Row gap={8}>
          <Button title="Cancel" small variant="secondary" onPress={() => setOpen(false)} />
          <Button title="Save" small onPress={save} />
        </Row>
      </Row>
    </View>
  );
}
