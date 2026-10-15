// Gives every product its official colour list and one variant per storage × colour × grade.
//
//   npm run seed:colours            → dry run: prints what would change, writes nothing
//   npm run seed:colours -- --yes   → writes, after saving products to backups/
//
// Safe to run more than once. It never removes a colour that has stock, never changes the price or stock of an
// existing variant, and every variant it adds starts at stock 0 (set real stock per colour in the admin panel),
// priced like the same storage + grade already is.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Document } from 'mongodb';
import { connect, disconnect, getDb } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { CONDITIONS, storageIndex } from '../lib/format.js';
import { OFFICIAL_COLOURS } from '../data/official-colours.js';

const write = process.argv.includes('--yes');
const here = path.dirname(fileURLToPath(import.meta.url));

interface V { storage: string; colour: string; condition: string; price: number; stock: number }
interface C { name: string; hex: string; image: string }

await connect();
const db = getDb();
const products = await db.collection<Document>('products').find({}).toArray();

if (write) {
  const dir = path.resolve(here, '../../backups');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${env.BUY_DB_NAME}-before-official-colours-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ database: env.BUY_DB_NAME, takenAt: new Date().toISOString(), products }));
  logger.info('Backup written', { file, products: products.length });
}

const totals = { products: 0, changed: 0, unmatched: [] as string[], skipped: [] as string[], variantsAdded: 0 };
for (const p of products) {
  totals.products += 1;
  const official = OFFICIAL_COLOURS[p.name as string];
  if (!official) { totals.unmatched.push(String(p.name)); continue; }

  const before = (p.variants ?? []) as V[];
  const existing = (p.colours ?? []) as C[];
  // Colourless rows can only be replaced when they hold no stock.
  if (before.some((v) => v.colour === '' && v.stock > 0)) { totals.skipped.push(`${p.name} (colourless variant has stock)`); continue; }

  const colours: C[] = [...existing];
  for (const o of official) if (!colours.some((x) => x.name.toLowerCase() === o.name.toLowerCase())) colours.push({ name: o.name, hex: o.hex, image: '' });
  // Colours already in use by variants always stay valid.
  for (const v of before) if (v.colour && !colours.some((x) => x.name === v.colour)) colours.push({ name: v.colour, hex: '#9CA3AF', image: '' });

  const rows = before.filter((v) => v.colour !== '');
  const grid = new Map<string, V[]>();
  for (const v of before) grid.set(`${v.storage}|${v.condition}`, [...(grid.get(`${v.storage}|${v.condition}`) ?? []), v]);

  const variants: V[] = [...rows];
  for (const [key, group] of grid) {
    const [storage, condition] = key.split('|');
    const price = Math.min(...group.map((v) => v.price));
    for (const col of colours) {
      if (!variants.some((v) => v.storage === storage && v.colour === col.name && v.condition === condition)) variants.push({ storage, colour: col.name, condition, price, stock: 0 });
    }
  }
  variants.sort((a, b) => storageIndex(a.storage) - storageIndex(b.storage) || colours.findIndex((x) => x.name === a.colour) - colours.findIndex((x) => x.name === b.colour) || CONDITIONS.indexOf(a.condition as (typeof CONDITIONS)[number]) - CONDITIONS.indexOf(b.condition as (typeof CONDITIONS)[number]));

  const added = variants.length - rows.length;
  if (variants.length === before.length && colours.length === existing.length && !before.some((v) => v.colour === '')) continue;
  totals.changed += 1;
  totals.variantsAdded += Math.max(0, variants.length - before.length);
  if (write) await db.collection('products').updateOne({ _id: p._id }, { $set: { colours, variants, updatedAt: new Date().toISOString() } });
  logger.info(write ? 'Updated' : 'Would update', { product: p.name, colours: colours.length, variants: variants.length, added });
}

logger.info(write ? 'Colours applied' : 'Dry run (nothing written). Add --yes to apply', { database: env.BUY_DB_NAME, ...totals });
await disconnect();
