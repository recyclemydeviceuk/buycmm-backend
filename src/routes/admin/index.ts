// Admin endpoints: /api/buy/admin/* — exactly what admin/src/api/http/adapter.ts calls. Every route checks a permission.
import { Router } from 'express';
import { z } from 'zod';
import { col, clean, cleanAll } from '../../config/db.js';
import { env } from '../../config/env.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { hit, paginate, parse, qs, wrap } from '../../lib/http.js';
import { norm, nowIso, uid, slugify } from '../../lib/ids.js';
import { CONDITIONS, ORDER_STATUSES, storageIndex, type Condition } from '../../lib/format.js';
import { ALL_PERMISSIONS, isPermission } from '../../lib/permissions.js';
import { sendEmail } from '../../lib/brevo.js';
import { emails } from '../../emails/templates.js';
import { actor, requireAdmin, requirePermission as perm } from '../../middleware/auth.js';
import { authRouter } from './auth.js';
import { logActivity } from '../../services/activity.js';
import { allProducts, colourProblem, invalidateCatalog, normalise } from '../../services/catalog.js';
import { customersFromOrders } from '../../services/customers.js';
import { dashboard } from '../../services/dashboard.js';
import { addNote, changeStatus, getOrder, refund, resendEmail, setTracking } from '../../services/orders.js';
import { getSettings, updateSettings } from '../../services/settings.js';
import type { OrderDoc, ProductDoc, RoleDoc, Variant } from '../../types.js';

export const adminRouter = Router();
adminRouter.use('/auth', authRouter);
adminRouter.use(requireAdmin);

const Q = (req: { query: unknown }) => req.query as Record<string, unknown>;
const page = (q: Record<string, unknown>, size = 25) => ({ page: qs.num(q.page) ?? 1, pageSize: Math.min(10000, qs.num(q.pageSize) ?? size) });

// ─── Dashboard & search ───────────────────────────────────────────────────────
adminRouter.get('/dashboard', perm('dashboard.view'), wrap(async (req, res) => {
  const r = qs.raw(Q(req).range);
  res.json(await dashboard(r === '7d' || r === '90d' ? r : '30d'));
}));

adminRouter.get('/search', perm('dashboard.view', 'orders.view', 'products.view', 'customers.view'), wrap(async (req, res) => {
  const t = (qs.raw(Q(req).q) ?? '').trim();
  if (!t) return res.json([]);
  const have = req.auth!.role.permissions;
  const hits: Array<{ type: string; id: string; title: string; subtitle: string; to: string }> = [];
  if (have.includes('orders.view')) {
    const rx = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const orders = await col.orders().find({ $or: [{ orderNumber: rx }, { 'customer.firstName': rx }, { 'customer.lastName': rx }, { 'customer.email': rx }, { paymentRef: rx }, { 'tracking.number': rx }] }).sort({ createdAt: -1 }).limit(5).toArray();
    orders.forEach((o) => hits.push({ type: 'order', id: o.orderNumber, title: o.orderNumber, subtitle: `${o.customer.firstName} ${o.customer.lastName} · £${o.total} · ${o.status}`, to: `/orders/${o.orderNumber}` }));
  }
  if (have.includes('products.view')) (await allProducts()).filter((p) => hit(`${p.brand} ${p.name} ${p.slug}`, t)).slice(0, 5).forEach((p) => hits.push({ type: 'product', id: p.id, title: `${p.brand} ${p.name}`, subtitle: `${p.variants.length} variants · from £${p.fromPrice} · ${p.status}`, to: `/products/${p.id}` }));
  if (have.includes('customers.view')) (await customersFromOrders()).filter((c) => hit(`${c.firstName} ${c.lastName} ${c.email}`, t)).slice(0, 4).forEach((c) => hits.push({ type: 'customer', id: c.id, title: `${c.firstName} ${c.lastName}`, subtitle: `${c.email} · ${c.orders} orders`, to: `/customers/${encodeURIComponent(c.id)}` }));
  if (have.includes('enquiries.manage')) (await col.enquiries().find({}).sort({ createdAt: -1 }).limit(200).toArray()).filter((e) => hit(`${e.name} ${e.email} ${e.message}`, t)).slice(0, 3).forEach((e) => hits.push({ type: 'enquiry', id: e.id, title: e.name, subtitle: e.message.slice(0, 70), to: `/enquiries?open=${e.id}` }));
  res.json(hits.slice(0, 14));
}));

// ─── Products ─────────────────────────────────────────────────────────────────
const variantSchema = z.object({ storage: z.string().min(1), colour: z.string().trim().max(60).default(''), condition: z.enum(CONDITIONS), price: z.number().min(0), stock: z.number().int().min(0) });
const colourSchema = z.object({ name: z.string().trim().min(1).max(60), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex colour, e.g. #1F2A44.'), image: z.string().trim().max(600).default('') });
const productInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/), brand: z.string().min(1), name: z.string().trim().min(1), series: z.string().min(1), releaseYear: z.number().int().min(2010).max(2035), image: z.string().min(1), rrp: z.number().min(0),
  status: z.enum(['active', 'draft', 'archived']), featured: z.boolean(), description: z.string().max(4000).default(''),
  specs: z.object({ display: z.string().default(''), chip: z.string().default(''), camera: z.string().default(''), battery: z.string().default(''), connectivity: z.string().default('') }),
  storages: z.array(z.string()), colours: z.array(colourSchema).max(24), variants: z.array(variantSchema), rating: z.number().min(0).max(5).optional(), reviewCount: z.number().int().min(0).optional(),
});
const totalStock = (p: ProductDoc) => p.variants.reduce((s, v) => s + v.stock, 0);

