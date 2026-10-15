// PayPal Orders v2 client (server-side integration).
//
// Flow: the server creates the PayPal order from a basket it has priced itself → the shopper approves it in the
// PayPal window → the server checks the approved order and captures it. Card and bank details never touch us.
// Every write carries a PayPal-Request-Id so a retried request can never create or capture twice.
import { env } from '../config/env.js';
import { logger } from './logger.js';
import { HttpError } from './errors.js';

const BASE = env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
let token: { value: string; exp: number } | null = null;

function requireConfigured(what = 'Payments are not available right now. Please try again later.') {
  if (!env.paypalEnabled) throw new HttpError(503, what);
}

async function accessToken(): Promise<string> {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const auth = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${BASE}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  if (!res.ok) {
    logger.error('PayPal auth failed', { status: res.status, mode: env.PAYPAL_MODE });
    throw new HttpError(502, 'Could not reach PayPal. Please try again.');
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return token.value;
}

interface PayPalErrorBody {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: Array<{ issue?: string; description?: string }>;
}

/** A PayPal API error. `issue` is PayPal's machine-readable reason, e.g. INSTRUMENT_DECLINED. */
export class PayPalError extends HttpError {
  constructor(status: number, message: string, public issue?: string, public debugId?: string) {
    super(status, message, issue ? { issue } : undefined);
  }
}

async function call<T>(path: string, init: RequestInit & { requestId?: string } = {}): Promise<T> {
  const t = await accessToken();
  const { requestId, ...rest } = init;
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
      ...(rest.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as T & PayPalErrorBody;
  if (!res.ok) {
    const issue = body.details?.[0]?.issue ?? body.name;
    logger.error('PayPal error', { path, status: res.status, issue, debugId: body.debug_id });
    // 4xx from PayPal is about this payment (declined, expired, already captured…); 5xx is PayPal being unwell.
    throw new PayPalError(res.status >= 500 ? 502 : 422, body.details?.[0]?.description ?? body.message ?? 'PayPal rejected the request.', issue, body.debug_id);
  }
  return body;
}

const gbp = (n: number) => ({ currency_code: 'GBP', value: n.toFixed(2) });
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

interface Capture { id: string; status: string; amount: { currency_code: string; value: string }; status_details?: { reason?: string } }
export interface PayPalOrder {
  id: string;
  status: 'CREATED' | 'SAVED' | 'APPROVED' | 'VOIDED' | 'COMPLETED' | 'PAYER_ACTION_REQUIRED';
  purchase_units: Array<{ reference_id?: string; amount: { currency_code: string; value: string }; payments?: { captures?: Capture[] } }>;
  payer?: { email_address?: string; payer_id?: string };
}

export interface NewPayPalOrder {
  /** Our own id for this checkout attempt; also PayPal's invoice id, so it must be unique. */
  reference: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
  items: Array<{ name: string; sku: string; unitPrice: number; quantity: number }>;
  shipTo: { fullName: string; line1: string; line2?: string; city: string; postcode: string };
  brandName: string;
}

/** Creates the PayPal order for a server-priced basket and returns PayPal's order id. */
export async function createOrder(o: NewPayPalOrder): Promise<string> {
  requireConfigured();
  const order = await call<PayPalOrder>('/v2/checkout/orders', {
    method: 'POST',
    requestId: `create-${o.reference}`,
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: o.reference,
          invoice_id: o.reference,
          custom_id: o.reference,
          description: cut(`${o.brandName} order`, 127),
          soft_descriptor: 'CASHMYMOBILE',
          amount: { ...gbp(o.total), breakdown: { item_total: gbp(o.subtotal), shipping: gbp(o.deliveryFee) } },
          items: o.items.map((i) => ({ name: cut(i.name, 127), sku: cut(i.sku, 127), unit_amount: gbp(i.unitPrice), quantity: String(i.quantity), category: 'PHYSICAL_GOODS' })),
          shipping: {
            type: 'SHIPPING',
            name: { full_name: cut(o.shipTo.fullName, 300) },
            address: { address_line_1: o.shipTo.line1, ...(o.shipTo.line2 ? { address_line_2: o.shipTo.line2 } : {}), admin_area_2: o.shipTo.city, postal_code: o.shipTo.postcode, country_code: 'GB' },
          },
        },
      ],
      application_context: { brand_name: cut(o.brandName, 127), locale: 'en-GB', shipping_preference: 'SET_PROVIDED_ADDRESS', user_action: 'PAY_NOW' },
    }),
  });
  return order.id;
}

export async function getOrder(paypalOrderId: string): Promise<PayPalOrder> {
  requireConfigured();
  return call<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
}

export interface CaptureResult {
  captureId: string;
  /** COMPLETED = money is ours; PENDING = PayPal is still clearing it (e.g. eCheck, review). */
  status: 'COMPLETED' | 'PENDING';
  amount: number;
  payerEmail?: string;
  reason?: string;
}

const firstCapture = (o: PayPalOrder) => o.purchase_units[0]?.payments?.captures?.[0];

/** Captures an approved order. Safe to call twice: a repeat returns the original capture. */
export async function captureOrder(paypalOrderId: string): Promise<CaptureResult> {
  requireConfigured();
  let order: PayPalOrder;
  try {
    order = await call<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, { method: 'POST', requestId: `capture-${paypalOrderId}`, body: '{}' });
  } catch (e) {
    if (e instanceof PayPalError && e.issue === 'ORDER_ALREADY_CAPTURED') order = await getOrder(paypalOrderId);
    else throw e;
  }
  const cap = firstCapture(order);
  if (!cap) throw new HttpError(502, 'PayPal did not return a capture.');
  if (cap.status !== 'COMPLETED' && cap.status !== 'PENDING') {
    throw new PayPalError(422, 'Your payment was declined by PayPal. Please try another payment method.', cap.status === 'DECLINED' ? 'INSTRUMENT_DECLINED' : cap.status);
  }
  return { captureId: cap.id, status: cap.status, amount: Number(cap.amount.value), payerEmail: order.payer?.email_address, reason: cap.status_details?.reason };
}

export async function refundCapture(captureId: string, amount: number, note: string, requestId?: string): Promise<{ refundId: string }> {
  requireConfigured('PayPal is not configured, so the refund cannot be sent. Add the PayPal credentials and try again.');
  const r = await call<{ id: string; status: string }>(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
    method: 'POST',
    ...(requestId ? { requestId } : {}),
    body: JSON.stringify({ amount: gbp(amount), note_to_payer: note.slice(0, 255) }),
  });
  return { refundId: r.id };
}

/** Asks PayPal whether a webhook delivery is genuine. Needs PAYPAL_WEBHOOK_ID from the PayPal developer dashboard. */
export async function verifyWebhook(headers: Record<string, string | string[] | undefined>, event: unknown): Promise<boolean> {
  if (!env.paypalEnabled || !env.PAYPAL_WEBHOOK_ID) return false;
  const h = (k: string) => String(headers[k] ?? '');
  const r = await call<{ verification_status: string }>('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: JSON.stringify({
      auth_algo: h('paypal-auth-algo'),
      cert_url: h('paypal-cert-url'),
      transmission_id: h('paypal-transmission-id'),
      transmission_sig: h('paypal-transmission-sig'),
      transmission_time: h('paypal-transmission-time'),
      webhook_id: env.PAYPAL_WEBHOOK_ID,
      webhook_event: event,
    }),
  }).catch(() => ({ verification_status: 'FAILURE' }));
  return r.verification_status === 'SUCCESS';
}
