// Puts a batch of real stock on sale from a JSON file (see src/data/stock/ for examples):
//   { "featured": ["slug", …]?, "modelImages": { "slug": "https://…" }?, "gradePhotos": { "good": [{ "url": "…", "caption": "Body" }] }?,
//     "items": [{ "slug": "apple-iphone-17-pro-max", "colour": { "name": "Deep Blue", "hex": "#32374A", "image": "https://…" },
//                 "storage": "256GB", "condition": "excellent", "price": 980, "stock": 1 }] }
//
//   npm run stock:import -- src/data/stock/2026-10.json           → dry run
//   npm run stock:import -- src/data/stock/2026-10.json --yes     → writes
//
// Each item sets the price and stock of one storage × colour × grade cell. A colour the product does not have yet is added,
// and the product's other cells are copied to it at zero stock so the admin shows a full matrix for every colour.
// `modelImages` replaces a product's own photo (the one shown when no colour is in stock).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Document } from 'mongodb';
import { z } from 'zod';
import { connect, disconnect, getDb } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { CONDITIONS, CONDITION_LABEL, storageIndex, type Condition } from '../lib/format.js';
import { colourProblem } from '../services/catalog.js';
import type { Colour, Variant } from '../types.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const write = args.includes('--yes');
if (!file) {
  console.error('Usage: npm run stock:import -- <file.json> [--yes]');
  process.exit(1);
}

const photo = z.object({ url: z.string().min(1), caption: z.string().default('') });
const batch = z.object({
  featured: z.array(z.string()).optional(),
  modelImages: z.record(z.string().url()).optional(),
  gradePhotos: z.record(z.enum(CONDITIONS), z.array(photo)).optional(),
  items: z.array(z.object({
    slug: z.string().min(1),
    colour: z.object({ name: z.string().min(1), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/), image: z.string().default('') }),
    storage: z.string().regex(/^\d+(GB|TB)$/),
    condition: z.enum(CONDITIONS),
    price: z.number().int().positive(),
    stock: z.number().int().min(0),
  })),
}).parse(JSON.parse(readFileSync(path.resolve(file), 'utf8')));

type StoredVariant = Variant & { network?: string };
const order = (a: StoredVariant, b: StoredVariant, colours: Colour[]) =>
  storageIndex(a.storage) - storageIndex(b.storage) || colours.findIndex((c) => c.name === a.colour) - colours.findIndex((c) => c.name === b.colour) || CONDITIONS.indexOf(a.condition) - CONDITIONS.indexOf(b.condition);

await connect();
const db = getDb();
const now = new Date().toISOString();
const report: string[] = [];
// Nothing is written until the whole file has been checked, so a bad entry never leaves half a batch on sale.
const writes: Array<() => Promise<unknown>> = [];
let failed = false;

