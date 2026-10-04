import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { badRequest } from './errors.js';

export type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown;

/** Wraps an async route so rejections reach the error handler. */
export const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res, next)).catch(next);

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`);
    throw badRequest(issues[0] ?? 'Invalid request', issues);
  }
  return r.data;
}

/** Query-string helpers: repeated keys become arrays, numbers are coerced. */
export const qs = {
  str: (v: unknown): string | undefined => (typeof v === 'string' && v !== '' && v !== 'all' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined),
  raw: (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined),
  list: (v: unknown): string[] | undefined => (v === undefined || v === '' ? undefined : Array.isArray(v) ? (v as string[]).map(String) : [String(v)]),
  num: (v: unknown): number | undefined => {
    const n = Number(v);
    return v === undefined || v === '' || !Number.isFinite(n) ? undefined : n;
  },
  bool: (v: unknown): boolean | undefined => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : undefined),
};

export function paginate<T>(items: T[], page = 1, pageSize = 25) {
  const p = Math.max(1, Math.floor(page));
  const s = Math.min(10000, Math.max(1, Math.floor(pageSize)));
  return { items: items.slice((p - 1) * s, p * s), total: items.length, page: p, pageSize: s };
}

export const hit = (haystack: string, needle: string) => haystack.toLowerCase().includes(needle.toLowerCase().trim());
