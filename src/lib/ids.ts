import { randomBytes, randomInt } from 'node:crypto';

export const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
export const nowIso = () => new Date().toISOString();

/** CMM-YYMM-NNNNNN, matching the storefront's confirmation format. */
export function orderNumber(d = new Date()) {
  return `CMM-${d.getFullYear().toString().slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}-${randomInt(100000, 999999)}`;
}

export const otpCode = () => String(randomInt(100000, 999999));
export const norm = (s: string) => s.trim().toLowerCase();
export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