for (const slug of [...new Set(batch.items.map((i) => i.slug))]) {
  const p = await db.collection<Document>('products').findOne({ slug });
  if (!p) {
    report.push(`✗ ${slug}: no such product`);
    failed = true;
    continue;
  }
  const colours: Colour[] = [...((p.colours ?? []) as Colour[])];
  let variants = [...((p.variants ?? []) as StoredVariant[])];
  // Products that have not been redeployed past the network model keep `network: 'Unlocked'` on every variant.
  const legacy = variants.some((v) => v.network !== undefined);
  const make = (storage: string, colour: string, condition: Condition, price: number, stock: number): StoredVariant => ({ storage, ...(legacy ? { network: 'Unlocked' } : {}), colour, condition, price, stock });

  for (const item of batch.items.filter((i) => i.slug === slug)) {
    const known = colours.find((c) => c.name.toLowerCase() === item.colour.name.toLowerCase());
    if (known) Object.assign(known, { hex: item.colour.hex, image: item.colour.image || known.image });
    else {
      // Copy the price matrix to the new colour at zero stock: from the colourless rows the first time, then from the first colour.
      const template = variants.filter((v) => v.colour === (colours[0]?.name ?? ''));
      if (!colours.length) variants = variants.filter((v) => v.colour !== '');
      variants.push(...template.map((v) => make(v.storage, item.colour.name, v.condition, v.price, 0)));
      colours.push({ ...item.colour });
    }
    const name = colours.find((c) => c.name.toLowerCase() === item.colour.name.toLowerCase())!.name;
    const cell = variants.find((v) => v.storage === item.storage && v.colour === name && v.condition === item.condition);
    if (cell) Object.assign(cell, { price: item.price, stock: item.stock });
    else variants.push(make(item.storage, name, item.condition, item.price, item.stock));
    report.push(`✓ ${p.brand} ${p.name} · ${item.storage} · ${name} · ${CONDITION_LABEL[item.condition]} → £${item.price} × ${item.stock}`);
  }

  // Rows left without a colour (for example a save from an admin build that predates colours) cannot be sold or edited; drop them.
  const orphans = variants.filter((v) => !colours.some((c) => c.name === v.colour));
  if (orphans.length) {
    variants = variants.filter((v) => !orphans.includes(v));
    report.push(`  ${p.brand} ${p.name}: removed ${orphans.length} ${orphans.length === 1 ? 'row' : 'rows'} with no valid colour`);
  }
  variants.sort((a, b) => order(a, b, colours));
  const problem = colourProblem({ colours, variants });
  if (problem) {
    report.push(`✗ ${slug}: ${problem}`);
    failed = true;
    continue;
  }
  const inStock = variants.filter((v) => v.stock > 0);
  const image = batch.modelImages?.[slug];
  if (image) report.push(`  ${p.brand} ${p.name}: model photo → ${image.split('/').pop()}`);
  const set = { ...(image ? { image } : {}), colours, variants, storages: [...new Set(variants.map((v) => v.storage))], fromPrice: inStock.length ? Math.min(...inStock.map((v) => v.price)) : Math.min(...variants.map((v) => v.price)), status: 'active', updatedAt: now };
  writes.push(() => db.collection('products').updateOne({ _id: p._id }, { $set: set }));
}

if (batch.featured && !failed) {
  const missing = [];
  for (const s of batch.featured) if (!(await db.collection('products').findOne({ slug: s }))) missing.push(s);
  if (missing.length) {
    report.push(`✗ featured: unknown products ${missing.join(', ')}`);
    failed = true;
  } else {
    report.push(`✓ Featured on the home page: ${batch.featured.join(', ')}`);
    writes.push(() => db.collection('settings').updateOne({ id: 'main' }, { $set: { featuredSlugs: batch.featured } }));
    writes.push(() => db.collection('products').updateMany({}, [{ $set: { featured: { $in: ['$slug', batch.featured] } } }]));
  }
}

if (batch.gradePhotos && !failed) {
  const settings = await db.collection<Document>('settings').findOne({ id: 'main' });
  const conditions = ((settings?.conditions ?? []) as Array<{ key: Condition; images?: unknown[] }>).map((c) => (batch.gradePhotos![c.key] ? { ...c, images: batch.gradePhotos![c.key] } : c));
  const absent = Object.keys(batch.gradePhotos).filter((k) => !conditions.some((c) => c.key === k));
  if (absent.length) {
    report.push(`✗ gradePhotos: settings have no ${absent.join(', ')} grade yet. Run npm run migrate:colours first.`);
    failed = true;
  } else {
    Object.entries(batch.gradePhotos).forEach(([k, v]) => report.push(`✓ ${CONDITION_LABEL[k as Condition]} grade: ${v!.length} example ${v!.length === 1 ? 'photo' : 'photos'}`));
    writes.push(() => db.collection('settings').updateOne({ id: 'main' }, { $set: { conditions } }));
  }
}

report.forEach((l) => console.log(l));
if (write && !failed) for (const w of writes) await w();
if (failed) logger.error('Nothing was written. Fix the entries marked ✗ and run again.', { database: env.BUY_DB_NAME });
else logger.info(write ? 'Stock imported' : 'Dry run (nothing written). Add --yes to apply', { database: env.BUY_DB_NAME, items: batch.items.length });
await disconnect();
process.exit(failed ? 1 : 0);
