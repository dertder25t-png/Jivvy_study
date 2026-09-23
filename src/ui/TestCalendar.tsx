// A small month calendar for the study dashboard: which days have a test coming up (color-coded per
// set), and — filled in automatically from the day-by-day plan — which days to study for it and how
// much. Tap a day to see its plan.
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Dot, Row, T } from './components';
import { DAY_CELL_WIDTH, MonthHeader, firstOfMonth, monthCells } from './calendarGrid';
import { space, useColors } from './theme';
import { localDateString, relativeDay } from '@/core/time';
import { prepShort, type PrepTask } from '@/core/testPrep';

export interface TestMarker {
  ymd: string;
  color: string;
  title: string;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function TestCalendar({ markers, now, tz, study = [] }: { markers: TestMarker[]; now: Date; tz: string; study?: PrepTask[] }) {
  const c = useColors();
  const todayYmd = localDateString(now, tz);
  const [viewYmd, setViewYmd] = useState(() =>
    firstOfMonth(study.length > 0 ? todayYmd : markers.find((m) => m.ymd >= todayYmd)?.ymd ?? todayYmd),
  );
  const [selected, setSelected] = useState(todayYmd);

  const byDay = new Map<string, TestMarker[]>();
  for (const marker of markers) byDay.set(marker.ymd, [...(byDay.get(marker.ymd) ?? []), marker]);
  const studyByDay = new Map<string, PrepTask[]>();
  for (const t of study) studyByDay.set(t.ymd, [...(studyByDay.get(t.ymd) ?? []), t]);

  const upcoming = markers.filter((m) => m.ymd >= todayYmd).sort((a, b) => a.ymd.localeCompare(b.ymd)).slice(0, 6);
  const selectedTests = byDay.get(selected) ?? [];
  const selectedStudy = studyByDay.get(selected) ?? [];

  return (
    <View style={{ gap: space.sm }}>
      <MonthHeader viewYmd={viewYmd} onChange={setViewYmd} />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {monthCells(viewYmd).map((cell) => {
          const isToday = cell.ymd === todayYmd;
          const isSelected = cell.ymd === selected;
          const dayMarkers = byDay.get(cell.ymd) ?? [];
          const dayStudy = studyByDay.get(cell.ymd) ?? [];
          const hasTest = dayMarkers.length > 0;
          return (
            <Pressable
              key={cell.ymd}
              onPress={() => setSelected(cell.ymd)}
              accessibilityRole="button"
              accessibilityLabel={`${cell.ymd}${hasTest ? ', test' : ''}${dayStudy.length ? ', study planned' : ''}`}
              style={{ width: DAY_CELL_WIDTH, height: 44, alignItems: 'center', opacity: cell.inMonth ? 1 : 0.3 }}
            >
              <View
                style={{
                  width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
                  borderWidth: isToday || isSelected ? 1.5 : 0, borderColor: isSelected ? c.text : c.primary,
                  backgroundColor: hasTest ? `${dayMarkers[0].color}33` : 'transparent',
                }}
              >
                <T variant="small" style={{ fontSize: 13, fontWeight: isToday || hasTest ? '700' : '400' }}>{cell.day}</T>
              </View>
              {hasTest ? (
                <Row gap={2} style={{ marginTop: 3 }}>
                  {dayMarkers.slice(0, 3).map((m, i) => <Dot key={i} color={m.color} size={5} />)}
                </Row>
              ) : dayStudy.length > 0 ? (
                <Row gap={2} style={{ marginTop: 4 }}>
                  {dayStudy.slice(0, 3).map((t, i) => (
                    <View key={i} style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: t.target.color, opacity: 0.8 }} />
                  ))}
                </Row>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {study.length > 0 ? (
        <Row gap={space.md}>
          <Row gap={4}><View style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: c.muted }} /><T variant="small" muted>study</T></Row>
          <Row gap={4}><Dot color={c.muted} size={6} /><T variant="small" muted>test</T></Row>
        </Row>
      ) : null}

      {selectedTests.length > 0 || selectedStudy.length > 0 || selected !== todayYmd ? (
        <View style={{ gap: 6, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: c.border }}>
          <T variant="small" style={{ fontWeight: '700' }}>{capitalize(relativeDay(selected, now, tz))}</T>
          {selectedTests.map((m, i) => (
            <Row key={`t-${i}`} gap={8}>
              <Dot color={m.color} size={9} />
              <T variant="small" style={{ flex: 1, fontWeight: '600' }} numberOfLines={1}>{m.title} — test</T>
            </Row>
          ))}
          {selectedStudy.map((t) => (
            <Row key={t.target.key} gap={8}>
              <View style={{ width: 9, height: 3, borderRadius: 2, backgroundColor: t.target.color }} />
              <T variant="small" style={{ flex: 1 }} numberOfLines={1}>{t.target.title}</T>
              <T variant="small" muted>{t.dayOffset > 0 && t.kind === 'learn' ? `~${prepShort(t)}` : prepShort(t)}</T>
            </Row>
          ))}
          {selectedTests.length === 0 && selectedStudy.length === 0 ? <T variant="small" muted>Nothing planned.</T> : null}
        </View>
      ) : null}

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
