import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { publicRouter } from './routes/public/index.js';
import { adminRouter } from './routes/admin/index.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.corsOrigins === '*' ? true : env.corsOrigins, credentials: false, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
  app.use(express.json({ limit: '1mb' }));
  app.use(rateLimit({ windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX_REQUESTS, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many requests, please slow down.' } }));

  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      if (req.path === '/health') return;
      logger.debug(`${req.method} ${req.originalUrl} ${res.statusCode}`, { ms: Date.now() - started });
    });
    next();
  });

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'buyupon-backend', env: env.NODE_ENV, time: new Date().toISOString() }));
  app.use('/api/buy/admin', adminRouter);
  app.use('/api/buy', publicRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
