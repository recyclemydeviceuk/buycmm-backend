import { col, clean } from '../config/db.js';
import { env } from '../config/env.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { nowIso, orderNumber, uid } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { captureOrder, refundCapture } from '../lib/paypal.js';
import { sendEmail } from '../lib/brevo.js';
import { emails } from '../emails/templates.js';
import { NEXT_STATUSES, addDays, type OrderStatus } from '../lib/format.js';
import type { Address, BasketLine, DeliveryMethod, OrderDoc, OrderEvent, PublicOrder } from '../types.js';
import { invalidateCatalog } from './catalog.js';
import { getSettings } from './settings.js';
import { logActivity } from './activity.js';

export function toPublicOrder(o: OrderDoc): PublicOrder {
  const { orderNumber: n, createdAt, status, lines, subtotal, deliveryFee, total, delivery, customer, estimatedDelivery } = o;
  return { orderNumber: n, createdAt, status, lines, subtotal, deliveryFee, total, delivery, customer, estimatedDelivery };
}

const event = (type: OrderEvent['type'], message: string, by: string): OrderEvent => ({ id: uid('ev'), at: nowIso(), type, message, by });

export interface CheckoutInput {
  lines: Array<{ productId: string; storage: string; network: string; condition: string; quantity: number }>;
  customer: Address;
  delivery: DeliveryMethod;
  paymentToken: string;
}

/**
 * Creates an order: validates lines against live stock, captures the PayPal payment for the server-side total,
 * then decrements stock atomically (a variant can never go below zero even under concurrent checkouts).
 */
export async function checkout(input: CheckoutInput): Promise<OrderDoc> {
  const settings = await getSettings();
  const option = settings.delivery.find((d) => d.id === input.delivery && d.enabled);
  if (!option) throw badRequest('That delivery option is not available.');
  if (!input.lines.length) throw badRequest('Your basket is empty.');

  // Resolve lines against the database.
  const lines: BasketLine[] = [];
  for (const [i, l] of input.lines.entries()) {
    const p = await col.products().findOne({ id: l.productId, status: 'active' });
    const v = p?.variants.find((x) => x.storage === l.storage && x.network === l.network && x.condition === l.condition);
    if (!p || !v) throw badRequest(`One of the items in your basket is no longer available.`);
    if (v.stock < l.quantity) throw conflict(`Only ${v.stock} of ${p.brand} ${p.name} ${l.storage} ${l.network} ${l.condition} left in stock.`);
    lines.push({ lineId: String(i), productId: p.id, slug: p.slug, name: p.name, brand: p.brand, image: p.image, storage: v.storage, network: v.network, condition: v.condition, unitPrice: v.price, quantity: l.quantity });
  }
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const deliveryFee = option.fee;
  const total = subtotal + deliveryFee;

  // Take payment for the server-side total (never the client's).
  const { captureId } = await captureOrder(input.paymentToken, total);

  // Reserve stock. Any failure here after capture is refunded immediately.
  const taken: BasketLine[] = [];
  try {
    for (const l of lines) {
      const r = await col.products().updateOne(
        { id: l.productId, variants: { $elemMatch: { storage: l.storage, network: l.network, condition: l.condition, stock: { $gte: l.quantity } } } },
        { $inc: { 'variants.$.stock': -l.quantity }, $set: { updatedAt: nowIso() } },
      );
      if (r.modifiedCount !== 1) throw conflict(`${l.brand} ${l.name} sold out while you were paying.`);
      taken.push(l);
    }
  } catch (e) {
    for (const l of taken) await col.products().updateOne({ id: l.productId, 'variants.storage': l.storage, 'variants.network': l.network, 'variants.condition': l.condition }, { $inc: { 'variants.$.stock': l.quantity } }).catch(() => undefined);
    await refundCapture(captureId, total, 'Stock unavailable').catch((err) => logger.error('Refund after failed reservation failed', { captureId, err: String(err) }));
    throw e;
  }
  await recomputeFromPrice(lines.map((l) => l.productId));
  invalidateCatalog();

  const now = new Date();
  const order: OrderDoc = {
    orderNumber: orderNumber(now),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    status: 'confirmed',
    lines,
    subtotal,
    deliveryFee,
    total,
    delivery: input.delivery,
    customer: { ...input.customer, email: input.customer.email.trim().toLowerCase() },
    estimatedDelivery: addDays(now, option.etaDays).toISOString(),
    paymentStatus: 'paid',
    paymentMethod: 'paypal',
    paymentRef: input.paymentToken,
    captureId,
    refundedAmount: 0,
    events: [event('created', `Order placed · paid £${total} via PayPal (${input.paymentToken})`, 'Customer')],
    flagged: false,
  };
  // Order numbers are random; retry on the (very unlikely) collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await col.orders().insertOne({ ...order });
      break;
    } catch (e) {
      if ((e as { code?: number }).code === 11000 && attempt < 4) order.orderNumber = orderNumber(now);
      else throw e;
    }
  }
  logger.info('Order created', { orderNumber: order.orderNumber, total });

  // Emails are best-effort and recorded on the timeline.
  const conf = emails.orderConfirmation(order);
  const sent = await sendEmail(order.customer.email, conf.subject, conf.html);
  await addEvent(order.orderNumber, event('email', sent.ok ? `Order confirmation email sent to ${order.customer.email}` : `Order confirmation email FAILED: ${sent.error}`, 'System'));
  if (settings.notifications.orderEmail) {
    const n = emails.adminNewOrder(order);
    void sendEmail(settings.notifications.notifyTo || env.ADMIN_NOTIFY_EMAIL, n.subject, n.html);
  }
  return (await col.orders().findOne({ orderNumber: order.orderNumber })) ?? order;
}

