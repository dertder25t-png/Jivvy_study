import React, { useState } from 'react';
import { friendlyAuthError, importLocalData, useLocalDataOffer } from '@/data/account';
import { prefs } from '@/data/prefs';
import { Button, Card, Row, T } from './components';

/** After signing in on a device that already holds data: offer to bring it into the account. */
export function ImportOffer() {
  const offer = useLocalDataOffer();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (result) {
    return (
      <Card tone="good">
        <T variant="body">{result}</T>
        <Button title="Great" small variant="secondary" onPress={() => setResult(null)} />
      </Card>
    );
  }
  if (!offer) return null;

  const parts = [
    offer.courses ? `${offer.courses} course${offer.courses === 1 ? '' : 's'}` : null,
    offer.notes ? `${offer.notes} note${offer.notes === 1 ? '' : 's'}` : null,
    offer.cards ? `${offer.cards} card${offer.cards === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(', ');

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await importLocalData();
      setResult(`Done — moved ${r.imported} item${r.imported === 1 ? '' : 's'} into your account.${r.skipped ? ` (${r.skipped} skipped: duplicates or broken links.)` : ''}`);
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card tone="primary">
      <T variant="heading">Bring your data into your account?</T>
      <T variant="small">This device already has {parts}. Move it into your account so it syncs and is backed up.</T>
      {error ? <T variant="small" color="#B45309">{error}</T> : null}
      <Row>
        <Button title="Bring it over" small onPress={go} loading={busy} />
        <Button title="No thanks" small variant="ghost" onPress={() => prefs.set({ localImport: 'skipped' })} disabled={busy} />
      </Row>
    </Card>
  );
}
