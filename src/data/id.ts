import { randomUUID } from 'expo-crypto';

export const newId = (): string => randomUUID();
export const nowIso = (): string => new Date().toISOString();
