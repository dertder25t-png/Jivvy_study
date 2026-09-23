// Whether this device's changes are reaching the account. Being offline is normal and stays quiet;
// a change the server keeps refusing is not, so it's said out loud rather than failing silently.
import React, { useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { store, useSyncStatus } from '@/data/store';
import { useNow } from '@/data/derived';
import { relativeTime } from '@/core/time';
import { Button, Card, Row, T } from './components';

const changes = (n: number) => `${n} change${n === 1 ? '' : 's'}`;

/** Top-of-screen notice, shown only when changes are stuck (not merely waiting for a connection). */
export function SyncProblemBanner() {
  const s = useSyncStatus();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (s.mode !== 'supabase' || !s.error || s.pending === 0) return null;

  const retry = async () => {
    setBusy(true);
    try {
      await store.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card tone="warn">
      <T variant="heading">{changes(s.pending)} haven't reached your account yet</T>
      <T variant="small">They're safe on this device and will sync as soon as the server accepts them. Other devices won't see them until then.</T>
      <Row>
        <Button title="Try again" small onPress={retry} loading={busy} />
        <Button title="Details" small variant="ghost" onPress={() => router.push('/settings')} />
      </Row>
    </Card>
  );
}

/** The full picture, for Settings. */
export function SyncStatusPanel() {
  const s = useSyncStatus();
  const now = useNow();
  const [busy, setBusy] = useState(false);

  if (s.mode !== 'supabase') {
    return <T variant="small" muted>Demo mode — everything is stored on this device only.</T>;
  }

  const retry = async () => {
    setBusy(true);
    try {
      await store.refresh();
    } finally {
      setBusy(false);
    }
  };

  const skip = () => {
    const msg = 'The first waiting change will be thrown away so the rest can sync. It can’t be undone.';
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) void store.discardStuckWrite();
    } else {
      Alert.alert('Skip the stuck change?', msg, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Skip it', style: 'destructive', onPress: () => void store.discardStuckWrite() },
      ]);
    }
  };

  const checked = s.lastSyncedAt ? `Last checked ${relativeTime(new Date(s.lastSyncedAt), now)}.` : '';
  let line: string;
  if (s.error) line = `${changes(s.pending)} waiting — the server hasn't accepted them yet.`;
  else if (s.pending > 0) line = `${changes(s.pending)} waiting to sync (they'll go when you're back online).`;
  else line = 'Synced to your account — your other devices see the same thing.';

  return (
    <>
      <T variant="small" muted>{line} {checked}</T>
      {s.error ? <T variant="small" color="#B45309">Server said: {s.error}</T> : null}
      <Row>
        <Button title="Sync now" small variant="secondary" onPress={retry} loading={busy} />
        {s.error ? <Button title="Skip the stuck change" small variant="ghost" onPress={skip} /> : null}
      </Row>
    </>
  );
}
