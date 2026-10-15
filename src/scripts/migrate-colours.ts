// One-off migration to the colour model (October 2026). Safe to run more than once.
//   - networks are gone: each storage × grade keeps its Unlocked price; the EE / Vodafone / O2 / Three rows are dropped
//   - variants gain `colour` ('' until the product is given colours) and products gain `colours`
//   - settings gain the Premium grade and grade photos, and lose `networks`
//
//   npm run migrate:colours                → dry run: prints what would change, writes nothing
//   npm run migrate:colours -- --yes       → writes, after saving products + settings to backups/
//   add --zero-stock                       → also sets every variant's stock to 0
//   add --keep-legacy                      → keeps `network: 'Unlocked'` on variants and `networks` on products/settings so an
//                                            API and storefront that have not been redeployed yet keep working. After the new
//                                            code is live, run again without it to remove them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Document } from 'mongodb';
import { connect, disconnect, getDb } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { CONDITIONS, storageIndex } from '../lib/format.js';
import { defaultConditions } from '../services/defaults.js';

const flags = new Set(process.argv.slice(2));
const write = flags.has('--yes');
const zeroStock = flags.has('--zero-stock');
const keepLegacy = flags.has('--keep-legacy');
const here = path.dirname(fileURLToPath(import.meta.url));

interface OldVariant { storage: string; network?: string; colour?: string; condition: string; price: number; stock: number }

/** One row per storage × colour × grade: the Unlocked one where networks still exist, otherwise the cheapest. */
function collapse(variants: OldVariant[]): OldVariant[] {
  const groups = new Map<string, OldVariant[]>();
  for (const v of variants) {
    const k = `${v.storage}|${v.colour ?? ''}|${v.condition}`;
    groups.set(k, [...(groups.get(k) ?? []), v]);
  }
  return [...groups.values()].map((g) => g.find((v) => v.network === 'Unlocked') ?? [...g].sort((a, b) => a.price - b.price)[0]);
}

await connect();
const db = getDb();
const products = await db.collection<Document>('products').find({}).toArray();
const settings = await db.collection<Document>('settings').findOne({ id: 'main' });

if (write) {
  const dir = path.resolve(here, '../../backups');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${env.BUY_DB_NAME}-before-colours-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ database: env.BUY_DB_NAME, takenAt: new Date().toISOString(), products, settings }));
  logger.info('Backup written', { file, products: products.length });
}

const totals = { products: 0, variantsBefore: 0, variantsAfter: 0, unitsBefore: 0, unitsAfter: 0, changed: 0 };
for (const p of products) {
  const before = (p.variants ?? []) as OldVariant[];
  const variants = collapse(before)
    .map((v) => ({ storage: v.storage, ...(keepLegacy ? { network: 'Unlocked' } : {}), colour: v.colour ?? '', condition: v.condition, price: v.price, stock: zeroStock ? 0 : v.stock }))
    .sort((a, b) => storageIndex(a.storage) - storageIndex(b.storage) || a.colour.localeCompare(b.colour) || CONDITIONS.indexOf(a.condition as (typeof CONDITIONS)[number]) - CONDITIONS.indexOf(b.condition as (typeof CONDITIONS)[number]));
  const inStock = variants.filter((v) => v.stock > 0);
  const set: Document = {
    variants,
    colours: p.colours ?? [],
    storages: [...new Set(variants.map((v) => v.storage))],
    fromPrice: inStock.length ? Math.min(...inStock.map((v) => v.price)) : variants.length ? Math.min(...variants.map((v) => v.price)) : 0,
  };
  if (keepLegacy) set.networks = ['Unlocked'];
  const changed = JSON.stringify({ variants: before, colours: p.colours, storages: p.storages, fromPrice: p.fromPrice, networks: p.networks }) !== JSON.stringify({ ...set, networks: keepLegacy ? ['Unlocked'] : undefined });
  totals.products += 1;
  totals.variantsBefore += before.length;
  totals.variantsAfter += variants.length;
  totals.unitsBefore += before.reduce((s, v) => s + v.stock, 0);
  totals.unitsAfter += variants.reduce((s, v) => s + v.stock, 0);
  if (!changed) continue;
  totals.changed += 1;
  if (write) await db.collection('products').updateOne({ _id: p._id }, { $set: { ...set, updatedAt: new Date().toISOString() }, ...(keepLegacy ? {} : { $unset: { networks: '' } }) });
}

let settingsChange = 'none';
if (settings) {
  const saved = (settings.conditions ?? []) as Array<{ key: string; images?: unknown[] }>;
  const conditions = CONDITIONS.map((key) => {
    const s = saved.find((c) => c.key === key);
    return s ? { ...s, images: s.images ?? [] } : defaultConditions().find((c) => c.key === key)!;
  });
  const addsPremium = !saved.some((c) => c.key === 'premium');
  const dropsNetworks = !keepLegacy && settings.networks !== undefined;
  if (addsPremium || dropsNetworks || JSON.stringify(conditions) !== JSON.stringify(saved)) {
    settingsChange = [addsPremium && 'adds the Premium grade', JSON.stringify(conditions) !== JSON.stringify(saved) && !addsPremium && 'adds grade photo lists', dropsNetworks && 'removes networks'].filter(Boolean).join(', ');
    if (write) await db.collection('settings').updateOne({ id: 'main' }, { $set: { conditions }, ...(dropsNetworks ? { $unset: { networks: '' } } : {}) });
  }
}

logger.info(write ? 'Migration applied' : 'Dry run (nothing written). Add --yes to apply', { database: env.BUY_DB_NAME, zeroStock, keepLegacy, ...totals, settings: settingsChange });
await disconnect();