adminRouter.get('/products', perm('products.view'), wrap(async (req, res) => {
  const q = Q(req);
  const settings = await getSettings();
  const status = qs.raw(q.status);
  const stock = qs.raw(q.stock);
  const search = qs.raw(q.search);
  const brand = qs.raw(q.brand);
  const series = qs.raw(q.series);
  const featured = qs.bool(q.featured);
  let items = (await allProducts()).filter((p) => {
    if (status && status !== 'all' && p.status !== status) return false;
    if (!status && p.status === 'archived') return false;
    if (brand && p.brand !== brand) return false;
    if (series && p.series !== series) return false;
    if (featured !== undefined && p.featured !== featured) return false;
    if (search && !hit(`${p.brand} ${p.name} ${p.slug} ${p.series}`, search)) return false;
    if (stock) {
      const total = totalStock(p as ProductDoc);
      const lowc = p.variants.filter((v) => v.stock > 0 && v.stock <= settings.lowStockThreshold).length;
      if (stock === 'out' && total > 0) return false;
      if (stock === 'low' && !(total > 0 && lowc > 0)) return false;
      if (stock === 'in' && total === 0) return false;
    }
    return true;
  });
  const sort = qs.raw(q.sort) ?? 'newest';
  const sorters: Record<string, (a: ProductDoc, b: ProductDoc) => number> = {
    name: (a, b) => `${a.brand} ${a.name}`.localeCompare(`${b.brand} ${b.name}`), newest: (a, b) => b.releaseYear - a.releaseYear || b.rrp - a.rrp, 'price-asc': (a, b) => a.fromPrice - b.fromPrice, 'price-desc': (a, b) => b.fromPrice - a.fromPrice, stock: (a, b) => totalStock(a) - totalStock(b), updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  };
  items = [...items].sort((sorters[sort] ?? sorters.newest) as (a: Omit<ProductDoc, '_id'>, b: Omit<ProductDoc, '_id'>) => number);
  const { page: p, pageSize } = page(q);
  res.json(paginate(items, p, pageSize));
}));

adminRouter.get('/products/series', perm('products.view'), wrap(async (_req, res) => {
  const m = new Map<string, { brand: string; series: string; count: number }>();
  (await allProducts()).forEach((p) => { const k = `${p.brand}|${p.series}`; const e = m.get(k) ?? { brand: p.brand, series: p.series, count: 0 }; e.count += 1; m.set(k, e); });
  res.json([...m.values()].sort((a, b) => a.brand.localeCompare(b.brand) || a.series.localeCompare(b.series)));
}));

adminRouter.get('/products/:id', perm('products.view'), wrap(async (req, res) => {
  const p = await col.products().findOne({ $or: [{ id: req.params.id }, { slug: req.params.id }] });
  if (!p) throw notFound('Product not found.');
  res.json(clean(p));
}));

adminRouter.post('/products', perm('products.edit'), wrap(async (req, res) => {
  const input = parse(productInput, req.body);
  if (await col.products().findOne({ slug: input.slug })) throw conflict(`A product with the slug "${input.slug}" already exists.`);
  const doc = await normalise({ ...input, id: input.slug, rating: input.rating ?? 0, reviewCount: input.reviewCount ?? 0, fromPrice: 0, createdAt: nowIso(), updatedAt: nowIso() });
  const problem = colourProblem(doc);
  if (problem) throw badRequest(problem);
  await col.products().insertOne(doc);
  if (doc.featured) await updateSettings({ featuredSlugs: [...new Set([...(await getSettings()).featuredSlugs, doc.slug])] });
  invalidateCatalog();
  await logActivity(actor(req), 'Created product', `${doc.brand} ${doc.name}`, 'product', `${doc.variants.length} variants`);
  res.status(201).json(clean(doc));
}));

adminRouter.patch('/products/:id', perm('products.edit'), wrap(async (req, res) => {
  const patch = parse(productInput.partial(), req.body);
  const p = await col.products().findOne({ id: req.params.id });
  if (!p) throw notFound('Product not found.');
  if (patch.slug && patch.slug !== p.slug && (await col.products().findOne({ slug: patch.slug }))) throw conflict(`Slug "${patch.slug}" is already in use.`);
  const next = await normalise({ ...p, ...patch });
  const problem = colourProblem(next);
  if (problem) throw badRequest(problem);
  await col.products().replaceOne({ id: p.id }, next);
  if (patch.featured !== undefined || (patch.slug && patch.slug !== p.slug)) {
    const s = await getSettings();
    const without = s.featuredSlugs.filter((x) => x !== p.slug && x !== next.slug);
    await updateSettings({ featuredSlugs: next.featured ? [...without, next.slug] : without });
  }
  invalidateCatalog();
  const keys = Object.keys(patch);
  await logActivity(actor(req), keys.length === 1 && keys[0] === 'status' ? `Set product ${patch.status}` : keys.length === 1 && keys[0] === 'featured' ? (patch.featured ? 'Featured product' : 'Unfeatured product') : 'Updated product', `${next.brand} ${next.name}`, 'product', keys.join(', '));
  res.json(clean(next));
}));

