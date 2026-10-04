import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { col, clean } from '../../config/db.js';
import { env } from '../../config/env.js';
import { badRequest, unauthorized, HttpError } from '../../lib/errors.js';
import { parse, wrap } from '../../lib/http.js';
import { norm, nowIso, otpCode } from '../../lib/ids.js';
import { signToken } from '../../lib/jwt.js';
import { sendEmail } from '../../lib/brevo.js';
import { emails } from '../../emails/templates.js';
import { requireAdmin } from '../../middleware/auth.js';
import { logActivity } from '../../services/activity.js';

export const authRouter = Router();
const otpLimit = rateLimit({ windowMs: 15 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many attempts. Try again in 15 minutes.' } });

/** Step 1: email a six-digit code. Unknown or suspended emails get a 401 before any email is sent. */
authRouter.post('/request-otp', otpLimit, wrap(async (req, res) => {
  const { email } = parse(z.object({ email: z.string().trim().email() }), req.body);
  const e = norm(email);
  const user = await col.admins().findOne({ email: e });
  if (!user) throw unauthorized('That email is not on the admin list.');
  if (user.status === 'suspended') throw unauthorized('This account is suspended. Ask the owner to restore access.');
  await col.otps().updateMany({ email: e, used: false }, { $set: { used: true } });
  const code = otpCode();
  const expiresAt = new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60_000);
  await col.otps().insertOne({ email: e, code, attempts: 0, used: false, createdAt: new Date(), expiresAt });
  const mail = emails.otp(code, env.OTP_EXPIRY_MINUTES);
  const sent = await sendEmail(e, mail.subject, mail.html);
  if (!sent.ok) {
    await col.otps().updateOne({ email: e, code }, { $set: { used: true } });
    throw new HttpError(502, `We could not send the sign-in email (${sent.error ?? 'email provider error'}). Try again in a moment.`);
  }
  res.json({ ok: true });
}));

/** Step 2: verify the code and issue a JWT. */
authRouter.post('/verify-otp', otpLimit, wrap(async (req, res) => {
  const { email, code } = parse(z.object({ email: z.string().trim().email(), code: z.string().trim().regex(/^\d{6}$/, 'Enter the six-digit code.') }), req.body);
  const e = norm(email);
  const otp = await col.otps().findOne({ email: e, used: false }, { sort: { createdAt: -1 } });
  if (!otp) throw badRequest('Request a new code and try again.');
  if (otp.expiresAt.getTime() < Date.now()) throw badRequest('That code has expired. Request a new one.');
  if (otp.attempts >= 5) throw badRequest('Too many wrong attempts. Request a new code.');
  if (otp.code !== code) {
    await col.otps().updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
    throw badRequest('Incorrect code. Check the digits and try again.');
  }
  await col.otps().updateOne({ _id: otp._id }, { $set: { used: true } });
  const user = await col.admins().findOne({ email: e });
  if (!user || user.status !== 'active') throw unauthorized('This account can no longer sign in.');
  const role = await col.roles().findOne({ id: user.roleId });
  if (!role) throw unauthorized('No role assigned. Ask an owner.');
  await col.admins().updateOne({ id: user.id }, { $set: { lastLoginAt: nowIso() } });
  await logActivity(user.name, 'Signed in', user.email, 'admin');
  res.json({ token: signToken({ sub: user.id, email: user.email }), user: clean({ ...user, lastLoginAt: nowIso() }), role: clean(role) });
}));

authRouter.get('/me', requireAdmin, (req, res) => res.json(req.auth));
authRouter.post('/logout', requireAdmin, wrap(async (req, res) => {
  await logActivity(req.auth!.user.name, 'Signed out', req.auth!.user.email, 'admin');
  res.status(204).end();
}));
