import type { NextFunction, Request, Response } from 'express';
import { col, clean } from '../config/db.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyToken } from '../lib/jwt.js';
import type { Permission } from '../lib/permissions.js';
import type { AuthUser } from '../types.js';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthUser;
  }
}

/** Resolves the bearer token to the admin and their role; 401 when missing, suspended or unknown. */
export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = token ? verifyToken(token) : null;
    if (!payload) throw unauthorized();
    const user = await col.admins().findOne({ id: payload.sub });
    if (!user || user.status !== 'active') throw unauthorized('This account can no longer sign in.');
    const role = await col.roles().findOne({ id: user.roleId });
    if (!role) throw unauthorized('No role assigned. Ask an owner.');
    req.auth = { user: clean(user), role: clean(role) };
    next();
  } catch (e) {
    next(e);
  }
}

export const requirePermission = (...perms: Permission[]) => (req: Request, _res: Response, next: NextFunction) => {
  const have = req.auth?.role.permissions ?? [];
  if (!perms.some((p) => have.includes(p))) return next(forbidden(`This needs the “${perms[0]}” permission.`));
  next();
};

export const actor = (req: Request) => req.auth?.user.name ?? 'System';
