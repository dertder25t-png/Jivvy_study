// A real calendar dropdown + time stepper for picking a date+time (e.g. a flashcard
// set's test date). Replaces free-text "YYYY-MM-DD" entry, which silently did nothing
// if you typed anything the strict format didn't match.
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Row, T } from './components';
import { radius, space, useColors } from './theme';
import { localDateString, zonedParts, zonedToUtc } from '@/core/time';

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function ym(ymd: string): { y: number; m: number } {
  const [y, m] = ymd.split('-').map(Number);
  return { y, m };
}

/** First-of-month ymd, shifted by `delta` months. */
function shiftMonth(ymd: string, delta: number): string {
  const { y, m } = ym(ymd);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function firstOfMonth(ymd: string): string {
  const { y, m } = ym(ymd);
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

interface Cell {
  ymd: string;
  day: number;
  inMonth: boolean;
}

function buildCells(viewYmd: string): Cell[] {
  const { y, m } = ym(viewYmd);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Cell[] = [];
  const start = new Date(Date.UTC(y, m - 1, 1 - firstWeekday));
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const dy = d.getUTCFullYear();
    const dm = d.getUTCMonth() + 1;
    const dd = d.getUTCDate();
    cells.push({
      ymd: `${dy}-${String(dm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`,
      day: dd,
      inMonth: dm === m && dy === y,
    });
    if (i >= 34 && d.getUTCDate() === daysInMonth && dm === m) break; // stop after the month's last week
  }
  return cells;
}

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
      style={{ paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border }}
    >
      <T variant="small" style={{ fontWeight: '600' }}>{label}</T>
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
  const [open, setOpen] = useState(false);
  const [draftYmd, setDraftYmd] = useState<string>(() => (valueIso ? localDateString(new Date(valueIso), tz) : localDateString(now, tz)));
  const [draftHour, setDraftHour] = useState<number>(() => (valueIso ? zonedParts(new Date(valueIso), tz).h : 23));
  const [draftMinute, setDraftMinute] = useState<number>(() => (valueIso ? zonedParts(new Date(valueIso), tz).min : 59));
  const [viewYmd, setViewYmd] = useState<string>(() => firstOfMonth(draftYmd));

  const todayYmd = localDateString(now, tz);

  const openPicker = () => {
    const base = valueIso ? localDateString(new Date(valueIso), tz) : todayYmd;
    setDraftYmd(base);
    setDraftHour(valueIso ? zonedParts(new Date(valueIso), tz).h : 23);
    setDraftMinute(valueIso ? zonedParts(new Date(valueIso), tz).min : 59);
    setViewYmd(firstOfMonth(base));
    setOpen(true);
  };

  const adjustMinute = (delta: number) => {
    setDraftMinute((min) => {
      let next = min + delta;
      let hourDelta = 0;
      while (next < 0) { next += 60; hourDelta -= 1; }
      while (next >= 60) { next -= 60; hourDelta += 1; }
      if (hourDelta !== 0) setDraftHour((h) => (h + hourDelta + 24) % 24);
      return next;
    });
  };

  const save = () => {
    const hh = `${String(draftHour).padStart(2, '0')}:${String(draftMinute).padStart(2, '0')}`;
    onChange(zonedToUtc(draftYmd, hh, tz).toISOString());
    setOpen(false);
  };

  const clear = () => {
    onChange(null);
    setOpen(false);
  };

  const buttonLabel = valueIso
    ? `${new Date(valueIso).toLocaleDateString(undefined, { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' })} · ${formatClock(zonedParts(new Date(valueIso), tz).h, zonedParts(new Date(valueIso), tz).min)}`
    : label;

  if (!open) {
    return (
      <Row gap={8}>
        <Button title={buttonLabel} small variant="secondary" onPress={openPicker} />
        {valueIso ? <Button title="Clear" small variant="ghost" onPress={() => onChange(null)} /> : null}
      </Row>
    );
  }

  const cells = buildCells(viewYmd);

  return (
    <View style={{ gap: space.sm, backgroundColor: c.surfaceAlt, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: c.border }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable onPress={() => setViewYmd(shiftMonth(viewYmd, -1))} hitSlop={8}><T variant="heading">‹</T></Pressable>
        <T variant="body" style={{ fontWeight: '600' }}>{MONTH_NAMES[ym(viewYmd).m - 1]} {ym(viewYmd).y}</T>
        <Pressable onPress={() => setViewYmd(shiftMonth(viewYmd, 1))} hitSlop={8}><T variant="heading">›</T></Pressable>
      </Row>

      <Row style={{ justifyContent: 'space-between' }}>
        {WEEKDAY_LETTERS.map((d, i) => (
          <T key={i} variant="small" muted style={{ width: 32, textAlign: 'center' }}>{d}</T>
        ))}
      </Row>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((cell) => {
          const selected = cell.ymd === draftYmd;
          const isToday = cell.ymd === todayYmd;
          return (
            <Pressable
              key={cell.ymd}
              onPress={() => setDraftYmd(cell.ymd)}
              style={{
                width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
                backgroundColor: selected ? c.primary : 'transparent',
                borderWidth: isToday && !selected ? 1 : 0, borderColor: c.primary,
                opacity: cell.inMonth ? 1 : 0.35,
              }}
            >
              <T variant="small" style={{ color: selected ? c.onPrimary : c.text, fontWeight: isToday ? '700' : '400' }}>
                {cell.day}
              </T>
            </Pressable>
          );
        })}
      </View>

      <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
        <T variant="small" muted>Time</T>
        <Row gap={4}>
          <StepButton label="−1h" onPress={() => setDraftHour((h) => (h + 23) % 24)} />
          <StepButton label="−15m" onPress={() => adjustMinute(-15)} />
          <T variant="small" style={{ fontWeight: '600', minWidth: 76, textAlign: 'center' }}>{formatClock(draftHour, draftMinute)}</T>
          <StepButton label="+15m" onPress={() => adjustMinute(15)} />
          <StepButton label="+1h" onPress={() => setDraftHour((h) => (h + 1) % 24)} />
        </Row>
      </Row>

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
