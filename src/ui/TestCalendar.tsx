// A small month calendar for the study dashboard: which days have a test coming up,
// color-coded per flashcard set, so students can see at a glance when to study for what.
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Dot, Row, T } from './components';
import { radius, space, useColors } from './theme';
import { localDateString, relativeDay } from '@/core/time';

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export interface TestMarker {
  ymd: string;
  color: string;
  title: string;
}

function ym(ymd: string): { y: number; m: number } {
  const [y, m] = ymd.split('-').map(Number);
  return { y, m };
}

function shiftMonth(ymd: string, delta: number): string {
  const { y, m } = ym(ymd);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

interface Cell {
  ymd: string;
  day: number;
  inMonth: boolean;
}

function buildCells(viewYmd: string): Cell[] {
  const { y, m } = ym(viewYmd);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const start = new Date(Date.UTC(y, m - 1, 1 - firstWeekday));
  const cells: Cell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const dy = d.getUTCFullYear();
    const dm = d.getUTCMonth() + 1;
    const dd = d.getUTCDate();
    cells.push({ ymd: `${dy}-${String(dm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`, day: dd, inMonth: dm === m && dy === y });
  }
  return cells;
}

export function TestCalendar({ markers, now, tz }: { markers: TestMarker[]; now: Date; tz: string }) {
  const c = useColors();
  const todayYmd = localDateString(now, tz);
  const [viewYmd, setViewYmd] = useState(() => `${ym(todayYmd).y}-${String(ym(todayYmd).m).padStart(2, '0')}-01`);

  const byDay = new Map<string, TestMarker[]>();
  for (const marker of markers) {
    const arr = byDay.get(marker.ymd);
    if (arr) arr.push(marker);
    else byDay.set(marker.ymd, [marker]);
  }

  const cells = buildCells(viewYmd);
  const upcoming = markers.filter((m) => m.ymd >= todayYmd).sort((a, b) => a.ymd.localeCompare(b.ymd)).slice(0, 6);

  return (
    <View style={{ gap: space.sm }}>
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
          const isToday = cell.ymd === todayYmd;
          const dayMarkers = byDay.get(cell.ymd) ?? [];
          return (
            <View key={cell.ymd} style={{ width: 32, height: 40, alignItems: 'center', opacity: cell.inMonth ? 1 : 0.35 }}>
              <View style={{
                width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
                borderWidth: isToday ? 1 : 0, borderColor: c.primary,
              }}>
                <T variant="small" style={{ fontWeight: isToday ? '700' : '400' }}>{cell.day}</T>
              </View>
              {dayMarkers.length > 0 ? (
                <Row gap={2} style={{ marginTop: 2 }}>
                  {dayMarkers.slice(0, 3).map((m, i) => <Dot key={i} color={m.color} size={6} />)}
                </Row>
              ) : null}
            </View>
          );
        })}
      </View>

      {upcoming.length > 0 ? (
        <View style={{ gap: 6, marginTop: space.xs, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: c.border }}>
          {upcoming.map((m, i) => (
            <Row key={`${m.ymd}-${i}`} gap={8}>
              <Dot color={m.color} size={8} />
              <T variant="small" style={{ flex: 1 }}>{m.title}</T>
              <T variant="small" muted>{relativeDay(m.ymd, now, tz)}</T>
            </Row>
          ))}
        </View>
      ) : (
        <T variant="small" muted>No test dates scheduled yet.</T>
      )}
    </View>
  );
}
