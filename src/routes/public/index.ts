// Storefront endpoints: /api/buy/* — exactly what frontend/src/api/http/adapter.ts calls.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { col, clean } from '../../config/db.js';
import { env } from '../../config/env.js';
import { notFound } from '../../lib/errors.js';
import { parse, qs, wrap } from '../../lib/http.js';
import { nowIso, uid } from '../../lib/ids.js';
import { sendEmail } from '../../lib/brevo.js';
import { emails } from '../../emails/templates.js';
import { activeProducts, facets, featured, listPublicProducts, related, toPublic } from '../../services/catalog.js';
import { checkout, getOrder, toPublicOrder } from '../../services/orders.js';
import { getSettings } from '../../services/settings.js';

export const publicRouter = Router();
const writeLimit = rateLimit({ windowMs: 15 * 60_000, max: 30, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many requests, please try again shortly.' } });

const productQuery = (q: Record<string, unknown>) => ({
  brand: qs.list(q.brand), series: qs.list(q.series), network: qs.list(q.network), condition: qs.list(q.condition), storage: qs.list(q.storage),
  minPrice: qs.num(q.minPrice), maxPrice: qs.num(q.maxPrice), search: qs.raw(q.search), sort: qs.raw(q.sort), page: qs.num(q.page), pageSize: qs.num(q.pageSize),
});

publicRouter.get('/products', wrap(async (req, res) => res.json(await listPublicProducts(productQuery(req.query as Record<string, unknown>)))));
/** Lightweight list of every active product for the mega menu, instant search and showcase tiles. */
publicRouter.get('/products/menu', wrap(async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json((await activeProducts()).map((p) => ({ id: p.id, slug: p.slug, brand: p.brand, name: p.name, series: p.series, image: p.image, fromPrice: p.fromPrice, rrp: p.rrp, releaseYear: p.releaseYear, rating: p.rating, reviewCount: p.reviewCount, storages: p.storages })));
}));
/** Latest approved reviews across the catalogue (home page). */
publicRouter.get('/reviews/recent', wrap(async (req, res) => {
  const limit = Math.min(24, qs.num(req.query.limit) ?? 8);
  const reviews = await col.reviews().find({ status: 'approved' }).sort({ date: -1 }).limit(limit).toArray();
  const [total, avgAgg] = await Promise.all([col.reviews().countDocuments({ status: 'approved' }), col.reviews().aggregate<{ avg: number }>([{ $match: { status: 'approved' } }, { $group: { _id: null, avg: { $avg: '$rating' } } }]).toArray()]);
  res.json({ items: reviews.map((r) => ({ id: r.id, productId: r.productId, productName: r.productName, author: r.author, rating: r.rating, title: r.title, body: r.body, date: r.date, verified: r.verified, reply: r.reply })), total, average: avgAgg[0]?.avg ?? 0 });
}));
publicRouter.get('/products/facets', wrap(async (req, res) => res.json(await facets(productQuery(req.query as Record<string, unknown>)))));
publicRouter.get('/products/featured', wrap(async (_req, res) => res.json(await featured())));
publicRouter.get('/products/:slug/related', wrap(async (req, res) => res.json(await related(req.params.slug))));
publicRouter.get('/products/:id/reviews', wrap(async (req, res) => {
  const p = (await activeProducts()).find((x) => x.id === req.params.id || x.slug === req.params.id);
  if (!p) throw notFound('Product not found.');
  const reviews = await col.reviews().find({ productId: p.id, status: 'approved' }).sort({ date: -1 }).limit(20).toArray();
  res.json(reviews.map((r) => { const { id, productId, author, rating, title, body, date, verified, reply } = r; return { id, productId, author, rating, title, body, date, verified, reply }; }));
}));
publicRouter.post('/products/:id/reviews', writeLimit, wrap(async (req, res) => {
  const p = (await activeProducts()).find((x) => x.id === req.params.id || x.slug === req.params.id);
  if (!p) throw notFound('Product not found.');
  const body = parse(z.object({ author: z.string().trim().min(2).max(60), email: z.string().trim().email(), orderNumber: z.string().trim().max(20).optional(), rating: z.number().int().min(1).max(5), title: z.string().trim().min(3).max(120), body: z.string().trim().min(10).max(2000) }), req.body);
  const verified = body.orderNumber ? !!(await col.orders().findOne({ orderNumber: body.orderNumber.toUpperCase(), 'customer.email': body.email.toLowerCase(), 'lines.productId': p.id })) : false;
  const review = { id: uid('rev'), productId: p.id, productName: `${p.brand} ${p.name}`, author: body.author, email: body.email.toLowerCase(), orderNumber: body.orderNumber?.toUpperCase(), rating: body.rating, title: body.title, body: body.body, date: nowIso(), verified, status: 'pending' as const };
  await col.reviews().insertOne(review);
  const settings = await getSettings();
  if (settings.notifications.reviewEmail) { const m = emails.adminNewReview(review); void sendEmail(settings.notifications.notifyTo || env.ADMIN_NOTIFY_EMAIL, m.subject, m.html); }
  res.status(201).json({ ok: true, status: 'pending' });
}));
publicRouter.get('/products/:slug', wrap(async (req, res) => {
  const p = (await activeProducts()).find((x) => x.slug === req.params.slug || x.id === req.params.slug);
  if (!p) throw notFound('Product not found.');
  res.json(toPublic(p));
}));

const address = z.object({ firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().min(1).max(60), email: z.string().trim().email(), phone: z.string().trim().min(7).max(25), line1: z.string().trim().min(3).max(120), line2: z.string().trim().max(120).optional(), city: z.string().trim().min(1).max(80), postcode: z.string().trim().min(5).max(10) });
const checkoutSchema = z.object({
  lines: z.array(z.object({ productId: z.string().min(1), storage: z.string().min(1), network: z.string().min(1), condition: z.enum(['excellent', 'good', 'fair']), quantity: z.number().int().min(1).max(5) })).min(1).max(10),
  customer: address,
  delivery: z.enum(['standard', 'next-day']),
  paymentToken: z.string().min(4).max(120),
});
publicRouter.post('/checkout', writeLimit, wrap(async (req, res) => {
  const body = parse(checkoutSchema, req.body);
  const order = await checkout({ ...body, customer: { ...body.customer, postcode: body.customer.postcode.toUpperCase() } });
  res.status(201).json(toPublicOrder(order));
}));

publicRouter.get('/orders/:orderNumber', wrap(async (req, res) => res.json(toPublicOrder(await getOrder(req.params.orderNumber)))));

publicRouter.post('/newsletter', writeLimit, wrap(async (req, res) => {
  const { email } = parse(z.object({ email: z.string().trim().email() }), req.body);
  const e = email.toLowerCase();
  const existing = await col.subscribers().findOne({ email: e });
  if (existing) await col.subscribers().updateOne({ email: e }, { $set: { status: 'subscribed' } });
  else await col.subscribers().insertOne({ id: uid('sub'), email: e, subscribedAt: nowIso(), status: 'subscribed', source: 'footer' });
  res.json({ ok: true });
}));

publicRouter.post('/contact', writeLimit, wrap(async (req, res) => {
  const body = parse(z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email(), message: z.string().trim().min(5).max(4000), orderNumber: z.string().trim().max(20).optional() }), req.body);
  const enquiry = { id: uid('enq'), name: body.name, email: body.email.toLowerCase(), message: body.message, createdAt: nowIso(), status: 'open' as const, orderNumber: body.orderNumber?.toUpperCase() || (body.message.match(/CMM-\d{4}-\d{6}/i)?.[0]?.toUpperCase()) };
  await col.enquiries().insertOne(enquiry);
  const ack = emails.enquiryReceived(enquiry.name, enquiry.message);
  void sendEmail(enquiry.email, ack.subject, ack.html);
  const settings = await getSettings();
  if (settings.notifications.enquiryEmail) { const m = emails.adminNewEnquiry(enquiry); void sendEmail(settings.notifications.notifyTo || env.ADMIN_NOTIFY_EMAIL, m.subject, m.html, { replyTo: enquiry.email }); }
  res.json({ ok: true });
}));

/** Public, cacheable store config the storefront can read instead of hard-coding (delivery options, networks, grades). */
publicRouter.get('/config', wrap(async (_req, res) => {
  const s = await getSettings();
  res.json({ store: { name: s.store.name, supportEmail: s.store.supportEmail, whatsapp: s.store.whatsapp, hours: s.store.hours, warrantyMonths: s.store.warrantyMonths, returnsDays: s.store.returnsDays }, delivery: s.delivery.filter((d) => d.enabled), networks: s.networks, conditions: s.conditions, paypal: { mode: s.payments.mode, clientId: s.payments.clientId } });
}));

void clean;
