// A small month calendar for the study dashboard: which days have a test coming up,
// color-coded per flashcard set, so students can see at a glance when to study for what.
import React, { useState } from 'react';
import { View } from 'react-native';
import { Dot, Row, T } from './components';
import { DAY_CELL_WIDTH, MonthHeader, firstOfMonth, monthCells } from './calendarGrid';
import { space, useColors } from './theme';
import { localDateString, relativeDay } from '@/core/time';

export interface TestMarker {
  ymd: string;
  color: string;
  title: string;
}

export function TestCalendar({ markers, now, tz }: { markers: TestMarker[]; now: Date; tz: string }) {
  const c = useColors();
  const todayYmd = localDateString(now, tz);
  const [viewYmd, setViewYmd] = useState(() => firstOfMonth(markers.find((m) => m.ymd >= todayYmd)?.ymd ?? todayYmd));

  const byDay = new Map<string, TestMarker[]>();
  for (const marker of markers) byDay.set(marker.ymd, [...(byDay.get(marker.ymd) ?? []), marker]);

  const upcoming = markers.filter((m) => m.ymd >= todayYmd).sort((a, b) => a.ymd.localeCompare(b.ymd)).slice(0, 6);

  return (
    <View style={{ gap: space.sm }}>
      <MonthHeader viewYmd={viewYmd} onChange={setViewYmd} />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {monthCells(viewYmd).map((cell) => {
          const isToday = cell.ymd === todayYmd;
          const dayMarkers = byDay.get(cell.ymd) ?? [];
          const hasTest = dayMarkers.length > 0;
          return (
            <View key={cell.ymd} style={{ width: DAY_CELL_WIDTH, height: 42, alignItems: 'center', opacity: cell.inMonth ? 1 : 0.3 }}>
              <View
                style={{
                  width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
                  borderWidth: isToday ? 1.5 : 0, borderColor: c.primary,
                  backgroundColor: hasTest ? `${dayMarkers[0].color}33` : 'transparent',
                }}
              >
                <T variant="small" style={{ fontSize: 13, fontWeight: isToday || hasTest ? '700' : '400' }}>{cell.day}</T>
              </View>
              {hasTest ? (
                <Row gap={2} style={{ marginTop: 3 }}>
                  {dayMarkers.slice(0, 3).map((m, i) => <Dot key={i} color={m.color} size={5} />)}
                </Row>
              ) : null}
            </View>
          );
        })}
      </View>

      <View style={{ gap: 8, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: c.border }}>
        {upcoming.length > 0 ? upcoming.map((m, i) => (
          <Row key={`${m.ymd}-${i}`} gap={8}>
            <Dot color={m.color} size={9} />
            <T variant="small" style={{ flex: 1, fontWeight: '500' }} numberOfLines={1}>{m.title}</T>
            <T variant="small" muted>{relativeDay(m.ymd, now, tz)}</T>
          </Row>
        )) : (
          <T variant="small" muted>No upcoming tests. Set a test date on a set to see it here.</T>
        )}
      </View>
    </View>
  );
}
