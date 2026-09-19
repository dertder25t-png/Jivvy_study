import { useColorScheme } from 'react-native';

// Calm on purpose: warm neutrals, one indigo accent, amber for "look at this".
// There is deliberately no alarm-red for overdue work (design rule: never punish).
export interface Colors {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  primarySoft: string;
  onPrimary: string;
  good: string;
  goodSoft: string;
  warn: string;
  warnSoft: string;
  danger: string;
}

const light: Colors = {
  bg: '#F7F6F3',
  surface: '#FFFFFF',
  surfaceAlt: '#F0EEE9',
  text: '#1C1B1A',
  muted: '#6B6862',
  border: '#E7E4DE',
  primary: '#4F46E5',
  primarySoft: '#ECEBFD',
  onPrimary: '#FFFFFF',
  good: '#047857',
  goodSoft: '#DCFCE7',
  warn: '#B45309',
  warnSoft: '#FEF3C7',
  danger: '#B91C1C',
};

const dark: Colors = {
  bg: '#141413',
  surface: '#1F1E1C',
  surfaceAlt: '#2A2825',
  text: '#F2F0EC',
  muted: '#A29E96',
  border: '#33312D',
  primary: '#8B93FF',
  primarySoft: '#2A2C52',
  onPrimary: '#12122B',
  good: '#34D399',
  goodSoft: '#12332A',
  warn: '#FBBF24',
  warnSoft: '#3A2E10',
  danger: '#F87171',
};

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
