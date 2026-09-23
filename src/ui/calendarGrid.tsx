// Month-grid math + the shared month header, used by the date picker and the study calendar.
import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Row, T } from './components';
import { radius, useColors } from './theme';

export const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Exactly seven columns at any container width. */
export const DAY_CELL_WIDTH = `${100 / 7}%` as const;

export interface DayCell {
  ymd: string;
  day: number;
  inMonth: boolean;
}

function ym(ymd: string): { y: number; m: number } {
  const [y, m] = ymd.split('-').map(Number);
  return { y, m };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function firstOfMonth(ymd: string): string {
  const { y, m } = ym(ymd);
  return `${y}-${pad(m)}-01`;
}

export function shiftMonth(ymd: string, delta: number): string {
  const { y, m } = ym(ymd);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
}

export function monthLabel(ymd: string): string {
  const { y, m } = ym(ymd);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Whole weeks covering the month, Sunday-first, padded with neighbouring days. */
export function monthCells(viewYmd: string): DayCell[] {
  const { y, m } = ym(viewYmd);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const total = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const start = Date.UTC(y, m - 1, 1 - firstWeekday);
  const cells: DayCell[] = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(start + i * 86400000);
    const dm = d.getUTCMonth() + 1;
    cells.push({ ymd: `${d.getUTCFullYear()}-${pad(dm)}-${pad(d.getUTCDate())}`, day: d.getUTCDate(), inMonth: dm === m });
  }
  return cells;
}

export function MonthHeader({ viewYmd, onChange }: { viewYmd: string; onChange: (ymd: string) => void }) {
  const c = useColors();
  const arrow = (dir: -1 | 1) => (
    <Pressable
      onPress={() => onChange(shiftMonth(viewYmd, dir))}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={dir < 0 ? 'Previous month' : 'Next month'}
      style={({ pressed }) => ({ width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.surfaceAlt : 'transparent' })}
    >
      <Ionicons name={dir < 0 ? 'chevron-back' : 'chevron-forward'} size={18} color={c.text} />
    </Pressable>
  );
  return (
    <View style={{ gap: 6 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        {arrow(-1)}
        <T variant="body" style={{ fontWeight: '600' }}>{monthLabel(viewYmd)}</T>
        {arrow(1)}
      </Row>
      <View style={{ flexDirection: 'row' }}>
        {WEEKDAY_LETTERS.map((d, i) => (
          <T key={i} variant="small" muted style={{ width: DAY_CELL_WIDTH, textAlign: 'center', fontSize: 12 }}>{d}</T>
        ))}
      </View>
    </View>
  );
}
