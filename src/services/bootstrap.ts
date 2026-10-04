// Runs at startup: makes sure built-in roles, settings and the owner admins from BUY_ADMIN_EMAILS exist.
import { col } from '../config/db.js';
import { env } from '../config/env.js';
import { nowIso, uid } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { defaultRoles } from './defaults.js';
import { getSettings } from './settings.js';

export async function bootstrap() {
  for (const r of defaultRoles()) {
    const existing = await col.roles().findOne({ id: r.id });
    if (!existing) await col.roles().insertOne(r);
    else if (r.id === 'role_owner') await col.roles().updateOne({ id: r.id }, { $set: { permissions: r.permissions } }); // owner always has everything
  }
  await getSettings();
  for (const email of env.adminEmails) {
    const existing = await col.admins().findOne({ email });
    if (!existing) {
      await col.admins().insertOne({ id: uid('adm'), email, name: email.split('@')[0], roleId: 'role_owner', status: 'active', createdAt: nowIso() });
      logger.info('Seeded owner admin', { email });
    }
  }
  if (!(await col.admins().countDocuments({}))) logger.warn('No admins exist. Set BUY_ADMIN_EMAILS so someone can sign in.');
}
