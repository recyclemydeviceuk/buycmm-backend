import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(8010),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CORS_ORIGIN: z.string().default('*'),
  STOREFRONT_URL: z.string().default('http://localhost:3003'),
  ADMIN_URL: z.string().default('http://localhost:3004'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  BUY_DB_NAME: z.string().default('buyupon'),
  SELL_DB_NAME: z.string().default('test'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRE: z.string().default('7d'),
  OTP_EXPIRY_MINUTES: z.coerce.number().default(10),
  BUY_ADMIN_EMAILS: z.string().default(''),
  BREVO_API_KEY: z.string().optional(),
  FROM_EMAIL_Brevo: z.string().default('info@cashmymobile.co.uk'),
  FROM_NAME_Brevo: z.string().default('Cash My Mobile'),
  SUPPORT_EMAIL: z.string().default('support@cashmymobile.co.uk'),
  ADMIN_NOTIFY_EMAIL: z.string().default('support@cashmymobile.co.uk'),
  PAYPAL_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  /** From the PayPal developer dashboard → your app → Webhooks. Without it webhooks are ignored. */
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(300),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;
const unquote = (s: string) => s.replace(/^"(.*)"$/, '$1');

export const env = {
  ...raw,
  FROM_NAME_Brevo: unquote(raw.FROM_NAME_Brevo),
  BUY_ADMIN_EMAILS: unquote(raw.BUY_ADMIN_EMAILS),
  corsOrigins: raw.CORS_ORIGIN === '*' ? '*' : raw.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
  adminEmails: [...new Set(unquote(raw.BUY_ADMIN_EMAILS).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))],
  paypalEnabled: !!(raw.PAYPAL_CLIENT_ID && raw.PAYPAL_CLIENT_SECRET),
  isProd: raw.NODE_ENV === 'production',
};

if (env.BUY_DB_NAME === env.SELL_DB_NAME) {
  console.error(`BUY_DB_NAME (${env.BUY_DB_NAME}) must not be the sell database. Refusing to start.`);
  process.exit(1);
}