adminRouter.delete('/products/:id', perm('products.delete'), wrap(async (req, res) => {
  const p = await col.products().findOne({ id: req.params.id });
  if (!p) return res.status(204).end();
  const sold = await col.orders().findOne({ 'lines.productId': p.id });
  if (sold) { await col.products().updateOne({ id: p.id }, { $set: { status: 'archived', featured: false, updatedAt: nowIso() } }); await logActivity(actor(req), 'Archived product (has orders)', `${p.brand} ${p.name}`, 'product'); }
  else { await col.products().deleteOne({ id: p.id }); await logActivity(actor(req), 'Deleted product', `${p.brand} ${p.name}`, 'product'); }
  const s = await getSettings();
  await updateSettings({ featuredSlugs: s.featuredSlugs.filter((x) => x !== p.slug) });
  invalidateCatalog();
  res.status(204).end();
}));

// ─── Variants & pricing ───────────────────────────────────────────────────────
adminRouter.get('/variants', perm('products.view'), wrap(async (req, res) => {
  const q = Q(req);
  const low = (await getSettings()).lowStockThreshold;
  const rows: Array<{ productId: string; productName: string; brand: string; slug: string; image: string; storage: string; colour: string; condition: Condition; price: number; stock: number; rrp: number }> = [];
  (await allProducts()).filter((p) => p.status !== 'archived').forEach((p) => p.variants.forEach((v) => rows.push({ productId: p.id, productName: `${p.brand} ${p.name}`, brand: p.brand, slug: p.slug, image: p.colours.find((c) => c.name === v.colour)?.image || p.image, storage: v.storage, colour: v.colour, condition: v.condition, price: v.price, stock: v.stock, rrp: p.rrp })));
  const summary = { inStock: rows.filter((r) => r.stock > low).length, low: rows.filter((r) => r.stock > 0 && r.stock <= low).length, out: rows.filter((r) => r.stock === 0).length, units: rows.reduce((s, r) => s + r.stock, 0), value: rows.reduce((s, r) => s + r.stock * r.price, 0) };
  const search = qs.raw(q.search); const brand = qs.raw(q.brand); const condition = qs.raw(q.condition); const storage = qs.raw(q.storage); const stock = qs.raw(q.stock);
  let items = rows.filter((r) => {
    if (search && !hit(`${r.productName} ${r.slug} ${r.storage} ${r.colour}`, search)) return false;
    if (brand && r.brand !== brand) return false;
    if (condition && r.condition !== condition) return false;
    if (storage && r.storage !== storage) return false;
    if (stock === 'out' && r.stock !== 0) return false;
    if (stock === 'low' && !(r.stock > 0 && r.stock <= low)) return false;
    if (stock === 'in' && r.stock <= low) return false;
    return true;
  });
  const sort = qs.raw(q.sort) ?? 'product';
  const sorters: Record<string, (a: (typeof rows)[number], b: (typeof rows)[number]) => number> = { product: (a, b) => a.productName.localeCompare(b.productName) || storageIndex(a.storage) - storageIndex(b.storage) || a.colour.localeCompare(b.colour) || CONDITIONS.indexOf(a.condition) - CONDITIONS.indexOf(b.condition), 'stock-asc': (a, b) => a.stock - b.stock, 'stock-desc': (a, b) => b.stock - a.stock, 'price-asc': (a, b) => a.price - b.price, 'price-desc': (a, b) => b.price - a.price };
  items = [...items].sort(sorters[sort] ?? sorters.product);
  const { page: p, pageSize } = page(q, 50);
  res.json({ ...paginate(items, p, pageSize), summary });
}));

adminRouter.patch('/variants', perm('inventory.edit'), wrap(async (req, res) => {
  const { updates } = parse(z.object({ updates: z.array(z.object({ productId: z.string(), storage: z.string(), colour: z.string().default(''), condition: z.enum(CONDITIONS), price: z.number().min(0).optional(), stock: z.number().int().min(0).optional() })).min(1).max(500) }), req.body);
  let updated = 0;
  const touched = new Set<string>();
  for (const u of updates) {
    const set: Record<string, number> = {};
    if (u.price !== undefined) set['variants.$.price'] = Math.round(u.price);
    if (u.stock !== undefined) set['variants.$.stock'] = Math.round(u.stock);
    if (!Object.keys(set).length) continue;
    const r = await col.products().updateOne({ id: u.productId, variants: { $elemMatch: { storage: u.storage, colour: u.colour, condition: u.condition } } }, { $set: set });
    if (r.matchedCount) { updated += 1; touched.add(u.productId); }
  }
  for (const id of touched) { const p = await col.products().findOne({ id }); if (p) await col.products().replaceOne({ id }, await normalise(p)); }
  invalidateCatalog();
  if (updated) { const names = [...touched]; const first = await col.products().findOne({ id: names[0] }); await logActivity(actor(req), 'Updated stock / prices', names.length === 1 && first ? `${first.brand} ${first.name}` : `${names.length} products`, 'product', `${updated} variants`); }
  res.json({ updated });
}));

