import { ALL_PERMISSIONS } from '../lib/permissions.js';
import type { RoleDoc, SettingsDoc } from '../types.js';

export function defaultSettings(): SettingsDoc {
  return {
    id: 'main',
    store: { name: 'CashMyMobile', supportEmail: 'support@cashmymobile.co.uk', whatsapp: '447700900123', hours: 'Monday to Friday, 9am to 5:30pm', siteUrl: 'https://buy.cashmymobile.co.uk', warrantyMonths: 12, returnsDays: 30 },
    delivery: [
      { id: 'next-day', label: 'Next-day tracked', description: 'Order by 3pm, arrives tomorrow. Signature required.', fee: 0, etaDays: 1, cutoff: '15:00', enabled: true },
      { id: 'standard', label: 'Standard tracked', description: 'Arrives in 2 to 3 working days.', fee: 0, etaDays: 3, cutoff: '17:00', enabled: true },
    ],
    networks: ['Unlocked', 'EE', 'Vodafone', 'O2', 'Three'],
    storages: ['64GB', '128GB', '256GB', '512GB', '1TB'],
    conditions: [
      { key: 'excellent', label: 'Excellent', short: 'Looks like new', blurb: 'Near-flawless. No visible marks from 20cm away, 90%+ battery health.', minBattery: 90 },
      { key: 'good', label: 'Good', short: 'Light signs of use', blurb: 'Light scratches on the body, screen clean. 85%+ battery health.', minBattery: 85 },
      { key: 'fair', label: 'Fair', short: 'Visible wear, works perfectly', blurb: 'Noticeable scratches or dents. Same 12-month warranty. 80%+ battery health.', minBattery: 80 },
    ],
    featuredSlugs: ['apple-iphone-15', 'samsung-galaxy-s24', 'apple-iphone-16-pro', 'samsung-galaxy-s25-ultra', 'apple-iphone-14', 'samsung-galaxy-z-flip-6', 'apple-iphone-13', 'samsung-galaxy-a56'],
    lowStockThreshold: 2,
    payments: { provider: 'paypal', mode: 'sandbox', clientId: '', merchantEmail: 'payments@cashmymobile.co.uk' },
    notifications: { orderEmail: true, lowStockEmail: true, enquiryEmail: true, reviewEmail: true, notifyTo: 'support@cashmymobile.co.uk' },
  };
}

export function defaultRoles(): RoleDoc[] {
  const at = new Date().toISOString();
  return [
    { id: 'role_owner', name: 'Owner', description: 'Full access to everything, including the team and roles.', permissions: [...ALL_PERMISSIONS], system: true, color: 'brand', createdAt: at, updatedAt: at },
    { id: 'role_manager', name: 'Manager', description: 'Runs the store day to day: orders, refunds, catalogue, pricing, settings. Cannot manage the team.', permissions: ALL_PERMISSIONS.filter((p) => p !== 'team.manage'), system: true, color: 'ink', createdAt: at, updatedAt: at },
    { id: 'role_staff', name: 'Staff', description: 'Fulfils orders, updates stock, moderates reviews and answers enquiries.', permissions: ['dashboard.view', 'orders.view', 'orders.manage', 'products.view', 'inventory.edit', 'customers.view', 'reviews.manage', 'enquiries.manage'], system: true, color: 'sky', createdAt: at, updatedAt: at },
  ];
}
