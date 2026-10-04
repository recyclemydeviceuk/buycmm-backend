// Keep in sync with ../../admin/src/lib/permissions.ts — the admin UI hides what a role lacks, the API enforces it.
export const ALL_PERMISSIONS = [
  'dashboard.view',
  'orders.view', 'orders.manage', 'orders.refund', 'orders.export',
  'products.view', 'products.edit', 'products.delete', 'inventory.edit', 'pricing.rules',
  'customers.view', 'customers.edit',
  'reviews.manage', 'enquiries.manage', 'subscribers.manage',
  'settings.view', 'settings.edit', 'team.view', 'team.manage', 'activity.view',
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];
export const isPermission = (p: string): p is Permission => (ALL_PERMISSIONS as readonly string[]).includes(p);
