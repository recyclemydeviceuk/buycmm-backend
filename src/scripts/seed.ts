// Seeds the buyupon database:
//   npm run seed        → products from src/data/catalogue.json (skips ones that already exist), with real device
//                         photos copied from the sell site's devices collection (read-only), plus roles, settings
//                         and owner admins. Ratings start at zero and grow from real approved reviews.
//   add --reset         → replaces existing products with the catalogue versions (admin edits to those products are lost).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { connect, disconnect, col, sellDb } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { bootstrap } from '../services/bootstrap.js';
import { normalise } from '../services/catalog.js';
import type { ProductDoc } from '../types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const flags = new Set(process.argv.slice(2));

function loadCatalogue(): Array<Omit<ProductDoc, 'status' | 'featured' | 'description' | 'createdAt' | 'updatedAt'>> {
  return JSON.parse(readFileSync(path.resolve(here, '../data/catalogue.json'), 'utf8'));
}

async function seedProducts() {
  const catalogue = loadCatalogue();
  // Real photos: match the sell site's devices by "Brand Name" (fullName) or name; fall back to the storefront's local copy.
  const devices = await sellDb().collection('devices').find({}, { projection: { brand: 1, name: 1, fullName: 1, imageUrl: 1 } }).toArray();
  // Names differ slightly between the two sites ("Galaxy S24 Plus" vs "Galaxy S24+", "A17 5G" vs "A17"), so compare a normalised key.
  const key = (s: string) => s.toLowerCase().replace(/\bplus\b/g, '+').replace(/\s*5g\b/g, '').replace(/\bapple\b|\bsamsung\b/g, '').replace(/[^a-z0-9+]/g, '');
  const byKey = new Map<string, string>();
  devices.forEach((d) => { if (typeof d.imageUrl === 'string' && d.imageUrl.startsWith('http')) { byKey.set(key(String(d.fullName ?? `${d.brand} ${d.name}`)), d.imageUrl); byKey.set(key(String(d.name)), d.imageUrl); } });
  const imageFor = (brand: string, name: string, fallback: string) => byKey.get(key(`${brand} ${name}`)) ?? byKey.get(key(name)) ?? `${env.STOREFRONT_URL}${fallback}`;
  const featured = (await col.settings().findOne({ id: 'main' }))?.featuredSlugs ?? [];
  let inserted = 0, replaced = 0, skipped = 0, matchedPhotos = 0;
  for (const p of catalogue) {
    const existing = await col.products().findOne({ slug: p.slug });
    if (existing && !flags.has('--reset')) { skipped += 1; continue; }
    const image = imageFor(p.brand, p.name, p.image);
    if (image.startsWith('https://')) matchedPhotos += 1;
    const doc = await normalise({ ...p, rating: existing?.rating ?? 0, reviewCount: existing?.reviewCount ?? 0, image, status: 'active', featured: featured.includes(p.slug), description: p.brand === 'Apple'
      ? 'Certified pre-owned, 40-point tested and graded by hand. Every iPhone is reset to factory settings, runs the latest supported iOS and ships with a cable, 12-month warranty and 30-day returns.'
      : 'Certified pre-owned, 40-point tested and graded by hand. Every Galaxy is factory reset, Knox-checked, unlocked where stated and ships with a USB-C cable, 12-month warranty and 30-day returns.', createdAt: existing?.createdAt ?? nowIso(), updatedAt: nowIso() });
    if (existing) { await col.products().replaceOne({ slug: p.slug }, doc); replaced += 1; } else { await col.products().insertOne(doc); inserted += 1; }
  }
  logger.info('Products seeded', { inserted, replaced, skipped, photosFromSellSite: matchedPhotos, catalogue: catalogue.length });
}

async function main() {
  await connect();
  await bootstrap();
  await seedProducts();
  const counts = { products: await col.products().countDocuments({}), orders: await col.orders().countDocuments({}), admins: await col.admins().countDocuments({}), roles: await col.roles().countDocuments({}) };
  logger.info('Seed complete', counts);
  await disconnect();
}
main().catch((e) => { logger.error('Seed failed', { error: String(e) }); process.exit(1); });
