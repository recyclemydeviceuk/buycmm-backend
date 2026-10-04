// Product reads for both the storefront and admin. The catalogue is small (tens of models), so filtering and
// facets run in memory on a short-lived cache, which keeps the semantics identical to the storefront's mock.
import { col, cleanAll } from '../config/db.js';
import { storageIndex, CONDITIONS, CONDITION_LABEL, type Condition } from '../lib/format.js';
import { nowIso } from '../lib/ids.js';
import type { ProductDoc, PublicProduct } from '../types.js';
import { getSettings } from './settings.js';

let cache: { items: Array<Omit<ProductDoc, '_id'>>; at: number } | null = null;

export async function allProducts(): Promise<Array<Omit<ProductDoc, '_id'>>> {
  if (cache && Date.now() - cache.at < 10_000) return cache.items;
  const items = cleanAll(await col.products().find({}).toArray());
  cache = { items, at: Date.now() };
  return items;
}
export const invalidateCatalog = () => (cache = null);

export async function activeProducts() {
  return (await allProducts()).filter((p) => p.status === 'active');
}

export function toPublic(p: Omit<ProductDoc, '_id'>): PublicProduct {
  const { status: _s, featured: _f, description: _d, createdAt: _c, updatedAt: _u, ...rest } = p;
  return rest;
}

/** Recomputes derived fields after a variant change. */
export async function normalise(p: ProductDoc): Promise<ProductDoc> {
  const settings = await getSettings();
  const inStock = p.variants.filter((v) => v.stock > 0);
  p.fromPrice = inStock.length ? Math.min(...inStock.map((v) => v.price)) : p.variants.length ? Math.min(...p.variants.map((v) => v.price)) : 0;
  p.storages = [...new Set(p.variants.map((v) => v.storage))].sort((a, b) => storageIndex(a) - storageIndex(b));
  p.networks = [...new Set(p.variants.map((v) => v.network))].sort((a, b) => settings.networks.indexOf(a) - settings.networks.indexOf(b));
  p.updatedAt = nowIso();
  return p;
}

export interface ProductQuery {
  brand?: string[];
  series?: string[];
  network?: string[];
  condition?: string[];
  storage?: string[];
  minPrice?: number;
  maxPrice?: number;
  search?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

const inStock = (p: PublicProduct) => p.variants.filter((v) => v.stock > 0);

function matches(p: PublicProduct, q: ProductQuery): boolean {
  if (q.brand?.length && !q.brand.includes(p.brand)) return false;
  if (q.series?.length && !q.series.includes(p.series)) return false;
  if (q.search) {
    const s = q.search.toLowerCase();
    if (!`${p.brand} ${p.name} ${p.series}`.toLowerCase().includes(s)) return false;
  }
  return inStock(p).some(
    (v) =>
      (!q.network?.length || q.network.includes(v.network)) &&
      (!q.condition?.length || q.condition.includes(v.condition)) &&
      (!q.storage?.length || q.storage.includes(v.storage)) &&
      (q.minPrice === undefined || v.price >= q.minPrice) &&
      (q.maxPrice === undefined || v.price <= q.maxPrice),
  );
}

function priceFor(p: PublicProduct, q: ProductQuery): number {
  const vs = inStock(p).filter((v) => (!q.network?.length || q.network.includes(v.network)) && (!q.condition?.length || q.condition.includes(v.condition)) && (!q.storage?.length || q.storage.includes(v.storage)));
  return vs.length ? Math.min(...vs.map((v) => v.price)) : p.fromPrice;
}

function sortProducts(items: PublicProduct[], q: ProductQuery): PublicProduct[] {
  const arr = [...items];
  switch (q.sort) {
    case 'price-asc': return arr.sort((a, b) => priceFor(a, q) - priceFor(b, q));
    case 'price-desc': return arr.sort((a, b) => priceFor(b, q) - priceFor(a, q));
    case 'newest': return arr.sort((a, b) => b.releaseYear - a.releaseYear || b.rrp - a.rrp);
    default: return arr.sort((a, b) => b.reviewCount * b.rating - a.reviewCount * a.rating);
  }
}

export async function listPublicProducts(q: ProductQuery) {
  const items = (await activeProducts()).map(toPublic);
  const filtered = sortProducts(items.filter((p) => matches(p, q)), q).map((p) => ({ ...p, fromPrice: priceFor(p, q) }));
  const pageSize = Math.min(100, q.pageSize ?? 24);
  const page = Math.max(1, q.page ?? 1);
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
}

function count<T extends string>(values: T[]): Map<T, number> {
  const m = new Map<T, number>();
  values.forEach((v) => m.set(v, (m.get(v) ?? 0) + 1));
  return m;
}

export async function facets(q: ProductQuery) {
  const all = (await activeProducts()).map(toPublic);
  const settings = await getSettings();
  const base = all.filter((p) => matches(p, { ...q, brand: undefined, series: undefined }));
  const brandCounts = count(base.map((p) => p.brand));
  const seriesCounts = count(all.filter((p) => matches(p, { ...q, series: undefined })).map((p) => p.series));
  const scope = all.filter((p) => matches(p, { ...q, network: undefined, condition: undefined, storage: undefined, minPrice: undefined, maxPrice: undefined }));
  const distinct = <T extends string>(pick: (p: PublicProduct) => T[]) => count(scope.flatMap((p) => [...new Set(pick(p))]));
  const networkCounts = distinct((p) => inStock(p).map((v) => v.network));
  const conditionCounts = distinct((p) => inStock(p).map((v) => v.condition));
  const storageCounts = distinct((p) => inStock(p).map((v) => v.storage));
  const prices = scope.flatMap(inStock).map((v) => v.price);
  return {
    brands: [...brandCounts].map(([value, c]) => ({ value, label: value, count: c })),
    series: [...seriesCounts].map(([value, c]) => ({ value, label: value, count: c })).sort((a, b) => a.label.localeCompare(b.label)),
    networks: settings.networks.filter((n) => networkCounts.has(n)).map((value) => ({ value, label: value, count: networkCounts.get(value) ?? 0 })),
    conditions: CONDITIONS.map((value) => ({ value, label: CONDITION_LABEL[value as Condition], count: conditionCounts.get(value) ?? 0 })),
    storages: [...storageCounts.keys()].sort((a, b) => storageIndex(a) - storageIndex(b)).map((value) => ({ value, label: value, count: storageCounts.get(value) ?? 0 })),
    priceRange: { min: prices.length ? Math.min(...prices) : 0, max: prices.length ? Math.max(...prices) : 0 },
  };
}

export async function featured(): Promise<PublicProduct[]> {
  const settings = await getSettings();
  const active = await activeProducts();
  return settings.featuredSlugs.map((s) => active.find((p) => p.slug === s)).filter((p): p is Omit<ProductDoc, '_id'> => !!p).map(toPublic);
}

export async function related(slug: string): Promise<PublicProduct[]> {
  const active = await activeProducts();
  const p = active.find((x) => x.slug === slug);
  if (!p) return [];
  return active.filter((x) => x.slug !== slug && x.series === p.series).sort((a, b) => Math.abs(a.fromPrice - p.fromPrice) - Math.abs(b.fromPrice - p.fromPrice)).slice(0, 4).map(toPublic);
}
