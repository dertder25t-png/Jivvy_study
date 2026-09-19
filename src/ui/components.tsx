import React from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text as RNText, TextInput, View,
  type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, space, useColors } from './theme';

// ------------------------------------------------------------------ Screen
export function Screen({
  children, scroll = true, padded = true, footer, contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  footer?: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const pad = padded ? space.lg : 0;
  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[{ padding: pad, paddingBottom: pad + 24, gap: space.lg }, contentStyle]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, padding: pad, gap: space.lg }, contentStyle]}>{children}</View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: 0 }}>
      {body}
      {footer ? (
        <View style={{ padding: space.lg, paddingBottom: space.lg + insets.bottom,borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, backgroundColor: c.bg }}>
          {footer}
        </View>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Text
type Variant = 'title' | 'heading' | 'body' | 'small' | 'label' | 'big';

const VARIANTS: Record<Variant, TextStyle> = {
  big: { fontSize: 34, fontWeight: '700', letterSpacing: -0.5 },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 23 },
  small: { fontSize: 14, lineHeight: 20 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
};

export function T({
  variant = 'body', muted, color, style, ...rest
}: TextProps & { variant?: Variant; muted?: boolean; color?: string }) {
  const c = useColors();
  return (
    <RNText
      {...rest}
      style={[VARIANTS[variant], { color: color ?? (muted ? c.muted : c.text) }, style]}
    />
  );
}

// ------------------------------------------------------------------ Card
export function Card({
  children, style, onPress, tone = 'surface', accent,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  tone?: 'surface' | 'primary' | 'warn' | 'good' | 'alt';
  accent?: string;
}) {
  const c = useColors();
  const bg = { surface: c.surface, primary: c.primarySoft, warn: c.warnSoft, good: c.goodSoft, alt: c.surfaceAlt }[tone];
  const inner: StyleProp<ViewStyle> = [
    {
      backgroundColor: bg, borderRadius: radius.lg, padding: space.lg, gap: space.sm,
      borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
      borderLeftWidth: accent ? 4 : StyleSheet.hairlineWidth, borderLeftColor: accent ?? c.border,
    },
    style,
  ];
  if (!onPress) return <View style={inner}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [inner, pressed && { opacity: 0.75 }]} accessibilityRole="button">
      {children}
    </Pressable>
  );
}

// ------------------------------------------------------------------ Button
export function Button({
  title, onPress, variant = 'primary', small, disabled, loading, style, icon,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  small?: boolean;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: string;
}) {
  const c = useColors();
  const bg = variant === 'primary' ? c.primary : variant === 'secondary' ? c.surfaceAlt : 'transparent';
  const fg = variant === 'primary' ? c.onPrimary : variant === 'danger' ? c.danger : variant === 'ghost' ? c.primary : c.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          backgroundColor: bg, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
          flexDirection: 'row', gap: space.sm,
          paddingVertical: small ? 8 : 14, paddingHorizontal: small ? 12 : 18,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : null}
      <RNText style={{ color: fg, fontSize: small ? 14 : 16, fontWeight: '600' }}>
        {icon ? `${icon}  ` : ''}{title}
      </RNText>
    </Pressable>
  );
}

// ------------------------------------------------------------------ Chip / badge
export function Chip({
  label, selected, onPress, color, small,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
  small?: boolean;
}) {
  const c = useColors();
  const tint = color ?? c.primary;
  const body = (
    <View
      style={{
        paddingVertical: small ? 3 : 7, paddingHorizontal: small ? 8 : 12, borderRadius: radius.pill,
        backgroundColor: selected ? tint : c.surfaceAlt, borderWidth: StyleSheet.hairlineWidth,
        borderColor: selected ? tint : c.border,
      }}
    >
      <RNText style={{ color: selected ? c.onPrimary : c.text, fontSize: small ? 12 : 14, fontWeight: '500' }}>{label}</RNText>
    </View>
  );
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button">{body}</Pressable> : body;
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export function Badge({ label, tone = 'alt' }: { label: string; tone?: 'alt' | 'primary' | 'warn' | 'good' }) {
  const c = useColors();
  const bg = { alt: c.surfaceAlt, primary: c.primarySoft, warn: c.warnSoft, good: c.goodSoft }[tone];
  const fg = { alt: c.muted, primary: c.primary, warn: c.warn, good: c.good }[tone];
  return (
    <View style={{ backgroundColor: bg, paddingVertical: 2, paddingHorizontal: 8, borderRadius: radius.pill, alignSelf: 'flex-start' }}>
      <RNText style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{label}</RNText>
    </View>
  );
}

// ------------------------------------------------------------------ layout bits
export function Row({ children, style, gap = space.sm }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="label" muted>{title}</T>
        {right}
      </Row>
      {children}
    </View>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <View style={{ alignItems: 'center', padding: space.xl, gap: space.sm }}>
      <T variant="heading" style={{ textAlign: 'center' }}>{title}</T>
      {body ? <T variant="small" muted style={{ textAlign: 'center', maxWidth: 320 }}>{body}</T> : null}
      {action}
    </View>
  );
}

export function Field(props: TextInputProps & { label?: string }) {
  const c = useColors();
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: 4 }}>
      {label ? <T variant="label" muted>{label}</T> : null}
      <TextInput
        placeholderTextColor={c.muted}
        {...rest}
        style={[
          {
            backgroundColor: c.surface, color: c.text, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16,
          },
          rest.multiline ? { minHeight: 90, textAlignVertical: 'top' } : null,
          style,
        ]}
      />
    </View>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const c = useColors();
  return (
    <View style={{ height: 6, backgroundColor: c.surfaceAlt, borderRadius: 3, overflow: 'hidden' }}>
      <View style={{ height: 6, width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: color ?? c.primary }} />
    </View>
  );
}

export function Divider() {
  const c = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />;
}
