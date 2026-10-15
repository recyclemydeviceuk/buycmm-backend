import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
import { env } from './env.js';
import { logger } from '../lib/logger.js';
import type { ActivityDoc, AdminDoc, CustomerNoteDoc, EnquiryDoc, OrderDoc, OtpDoc, PaymentDoc, ProductDoc, ReviewDoc, RoleDoc, SettingsDoc, SubscriberDoc } from '../types.js';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connect(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000, maxPoolSize: 10 });
  await client.connect();
  db = client.db(env.BUY_DB_NAME);
  logger.info(`MongoDB connected`, { database: env.BUY_DB_NAME });
  await ensureIndexes(db);
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error('Database not connected');
  return db;
}

/** Read-only handle on the sell database (device images for the seed). Never written to. */
export function sellDb(): Db {
  if (!client) throw new Error('Database not connected');
  return client.db(env.SELL_DB_NAME);
}

export async function disconnect() {
  await client?.close();
  client = null;
  db = null;
}

export const col = {
  products: () => getDb().collection<ProductDoc>('products'),
  orders: () => getDb().collection<OrderDoc>('orders'),
  reviews: () => getDb().collection<ReviewDoc>('reviews'),
  enquiries: () => getDb().collection<EnquiryDoc>('enquiries'),
  subscribers: () => getDb().collection<SubscriberDoc>('subscribers'),
  settings: () => getDb().collection<SettingsDoc>('settings'),
  admins: () => getDb().collection<AdminDoc>('admins'),
  roles: () => getDb().collection<RoleDoc>('roles'),
  otps: () => getDb().collection<OtpDoc>('otps'),
  activity: () => getDb().collection<ActivityDoc>('activity'),
  customerNotes: () => getDb().collection<CustomerNoteDoc>('customer_notes'),
  payments: () => getDb().collection<PaymentDoc>('payments'),
};

async function ensureIndexes(d: Db) {
  const idx = async <T extends Document>(c: Collection<T>, specs: Array<[Document, Document?]>) => {
    for (const [keys, opts] of specs) await c.createIndex(keys, opts ?? {});
  };
  await idx(d.collection('products'), [[{ slug: 1 }, { unique: true }], [{ status: 1, brand: 1 }], [{ updatedAt: -1 }]]);
  await idx(d.collection('orders'), [[{ orderNumber: 1 }, { unique: true }], [{ createdAt: -1 }], [{ 'customer.email': 1 }], [{ status: 1 }], [{ paymentRef: 1 }], [{ captureId: 1 }]]);
  await idx(d.collection('payments'), [[{ paypalOrderId: 1 }, { unique: true }], [{ id: 1 }, { unique: true }], [{ createdAt: -1 }]]);
  await idx(d.collection('reviews'), [[{ productId: 1, status: 1 }], [{ date: -1 }]]);
  await idx(d.collection('enquiries'), [[{ createdAt: -1 }], [{ status: 1 }]]);
  await idx(d.collection('subscribers'), [[{ email: 1 }, { unique: true }]]);
  await idx(d.collection('admins'), [[{ email: 1 }, { unique: true }]]);
  await idx(d.collection('otps'), [[{ email: 1 }], [{ expiresAt: 1 }, { expireAfterSeconds: 0 }]]);
  await idx(d.collection('activity'), [[{ at: -1 }]]);
}

/** Strip Mongo's _id so API responses match the contract shapes exactly. */
export function clean<T extends { _id?: unknown }>(doc: T): Omit<T, '_id'> {
  const { _id: _ignored, ...rest } = doc;
  return rest;
}
export const cleanAll = <T extends { _id?: unknown }>(docs: T[]) => docs.map(clean);