const ruleSchema = z.object({ mode: z.enum(['percent', 'fixed']), amount: z.number(), brand: z.string().optional(), series: z.string().optional(), condition: z.enum(CONDITIONS).optional(), roundTo: z.number().int().min(0).max(9).optional() });
type Rule = z.infer<typeof ruleSchema>;
const matchRule = (p: ProductDoc, v: Variant, r: Rule) => (!r.brand || p.brand === r.brand) && (!r.series || p.series === r.series) && (!r.condition || v.condition === r.condition);
const applyRule = (price: number, r: Rule) => { let n = r.mode === 'percent' ? price * (1 + r.amount / 100) : price + r.amount; n = r.roundTo !== undefined ? Math.round((n - r.roundTo) / 10) * 10 + r.roundTo : Math.round(n); return Math.max(10, n); };

adminRouter.post('/pricing/preview', perm('pricing.rules'), wrap(async (req, res) => {
  const rule = parse(ruleSchema, req.body);
  let affected = 0, sampleBefore = 0, sampleAfter = 0;
  (await allProducts()).filter((p) => p.status !== 'archived').forEach((p) => p.variants.forEach((v) => { if (!matchRule(p as ProductDoc, v, rule)) return; if (!affected) { sampleBefore = v.price; sampleAfter = applyRule(v.price, rule); } affected += 1; }));
  res.json({ affected, sampleBefore, sampleAfter });
}));

adminRouter.post('/pricing/apply', perm('pricing.rules'), wrap(async (req, res) => {
  const rule = parse(ruleSchema, req.body);
  let affected = 0;
  for (const p of await col.products().find({ status: { $ne: 'archived' } }).toArray()) {
    let changed = false;
    p.variants.forEach((v) => { if (!matchRule(p, v, rule)) return; v.price = applyRule(v.price, rule); changed = true; affected += 1; });
    if (changed) await col.products().replaceOne({ id: p.id }, await normalise(p));
  }
  invalidateCatalog();
  const scope = [rule.brand, rule.series, rule.condition].filter(Boolean).join(' · ') || 'All variants';
  await logActivity(actor(req), 'Applied price rule', `${scope} · ${rule.mode === 'percent' ? `${rule.amount}%` : `£${rule.amount}`}`, 'product', `${affected} variants changed`);
  res.json({ affected });
}));

// ─── Orders ───────────────────────────────────────────────────────────────────
adminRouter.get('/orders', perm('orders.view'), wrap(async (req, res) => {
  const q = Q(req);
  const status = qs.raw(q.status); const paymentStatus = qs.raw(q.paymentStatus); const delivery = qs.raw(q.delivery); const flagged = qs.bool(q.flagged); const from = qs.raw(q.from); const to = qs.raw(q.to); const search = qs.raw(q.search);
  const filter: Record<string, unknown> = {};
  if (status === 'open') filter.status = { $in: ['confirmed', 'packing'] };
  else if (status && status !== 'all') filter.status = status;
  if (paymentStatus && paymentStatus !== 'all') filter.paymentStatus = paymentStatus;
  if (delivery && delivery !== 'all') filter.delivery = delivery;
  if (flagged) filter.flagged = true;
  if (from || to) filter.createdAt = { ...(from ? { $gte: new Date(from).toISOString() } : {}), ...(to ? { $lt: new Date(new Date(to).getTime() + 86_400_000).toISOString() } : {}) };
  if (search) { const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); filter.$or = [{ orderNumber: rx }, { 'customer.firstName': rx }, { 'customer.lastName': rx }, { 'customer.email': rx }, { 'customer.postcode': rx }, { paymentRef: rx }, { 'tracking.number': rx }, { 'lines.name': rx }]; }
  const sort = qs.raw(q.sort) ?? 'newest';
  const sortSpec: Record<string, Record<string, 1 | -1>> = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, 'total-desc': { total: -1, createdAt: -1 }, 'total-asc': { total: 1, createdAt: -1 } };
  const { page: p, pageSize } = page(q);
  const [items, total] = await Promise.all([col.orders().find(filter).sort(sortSpec[sort] ?? sortSpec.newest).skip((p - 1) * pageSize).limit(pageSize).toArray(), col.orders().countDocuments(filter)]);
  res.json({ items: cleanAll(items), total, page: p, pageSize });
}));

