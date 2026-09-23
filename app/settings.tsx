import React, { useEffect, useState } from 'react';
import { Alert, Platform, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { clearLocalData } from '@/data/backends';
import { addSampleSemester } from '@/data/actions';
import { prefs, usePrefs } from '@/data/prefs';
import { store } from '@/data/store';
import { useSemester } from '@/data/derived';
import { DAILY_CAP } from '@/core/notifications';
import { ensurePermission, webPermission } from '@/notifications/schedule';
import { Button, Card, Chip, Field, Row, Screen, Section, T } from '@/ui/components';
import { SyncStatusPanel } from '@/ui/SyncBanner';

const MINUTES = [45, 90, 120, 180];
const STUDY_TIMES = [
  { value: '07:00', label: '7am' }, { value: '12:00', label: 'Noon' }, { value: '16:00', label: '4pm' },
  { value: '18:00', label: '6pm' }, { value: '20:00', label: '8pm' }, { value: '22:00', label: '10pm' },
];

function keyLabel(key: string): string {
  if (key === ' ') return 'Space';
  return key.length === 1 ? key.toUpperCase() : key;
}

export default function Settings() {
  const p = usePrefs();
  const sem = useSemester();
  const router = useRouter();
  const [tz, setTz] = useState(p.tz);
  const [msg, setMsg] = useState<string | null>(null);
  const [capturingShortcut, setCapturingShortcut] = useState(false);
  const [webPerm, setWebPerm] = useState(webPermission);

  useEffect(() => {
    if (!capturingShortcut || Platform.OS !== 'web') return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      prefs.set({ subNoteShortcutKey: e.key });
      setCapturingShortcut(false);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [capturingShortcut]);

  const toggleNotifications = async (on: boolean) => {
    if (on) {
      const ok = await ensurePermission();
      setWebPerm(webPermission());
      if (!ok && Platform.OS !== 'web') setMsg('Notifications are blocked for this app in your device settings.');
    }
    prefs.set({ notificationsEnabled: on });
  };

  const allowBrowser = async () => {
    await ensurePermission();
    setWebPerm(webPermission());
  };

  const resetLocal = () => {
    const go = async () => {
      await clearLocalData();
      store.reset();
      router.replace('/');
      setTimeout(() => (Platform.OS === 'web' ? window.location.reload() : undefined), 50);
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Erase everything stored on this device?')) void go();
    } else {
      Alert.alert('Erase all local data?', 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Erase', style: 'destructive', onPress: () => void go() }]);
    }
  };

  return (
    <Screen maxWidth={760}>
      <Section title="You">
        <Card>
          <Field label="Your name (for email drafts)" value={p.studentName} onChangeText={(v) => prefs.set({ studentName: v })} placeholder="Alex" />
          <Field label="Time zone" value={tz} onChangeText={setTz} onBlur={() => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); prefs.set({ tz }); setMsg(null); } catch { setMsg('That time zone isn’t recognised (try e.g. America/Chicago).'); } }} autoCapitalize="none" />
        </Card>
      </Section>

      <Section title="Study time">
        <Card>
          <T variant="small" muted>About how much can you realistically study on a normal day? This shapes start dates and study plans.</T>
          <Row style={{ flexWrap: 'wrap' }}>
            {MINUTES.map((m) => <Chip key={m} label={`${m} min`} selected={p.dailyMinutes === m} onPress={() => prefs.set({ dailyMinutes: m })} />)}
          </Row>
          <T variant="small" muted>When do you usually study? Your daily flashcard plan for upcoming tests is sent then.</T>
          <Row style={{ flexWrap: 'wrap' }}>
            {STUDY_TIMES.map((t) => <Chip key={t.value} label={t.label} selected={p.studyTime === t.value} onPress={() => prefs.set({ studyTime: t.value })} />)}
          </Row>
        </Card>
      </Section>

      <Section title="Reminders">
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <T style={{ flex: 1 }}>Smart reminders</T>
            <Switch value={p.notificationsEnabled} onValueChange={toggleNotifications} />
          </Row>
          <T variant="small" muted>
            At most {DAILY_CAP} a day, ranked by how much your grade depends on them. Your daily study plan for upcoming tests
            (at your study time), start-date nudges, exam review sessions, closing late windows, and crunch-week heads-ups. Never
            streak reminders, never “you haven’t opened the app.”
          </T>
          {Platform.OS === 'web' ? (
            webPerm === 'granted' ? (
              <T variant="small" muted>In the web app, reminders pop up while the app is open in a browser tab.</T>
            ) : webPerm === 'default' ? (
              <Row style={{ flexWrap: 'wrap' }}>
                <T variant="small" muted style={{ flex: 1 }}>Let this browser show reminders while the app is open in a tab.</T>
                <Button title="Allow browser notifications" small variant="secondary" onPress={allowBrowser} />
              </Row>
            ) : webPerm === 'denied' ? (
              <T variant="small" muted>Notifications are blocked for this site in your browser settings.</T>
            ) : (
              <T variant="small" muted>This browser can't show reminders — they work in the phone app.</T>
            )
          ) : null}
          <T variant="small">{sem.notifications.length} planned over the next two weeks.</T>
        </Card>
      </Section>

      <Section title="Notes">
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <T style={{ flex: 1 }}>Quick-add "+" for sub-notes</T>
            <Switch value={p.subNoteQuickAddEnabled} onValueChange={(v) => prefs.set({ subNoteQuickAddEnabled: v })} />
          </Row>
          <T variant="small" muted>Shows a small + next to any note (in the list and while writing it) to spin off a sub-note under it.</T>

          {Platform.OS === 'web' ? (
            <>
              <Row style={{ justifyContent: 'space-between' }}>
                <T style={{ flex: 1 }}>Keyboard shortcut</T>
                <T variant="small" muted>{p.subNoteShortcutKey ? keyLabel(p.subNoteShortcutKey) : 'Off'}</T>
              </Row>
              <Row gap={8}>
                <Button title={capturingShortcut ? 'Press any key…' : 'Change shortcut'} small variant="secondary" onPress={() => setCapturingShortcut(true)} />
                {p.subNoteShortcutKey ? <Button title="Turn off" small variant="ghost" onPress={() => prefs.set({ subNoteShortcutKey: null })} /> : null}
              </Row>
              <T variant="small" muted>While writing a note, this key creates a new sub-note under it. Default is Tab.</T>
            </>
          ) : (
            <T variant="small" muted>The keyboard shortcut is available in the web app.</T>
          )}
        </Card>
      </Section>

      <Section title="Data">
        <Card>
          <SyncStatusPanel />
          {store.mode === 'local' ? (
            <>
              <Button title="Load sample semester" variant="secondary" onPress={() => { addSampleSemester(new Date()); router.replace('/'); }} />
              <Button title="Erase everything on this device" variant="danger" small onPress={resetLocal} />
            </>
          ) : (
            <Button title="Account & sign out" variant="secondary" onPress={() => router.push('/account')} />
          )}
        </Card>
      </Section>
      {msg ? <T variant="small" color="#B45309">{msg}</T> : null}
    </Screen>
  );
}