async function addEvent(n: string, ev: OrderEvent) {
  await col.orders().updateOne({ orderNumber: n }, { $push: { events: ev }, $set: { updatedAt: ev.at } });
}

export async function recomputeFromPrice(productIds: string[]) {
  for (const id of new Set(productIds)) {
    const p = await col.products().findOne({ id });
    if (!p) continue;
    const inStock = p.variants.filter((v) => v.stock > 0);
    const fromPrice = inStock.length ? Math.min(...inStock.map((v) => v.price)) : p.variants.length ? Math.min(...p.variants.map((v) => v.price)) : 0;
    await col.products().updateOne({ id }, { $set: { fromPrice } });
  }
}

export async function getOrder(n: string): Promise<OrderDoc> {
  const o = await col.orders().findOne({ orderNumber: n.toUpperCase() });
  if (!o) throw notFound('Order not found.');
  return o;
}

const STATUS_LABEL: Record<OrderStatus, string> = { confirmed: 'Confirmed', packing: 'Packing · final checks and boxing', dispatched: 'Dispatched · with the courier', delivered: 'Delivered', cancelled: 'Cancelled', returned: 'Returned · device received and checked' };

export interface StatusChange {
  status: OrderStatus;
  tracking?: { carrier: string; number: string; url?: string };
  note?: string;
  notifyCustomer?: boolean;
}

export async function changeStatus(n: string, change: StatusChange, by: string): Promise<OrderDoc> {
  const o = await getOrder(n);
  if (!NEXT_STATUSES[o.status].includes(change.status)) throw badRequest(`An order that is ${o.status} cannot be marked ${change.status}.`);
  const events: OrderEvent[] = [];
  const set: Partial<OrderDoc> = { status: change.status };
  if (change.tracking?.number) {
    set.tracking = { ...change.tracking };
    events.push(event('tracking', `Tracking added · ${change.tracking.carrier} ${change.tracking.number}`, by));
  }
  if (change.status === 'dispatched' && !set.tracking && !o.tracking) throw badRequest('Add a tracking number before marking the order dispatched.');
  events.push(event('status', change.note ? `${STATUS_LABEL[change.status]} · ${change.note}` : STATUS_LABEL[change.status], by));

  if (change.status === 'cancelled' || change.status === 'returned') {
    for (const l of o.lines) {
      await col.products().updateOne({ id: l.productId, 'variants.storage': l.storage, 'variants.network': l.network, 'variants.condition': l.condition }, { $inc: { 'variants.$.stock': l.quantity }, $set: { updatedAt: nowIso() } });
    }
    await recomputeFromPrice(o.lines.map((l) => l.productId));
    invalidateCatalog();
    const remaining = o.total - o.refundedAmount;
    if (remaining > 0) {
      await refundCapture(o.captureId ?? o.paymentRef, remaining, change.status === 'cancelled' ? 'Order cancelled' : 'Order returned');
      set.refundedAmount = o.total;
      set.paymentStatus = 'refunded';
      events.push(event('payment', `Refunded £${remaining} to PayPal`, by));
    }
    set.flagged = false;
  }
  if (change.status === 'delivered') set.flagged = false;

  const merged: OrderDoc = { ...o, ...set, events: [...o.events, ...events], updatedAt: nowIso() };
  if (change.notifyCustomer !== false && ['dispatched', 'delivered', 'cancelled'].includes(change.status)) {
    const mail = change.status === 'dispatched' ? emails.dispatched(merged) : change.status === 'delivered' ? emails.delivered(merged) : emails.cancelled(merged, set.refundedAmount !== undefined ? o.total - o.refundedAmount : 0);
    const sent = await sendEmail(o.customer.email, mail.subject, mail.html);
    merged.events.push(event('email', sent.ok ? `${change.status[0].toUpperCase()}${change.status.slice(1)} email sent to ${o.customer.email}` : `Email FAILED: ${sent.error}`, 'System'));
  }
  await col.orders().replaceOne({ orderNumber: o.orderNumber }, merged);
  await logActivity(by, `Set order ${change.status}`, o.orderNumber, 'order', change.note);
  return merged;
}