adminRouter.get('/orders/:n', perm('orders.view'), wrap(async (req, res) => res.json(clean(await getOrder(req.params.n)))));
adminRouter.post('/orders/:n/status', perm('orders.manage'), wrap(async (req, res) => {
  const change = parse(z.object({ status: z.enum(ORDER_STATUSES), tracking: z.object({ carrier: z.string().min(1), number: z.string().min(3), url: z.string().url().optional() }).optional(), note: z.string().max(500).optional(), notifyCustomer: z.boolean().optional() }), req.body);
  if ((change.status === 'cancelled' || change.status === 'returned') && !req.auth!.role.permissions.includes('orders.refund')) throw forbidden('Cancelling or returning an order needs the “orders.refund” permission.');
  res.json(clean(await changeStatus(req.params.n, change, actor(req))));
}));
adminRouter.post('/orders/:n/notes', perm('orders.manage'), wrap(async (req, res) => { const { note } = parse(z.object({ note: z.string().trim().min(1).max(1000) }), req.body); res.json(clean(await addNote(req.params.n, note, actor(req)))); }));
adminRouter.post('/orders/:n/tracking', perm('orders.manage'), wrap(async (req, res) => { const t = parse(z.object({ carrier: z.string().min(1), number: z.string().min(3), url: z.string().url().optional() }), req.body); res.json(clean(await setTracking(req.params.n, t, actor(req)))); }));
adminRouter.post('/orders/:n/refund', perm('orders.refund'), wrap(async (req, res) => { const { amount, reason } = parse(z.object({ amount: z.number().positive(), reason: z.string().trim().min(1).max(300) }), req.body); res.json(await refund(req.params.n, amount, reason, actor(req))); }));
adminRouter.post('/orders/:n/emails', perm('orders.manage'), wrap(async (req, res) => { const { kind } = parse(z.object({ kind: z.enum(['confirmation', 'dispatched', 'invoice']) }), req.body); res.json(clean(await resendEmail(req.params.n, kind, actor(req)))); }));
adminRouter.patch('/orders/:n', perm('orders.manage'), wrap(async (req, res) => {
  const body = parse(z.object({ flagged: z.boolean().optional(), customer: z.object({ firstName: z.string().min(1), lastName: z.string().min(1), email: z.string().email(), phone: z.string().min(5), line1: z.string().min(1), line2: z.string().optional(), city: z.string().min(1), postcode: z.string().min(3) }).optional() }), req.body);
  const o = await getOrder(req.params.n);
  const set: Partial<OrderDoc> = { updatedAt: nowIso() };
  const events = [...o.events];
  if (body.flagged !== undefined) { set.flagged = body.flagged; await logActivity(actor(req), body.flagged ? 'Flagged order' : 'Cleared order flag', o.orderNumber, 'order'); }
  if (body.customer) { set.customer = { ...body.customer, email: body.customer.email.toLowerCase() }; events.push({ id: uid('ev'), at: nowIso(), type: 'note', message: `Customer / delivery details updated · ${body.customer.line1}, ${body.customer.postcode}`, by: actor(req) }); await logActivity(actor(req), 'Updated delivery details', o.orderNumber, 'order'); }
  await col.orders().updateOne({ orderNumber: o.orderNumber }, { $set: { ...set, events } });
  res.json(clean(await getOrder(req.params.n)));
}));

