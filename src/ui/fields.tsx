import React, { useEffect, useState } from 'react';
import { Field } from './components';

/** Keeps the user's in-progress text locally; only commits once it's a complete, valid value. */
export function DateField({ value, onCommit, placeholder }: { value: string; onCommit: (ymd: string) => void; placeholder?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Field
      value={text}
      placeholder={placeholder}
      autoCapitalize="none"
      style={{ width: 130 }}
      onChangeText={(v) => {
        setText(v);
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) onCommit(v);
      }}
    />
  );
}

/** A 0–100 number that tolerates half-typed input ("32." stays "32."). `value` is shown as given. */
export function NumberField({
  value, onCommit, width = 80, placeholder,
}: { value: number | null; onCommit: (n: number) => void; width?: number; placeholder?: string }) {
  const [text, setText] = useState(value == null ? '' : String(Math.round(value * 10) / 10));
  return (
    <Field
      value={text}
      placeholder={placeholder}
      keyboardType="decimal-pad"
      style={{ width, textAlign: 'right' }}
      onChangeText={(v) => {
        setText(v);
        const num = Number(v);
        if (v.trim() !== '' && !Number.isNaN(num)) onCommit(num);
      }}
    />
  );
}

/** Fraction (0.25) shown and edited as a percent (25). */
export function PercentField({ value, onCommit }: { value: number; onCommit: (pct: number) => void }) {
  return <NumberField value={Math.round(value * 1000) / 10} onCommit={onCommit} />;
}

/** Text that only commits when you leave the field, so typing never fights a re-render. */
export function CommitText({
  value, onCommit, placeholder, width,
}: { value: string; onCommit: (v: string) => void; placeholder?: string; width?: number }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Field
      value={text}
      placeholder={placeholder}
      onChangeText={setText}
      onBlur={() => text.trim() !== value && text.trim() !== '' && onCommit(text.trim())}
      style={width ? { width } : undefined}
    />
  );
}
