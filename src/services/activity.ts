import { col } from '../config/db.js';
import { nowIso, uid } from '../lib/ids.js';
import type { ActivityDoc } from '../types.js';

export async function logActivity(actor: string, action: string, target?: string, targetType?: ActivityDoc['targetType'], detail?: string) {
  await col.activity().insertOne({ id: uid('act'), at: nowIso(), actor, action, target, targetType, detail });
}
