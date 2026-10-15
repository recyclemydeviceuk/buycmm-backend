import { col, clean } from '../config/db.js';
import { env } from '../config/env.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { nowIso, orderNumber, uid } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { PayPalError, captureOrder as capturePayPalOrder, createOrder as createPayPalOrder, getOrder as getPayPalOrder, refundCapture, type CaptureResult } from '../lib/paypal.js';
import { sendEmail } from '../lib/brevo.js';
import { emails } from '../emails/templates.js';
import { CONDITION_LABEL, NEXT_STATUSES, addDays, type OrderStatus } from '../lib/format.js';
import type { Address, BasketLine, DeliveryMethod, OrderDoc, OrderEvent, PaymentDoc, PublicOrder } from '../types.js';
import { invalidateCatalog } from './catalog.js';
import { getSettings } from './settings.js';
import { logActivity } from './activity.js';

export function toPublicOrder(o: OrderDoc): PublicOrder {
  const { orderNumber: n, createdAt, status, lines, subtotal, deliveryFee, total, delivery, customer, estimatedDelivery } = o;
  return { orderNumber: n, createdAt, status, lines, subtotal, deliveryFee, total, delivery, customer, estimatedDelivery };
}

const event = (type: OrderEvent['type'], message: string, by: string): OrderEvent => ({ id: uid('ev'), at: nowIso(), type, message, by });
/** The one variant an order line was bought from. */
const variantOf = (l: Pick<BasketLine, 'storage' | 'colour' | 'condition'>) => ({ storage: l.storage, colour: l.colour, condition: l.condition });

export interface BasketInput {
  lines: Array<{ productId: string; storage: string; colour: string; condition: string; quantity: number }>;
  customer: Address;
  delivery: DeliveryMethod;
}

/** Prices a basket from the database (never from the client) and checks it is in stock right now. */
async function priceBasket(input: BasketInput) {
  const settings = await getSettings();
  const option = settings.delivery.find((d) => d.id === input.delivery && d.enabled);
  if (!option) throw badRequest('That delivery option is not available.');
  if (!input.lines.length) throw badRequest('Your basket is empty.');
  const lines: BasketLine[] = [];
  for (const [i, l] of input.lines.entries()) {
    const p = await col.products().findOne({ id: l.productId, status: 'active' });
    const v = p?.variants.find((x) => x.storage === l.storage && x.colour === l.colour && x.condition === l.condition);
    if (!p || !v) throw badRequest(`One of the items in your basket is no longer available.`);
    if (p.colours.length > 0 && !v.colour) throw badRequest(`Choose a colour for the ${p.brand} ${p.name}.`);
    if (v.stock < l.quantity) throw conflict(`Only ${v.stock} of ${[p.brand, p.name, v.storage, v.colour, CONDITION_LABEL[v.condition]].filter(Boolean).join(' ')} left in stock.`);
    lines.push({ lineId: String(i), productId: p.id, slug: p.slug, name: p.name, brand: p.brand, image: p.colours.find((c) => c.name === v.colour)?.image || p.image, storage: v.storage, colour: v.colour, condition: v.condition, unitPrice: v.price, quantity: l.quantity });
  }
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  return { settings, option, lines, subtotal, deliveryFee: option.fee, total: subtotal + option.fee };
}

/**
 * Step 1 of checkout: prices the basket, creates the matching PayPal order and remembers the basket against it.
 * The browser only ever receives PayPal's order id.
 */
export async function startPayment(input: BasketInput): Promise<{ paypalOrderId: string }> {
  const { settings, lines, subtotal, deliveryFee, total } = await priceBasket(input);
  const customer = { ...input.customer, email: input.customer.email.trim().toLowerCase(), postcode: input.customer.postcode.toUpperCase().trim() };
  const reference = uid('pay');
  const paypalOrderId = await createPayPalOrder({
    reference,
    subtotal,
    deliveryFee,
    total,
    brandName: settings.store.name || 'CashMyMobile',
    items: lines.map((l) => ({ name: [l.brand, l.name, l.storage, l.colour, CONDITION_LABEL[l.condition]].filter(Boolean).join(' '), sku: `${l.productId}|${l.storage}|${l.colour}|${l.condition}`, unitPrice: l.unitPrice, quantity: l.quantity })),
    shipTo: { fullName: `${customer.firstName} ${customer.lastName}`, line1: customer.line1, line2: customer.line2, city: customer.city, postcode: customer.postcode },
  });
  const now = nowIso();
  await col.payments().insertOne({ id: reference, paypalOrderId, status: 'created', lines, customer, delivery: input.delivery, subtotal, deliveryFee, total, createdAt: now, updatedAt: now });
  logger.info('PayPal order created', { reference, paypalOrderId, total });
  return { paypalOrderId };
}

const releaseStock = async (lines: BasketLine[]) => {
  for (const l of lines) await col.products().updateOne({ id: l.productId, variants: { $elemMatch: variantOf(l) } }, { $inc: { 'variants.$.stock': l.quantity } }).catch(() => undefined);
};

