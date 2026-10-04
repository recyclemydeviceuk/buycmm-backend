import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ message: 'Not found.' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    if (err.status >= 500) logger.error(err.message, { path: req.path });
    return res.status(err.status).json({ message: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  const anyErr = err as { type?: string; status?: number; message?: string };
  if (anyErr?.type === 'entity.parse.failed') return res.status(400).json({ message: 'Malformed JSON body.' });
  logger.error('Unhandled error', { path: req.path, error: anyErr?.message ?? String(err) });
  res.status(500).json({ message: 'Something went wrong on our side.' });
}
