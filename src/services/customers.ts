import { col } from '../config/db.js';
import { norm } from '../lib/ids.js';
import type { OrderDoc } from '../types.js';

export interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  postcode: string;
  orders: number;
  spent: number;
  firstOrderAt: string;
  lastOrderAt: string;
  subscribed: boolean;
  notes: string;
}

/** Customers are derived from orders (keyed by email) rather than stored, so they can never drift from the order book. */
export async function customersFromOrders(orders?: OrderDoc[]): Promise<Customer[]> {
  const all = orders ?? (await col.orders().find({}).toArray());
  const subs = new Set((await col.subscribers().find({ status: 'subscribed' }, { projection: { email: 1 } }).toArray()).map((s) => norm(s.email)));
  const notes = new Map((await col.customerNotes().find({}).toArray()).map((n) => [n.id, n.notes]));
  const map = new Map<string, Customer>();
  [...all].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).forEach((o) => {
    const id = norm(o.customer.email);
    const spent = o.paymentStatus === 'refunded' ? 0 : o.total - o.refundedAmount;
    const c = map.get(id);
    if (c) {
      c.orders += 1;
      c.spent += spent;
      c.lastOrderAt = o.createdAt;
      Object.assign(c, { firstName: o.customer.firstName, lastName: o.customer.lastName, phone: o.customer.phone, city: o.customer.city, postcode: o.customer.postcode });
    } else {
      map.set(id, { id, firstName: o.customer.firstName, lastName: o.customer.lastName, email: o.customer.email, phone: o.customer.phone, city: o.customer.city, postcode: o.customer.postcode, orders: 1, spent, firstOrderAt: o.createdAt, lastOrderAt: o.createdAt, subscribed: subs.has(id), notes: notes.get(id) ?? '' });
    }
  });
  return [...map.values()];
}
