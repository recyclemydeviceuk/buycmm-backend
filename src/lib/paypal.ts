// Minimal PayPal Orders v2 client. The storefront creates the PayPal order in the browser and sends its id
// as `paymentToken`; the server verifies the amount and captures it, so no card data ever touches us.
import { env } from '../config/env.js';
import { logger } from './logger.js';
import { badRequest, HttpError } from './errors.js';

const BASE = env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
let token: { value: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && token.exp > Date.now() + 30_000) return token.value;
  const auth = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${BASE}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  if (!res.ok) throw new HttpError(502, 'Could not reach PayPal.');
  const data = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return token.value;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const t = await accessToken();
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as T & { message?: string; details?: Array<{ issue?: string; description?: string }> };
  if (!res.ok) {
    logger.error('PayPal error', { path, status: res.status, body: JSON.stringify(body).slice(0, 400) });
    throw new HttpError(502, body.details?.[0]?.description ?? body.message ?? 'PayPal rejected the request.');
  }
  return body;
}

interface PayPalOrder {
  id: string;
  status: string;
  purchase_units: Array<{ amount: { currency_code: string; value: string }; payments?: { captures?: Array<{ id: string; status: string; amount: { value: string } }> } }>;
}

/** Verifies the approved order matches our total, captures it and returns the capture id. */
export async function captureOrder(paypalOrderId: string, expectedTotal: number): Promise<{ captureId: string }> {
  if (!env.paypalEnabled) throw new HttpError(503, 'Payments are not available right now. Please try again later.');
  const order = await call<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
  const unit = order.purchase_units[0];
  if (!unit || unit.amount.currency_code !== 'GBP' || Math.round(Number(unit.amount.value)) !== Math.round(expectedTotal)) {
    throw badRequest('The PayPal payment does not match the basket total. Please try again.');
  }
  if (order.status === 'COMPLETED') {
    const cap = unit.payments?.captures?.[0];
    if (cap) return { captureId: cap.id };
  }
  if (order.status !== 'APPROVED') throw badRequest(`PayPal payment is ${order.status.toLowerCase()}; approve it and try again.`);
  const captured = await call<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, { method: 'POST', body: '{}' });
  const cap = captured.purchase_units[0]?.payments?.captures?.[0];
  if (!cap || cap.status !== 'COMPLETED') throw new HttpError(502, 'PayPal could not complete the capture.');
  return { captureId: cap.id };
}

export async function refundCapture(captureId: string, amount: number, note: string): Promise<{ refundId: string }> {
  if (!env.paypalEnabled) throw new HttpError(503, 'PayPal is not configured, so the refund cannot be sent. Add the PayPal credentials and try again.');
  const r = await call<{ id: string; status: string }>(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, { method: 'POST', body: JSON.stringify({ amount: { value: amount.toFixed(2), currency_code: 'GBP' }, note_to_payer: note.slice(0, 255) }) });
  return { refundId: r.id };
}