export async function refund(n: string, amount: number, reason: string, by: string): Promise<OrderDoc> {
  const o = await getOrder(n);
  const remaining = o.total - o.refundedAmount;
  if (!(amount > 0) || amount > remaining) throw badRequest(`Refund must be between £1 and £${remaining}.`);
  await refundCapture(o.captureId ?? o.paymentRef, amount, reason);
  const refundedAmount = o.refundedAmount + amount;
  const paymentStatus = refundedAmount >= o.total ? 'refunded' : 'partially-refunded';
  const ev = event('payment', `Refunded £${amount} to PayPal · ${reason}`, by);
  const mail = emails.refund(o, amount, reason);
  const sent = await sendEmail(o.customer.email, mail.subject, mail.html);
  const events = [...o.events, ev, event('email', sent.ok ? `Refund email sent to ${o.customer.email}` : `Email FAILED: ${sent.error}`, 'System')];
  await col.orders().updateOne({ orderNumber: o.orderNumber }, { $set: { refundedAmount, paymentStatus, events, updatedAt: nowIso() } });
  await logActivity(by, `Refunded £${amount}`, o.orderNumber, 'order', reason);
  return clean((await getOrder(n))) as OrderDoc;
}

export async function resendEmail(n: string, kind: 'confirmation' | 'dispatched' | 'invoice', by: string): Promise<OrderDoc> {
  const o = await getOrder(n);
  const mail = kind === 'confirmation' ? emails.orderConfirmation(o) : kind === 'dispatched' ? emails.dispatched(o) : emails.invoice(o);
  const names = { confirmation: 'Order confirmation', dispatched: 'Dispatch', invoice: 'VAT invoice' };
  const sent = await sendEmail(o.customer.email, mail.subject, mail.html);
  if (!sent.ok) throw badRequest(`Could not send: ${sent.error}`);
  await addEvent(n, event('email', `${names[kind]} email re-sent to ${o.customer.email}`, by));
  await logActivity(by, `Re-sent ${names[kind].toLowerCase()} email`, o.orderNumber, 'order');
  return getOrder(n);
}

export async function addNote(n: string, note: string, by: string) {
  const o = await getOrder(n);
  await addEvent(n, event('note', note, by));
  await logActivity(by, 'Added order note', o.orderNumber, 'order', note.slice(0, 80));
  return getOrder(n);
}

export async function setTracking(n: string, tracking: { carrier: string; number: string; url?: string }, by: string) {
  const o = await getOrder(n);
  await col.orders().updateOne({ orderNumber: n }, { $set: { tracking, updatedAt: nowIso() }, $push: { events: event('tracking', `Tracking ${o.tracking ? 'updated' : 'added'} · ${tracking.carrier} ${tracking.number}`, by) } });
  await logActivity(by, 'Updated tracking', o.orderNumber, 'order', `${tracking.carrier} ${tracking.number}`);
  return getOrder(n);
}
