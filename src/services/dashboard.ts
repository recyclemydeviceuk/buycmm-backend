// Dashboard analytics: all computed from the order book in memory. Same definitions as the admin's mock adapter.
import { col } from '../config/db.js';
import { norm } from '../lib/ids.js';
import { addDays, dayKey, startOfDay, storageIndex, ORDER_STATUSES, type Condition, type OrderStatus } from '../lib/format.js';
import type { OrderDoc } from '../types.js';
import { getSettings } from './settings.js';
import { allProducts } from './catalog.js';

export type Range = '7d' | '30d' | '90d';

export async function dashboard(range: Range) {
  const [orders, products, settings, reviews, enquiries, subscribers, activity] = await Promise.all([
    col.orders().find({}).sort({ createdAt: -1 }).toArray(),
    allProducts(),
    getSettings(),
    col.reviews().find({}).sort({ date: -1 }).toArray(),
    col.enquiries().find({}).sort({ createdAt: -1 }).toArray(),
    col.subscribers().find({}).toArray(),
    col.activity().find({}).sort({ at: -1 }).limit(8).toArray(),
  ]);
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const now = new Date();
  const start = startOfDay(addDays(now, -(days - 1)));
  const end = addDays(startOfDay(now), 1);
  const prevStart = addDays(start, -days);
  const today = dayKey(now);
  const t = (iso: string) => new Date(iso).getTime();
  const inRange = (o: OrderDoc, from: Date, to: Date) => t(o.createdAt) >= from.getTime() && t(o.createdAt) < to.getTime();
  const cur = orders.filter((o) => inRange(o, start, end));
  const prev = orders.filter((o) => inRange(o, prevStart, start));
  const sold = (os: OrderDoc[]) => os.filter((o) => o.status !== 'cancelled');
  const rev = (os: OrderDoc[]) => sold(os).reduce((s, o) => s + o.total - o.refundedAmount, 0);
  const unitsOf = (os: OrderDoc[]) => sold(os).reduce((s, o) => s + o.lines.reduce((x, l) => x + l.quantity, 0), 0);
  const todays = orders.filter((o) => dayKey(o.createdAt) === today && o.status !== 'cancelled');
  const seriesFor = (from: Date, os: OrderDoc[]) => Array.from({ length: days }, (_, i) => {
    const key = dayKey(addDays(from, i));
    const dayOrders = sold(os).filter((o) => dayKey(o.createdAt) === key);
    return { date: key, revenue: rev(dayOrders), orders: dayOrders.length };
  });

  const refundAmount = cur.reduce((s, o) => s + o.refundedAmount, 0);
  const refundCount = cur.filter((o) => o.refundedAmount > 0).length;
  const cancelled = cur.filter((o) => o.status === 'cancelled').length;

  const firstOrderAt = new Map<string, number>();
  [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).forEach((o) => {
    const k = norm(o.customer.email);
    if (!firstOrderAt.has(k)) firstOrderAt.set(k, t(o.createdAt));
  });
  const repeat = (os: OrderDoc[], from: Date) => {
    const emails = new Set(os.map((o) => norm(o.customer.email)));
    let returning = 0;
    emails.forEach((e) => { if ((firstOrderAt.get(e) ?? 0) < from.getTime() || os.filter((o) => norm(o.customer.email) === e).length > 1) returning += 1; });
    return { total: emails.size, returning };
  };
  const rc = repeat(cur, start);
  const rp = repeat(prev, prevStart);

  const hoursToDispatch = (os: OrderDoc[]) => {
    const vals = os.map((o) => { const ev = o.events.find((e) => e.type === 'status' && e.message.startsWith('Dispatched')); return ev ? (t(ev.at) - t(o.createdAt)) / 3_600_000 : null; }).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };
  const delivered = cur.filter((o) => o.status === 'delivered' || o.status === 'returned');
  const onTime = delivered.filter((o) => { const ev = o.events.find((e) => e.type === 'status' && e.message.startsWith('Delivered')); return ev && t(ev.at) <= t(o.estimatedDelivery) + 86_400_000; }).length;
  const open = orders.filter((o) => o.status === 'confirmed');
  const oldestOpen = open.length ? Math.max(...open.map((o) => (now.getTime() - t(o.createdAt)) / 3_600_000)) : 0;
  const inTransit = orders.filter((o) => o.status === 'dispatched');
  const overdue = inTransit.filter((o) => t(o.estimatedDelivery) + 86_400_000 < now.getTime()).length;

  const low = settings.lowStockThreshold;
  const stockByCondition = { excellent: { units: 0, value: 0 }, good: { units: 0, value: 0 }, fair: { units: 0, value: 0 } } as Record<Condition, { units: number; value: number }>;
  const stock = { units: 0, value: 0, low: 0, out: 0, healthy: 0 };
  const variantStock = new Map<string, number>();
  products.filter((p) => p.status === 'active').forEach((p) => p.variants.forEach((v) => {
    stockByCondition[v.condition].units += v.stock;
    stockByCondition[v.condition].value += v.stock * v.price;
    stock.units += v.stock;
    stock.value += v.stock * v.price;
    if (v.stock === 0) stock.out += 1; else if (v.stock <= low) stock.low += 1; else stock.healthy += 1;
    variantStock.set(`${p.id}|${v.storage}|${v.network}|${v.condition}`, v.stock);
  }));

  const split = <K extends string>(pick: (l: OrderDoc['lines'][number]) => K) => {
    const m = new Map<K, { key: K; units: number; revenue: number }>();
    sold(cur).forEach((o) => o.lines.forEach((l) => { const k = pick(l); const e = m.get(k) ?? { key: k, units: 0, revenue: 0 }; e.units += l.quantity; e.revenue += l.unitPrice * l.quantity; m.set(k, e); }));
    return [...m.values()].sort((a, b) => b.revenue - a.revenue);
  };
  const productSeries = new Map(products.map((p) => [p.id, p.series]));
  const byCond = split((l) => l.condition);
  const salesByCondition = (['excellent', 'good', 'fair'] as Condition[]).map((c) => byCond.find((x) => x.key === c) ?? { key: c, units: 0, revenue: 0 });

  const top = new Map<string, { productId: string; name: string; brand: string; image: string; units: number; revenue: number; stock: number }>();
  const variantSold = new Map<string, number>();
  sold(cur).forEach((o) => o.lines.forEach((l) => {
    const p = products.find((x) => x.id === l.productId);
    const e = top.get(l.productId) ?? { productId: l.productId, name: l.name, brand: l.brand, image: l.image, units: 0, revenue: 0, stock: p ? p.variants.reduce((s, v) => s + v.stock, 0) : 0 };
    e.units += l.quantity; e.revenue += l.unitPrice * l.quantity; top.set(l.productId, e);
    const vk = `${l.productId}|${l.storage}|${l.network}|${l.condition}`;
    variantSold.set(vk, (variantSold.get(vk) ?? 0) + l.quantity);
  }));
  const restock: Array<{ productId: string; name: string; brand: string; image: string; storage: string; network: string; condition: Condition; stock: number; soldInRange: number; price: number }> = [];
  variantSold.forEach((soldInRange, vk) => {
    const st = variantStock.get(vk);
    if (st === undefined || st > low) return;
    const [productId, storage, network, condition] = vk.split('|');
    const p = products.find((x) => x.id === productId)!;
    const v = p.variants.find((x) => x.storage === storage && x.network === network && x.condition === condition)!;
    restock.push({ productId, name: p.name, brand: p.brand, image: p.image, storage, network, condition: condition as Condition, stock: st, soldInRange, price: v.price });
  });
  restock.sort((a, b) => b.soldInRange - a.soldInRange || a.stock - b.stock);

  const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  sold(cur).forEach((o) => { const dt = new Date(o.createdAt); heatmap[(dt.getDay() + 6) % 7][dt.getHours()] += 1; });

  const custMap = new Map<string, { id: string; name: string; email: string; orders: number; spent: number }>();
  const cityMap = new Map<string, { key: string; orders: number; revenue: number }>();
  sold(cur).forEach((o) => {
    const id = norm(o.customer.email);
    const c = custMap.get(id) ?? { id, name: `${o.customer.firstName} ${o.customer.lastName}`, email: o.customer.email, orders: 0, spent: 0 };
    c.orders += 1; c.spent += o.total - o.refundedAmount; custMap.set(id, c);
    const ci = cityMap.get(o.customer.city) ?? { key: o.customer.city, orders: 0, revenue: 0 };
    ci.orders += 1; ci.revenue += o.total - o.refundedAmount; cityMap.set(o.customer.city, ci);
  });

  const statusCounts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
  orders.forEach((o) => (statusCounts[o.status] += 1));
  const approved = reviews.filter((r) => r.status === 'approved');
  const subsNow = subscribers.filter((x) => x.status === 'subscribed').length;
  const subsJoinedInRange = subscribers.filter((x) => t(x.subscribedAt) >= start.getTime()).length;
  const strip = <T extends { _id?: unknown }>(d: T) => { const { _id, ...rest } = d; void _id; return rest; };

  return {
    range, days,
    revenue: { current: rev(cur), previous: rev(prev), today: rev(todays) },
    orders: { current: sold(cur).length, previous: sold(prev).length, today: todays.length },
    aov: { current: sold(cur).length ? rev(cur) / sold(cur).length : 0, previous: sold(prev).length ? rev(prev) / sold(prev).length : 0 },
    units: { current: unitsOf(cur), previous: unitsOf(prev) },
    refunds: { amount: refundAmount, count: refundCount, rate: cur.length ? (refundCount / cur.length) * 100 : 0, previousRate: prev.length ? (prev.filter((o) => o.refundedAmount > 0).length / prev.length) * 100 : 0 },
    cancellations: { count: cancelled, rate: cur.length ? (cancelled / cur.length) * 100 : 0 },
    customers: { newCount: rc.total - rc.returning, returningCount: rc.returning, repeatRate: rc.total ? (rc.returning / rc.total) * 100 : 0, previousRepeatRate: rp.total ? (rp.returning / rp.total) * 100 : 0 },
    fulfilment: { awaiting: open.length, packing: orders.filter((o) => o.status === 'packing').length, inTransit: inTransit.length, overdue, oldestOpenHours: oldestOpen, avgHoursToDispatch: hoursToDispatch(cur), previousAvgHoursToDispatch: hoursToDispatch(prev), onTimePct: delivered.length ? (onTime / delivered.length) * 100 : 0 },
    stock,
    pendingReviews: reviews.filter((r) => r.status === 'pending').length,
    openEnquiries: enquiries.filter((e) => e.status === 'open').length,
    subscribers: { current: subsNow, previous: subsNow - subsJoinedInRange },
    avgRating: approved.length ? approved.reduce((s, r) => s + r.rating, 0) / approved.length : 0,
    series: seriesFor(start, cur),
    previousSeries: seriesFor(prevStart, prev),
    heatmap,
    topProducts: [...top.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8),
    restock: restock.slice(0, 8),
    recentOrders: orders.slice(0, 8).map(strip),
    topCustomers: [...custMap.values()].sort((a, b) => b.spent - a.spent).slice(0, 5),
    stockByCondition,
    salesByCondition,
    salesByBrand: split((l) => l.brand),
    salesByNetwork: split((l) => l.network),
    salesByStorage: split((l) => l.storage).sort((a, b) => storageIndex(a.key) - storageIndex(b.key)),
    salesBySeries: split((l) => productSeries.get(l.productId) ?? 'Other'),
    cities: [...cityMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6),
    statusCounts,
    deliverySplit: { 'next-day': sold(cur).filter((o) => o.delivery === 'next-day').length, standard: sold(cur).filter((o) => o.delivery === 'standard').length },
    pendingReviewList: reviews.filter((r) => r.status === 'pending').slice(0, 4).map(strip),
    openEnquiryList: enquiries.filter((e) => e.status === 'open').slice(0, 4).map(strip),
    recentActivity: activity.map(strip),
  };
}
