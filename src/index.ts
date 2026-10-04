import { env } from './config/env.js';
import { connect, disconnect } from './config/db.js';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';
import { bootstrap } from './services/bootstrap.js';

async function main() {
  await connect();
  await bootstrap();
  const app = createApp();
  const server = app.listen(env.PORT, () => logger.info(`BuyUpon API listening`, { port: env.PORT, env: env.NODE_ENV, paypal: env.paypalEnabled ? env.PAYPAL_MODE : 'not configured', email: env.BREVO_API_KEY ? 'brevo' : 'disabled' }));
  const stop = async () => {
    logger.info('Shutting down');
    server.close();
    await disconnect();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  logger.error('Failed to start', { error: String(e) });
  process.exit(1);
});
