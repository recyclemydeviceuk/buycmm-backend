export const STORAGE_ORDER = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB', '2TB'];
export const storageIndex = (s: string) => {
  const i = STORAGE_ORDER.indexOf(s);
  return i === -1 ? 99 : i;
};
export const CONDITIONS = ['excellent', 'good', 'fair'] as const;
export type Condition = (typeof CONDITIONS)[number];
export const CONDITION_LABEL: Record<Condition, string> = { excellent: 'Excellent', good: 'Good', fair: 'Fair' };
export const ORDER_STATUSES = ['confirmed', 'packing', 'dispatched', 'delivered', 'cancelled', 'returned'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const NEXT_STATUSES: Record<OrderStatus, OrderStatus[]> = {
  confirmed: ['packing', 'dispatched', 'cancelled'],
  packing: ['dispatched', 'confirmed', 'cancelled'],
  dispatched: ['delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};
export const money = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
export const DAY = 86_400_000;
export const dayKey = (d: Date | string) => {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
export const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
