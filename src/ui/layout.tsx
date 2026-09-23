// Responsive layout primitives. One set of screens, three shapes: phone (single column,
// bottom tabs), tablet (single column, wider gutters), desktop (sidebar nav + multi-column).
import React from 'react';
import { View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { space } from './theme';

export const BREAKPOINTS = { tablet: 768, desktop: 1024 };

/** Readable max width for page content on large screens. */
export const CONTENT_MAX_WIDTH = 1120;
export const SIDEBAR_WIDTH = 248;

export function useLayout() {
  const { width, height } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINTS.desktop;
  const isTablet = !isDesktop && width >= BREAKPOINTS.tablet;
  return { width, height, isDesktop, isTablet, isPhone: !isDesktop && !isTablet };
}

/** Main + side column on desktop; stacked (main first) everywhere else. */
export function Columns({
  main, side, sideWidth = 360, gap = space.xl, sideFirstOnMobile = false,
}: {
  main: React.ReactNode;
  side: React.ReactNode;
  sideWidth?: number;
  gap?: number;
  sideFirstOnMobile?: boolean;
}) {
  const { isDesktop } = useLayout();
  if (!isDesktop) {
    return (
      <View style={{ gap: space.lg }}>
        {sideFirstOnMobile ? side : main}
        {sideFirstOnMobile ? main : side}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap }}>
      <View style={{ flex: 1, minWidth: 0, gap: space.lg }}>{main}</View>
      <View style={{ width: sideWidth, gap: space.lg }}>{side}</View>
    </View>
  );
}

/** A true grid: as many equal columns as fit at `minItemWidth` (one on phones), last row not stretched. */
export function Grid({
  children, minItemWidth = 300, gap = space.md, style,
}: {
  children: React.ReactNode;
  minItemWidth?: number;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [width, setWidth] = React.useState(0);
  const cols = width > 0 ? Math.max(1, Math.floor((width + gap) / (minItemWidth + gap))) : 1;
  const itemWidth = width > 0 ? (width - gap * (cols - 1)) / cols : undefined;
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[{ flexDirection: 'row', flexWrap: 'wrap', gap }, style]}
    >
      {React.Children.toArray(children).map((child, i) => (
        <View key={i} style={itemWidth ? { width: itemWidth } : { width: '100%' }}>{child}</View>
      ))}
    </View>
  );
}