/**
 * Step 2 of checkout, after the shopper approves in PayPal: reserves stock, captures the payment and creates the order.
 * Stock is reserved before any money moves, so a sold-out phone is never charged. Calling this again for the same
 * PayPal order returns the order already created.
 */
export async function checkout(paypalOrderId: string): Promise<OrderDoc> {
  const done = await col.orders().findOne({ paymentRef: paypalOrderId });
  if (done) return done;

  const payment = await col.payments().findOne({ paypalOrderId });
  if (!payment) throw conflict('This payment session has expired. Refresh the page and try again; you have not been charged.');
  // Only one request may work on a payment at a time.
  const claimed = await col.payments().findOneAndUpdate({ paypalOrderId, status: 'created' }, { $set: { status: 'processing', updatedAt: nowIso() } });
  if (!claimed) {
    if (payment.status === 'completed' && payment.orderNumber) return getOrder(payment.orderNumber);
    if (payment.status === 'processing') throw conflict('Your payment is already being processed. Please wait a moment.');
    throw conflict('This payment could not be completed. Refresh the page and try again; you have not been charged.');
  }
  const fail = async (status: PaymentDoc['status'], error: string) => {
    await col.payments().updateOne({ paypalOrderId }, { $set: { status, error, updatedAt: nowIso() } });
  };

  // The order the shopper approved must be the one we created, for the amount we priced.
  const pp = await getPayPalOrder(paypalOrderId).catch(async (e) => {
    await fail('created', String(e));
    throw e;
  });
  const unit = pp.purchase_units[0];
  if (!unit || unit.amount.currency_code !== 'GBP' || Number(unit.amount.value) !== payment.total || unit.reference_id !== payment.id) {
    await fail('failed', 'Amount or reference mismatch');
    throw badRequest('The PayPal payment does not match your basket. Please refresh and try again; you have not been charged.');
  }
  if (pp.status !== 'APPROVED' && pp.status !== 'COMPLETED') {
    await fail('created', `PayPal order is ${pp.status}`);
    throw badRequest('Please approve the payment in the PayPal window first.');
  }

  // Reserve stock. Nothing has been charged yet, so a failure here costs the shopper nothing.
  const lines = payment.lines;
  const taken: BasketLine[] = [];
  try {
    for (const l of lines) {
      const r = await col.products().updateOne(
        { id: l.productId, variants: { $elemMatch: { ...variantOf(l), stock: { $gte: l.quantity } } } },
        { $inc: { 'variants.$.stock': -l.quantity }, $set: { updatedAt: nowIso() } },
      );
      if (r.modifiedCount !== 1) throw conflict(`Sorry, the ${l.brand} ${l.name} sold out while you were paying. You have not been charged.`);
      taken.push(l);
    }
  } catch (e) {
    await releaseStock(taken);
    await fail('failed', String((e as Error).message));
    throw e;
  }

  // Take the money.
  let capture: CaptureResult;
  try {
    capture = await capturePayPalOrder(paypalOrderId);
  } catch (e) {
    await releaseStock(taken);
    // A declined card can be retried with another funding source in the same PayPal order.
    const retry = e instanceof PayPalError && e.issue === 'INSTRUMENT_DECLINED';
    await fail(retry ? 'created' : 'failed', String((e as Error).message));
    if (retry) throw new PayPalError(422, 'Your payment method was declined. Please choose another one in PayPal.', 'INSTRUMENT_DECLINED');
    throw e;
  }
  await recomputeFromPrice(lines.map((l) => l.productId));
  invalidateCatalog();

  const settings = await getSettings();
  const option = settings.delivery.find((d) => d.id === payment.delivery) ?? { etaDays: 1 };
  const now = new Date();
  const pending = capture.status === 'PENDING';
  const order: OrderDoc = {
    orderNumber: orderNumber(now),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    status: 'confirmed',
    lines,
    subtotal: payment.subtotal,
    deliveryFee: payment.deliveryFee,
    total: payment.total,
    delivery: payment.delivery,
    customer: payment.customer,
    estimatedDelivery: addDays(now, option.etaDays).toISOString(),
    paymentStatus: pending ? 'pending' : 'paid',
    paymentMethod: 'paypal',
    paymentRef: paypalOrderId,
    captureId: capture.captureId,
    refundedAmount: 0,
    events: [
      event('created', pending
        ? `Order placed · PayPal payment of £${payment.total} is PENDING${capture.reason ? ` (${capture.reason})` : ''}. Do not dispatch until PayPal completes it.`
        : `Order placed · paid £${payment.total} via PayPal (capture ${capture.captureId})`, 'Customer'),
    ],
    // A pending payment needs a person to watch it.
    flagged: pending,
  };
  // Order numbers are random; retry on the (very unlikely) collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await col.orders().insertOne({ ...order });
      break;
    } catch (e) {
      if ((e as { code?: number }).code === 11000 && attempt < 4) order.orderNumber = orderNumber(now);
      else {
        // The money is taken but the order could not be saved: keep everything needed to sort it out by hand.
        logger.error('Order insert failed after capture', { paypalOrderId, captureId: capture.captureId, err: String(e) });
        await fail('failed', `Captured ${capture.captureId} but order insert failed: ${String(e)}`);
        throw e;
      }
    }
  }
  await col.payments().updateOne({ paypalOrderId }, { $set: { status: 'completed', orderNumber: order.orderNumber, updatedAt: nowIso() } });
  logger.info('Order created', { orderNumber: order.orderNumber, total: order.total, payment: capture.status });

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
      await col.products().updateOne({ id: l.productId, variants: { $elemMatch: variantOf(l) } }, { $inc: { 'variants.$.stock': l.quantity }, $set: { updatedAt: nowIso() } });
    }
    await recomputeFromPrice(o.lines.map((l) => l.productId));
    invalidateCatalog();
    const remaining = o.total - o.refundedAmount;
    if (o.paymentStatus === 'pending') throw badRequest('PayPal is still clearing this payment. Wait until it completes before cancelling, or cancel it in PayPal.');
    if (remaining > 0 && o.paymentStatus !== 'failed') {
      if (!o.captureId) throw badRequest('This order has no PayPal capture to refund; refund it in PayPal directly.');
      await refundCapture(o.captureId, remaining, change.status === 'cancelled' ? 'Order cancelled' : 'Order returned');
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
  if (o.paymentStatus === 'pending' || o.paymentStatus === 'failed') throw badRequest(`This payment is ${o.paymentStatus} in PayPal, so there is nothing to refund yet.`);
  const remaining = o.total - o.refundedAmount;
  if (!(amount > 0) || amount > remaining) throw badRequest(`Refund must be between £1 and £${remaining}.`);
  if (!o.captureId) throw badRequest('This order has no PayPal capture to refund; refund it in PayPal directly.');
  await refundCapture(o.captureId, amount, reason);
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

interface PayPalWebhookEvent {
  id: string;
  event_type: string;
  resource: { id: string; status?: string; amount?: { value: string }; links?: Array<{ rel: string; href: string }>; status_details?: { reason?: string } };
}

/**
 * Keeps orders in step with PayPal. Only events PayPal has signed reach here (see the webhook route).
 *   PAYMENT.CAPTURE.COMPLETED  a pending payment has cleared → paid
 *   PAYMENT.CAPTURE.DENIED     a pending payment was refused → failed, flagged, stock released
 *   PAYMENT.CAPTURE.REFUNDED   a refund (ours or made in PayPal) → noted on the timeline
 *   PAYMENT.CAPTURE.REVERSED   a chargeback / reversal → flagged
 */
export async function handlePayPalWebhook(e: PayPalWebhookEvent): Promise<void> {
  const by = 'PayPal';
  // A refund's resource is the refund; its "up" link points at the capture.
  const captureId = e.event_type === 'PAYMENT.CAPTURE.REFUNDED' ? e.resource.links?.find((l) => l.rel === 'up')?.href.split('/').pop() : e.resource.id;
  if (!captureId) return;
  const o = await col.orders().findOne({ captureId });
  if (!o) {
    logger.info('PayPal webhook for an unknown capture', { type: e.event_type, captureId });
    return;
  }
  // PayPal retries deliveries; each event is applied once.
  if (o.events.some((ev) => ev.message.includes(`[${e.id}]`))) return;
  const tag = ` [${e.id}]`;
  switch (e.event_type) {
    case 'PAYMENT.CAPTURE.COMPLETED':
      if (o.paymentStatus !== 'pending') return;
      await col.orders().updateOne({ orderNumber: o.orderNumber }, { $set: { paymentStatus: 'paid', flagged: false, updatedAt: nowIso() }, $push: { events: event('payment', `PayPal payment completed · £${o.total} received${tag}`, by) } });
      return;
    case 'PAYMENT.CAPTURE.DENIED':
    case 'PAYMENT.CAPTURE.DECLINED': {
      await col.orders().updateOne({ orderNumber: o.orderNumber }, { $set: { paymentStatus: 'failed', status: 'cancelled', flagged: true, updatedAt: nowIso() }, $push: { events: event('payment', `PayPal DENIED the payment${e.resource.status_details?.reason ? ` (${e.resource.status_details.reason})` : ''}. Order cancelled and stock returned. Do not dispatch.${tag}`, by) } });
      if (o.status !== 'cancelled') {
        await releaseStock(o.lines);
        await recomputeFromPrice(o.lines.map((l) => l.productId));
        invalidateCatalog();
      }
      return;
    }
    case 'PAYMENT.CAPTURE.REFUNDED':
      await addEvent(o.orderNumber, event('payment', `PayPal confirmed a refund of £${e.resource.amount?.value ?? '?'} (refund ${e.resource.id})${tag}`, by));
      return;
    case 'PAYMENT.CAPTURE.REVERSED':
      await col.orders().updateOne({ orderNumber: o.orderNumber }, { $set: { flagged: true, updatedAt: nowIso() }, $push: { events: event('payment', `PayPal REVERSED this payment (chargeback or dispute). Check the PayPal Resolution Centre.${tag}`, by) } });
      return;
    default:
      logger.debug('PayPal webhook ignored', { type: e.event_type });
  }
}
