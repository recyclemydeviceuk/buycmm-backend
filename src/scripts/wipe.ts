// Deletes transactional data (orders, reviews, enquiries, subscribers, activity, customer notes, pending sign-in
// codes) from the buyupon database. Products, settings, roles and admins are kept. Run before go-live to clear test data.
//   npm run db:wipe -- --yes
import { connect, disconnect, col } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

if (!process.argv.includes('--yes')) {
  console.error('Refusing to wipe without --yes. This deletes every order, review, enquiry, subscriber and activity entry in ' + env.BUY_DB_NAME + '.');
  process.exit(1);
}
await connect();
const result: Record<string, number> = {};
for (const [name, c] of Object.entries({ orders: col.orders(), reviews: col.reviews(), enquiries: col.enquiries(), subscribers: col.subscribers(), activity: col.activity(), customerNotes: col.customerNotes(), otps: col.otps() })) {
  result[name] = (await c.deleteMany({})).deletedCount;
}
await col.products().updateMany({}, { $set: { rating: 0, reviewCount: 0 } });
logger.info('Wiped transactional data', result);
await disconnect();
