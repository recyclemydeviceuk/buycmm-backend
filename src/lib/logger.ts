import { env } from '../config/env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
const min = LEVELS[env.LOG_LEVEL];

function line(level: keyof typeof LEVELS, msg: string, meta?: Record<string, unknown>) {
  if (LEVELS[level] < min) return;
  const ts = new Date().toISOString();
  const extra = meta && Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  const out = `${ts} ${level.toUpperCase().padEnd(5)} ${msg}${extra}`;
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);
}

export const logger = {
  debug: (m: string, meta?: Record<string, unknown>) => line('debug', m, meta),
  info: (m: string, meta?: Record<string, unknown>) => line('info', m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => line('warn', m, meta),
  error: (m: string, meta?: Record<string, unknown>) => line('error', m, meta),
};