// ─── Customers ────────────────────────────────────────────────────────────────
adminRouter.get('/customers', perm('customers.view'), wrap(async (req, res) => {
  const q = Q(req);
  const search = qs.raw(q.search); const subscribed = qs.bool(q.subscribed); const sort = qs.raw(q.sort) ?? 'recent';
  let items = (await customersFromOrders()).filter((c) => (subscribed === undefined || c.subscribed === subscribed) && (!search || hit(`${c.firstName} ${c.lastName} ${c.email} ${c.postcode} ${c.city}`, search)));
  const sorters: Record<string, (a: (typeof items)[number], b: (typeof items)[number]) => number> = { recent: (a, b) => b.lastOrderAt.localeCompare(a.lastOrderAt), spent: (a, b) => b.spent - a.spent, orders: (a, b) => b.orders - a.orders || b.spent - a.spent, name: (a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`) };
  items = [...items].sort(sorters[sort] ?? sorters.recent);
  const { page: p, pageSize } = page(q);
  res.json(paginate(items, p, pageSize));
}));
adminRouter.get('/customers/:id', perm('customers.view'), wrap(async (req, res) => {
  const id = norm(decodeURIComponent(req.params.id));
  const customer = (await customersFromOrders()).find((c) => c.id === id);
  if (!customer) throw notFound('Customer not found.');
  const [orders, reviews, enquiries] = await Promise.all([col.orders().find({ 'customer.email': id }).sort({ createdAt: -1 }).toArray(), col.reviews().find({ email: id }).toArray(), col.enquiries().find({ email: id }).toArray()]);
  res.json({ customer, orders: cleanAll(orders), reviews: cleanAll(reviews), enquiries: cleanAll(enquiries) });
}));
adminRouter.patch('/customers/:id', perm('customers.edit'), wrap(async (req, res) => {
  const id = norm(decodeURIComponent(req.params.id));
  const { notes } = parse(z.object({ notes: z.string().max(4000) }), req.body);
  await col.customerNotes().updateOne({ id }, { $set: { id, notes, updatedAt: nowIso() } }, { upsert: true });
  await logActivity(actor(req), 'Updated customer notes', id, 'customer');
  const c = (await customersFromOrders()).find((x) => x.id === id);
  if (!c) throw notFound('Customer not found.');
  res.json(c);
}));

// ─── Reviews ──────────────────────────────────────────────────────────────────
async function recomputeRating(productId: string) {
  const approved = await col.reviews().find({ productId, status: 'approved' }).toArray();
  const rating = approved.length ? Math.round((approved.reduce((s, r) => s + r.rating, 0) / approved.length) * 10) / 10 : 0;
  await col.products().updateOne({ id: productId }, { $set: { rating, reviewCount: approved.length } });
  invalidateCatalog();
}
adminRouter.get('/reviews', perm('reviews.manage'), wrap(async (req, res) => {
  const q = Q(req);
  const all = await col.reviews().find({}).sort({ date: -1 }).toArray();
  const counts = { pending: 0, approved: 0, rejected: 0 };
  all.forEach((r) => (counts[r.status] += 1));
  const status = qs.raw(q.status); const rating = qs.num(q.rating); const productId = qs.raw(q.productId); const search = qs.raw(q.search);
  const items = all.filter((r) => (!status || status === 'all' || r.status === status) && (!rating || r.rating === rating) && (!productId || r.productId === productId) && (!search || hit(`${r.author} ${r.email} ${r.title} ${r.body} ${r.productName}`, search)));
  const { page: p, pageSize } = page(q, 20);
  res.json({ ...paginate(cleanAll(items), p, pageSize), counts });
}));
adminRouter.patch('/reviews/:id', perm('reviews.manage'), wrap(async (req, res) => {
  const body = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional(), reply: z.string().max(2000).optional() }), req.body);
  const r = await col.reviews().findOne({ id: req.params.id });
  if (!r) throw notFound('Review not found.');
  const set: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};
  if (body.status) set.status = body.status;
  if (body.reply !== undefined) { if (body.reply.trim()) set.reply = body.reply.trim(); else unset.reply = ''; }
  await col.reviews().updateOne({ id: r.id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  if (body.status) await recomputeRating(r.productId);
  await logActivity(actor(req), body.status ? `${body.status === 'approved' ? 'Approved' : body.status === 'rejected' ? 'Rejected' : 'Reopened'} review` : 'Replied to review', `${r.author} on ${r.productName}`, 'review');
  res.json(clean((await col.reviews().findOne({ id: r.id }))!));
}));
adminRouter.delete('/reviews/:id', perm('reviews.manage'), wrap(async (req, res) => {
  const r = await col.reviews().findOne({ id: req.params.id });
  if (r) { await col.reviews().deleteOne({ id: r.id }); await recomputeRating(r.productId); await logActivity(actor(req), 'Deleted review', `${r.author} on ${r.productName}`, 'review'); }
  res.status(204).end();
}));

// ─── Enquiries & newsletter ───────────────────────────────────────────────────
adminRouter.get('/enquiries', perm('enquiries.manage'), wrap(async (req, res) => {
  const q = Q(req);
  const all = await col.enquiries().find({}).sort({ createdAt: -1 }).toArray();
  const counts = { open: 0, replied: 0, closed: 0 };
  all.forEach((e) => (counts[e.status] += 1));
  const status = qs.raw(q.status); const search = qs.raw(q.search);
  const items = all.filter((e) => (!status || status === 'all' || e.status === status) && (!search || hit(`${e.name} ${e.email} ${e.message} ${e.orderNumber ?? ''}`, search)));
  const { page: p, pageSize } = page(q, 20);
  res.json({ ...paginate(cleanAll(items), p, pageSize), counts });
}));
adminRouter.patch('/enquiries/:id', perm('enquiries.manage'), wrap(async (req, res) => {
  const body = parse(z.object({ status: z.enum(['open', 'replied', 'closed']).optional(), reply: z.string().max(5000).optional(), assignee: z.string().max(80).optional() }), req.body);
  const e = await col.enquiries().findOne({ id: req.params.id });
  if (!e) throw notFound('Enquiry not found.');
  const set: Record<string, unknown> = {};
  if (body.reply !== undefined) {
    const mail = emails.enquiryReply(e.name, e.message, body.reply);
    const sent = await sendEmail(e.email, mail.subject, mail.html);
    if (!sent.ok) throw badRequest(`Could not send the reply: ${sent.error}`);
    Object.assign(set, { reply: body.reply, repliedAt: nowIso(), assignee: actor(req), status: body.status ?? 'replied' });
  }
  if (body.status) set.status = body.status;
  if (body.assignee !== undefined) set.assignee = body.assignee;
  await col.enquiries().updateOne({ id: e.id }, { $set: set });
  await logActivity(actor(req), body.reply !== undefined ? 'Replied to enquiry' : `Marked enquiry ${set.status ?? e.status}`, e.name, 'enquiry');
  res.json(clean((await col.enquiries().findOne({ id: e.id }))!));
}));

adminRouter.get('/subscribers', perm('subscribers.manage'), wrap(async (req, res) => {
  const q = Q(req);
  const all = await col.subscribers().find({}).sort({ subscribedAt: -1 }).toArray();
  const counts = { subscribed: 0, unsubscribed: 0 };
  all.forEach((s) => (counts[s.status] += 1));
  const status = qs.raw(q.status); const search = qs.raw(q.search);
  const items = all.filter((s) => (!status || status === 'all' || s.status === status) && (!search || hit(s.email, search)));
  const { page: p, pageSize } = page(q, 30);
  res.json({ ...paginate(cleanAll(items), p, pageSize), counts });
}));
adminRouter.post('/subscribers', perm('subscribers.manage'), wrap(async (req, res) => {
  const { email } = parse(z.object({ email: z.string().trim().email() }), req.body);
  const e = norm(email);
  const existing = await col.subscribers().findOne({ email: e });
  if (existing) { await col.subscribers().updateOne({ email: e }, { $set: { status: 'subscribed' } }); return res.json(clean({ ...existing, status: 'subscribed' as const })); }
  const s = { id: uid('sub'), email: e, subscribedAt: nowIso(), status: 'subscribed' as const, source: 'admin' as const };
  await col.subscribers().insertOne({ ...s });
  await logActivity(actor(req), 'Added subscriber', e, 'subscriber');
  res.status(201).json(s);
}));
adminRouter.patch('/subscribers/:id', perm('subscribers.manage'), wrap(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['subscribed', 'unsubscribed']) }), req.body);
  const s = await col.subscribers().findOne({ id: req.params.id });
  if (!s) throw notFound('Subscriber not found.');
  await col.subscribers().updateOne({ id: s.id }, { $set: { status } });
  await logActivity(actor(req), status === 'subscribed' ? 'Re-subscribed' : 'Unsubscribed', s.email, 'subscriber');
  res.json(clean({ ...s, status }));
}));
adminRouter.delete('/subscribers/:id', perm('subscribers.manage'), wrap(async (req, res) => {
  const s = await col.subscribers().findOne({ id: req.params.id });
  if (s) { await col.subscribers().deleteOne({ id: s.id }); await logActivity(actor(req), 'Deleted subscriber', s.email, 'subscriber'); }
  res.status(204).end();
}));

// ─── Settings ─────────────────────────────────────────────────────────────────
adminRouter.get('/settings', perm('settings.view'), wrap(async (_req, res) => res.json(await getSettings())));
adminRouter.patch('/settings', perm('settings.edit'), wrap(async (req, res) => {
  const schema = z.object({
    store: z.object({ name: z.string().min(1), supportEmail: z.string().email(), whatsapp: z.string(), hours: z.string(), siteUrl: z.string(), warrantyMonths: z.number().int().min(0), returnsDays: z.number().int().min(0) }).optional(),
    delivery: z.array(z.object({ id: z.enum(['standard', 'next-day']), label: z.string().min(1), description: z.string(), fee: z.number().min(0), etaDays: z.number().int().min(1), cutoff: z.string(), enabled: z.boolean() })).optional(),
    storages: z.array(z.string().min(1)).min(1).optional(),
    conditions: z.array(z.object({ key: z.enum(CONDITIONS), label: z.string().min(1), short: z.string(), blurb: z.string(), minBattery: z.number().int().min(0).max(100), images: z.array(z.object({ url: z.string().trim().min(1).max(600), caption: z.string().trim().max(40).default('') })).max(6).default([]) })).optional(),
    featuredSlugs: z.array(z.string()).optional(), lowStockThreshold: z.number().int().min(0).optional(),
    payments: z.object({ provider: z.literal('paypal'), mode: z.enum(['sandbox', 'live']), clientId: z.string(), merchantEmail: z.string() }).optional(),
    notifications: z.object({ orderEmail: z.boolean(), lowStockEmail: z.boolean(), enquiryEmail: z.boolean(), reviewEmail: z.boolean(), notifyTo: z.string() }).optional(),
  });
  const patch = parse(schema, req.body);
  const next = await updateSettings(patch);
  if (patch.featuredSlugs) { await col.products().updateMany({}, [{ $set: { featured: { $in: ['$slug', patch.featuredSlugs] } } }]); invalidateCatalog(); }
  await logActivity(actor(req), 'Updated settings', Object.keys(patch).join(', '), 'settings');
  res.json(next);
}));

// ─── Team & roles ─────────────────────────────────────────────────────────────
adminRouter.get('/admins', perm('team.view'), wrap(async (_req, res) => res.json(cleanAll(await col.admins().find({}).sort({ createdAt: 1 }).toArray()))));
adminRouter.post('/admins', perm('team.manage'), wrap(async (req, res) => {
  const input = parse(z.object({ email: z.string().trim().email(), name: z.string().trim().max(80).default(''), roleId: z.string().min(1) }), req.body);
  const email = norm(input.email);
  if (await col.admins().findOne({ email })) throw conflict('That email is already an admin.');
  const role = await col.roles().findOne({ id: input.roleId });
  if (!role) throw badRequest('Pick a role.');
  const u = { id: uid('adm'), email, name: input.name || email.split('@')[0], roleId: role.id, status: 'active' as const, createdAt: nowIso() };
  await col.admins().insertOne({ ...u });
  await logActivity(actor(req), 'Added admin', email, 'admin', role.name);
  res.status(201).json(u);
}));
adminRouter.patch('/admins/:id', perm('team.manage'), wrap(async (req, res) => {
  const patch = parse(z.object({ name: z.string().trim().min(1).max(80).optional(), roleId: z.string().optional(), status: z.enum(['active', 'suspended']).optional() }), req.body);
  const u = await col.admins().findOne({ id: req.params.id });
  if (!u) throw notFound('Admin not found.');
  const me = req.auth!.user.id;
  if (u.id === me && (patch.roleId || patch.status === 'suspended')) throw badRequest('You cannot change your own role or suspend yourself.');
  const activeOwners = await col.admins().countDocuments({ roleId: 'role_owner', status: 'active' });
  if (u.roleId === 'role_owner' && u.status === 'active' && activeOwners === 1 && ((patch.roleId && patch.roleId !== 'role_owner') || patch.status === 'suspended')) throw badRequest('There must be at least one active owner.');
  let roleName: string | undefined;
  if (patch.roleId) { const role = await col.roles().findOne({ id: patch.roleId }); if (!role) throw badRequest('Role not found.'); roleName = role.name; }
  await col.admins().updateOne({ id: u.id }, { $set: patch });
  await logActivity(actor(req), patch.status ? (patch.status === 'suspended' ? 'Suspended admin' : 'Restored admin') : patch.roleId ? 'Changed admin role' : 'Updated admin', u.email, 'admin', roleName);
  res.json(clean((await col.admins().findOne({ id: u.id }))!));
}));
adminRouter.delete('/admins/:id', perm('team.manage'), wrap(async (req, res) => {
  const u = await col.admins().findOne({ id: req.params.id });
  if (!u) return res.status(204).end();
  if (u.id === req.auth!.user.id) throw badRequest('You cannot remove yourself.');
  if (u.roleId === 'role_owner' && (await col.admins().countDocuments({ roleId: 'role_owner' })) === 1) throw badRequest('You cannot remove the only owner.');
  await col.admins().deleteOne({ id: u.id });
  await logActivity(actor(req), 'Removed admin', u.email, 'admin');
  res.status(204).end();
}));

const roleInput = z.object({ name: z.string().trim().min(1).max(60), description: z.string().trim().max(300).default(''), permissions: z.array(z.string()).transform((ps) => ps.filter(isPermission)), color: z.enum(['ink', 'brand', 'sky', 'mint', 'lilac', 'lemon', 'peach']) });
adminRouter.get('/roles', perm('team.view'), wrap(async (_req, res) => {
  const [roles, admins] = await Promise.all([col.roles().find({}).sort({ createdAt: 1 }).toArray(), col.admins().find({}, { projection: { roleId: 1 } }).toArray()]);
  res.json(roles.map((r) => ({ ...clean(r), members: admins.filter((a) => a.roleId === r.id).length })));
}));
adminRouter.post('/roles', perm('team.manage'), wrap(async (req, res) => {
  const input = parse(roleInput, req.body);
  if (await col.roles().findOne({ name: new RegExp(`^${input.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })) throw conflict('A role with that name already exists.');
  const r: RoleDoc = { id: uid('role'), ...input, system: false, createdAt: nowIso(), updatedAt: nowIso() };
  await col.roles().insertOne({ ...r });
  await logActivity(actor(req), 'Created role', r.name, 'role', `${r.permissions.length} permissions`);
  res.status(201).json(r);
}));
adminRouter.patch('/roles/:id', perm('team.manage'), wrap(async (req, res) => {
  const patch = parse(roleInput.partial(), req.body);
  const r = await col.roles().findOne({ id: req.params.id });
  if (!r) throw notFound('Role not found.');
  if (r.id === 'role_owner') throw badRequest('The Owner role cannot be changed.');
  if (patch.name && (await col.roles().findOne({ id: { $ne: r.id }, name: new RegExp(`^${patch.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }))) throw conflict('A role with that name already exists.');
  await col.roles().updateOne({ id: r.id }, { $set: { ...patch, updatedAt: nowIso() } });
  await logActivity(actor(req), 'Updated role', patch.name ?? r.name, 'role', patch.permissions ? `${patch.permissions.length} permissions` : undefined);
  res.json(clean((await col.roles().findOne({ id: r.id }))!));
}));
adminRouter.delete('/roles/:id', perm('team.manage'), wrap(async (req, res) => {
  const r = await col.roles().findOne({ id: req.params.id });
  if (!r) return res.status(204).end();
  if (r.system) throw badRequest('Built-in roles cannot be deleted.');
  const members = await col.admins().countDocuments({ roleId: r.id });
  if (members) throw badRequest(`Move the ${members} ${members === 1 ? 'admin' : 'admins'} on this role first.`);
  await col.roles().deleteOne({ id: r.id });
  await logActivity(actor(req), 'Deleted role', r.name, 'role');
  res.status(204).end();
}));

// ─── System ───────────────────────────────────────────────────────────────────
adminRouter.get('/system', perm('settings.view'), wrap(async (_req, res) => {
  const [products, orders, reviews, enquiries, subscribers, admins] = await Promise.all([col.products().countDocuments({}), col.orders().countDocuments({}), col.reviews().countDocuments({}), col.enquiries().countDocuments({}), col.subscribers().countDocuments({}), col.admins().countDocuments({})]);
  const last = await col.orders().find({}).sort({ createdAt: -1 }).limit(1).project({ createdAt: 1 }).toArray();
  res.json({ env: env.NODE_ENV, version: '0.1.0', database: env.BUY_DB_NAME, email: env.BREVO_API_KEY ? 'brevo' : 'disabled', emailFrom: env.FROM_EMAIL_Brevo, paypal: env.paypalEnabled ? env.PAYPAL_MODE : 'not configured', storefrontUrl: env.STOREFRONT_URL, counts: { products, orders, reviews, enquiries, subscribers, admins }, lastOrderAt: last[0]?.createdAt ?? null, uptimeSeconds: Math.round(process.uptime()), time: new Date().toISOString() });
}));

// ─── Activity ─────────────────────────────────────────────────────────────────
adminRouter.get('/activity', perm('activity.view'), wrap(async (req, res) => {
  const q = Q(req);
  const filter: Record<string, unknown> = {};
  const search = qs.raw(q.search); const who = qs.raw(q.actor); const targetType = qs.raw(q.targetType);
  if (who) filter.actor = who;
  if (targetType) filter.targetType = targetType;
  if (search) { const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); filter.$or = [{ actor: rx }, { action: rx }, { target: rx }, { detail: rx }]; }
  const { page: p, pageSize } = page(q, 40);
  const [items, total] = await Promise.all([col.activity().find(filter).sort({ at: -1 }).skip((p - 1) * pageSize).limit(pageSize).toArray(), col.activity().countDocuments(filter)]);
  res.json({ items: cleanAll(items), total, page: p, pageSize });
}));

void ALL_PERMISSIONS; void slugify;
