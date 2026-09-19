import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { MIN_PASSWORD, initials, passwordProblems, passwordStrength } from '@/core/auth';
import {
  changePassword, currentAccount, deleteAccount, downloadMyData, friendlyAuthError, saveProfile, type AccountInfo,
} from '@/data/account';
import { leaveGuestMode, signOut } from '@/data/boot';
import { restartApp } from '@/data/session';
import { prefs, usePrefs } from '@/data/prefs';
import { store } from '@/data/store';
import { isSupabaseConfigured } from '@/data/supabase';
import { Button, Card, Field, Row, Screen, Section, T } from '@/ui/components';
import { ImportOffer } from '@/ui/ImportOffer';
import { useColors } from '@/ui/theme';

/** Who you are, how you sign in, and full control over your data (download it, or delete it all). */
export default function Account() {
  const c = useColors();
  const p = usePrefs();
  const signedIn = store.mode === 'supabase';
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [name, setName] = useState(p.studentName);
  const [tz, setTz] = useState(p.tz);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [danger, setDanger] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [dangerError, setDangerError] = useState<string | null>(null);

  useEffect(() => {
    if (signedIn) void currentAccount().then(setInfo).catch(() => {});
  }, [signedIn]);

  const displayName = (info?.name || p.studentName || '').trim();
  const label = signedIn ? info?.email ?? 'Signed in' : 'This device';

  const saveProfileNow = async () => {
    setBusy('profile');
    setProfileMsg(null);
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz }); // throws on a bad zone
      await saveProfile({ name, timezone: tz });
      setProfileMsg('Saved.');
    } catch (e) {
      setProfileMsg(e instanceof RangeError ? 'That time zone isn’t recognised (try e.g. America/Chicago).' : friendlyAuthError(e));
    } finally {
      setBusy(null);
    }
  };

  const pwProblems = pw ? passwordProblems(pw) : [];
  const strength = passwordStrength(pw);
  const changePw = async () => {
    setBusy('pw');
    setPwMsg(null);
    try {
      await changePassword(pw);
      setPw('');
      setPw2('');
      setPwMsg({ ok: true, text: 'Password updated.' });
    } catch (e) {
      setPwMsg({ ok: false, text: friendlyAuthError(e) });
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    setBusy('download');
    try {
      await downloadMyData();
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async () => {
    setBusy('delete');
    setDangerError(null);
    try {
      await deleteAccount();
      prefs.set({ guest: false, localImport: 'pending' });
      store.reset();
      restartApp();
    } catch (e) {
      setDangerError(friendlyAuthError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen contentStyle={{ width: '100%', maxWidth: 640, alignSelf: 'center' }}>
      {/* ---------------- who ---------------- */}
      <Card>
        <Row gap={14}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <T variant="heading" color={c.primary}>{initials(displayName || info?.email || 'Me')}</T>
          </View>
          <View style={{ flex: 1 }}>
            <T variant="heading">{displayName || (signedIn ? 'Your account' : 'No account')}</T>
            <T variant="small" muted numberOfLines={1}>{label}</T>
          </View>
        </Row>
        {!signedIn ? (
          <T variant="small" muted>
            {isSupabaseConfigured
              ? 'You are using the app without an account, so everything lives on this device only. Create an account to sync across devices and keep a backup.'
              : 'Accounts need a backend that isn’t connected yet, so everything lives on this device only. See SETUP.md to turn accounts on.'}
          </T>
        ) : (
          <T variant="small" muted>Signed in — your semester syncs and is backed up.</T>
        )}
        {!signedIn && isSupabaseConfigured ? <Button title="Create an account or sign in" onPress={leaveGuestMode} /> : null}
      </Card>

      {signedIn ? <ImportOffer /> : null}

      {/* ---------------- profile ---------------- */}
      <Section title="Profile">
        <Card>
          <Field label="Your name" value={name} onChangeText={setName} placeholder="Alex" autoComplete="name" />
          <Field label="Time zone" value={tz} onChangeText={setTz} autoCapitalize="none" />
          <T variant="small" muted>Used for email drafts, and so “tomorrow” means tomorrow where you are.</T>
          <Row>
            <Button title="Save" small onPress={saveProfileNow} loading={busy === 'profile'} />
            {profileMsg ? <T variant="small" muted style={{ flex: 1 }}>{profileMsg}</T> : null}
          </Row>
        </Card>
      </Section>

      {/* ---------------- password ---------------- */}
      {signedIn ? (
        <Section title="Password">
          <Card>
            <T variant="small" muted>
              Set or change your password. If you signed in with an emailed code because you forgot it, this is where you set a new one.
            </T>
            <Field label="New password" value={pw} onChangeText={setPw} secureTextEntry autoCapitalize="none" autoComplete="new-password" placeholder={`At least ${MIN_PASSWORD} characters`} />
            <Field label="Type it again" value={pw2} onChangeText={setPw2} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
            {pw ? (
              <T variant="small" color={pwProblems.length ? c.warn : strength >= 3 ? c.good : c.muted}>
                {pwProblems[0] ?? ['', 'Weak', 'Okay', 'Strong'][strength]}
              </T>
            ) : null}
            {pw2 && pw !== pw2 ? <T variant="small" color={c.warn}>The two passwords don’t match.</T> : null}
            <Row>
              <Button title="Update password" small onPress={changePw} loading={busy === 'pw'} disabled={!pw || pwProblems.length > 0 || pw !== pw2} />
              {pwMsg ? <T variant="small" color={pwMsg.ok ? c.good : c.warn} style={{ flex: 1 }}>{pwMsg.text}</T> : null}
            </Row>
          </Card>
        </Section>
      ) : null}

      {/* ---------------- data ---------------- */}
      <Section title="Your data">
        <Card>
          <T variant="small" muted>Everything you’ve added — courses, notes, cards, grades — in one file you own.</T>
          <Button title="Download my data" variant="secondary" small onPress={download} loading={busy === 'download'} />
        </Card>
      </Section>

      {/* ---------------- session ---------------- */}
      {signedIn ? (
        <Button title="Sign out" variant="secondary" onPress={() => void signOut()} />
      ) : null}

      {/* ---------------- danger ---------------- */}
      {signedIn ? (
        <Section title="Danger zone">
          <Card>
            {!danger ? (
              <>
                <T variant="small" muted>Deleting your account permanently removes it and everything in it — courses, notes, cards, uploaded syllabi. This can’t be undone.</T>
                <Button title="Delete my account…" variant="danger" small onPress={() => setDanger(true)} />
              </>
            ) : (
              <>
                <T variant="body" style={{ fontWeight: '600' }}>This deletes everything, permanently.</T>
                <T variant="small" muted>Download your data first if you might want it. Type DELETE to confirm.</T>
                <Field value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" placeholder="DELETE" />
                {dangerError ? <T variant="small" color={c.warn}>{dangerError}</T> : null}
                <Row>
                  <Button title="Cancel" variant="secondary" small onPress={() => { setDanger(false); setConfirmText(''); setDangerError(null); }} style={{ flex: 1 }} />
                  <Button title="Delete forever" variant="danger" small onPress={doDelete} loading={busy === 'delete'} disabled={confirmText.trim() !== 'DELETE'} style={{ flex: 1 }} />
                </Row>
              </>
            )}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
