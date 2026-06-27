import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  numeric,
  pgEnum,
  integer,
  jsonb,
  boolean,
  geometry,
  primaryKey,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ── Enums ────────────────────────────────────────────

export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'confirmed',
  'preparing',
  'delivering',
  'completed',
  'cancelled',
]);

export const shopStatusEnum = pgEnum('shop_status', [
  'pending',
  'active',
  'suspended',
]);

export const settlementStatusEnum = pgEnum('settlement_status', [
  'pending',
  'settled',
  'paid',
]);

export const userRoleEnum = pgEnum('user_role', [
  'user',
  'merchant',
  'admin',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'unpaid',
  'paid',
  'refunding',
  'refunded',
]);

// ── Users ────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  openid: varchar('openid', { length: 64 }).notNull().unique(),
  nickname: varchar('nickname', { length: 64 }),
  avatar: varchar('avatar', { length: 512 }),
  phone: varchar('phone', { length: 20 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ── Addresses ────────────────────────────────────────

export const addresses = pgTable('addresses', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  contactName: varchar('contact_name', { length: 32 }).notNull(),
  phone: varchar('phone', { length: 20 }).notNull(),
  address: varchar('address', { length: 256 }).notNull(),
  location: geometry('location', { type: 'Point', srid: 4326 }), // PostGIS Point
  isDefault: boolean('is_default').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ── Shops ────────────────────────────────────────────

export const shops = pgTable('shops', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  logo: varchar('logo', { length: 512 }),
  description: text('description'),
  location: geometry('location', { type: 'Point', srid: 4326 }),
  address: varchar('address', { length: 256 }),
  phone: varchar('phone', { length: 20 }),
  status: shopStatusEnum('status').default('pending').notNull(),
  avgRating: numeric('avg_rating', { precision: 2, scale: 1 }).default('0'),
  commissionRate: numeric('commission_rate', { precision: 3, scale: 2 }).default('0.05'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ── Shop Admins ──────────────────────────────────────

export const shopAdmins = pgTable('shop_admins', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: varchar('username', { length: 64 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 256 }).notNull(),
  shopId: uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ── Categories ───────────────────────────────────────

export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  shopId: uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 32 }).notNull(),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ── Products ─────────────────────────────────────────

export const products = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  shopId: uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id')
    .references(() => categories.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 64 }).notNull(),
  image: varchar('image', { length: 512 }),
  price: integer('price').notNull(), // fen (分)
  originalPrice: integer('original_price'), // fen
  isAvailable: boolean('is_available').default(true),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ── Orders ───────────────────────────────────────────

export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderNo: varchar('order_no', { length: 24 }).notNull().unique(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  shopId: uuid('shop_id')
    .notNull()
    .references(() => shops.id),
  status: orderStatusEnum('status').default('pending').notNull(),
  addressSnapshot: jsonb('address_snapshot').notNull(),
  totalAmount: integer('total_amount').notNull(), // fen
  deliveryFee: integer('delivery_fee').default(0), // fen
  remark: text('remark'),
  paymentStatus: paymentStatusEnum('payment_status').default('unpaid').notNull(),
  transactionId: varchar('transaction_id', { length: 64 }),
  paidAt: timestamp('paid_at'),
  prepayId: varchar('prepay_id', { length: 64 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ── Order Items ──────────────────────────────────────

export const orderItems = pgTable('order_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  productSnapshot: jsonb('product_snapshot').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: integer('unit_price').notNull(), // fen
});

// ── Order Status Logs ────────────────────────────────

export const orderStatusLogs = pgTable('order_status_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  fromStatus: orderStatusEnum('from_status'),
  toStatus: orderStatusEnum('to_status').notNull(),
  operatorRole: userRoleEnum('operator_role').notNull(),
  operatorId: uuid('operator_id'),
  remark: text('remark'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ── Settlements ──────────────────────────────────────

export const settlements = pgTable('settlements', {
  id: uuid('id').defaultRandom().primaryKey(),
  shopId: uuid('shop_id')
    .notNull()
    .references(() => shops.id),
  periodStart: timestamp('period_start').notNull(),
  periodEnd: timestamp('period_end').notNull(),
  totalAmount: integer('total_amount').notNull(), // fen
  commission: integer('commission').notNull(), // fen
  netAmount: integer('net_amount').notNull(), // fen
  totalOrders: integer('total_orders').default(0),
  status: settlementStatusEnum('status').default('pending').notNull(),
  settledAt: timestamp('settled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ── Admins ───────────────────────────────────────────

export const admins = pgTable('admins', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: varchar('username', { length: 64 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 256 }).notNull(),
  role: varchar('role', { length: 32 }).default('admin'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ── Uploads ──────────────────────────────────────────

export const uploads = pgTable('uploads', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  originalName: varchar('original_name', { length: 256 }).notNull(),
  objectKey: varchar('object_key', { length: 512 }).notNull(),
  thumbnailKey: varchar('thumbnail_key', { length: 512 }),
  mimeType: varchar('mime_type', { length: 64 }),
  size: integer('size'), // bytes
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ── Indexes ──────────────────────────────────────────
// GIST spatial indexes and B-tree indexes created via raw SQL migration (see seed.ts)
