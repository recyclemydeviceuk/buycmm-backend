// HTML emails for the buy side. Same warm palette as the storefront; table layout for email clients.
import { env } from '../config/env.js';
import type { OrderDoc } from '../types.js';
import { CONDITION_LABEL, money } from '../lib/format.js';

const LOGO = 'https://res.cloudinary.com/dn2sab6qc/image/upload/v1772457689/CMM-Logo_kid8km.png';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function layout(title: string, body: string, preheader = '') {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:24px;background:#F6F3EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0B0C10;line-height:1.6">
<span style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center">
<table role="presentation" width="600" style="max-width:600px;width:100%;background:#fff;border-radius:20px;overflow:hidden;border:1px solid #E7E4DE" cellspacing="0" cellpadding="0" border="0">
<tr><td style="padding:28px 32px 8px"><img src="${LOGO}" alt="CashMyMobile" height="30" style="height:30px"></td></tr>
<tr><td style="padding:8px 32px 32px">${body}</td></tr>
<tr><td style="padding:20px 32px;background:#FBF9F5;border-top:1px solid #E7E4DE;font-size:12px;color:#6E737C">
CashMyMobile · <a href="mailto:${env.SUPPORT_EMAIL}" style="color:#6E737C">${env.SUPPORT_EMAIL}</a> · <a href="${env.STOREFRONT_URL}" style="color:#6E737C">${env.STOREFRONT_URL.replace(/^https?:\/\//, '')}</a><br>
12-month warranty · 30-day returns · Free tracked delivery</td></tr>
</table></td></tr></table></body></html>`;
}
const h1 = (t: string) => `<h1 style="margin:0 0 8px;font-size:24px;line-height:1.2;letter-spacing:-.02em">${t}</h1>`;
const p = (t: string) => `<p style="margin:0 0 14px;font-size:15px;color:#3A3F47">${t}</p>`;
const button = (href: string, label: string, color = '#D01A2A') => `<p style="margin:22px 0"><a href="${href}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:999px;font-size:15px">${esc(label)}</a></p>`;
const pill = (t: string, bg: string, fg: string) => `<span style="display:inline-block;background:${bg};color:${fg};font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px">${esc(t)}</span>`;

function orderLines(o: OrderDoc) {
  const rows = o.lines.map((l) => `<tr><td style="padding:10px 0;border-bottom:1px solid #F0EDE7;font-size:14px"><b>${esc(l.brand)} ${esc(l.name)}</b><br><span style="color:#6E737C;font-size:12.5px">${[l.storage, l.colour, CONDITION_LABEL[l.condition]].filter(Boolean).map(esc).join(' · ')} × ${l.quantity}</span></td><td align="right" style="padding:10px 0;border-bottom:1px solid #F0EDE7;font-size:14px;font-weight:600;white-space:nowrap">${money(l.unitPrice * l.quantity)}</td></tr>`).join('');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${rows}
<tr><td style="padding:10px 0 4px;font-size:13px;color:#6E737C">Subtotal</td><td align="right" style="padding:10px 0 4px;font-size:13px">${money(o.subtotal)}</td></tr>
<tr><td style="padding:4px 0;font-size:13px;color:#6E737C">Delivery</td><td align="right" style="padding:4px 0;font-size:13px">${o.deliveryFee ? money(o.deliveryFee) : '<span style="color:#127A4A;font-weight:700">Free</span>'}</td></tr>
<tr><td style="padding:10px 0;font-size:16px;font-weight:800;border-top:1px solid #E7E4DE">Total paid</td><td align="right" style="padding:10px 0;font-size:16px;font-weight:800;border-top:1px solid #E7E4DE">${money(o.total)}</td></tr></table>`;
}
const address = (o: OrderDoc) => [`${o.customer.firstName} ${o.customer.lastName}`, o.customer.line1, o.customer.line2, o.customer.city, o.customer.postcode].filter((x): x is string => !!x).map(esc).join('<br>');
const eta = (o: OrderDoc) => new Date(o.estimatedDelivery).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const trackUrl = (o: OrderDoc) => `${env.STOREFRONT_URL}/track?order=${encodeURIComponent(o.orderNumber)}`;

export const emails = {
  otp(code: string, minutes: number) {
    return {
      subject: `${code} is your BuyUpon admin code`,
      html: layout('Your sign-in code', `${h1('Your sign-in code')}${p('Enter this code in the BuyUpon admin to sign in. It expires in ' + minutes + ' minutes and can only be used once.')}
<p style="margin:24px 0;text-align:center"><span style="display:inline-block;font-family:ui-monospace,Menlo,monospace;font-size:34px;letter-spacing:.35em;font-weight:700;background:#F6F3EE;padding:16px 24px 16px 32px;border-radius:16px">${code}</span></p>
${p('If you did not request this, you can ignore this email. Nobody can sign in without the code.')}`, `Your code is ${code}`),
    };
  },
  orderConfirmation(o: OrderDoc) {
    return {
      subject: `Order confirmed · ${o.orderNumber}`,
      html: layout('Order confirmed', `${pill('Order confirmed', '#DDF3E4', '#127A4A')}${h1(`Thanks, ${esc(o.customer.firstName)}. Your phone is on its way to being packed.`)}
${p(`Order <b>${o.orderNumber}</b> placed ${new Date(o.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}. Expected delivery <b>${eta(o)}</b> (${o.delivery === 'next-day' ? 'next-day tracked, signature required' : 'standard tracked'}).`)}
${orderLines(o)}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:20px"><tr><td style="background:#F6F3EE;border-radius:14px;padding:14px 16px;font-size:13.5px"><b>Delivering to</b><br>${address(o)}</td></tr></table>
${button(trackUrl(o), 'Track your order', '#0B0C10')}
${p('Every phone is 40-point tested and comes with a 12-month warranty and 30-day returns. Reply to this email if you need anything.')}`, `Order ${o.orderNumber} confirmed`),
    };
  },
  dispatched(o: OrderDoc) {
    const t = o.tracking;
    return {
      subject: `Your phone is on its way · ${o.orderNumber}`,
      html: layout('Dispatched', `${pill('Dispatched', '#DCEBFA', '#1D5FB4')}${h1('Your phone is with the courier')}
${p(`Order <b>${o.orderNumber}</b> was dispatched ${o.delivery === 'next-day' ? 'on a next-day tracked service with signature required' : 'on a tracked service'}. Expected delivery <b>${eta(o)}</b>.`)}
${t ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="background:#F6F3EE;border-radius:14px;padding:14px 16px;font-size:13.5px"><b>${esc(t.carrier)}</b><br><span style="font-family:ui-monospace,Menlo,monospace">${esc(t.number)}</span></td></tr></table>${t.url ? button(t.url, 'Track with the courier', '#0B0C10') : ''}` : ''}
${orderLines(o)}
${p('Please check the box in front of the courier if you can. Any problem at all, reply to this email within 30 days.')}`, `Order ${o.orderNumber} dispatched`),
    };
  },
  delivered(o: OrderDoc) {
    return {
      subject: `Delivered · ${o.orderNumber}`,
      html: layout('Delivered', `${pill('Delivered', '#DDF3E4', '#127A4A')}${h1('Enjoy your phone')}
${p(`Order <b>${o.orderNumber}</b> has been delivered. Your 12-month warranty started today, and you have 30 days to return it for any reason.`)}
${p('If you have a minute, a short review helps other customers choose the right grade.')}
${button(`${env.STOREFRONT_URL}/phones/${o.lines[0]?.slug ?? ''}#reviews`, 'Leave a review')}`, `Order ${o.orderNumber} delivered`),
    };
  },
  cancelled(o: OrderDoc, refund: number) {
    return {
      subject: `Order cancelled · ${o.orderNumber}`,
      html: layout('Order cancelled', `${pill('Cancelled', '#FDE6DA', '#B01524')}${h1('Your order has been cancelled')}
${p(`Order <b>${o.orderNumber}</b> has been cancelled${refund > 0 ? ` and <b>${money(refund)}</b> has been refunded to your PayPal account. Refunds usually show within 3 to 5 working days` : ''}.`)}
${p('If this was not expected, reply to this email and we will sort it out.')}`, `Order ${o.orderNumber} cancelled`),
    };
  },
  refund(o: OrderDoc, amount: number, reason: string) {
    return {
      subject: `Refund issued · ${o.orderNumber}`,
      html: layout('Refund issued', `${pill('Refund', '#E8E2F8', '#5B3FA6')}${h1(`${money(amount)} is on its way back to you`)}
${p(`We have refunded <b>${money(amount)}</b> on order <b>${o.orderNumber}</b> to your PayPal account${reason ? ` (${esc(reason)})` : ''}. It usually shows within 3 to 5 working days.`)}`, `Refund of ${money(amount)}`),
    };
  },
  invoice(o: OrderDoc) {
    return {
      subject: `VAT invoice · ${o.orderNumber}`,
      html: layout('VAT invoice', `${h1('VAT invoice')}${p(`Invoice for order <b>${o.orderNumber}</b>, dated ${new Date(o.createdAt).toLocaleDateString('en-GB')}. Prices include VAT under the second-hand margin scheme; no VAT is separately recoverable.`)}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:16px"><tr><td style="font-size:13.5px"><b>Billed to</b><br>${address(o)}<br>${esc(o.customer.email)}</td></tr></table>
${orderLines(o)}`, `Invoice ${o.orderNumber}`),
    };
  },
  enquiryReceived(name: string, message: string) {
    return {
      subject: 'We received your message',
      html: layout('We received your message', `${h1(`Thanks, ${esc(name.split(' ')[0])}`)}${p('We have your message and will reply by email, usually within one working day.')}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="background:#F6F3EE;border-radius:14px;padding:14px 16px;font-size:13.5px;color:#3A3F47;white-space:pre-wrap">${esc(message)}</td></tr></table>`, 'We received your message'),
    };
  },
  enquiryReply(name: string, original: string, reply: string) {
    return {
      subject: 'Re: your enquiry',
      html: layout('Reply from CashMyMobile', `${h1(`Hi ${esc(name.split(' ')[0])}`)}<div style="font-size:15px;color:#3A3F47;white-space:pre-wrap;margin-bottom:20px">${esc(reply)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-left:3px solid #E7E4DE;padding:4px 12px;font-size:13px;color:#6E737C;white-space:pre-wrap">${esc(original)}</td></tr></table>`, reply.slice(0, 80)),
    };
  },
  adminNewOrder(o: OrderDoc) {
    return {
      subject: `New order ${o.orderNumber} · ${money(o.total)}`,
      html: layout('New order', `${h1(`New order · ${money(o.total)}`)}${p(`<b>${o.orderNumber}</b> from ${esc(o.customer.firstName)} ${esc(o.customer.lastName)} (${esc(o.customer.city)}) · ${o.delivery === 'next-day' ? 'next-day' : 'standard'} delivery.`)}
${orderLines(o)}${button(`${env.ADMIN_URL}/orders/${o.orderNumber}`, 'Open in admin', '#0B0C10')}`, `New order ${o.orderNumber}`),
    };
  },
  adminNewEnquiry(e: { id: string; name: string; email: string; message: string; orderNumber?: string }) {
    return {
      subject: `New enquiry from ${e.name}`,
      html: layout('New enquiry', `${h1('New enquiry')}${p(`<b>${esc(e.name)}</b> · ${esc(e.email)}${e.orderNumber ? ` · order ${e.orderNumber}` : ''}`)}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="background:#F6F3EE;border-radius:14px;padding:14px 16px;font-size:13.5px;white-space:pre-wrap">${esc(e.message)}</td></tr></table>
${button(`${env.ADMIN_URL}/enquiries?open=${e.id}`, 'Reply in admin', '#0B0C10')}`, e.message.slice(0, 80)),
    };
  },
  adminNewReview(r: { id: string; author: string; productName: string; rating: number; title: string }) {
    return {
      subject: `New review to moderate · ${r.rating}★ on ${r.productName}`,
      html: layout('New review', `${h1('New review waiting')}${p(`<b>${esc(r.author)}</b> left ${r.rating}★ on <b>${esc(r.productName)}</b>: “${esc(r.title)}”.`)}${button(`${env.ADMIN_URL}/reviews?status=pending`, 'Moderate', '#0B0C10')}`, r.title),
    };
  },
};
