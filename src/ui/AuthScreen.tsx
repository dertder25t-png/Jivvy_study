import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { MIN_PASSWORD, isValidEmail, passwordProblems, passwordStrength } from '@/core/auth';
import {
  friendlyAuthError, resendSignupCode, sendSignInCode, signInWithPassword, signUpWithPassword, verifyCode,
  type CodeKind,
} from '@/data/account';
import { prefs } from '@/data/prefs';
import { Button, Card, Chip, Field, Row, Screen, T } from './components';
import { useColors } from './theme';

type Tab = 'signin' | 'signup';

/**
 * Sign in / create account. Email + password, or a one-time emailed code (which is also the way back
 * in after forgetting a password). "Use without an account" keeps everything on this device.
 */
export function AuthScreen({ onGuest }: { onGuest?: () => void }) {
  const c = useColors();
  const [tab, setTab] = useState<Tab>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [verifying, setVerifying] = useState<null | { kind: CodeKind; note: string }>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const emailOk = isValidEmail(email);
  const problems = tab === 'signup' ? passwordProblems(password) : [];
  const strength = passwordStrength(password);

  const submit = () =>
    run(async () => {
      if (!emailOk) throw new Error('Enter a valid email address.');
      if (tab === 'signin') {
        if (!password) throw new Error('Enter your password.');
        await signInWithPassword(email, password);
        prefs.set({ guest: false });
        return; // the auth listener restarts the app into your account
      }
      if (problems.length > 0) throw new Error(problems[0]);
      const result = await signUpWithPassword({ email, password, name });
      prefs.set({ guest: false });
      if (result === 'needs_code') {
        setVerifying({ kind: 'signup', note: 'We emailed you a code to confirm your address.' });
        setCooldown(30);
      }
    });

  const emailCode = (note: string) =>
    run(async () => {
      if (!emailOk) throw new Error('Enter your email address first.');
      await sendSignInCode(email);
      setVerifying({ kind: 'email', note });
      setCooldown(30);
    });

  const submitCode = () =>
    run(async () => {
      if (code.replace(/\s/g, '').length < 6) throw new Error('Enter the code from the email.');
      await verifyCode(email, code, verifying!.kind);
      prefs.set({ guest: false });
    });

  const resend = () =>
    run(async () => {
      if (verifying?.kind === 'signup') await resendSignupCode(email);
      else await sendSignInCode(email);
      setCooldown(30);
    });

  const strengthColor = strength >= 3 ? c.good : strength === 2 ? c.warn : c.muted;

  return (
    <Screen contentStyle={{ width: '100%', maxWidth: 460, alignSelf: 'center' }}>
      <View style={{ height: 32 }} />
      <T variant="big">Your semester,{'\n'}already built.</T>

      {verifying ? (
        <>
          <Card tone="primary">
            <T variant="heading">Check your email</T>
            <T variant="small">{verifying.note} It was sent to {email.trim()}.</T>
            {verifying.kind === 'email' ? (
              <T variant="small" muted>If you're resetting a forgotten password: sign in with the code, then set a new password under More → Account.</T>
            ) : null}
          </Card>
          <Field label="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="123456" autoFocus autoComplete="one-time-code" />
          <Button title="Continue" onPress={submitCode} loading={busy} disabled={code.replace(/\s/g, '').length < 6} />
          <Row style={{ justifyContent: 'space-between' }}>
            <Button title="Use a different email" variant="ghost" small onPress={() => { setVerifying(null); setCode(''); setError(null); }} />
            <Button title={cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'} variant="ghost" small onPress={resend} disabled={cooldown > 0 || busy} />
          </Row>
        </>
      ) : (
        <>
          <Row>
            <Chip label="Sign in" selected={tab === 'signin'} onPress={() => { setTab('signin'); setError(null); }} />
            <Chip label="Create account" selected={tab === 'signup'} onPress={() => { setTab('signup'); setError(null); }} />
          </Row>

          {tab === 'signup' ? <Field label="Your name (optional)" value={name} onChangeText={setName} autoComplete="name" placeholder="Alex" /> : null}
          <Field
            label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email"
            keyboardType="email-address" placeholder="you@school.edu"
          />
          <View style={{ gap: 4 }}>
            <Field
              label="Password" value={password} onChangeText={setPassword} secureTextEntry={!showPw} autoCapitalize="none"
              autoComplete={tab === 'signup' ? 'new-password' : 'current-password'} placeholder={tab === 'signup' ? `At least ${MIN_PASSWORD} characters` : 'Your password'}
              onSubmitEditing={submit}
            />
            <Row style={{ justifyContent: 'space-between' }}>
              <Pressable onPress={() => setShowPw((v) => !v)} accessibilityRole="button">
                <T variant="small" color={c.primary}>{showPw ? 'Hide password' : 'Show password'}</T>
              </Pressable>
              {tab === 'signup' && password ? (
                <T variant="small" color={strengthColor}>{['', 'Weak', 'Okay', 'Strong'][strength]}</T>
              ) : null}
            </Row>
            {tab === 'signup' && password && problems.length > 0 ? <T variant="small" color={c.warn}>{problems[0]}</T> : null}
          </View>

          <Button
            title={tab === 'signin' ? 'Sign in' : 'Create account'}
            onPress={submit}
            loading={busy}
            disabled={!emailOk || !password || (tab === 'signup' && problems.length > 0)}
          />

          {tab === 'signin' ? (
            <Row style={{ flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <Button title="Forgot password?" variant="ghost" small onPress={() => emailCode('We emailed you a sign-in code.')} disabled={busy} />
              <Button title="Email me a code instead" variant="ghost" small onPress={() => emailCode('We emailed you a sign-in code.')} disabled={busy} />
            </Row>
          ) : (
            <T variant="small" muted>By creating an account you keep your semester in sync across devices. You can download or delete everything anytime.</T>
          )}
        </>
      )}

      {error ? (
        <Card tone="warn">
          <T variant="small">{error}</T>
        </Card>
      ) : null}

      {onGuest && !verifying ? (
        <View style={{ gap: 6, marginTop: 8 }}>
          <Button title="Use without an account" variant="secondary" onPress={onGuest} />
          <T variant="small" muted style={{ textAlign: 'center' }}>
            Everything stays on this device only. You can create an account later and bring it with you.
          </T>
        </View>
      ) : null}
    </Screen>
  );
}
