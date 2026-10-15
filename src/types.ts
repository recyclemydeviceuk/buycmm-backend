// Document shapes stored in the buyupon database. They mirror the storefront (../frontend/src/types.ts) and
// admin (../admin/src/types.ts) contracts field for field so API responses need no mapping beyond dropping _id.
import type { ObjectId } from 'mongodb';
import type { Condition, OrderStatus } from './lib/format.js';
import type { Permission } from './lib/permissions.js';

export type { Condition, OrderStatus, Permission };
export type DeliveryMethod = 'standard' | 'next-day';
export type PaymentStatus = 'paid' | 'partially-refunded' | 'refunded';
export type ProductStatus = 'active' | 'draft' | 'archived';

/** A finish the model is sold in. `image` is the photo shown when that colour is picked. */
export interface Colour {
  name: string;
  hex: string;
  image: string;
}
export interface Variant {
  storage: string;
  /** One of the product's `colours` names, or '' when the product has no colour options. */
  colour: string;
  condition: Condition;
  price: number;
  stock: number;
}
export interface ProductSpecs {
  display: string;
  chip: string;
  camera: string;
  battery: string;
  connectivity: string;
}
export interface ProductDoc {
  _id?: ObjectId;
  id: string;
  slug: string;
  brand: string;
  name: string;
  series: string;
  releaseYear: number;
  image: string;
  rrp: number;
  fromPrice: number;
  rating: number;
  reviewCount: number;
  specs: ProductSpecs;
  storages: string[];
  colours: Colour[];
  variants: Variant[];
  status: ProductStatus;
  featured: boolean;
  description: string;
  createdAt: string;
  updatedAt: string;
}
/** What the storefront sees. */
export type PublicProduct = Omit<ProductDoc, '_id' | 'status' | 'featured' | 'description' | 'createdAt' | 'updatedAt'>;

export interface Address {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  postcode: string;
}
export interface BasketLine {
  lineId: string;
  productId: string;
  slug: string;
  name: string;
  brand: string;
  image: string;
  storage: string;
  colour: string;
  condition: Condition;
  unitPrice: number;
  quantity: number;
}
export interface OrderEvent {
  id: string;
  at: string;
  type: 'created' | 'status' | 'note' | 'payment' | 'email' | 'tracking';
  message: string;
  by: string;
}
export interface Tracking {
  carrier: string;
  number: string;
  url?: string;
}
export interface OrderDoc {
  _id?: ObjectId;
  orderNumber: string;
  createdAt: string;
  updatedAt: string;
  status: OrderStatus;
  lines: BasketLine[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  delivery: DeliveryMethod;
  customer: Address;
  estimatedDelivery: string;
  paymentStatus: PaymentStatus;
  paymentMethod: 'paypal';
  paymentRef: string;
  /** PayPal capture id, needed for refunds. */
  captureId?: string;
  refundedAmount: number;
  tracking?: Tracking;
  events: OrderEvent[];
  flagged: boolean;
}
export type PublicOrder = Pick<OrderDoc, 'orderNumber' | 'createdAt' | 'status' | 'lines' | 'subtotal' | 'deliveryFee' | 'total' | 'delivery' | 'customer' | 'estimatedDelivery'>;

export interface ReviewDoc {
  _id?: ObjectId;
  id: string;
  productId: string;
  productName: string;
  author: string;
  email: string;
  orderNumber?: string;
  rating: number;
  title: string;
  body: string;
  date: string;
  verified: boolean;
  status: 'pending' | 'approved' | 'rejected';
  reply?: string;
}
export interface EnquiryDoc {
  _id?: ObjectId;
  id: string;
  name: string;
  email: string;
  message: string;
  createdAt: string;
  status: 'open' | 'replied' | 'closed';
  orderNumber?: string;
  reply?: string;
  repliedAt?: string;
  assignee?: string;
}
export interface SubscriberDoc {
  _id?: ObjectId;
  id: string;
  email: string;
  subscribedAt: string;
  status: 'subscribed' | 'unsubscribed';
  source: 'footer' | 'checkout' | 'admin' | 'import';
}
export interface DeliveryOption {
  id: DeliveryMethod;
  label: string;
  description: string;
  fee: number;
  etaDays: number;
  cutoff: string;
  enabled: boolean;
}
export interface ConditionSetting {
  key: Condition;
  label: string;
  short: string;
  blurb: string;
  minBattery: number;
  /** Example photos of a phone in this grade, shown in the grading guide and on product pages. */
  images: Array<{ url: string; caption: string }>;
}
export interface SettingsDoc {
  _id?: ObjectId;
  id: 'main';
  store: { name: string; supportEmail: string; whatsapp: string; hours: string; siteUrl: string; warrantyMonths: number; returnsDays: number };
  delivery: DeliveryOption[];
  storages: string[];
  conditions: ConditionSetting[];
  featuredSlugs: string[];
  lowStockThreshold: number;
  payments: { provider: 'paypal'; mode: 'sandbox' | 'live'; clientId: string; merchantEmail: string };
  notifications: { orderEmail: boolean; lowStockEmail: boolean; enquiryEmail: boolean; reviewEmail: boolean; notifyTo: string };
}
export type RoleColor = 'ink' | 'brand' | 'sky' | 'mint' | 'lilac' | 'lemon' | 'peach';
export interface RoleDoc {
  _id?: ObjectId;
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  system: boolean;
  color: RoleColor;
  createdAt: string;
  updatedAt: string;
}
export interface AdminDoc {
  _id?: ObjectId;
  id: string;
  email: string;
  name: string;
  roleId: string;
  status: 'active' | 'suspended';
  createdAt: string;
  lastLoginAt?: string;
}
export interface OtpDoc {
  _id?: ObjectId;
  email: string;
  code: string;
  attempts: number;
  used: boolean;
  createdAt: Date;
  expiresAt: Date;
}
export interface ActivityDoc {
  _id?: ObjectId;
  id: string;
  at: string;
  actor: string;
  action: string;
  target?: string;
  targetType?: 'order' | 'product' | 'review' | 'enquiry' | 'subscriber' | 'settings' | 'admin' | 'customer' | 'role';
  detail?: string;
}
export interface CustomerNoteDoc {
  _id?: ObjectId;
  id: string; // lower-cased email
  notes: string;
  updatedAt: string;
}

export interface AuthUser {
  user: Omit<AdminDoc, '_id'>;
  role: Omit<RoleDoc, '_id'>;
}
