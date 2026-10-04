import { col, clean } from '../config/db.js';
import { defaultSettings } from './defaults.js';
import type { SettingsDoc } from '../types.js';

let cache: { value: Omit<SettingsDoc, '_id'>; at: number } | null = null;

export async function getSettings(): Promise<Omit<SettingsDoc, '_id'>> {
  if (cache && Date.now() - cache.at < 15_000) return cache.value;
  const found = await col.settings().findOne({ id: 'main' });
  let value: Omit<SettingsDoc, '_id'>;
  if (found) value = clean(found);
  else {
    const d = defaultSettings();
    await col.settings().insertOne(d);
    value = d;
  }
  cache = { value, at: Date.now() };
  return cache.value;
}

export async function updateSettings(patch: Partial<SettingsDoc>) {
  const current = await getSettings();
  const next = { ...current, ...patch, id: 'main' as const };
  await col.settings().replaceOne({ id: 'main' }, next, { upsert: true });
  cache = null;
  return next;
}

export const invalidateSettings = () => (cache = null);
