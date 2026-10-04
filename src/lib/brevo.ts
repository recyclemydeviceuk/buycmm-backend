import { env } from '../config/env.js';
import { logger } from './logger.js';

const API_URL = 'https://api.brevo.com/v3/smtp/email';

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|tr|h[1-6]|li)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&pound;/g, '£').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Sends a transactional email through Brevo with the same sender as the sell site. Email is best-effort:
 * the result is returned (and logged) but callers decide whether a failure is fatal (OTP) or not (receipts).
 */
export async function sendEmail(to: string | string[], subject: string, html: string, opts?: { replyTo?: string; text?: string }): Promise<SendResult> {
  const toList = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!env.BREVO_API_KEY) {
    logger.warn('BREVO_API_KEY not set; email not sent', { to: toList, subject });
    return { ok: false, error: 'Email is not configured (BREVO_API_KEY missing).' };
  }
  const payload = {
    sender: { name: env.FROM_NAME_Brevo, email: env.FROM_EMAIL_Brevo },
    to: toList.map((email) => ({ email })),
    replyTo: { email: opts?.replyTo ?? env.SUPPORT_EMAIL },
    subject,
    htmlContent: html,
    textContent: opts?.text ?? htmlToText(html) ?? subject,
  };
  try {
    const res = await fetch(API_URL, { method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error('Brevo rejected email', { to: toList, subject, status: res.status, body: body.slice(0, 300) });
      return { ok: false, error: `Email provider error (${res.status}).` };
    }
    const data = (await res.json().catch(() => ({}))) as { messageId?: string };
    logger.info('Email sent', { to: toList, subject, messageId: data.messageId });
    return { ok: true, messageId: data.messageId };
  } catch (e) {
    logger.error('Brevo request failed', { to: toList, subject, error: String(e) });
    return { ok: false, error: 'Could not reach the email provider.' };
  }
}
