import { Hono } from 'hono';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { eq, desc, count, sql, sum, and, gte, lte } from 'drizzle-orm';
import {
  db,
  admins,
  users,
  shops,
  orders,
  settlements,
  deliveryProviders,
  deliveryOrders,
} from '../../db/index.js';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/role.js';
import { validate } from '../../utils/validator.js';
import { signToken } from '../../utils/jwt.js';
import { ErrorCode } from '@fd/shared';

export const adminRoutes = new Hono();

// ── POST /api/admin/login ──────────────────

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

adminRoutes.post('/login', validate(loginSchema), async (c) => {
  const { username, password } = c.get('validated');
  const [admin] = await db
    .select()
    .from(admins)
    .where(eq(admins.username, username));
  if (!admin) {
    return c.json({ code: ErrorCode.INVALID_ADMIN_CREDENTIALS, message: '账号或密码错误' }, 401);
  }

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) {
    return c.json({ code: ErrorCode.INVALID_ADMIN_CREDENTIALS, message: '账号或密码错误' }, 401);
  }

  const token = await signToken({ sub: admin.id, role: 'admin' });

  return c.json({ token, username: admin.username });
});

// ── GET /api/admin/dashboard ───────────────

adminRoutes.get('/dashboard', auth, requireRole('admin'), async (c) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [userCount] = await db.select({ count: count() }).from(users);
  const [shopCount] = await db
    .select({ count: count() })
    .from(shops)
    .where(eq(shops.status, 'active'));
  const [pendingShops] = await db
    .select({ count: count() })
    .from(shops)
    .where(eq(shops.status, 'pending'));
  const [orderStats] = await db
    .select({
      todayOrders: count(),
      todayRevenue: sum(orders.totalAmount),
    })
    .from(orders)
    .where(gte(orders.createdAt, todayStart));

  const [pendingOrders] = await db
    .select({ count: count() })
    .from(orders)
    .where(eq(orders.status, 'pending'));

  return c.json({
    totalUsers: Number(userCount?.count ?? 0),
    activeShops: Number(shopCount?.count ?? 0),
    pendingShops: Number(pendingShops?.count ?? 0),
    todayOrders: Number(orderStats?.todayOrders ?? 0),
    todayRevenue: Number(orderStats?.todayRevenue ?? 0),
    pendingOrders: Number(pendingOrders?.count ?? 0),
  });
});

// ── Shops Management ───────────────────────

adminRoutes.get('/shops', auth, requireRole('admin'), async (c) => {
  const list = await db
    .select()
    .from(shops)
    .orderBy(desc(shops.createdAt));
  return c.json(list);
});

adminRoutes.put('/shops/:id/audit', auth, requireRole('admin'), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { status } = body as { status: string };

  if (!['active', 'suspended'].includes(status)) {
    return c.json({ code: ErrorCode.VALIDATION_ERROR, message: '状态值无效' }, 400);
  }

  const [shop] = await db
    .update(shops)
    .set({ status, updatedAt: new Date() })
    .where(eq(shops.id, id))
    .returning();
  if (!shop) return c.json({ code: ErrorCode.SHOP_NOT_FOUND }, 404);
  return c.json(shop);
});

// ── Users Management ───────────────────────

adminRoutes.get('/users', auth, requireRole('admin'), async (c) => {
  const list = await db
    .select()
    .from(users)
    .orderBy(desc(users.createdAt));
  return c.json(list);
});

// ── Orders Management ──────────────────────

adminRoutes.get('/orders', auth, requireRole('admin'), async (c) => {
  const list = await db
    .select()
    .from(orders)
    .orderBy(desc(orders.createdAt));
  return c.json(list);
});

adminRoutes.post('/orders/:id/cancel', auth, requireRole('admin'), async (c) => {
  const id = c.req.param('id');
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) return c.json({ code: ErrorCode.ORDER_NOT_FOUND }, 404);

  await db
    .update(orders)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(orders.id, id));

  await db.execute(
    `INSERT INTO order_status_logs (order_id, from_status, to_status, operator_role, operator_id) VALUES ('${id}', '${order.status}', 'cancelled', 'admin', '${c.get('auth').sub}')`,
  );

  return c.json({ status: 'cancelled' });
});

// ── Settlements Management ─────────────────

adminRoutes.get('/settlements', auth, requireRole('admin'), async (c) => {
  const list = await db
    .select()
    .from(settlements)
    .orderBy(desc(settlements.createdAt));
  return c.json(list);
});

// Generate settlement for a shop (manual trigger)
adminRoutes.post('/settlements/generate', auth, requireRole('admin'), async (c) => {
  const body = await c.req.json();
  const { shopId } = body as { shopId: string };

  if (!shopId) {
    return c.json({ code: ErrorCode.VALIDATION_ERROR, message: 'shopId required' }, 400);
  }

  // Aggregate orders from previous day
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const periodStart = new Date(yesterday);
  periodStart.setHours(0, 0, 0, 0);
  const periodEnd = new Date(yesterday);
  periodEnd.setHours(23, 59, 59, 999);

  const [stats] = await db
    .select({
      totalAmount: sum(orders.totalAmount),
      totalOrders: count(),
    })
    .from(orders)
    .where(
      and(
        eq(orders.shopId, shopId),
        eq(orders.status, 'completed'),
        gte(orders.createdAt, periodStart),
        lte(orders.createdAt, periodEnd),
      ),
    );

  const amount = Number(stats?.totalAmount ?? 0);
  const totalOrders = Number(stats?.totalOrders ?? 0);

  if (totalOrders === 0) {
    return c.json({ message: '无可结算订单' }, 200);
  }

  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
  const commission = Math.round(amount * Number(shop?.commissionRate ?? 0.05));

  const [settlement] = await db
    .insert(settlements)
    .values({
      shopId,
      periodStart,
      periodEnd,
      totalAmount: amount,
      commission,
      netAmount: amount - commission,
      totalOrders,
    })
    .returning();

  return c.json(settlement, 201);
});

adminRoutes.post('/settlements/:id/pay', auth, requireRole('admin'), async (c) => {
  const id = c.req.param('id');

  const [s] = await db
    .update(settlements)
    .set({ status: 'paid', settledAt: new Date() })
    .where(eq(settlements.id, id))
    .returning();
  if (!s) return c.json({ code: ErrorCode.SETTLEMENT_NOT_FOUND }, 404);
  return c.json(s);
});

// ── Delivery Providers Management ────────────

adminRoutes.get('/delivery/providers', auth, requireRole('admin'), async (c) => {
  const list = await db.select().from(deliveryProviders).orderBy(deliveryProviders.createdAt);
  return c.json(list);
});

const providerSchema = z.object({
  name: z.string().min(1).max(32),
  displayName: z.string().min(1).max(64),
  config: z.record(z.unknown()),
});

adminRoutes.post('/delivery/providers', auth, requireRole('admin'), validate(providerSchema), async (c) => {
  const { name, displayName, config } = c.get('validated');
  const [provider] = await db
    .insert(deliveryProviders)
    .values({ name, displayName, config, isActive: true })
    .returning();
  return c.json(provider, 201);
});

adminRoutes.put('/delivery/providers/:id', auth, requireRole('admin'), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { displayName, config, isActive } = body as {
    displayName?: string;
    config?: Record<string, unknown>;
    isActive?: boolean;
  };

  const updates: Record<string, unknown> = {};
  if (displayName !== undefined) updates.displayName = displayName;
  if (config !== undefined) updates.config = config;
  if (isActive !== undefined) updates.isActive = isActive;

  const [provider] = await db
    .update(deliveryProviders)
    .set(updates)
    .where(eq(deliveryProviders.id, id))
    .returning();
  if (!provider) {
    return c.json({ code: ErrorCode.DELIVERY_PROVIDER_NOT_FOUND, message: 'Provider not found' }, 404);
  }
  return c.json(provider);
});

// ── Shop Delivery Configuration ──────────────

adminRoutes.put('/shops/:id/delivery-type', auth, requireRole('admin'), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { deliveryType } = body as { deliveryType: string };

  if (!['self', 'platform'].includes(deliveryType)) {
    return c.json({ code: ErrorCode.VALIDATION_ERROR, message: 'deliveryType must be self or platform' }, 400);
  }

  const [shop] = await db
    .update(shops)
    .set({ deliveryType, updatedAt: new Date() })
    .where(eq(shops.id, id))
    .returning();
  if (!shop) return c.json({ code: ErrorCode.SHOP_NOT_FOUND }, 404);
  return c.json(shop);
});

adminRoutes.put('/shops/:id/bind-delivery', auth, requireRole('admin'), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { providerId, externalShopNo } = body as {
    providerId: string;
    externalShopNo: string;
  };

  const [shop] = await db
    .update(shops)
    .set({ deliveryProviderId: providerId, externalShopNo, updatedAt: new Date() })
    .where(eq(shops.id, id))
    .returning();
  if (!shop) return c.json({ code: ErrorCode.SHOP_NOT_FOUND }, 404);
  return c.json(shop);
});

// ── Delivery Orders (admin view) ─────────────

adminRoutes.get('/delivery/orders', auth, requireRole('admin'), async (c) => {
  const list = await db
    .select()
    .from(deliveryOrders)
    .orderBy(desc(deliveryOrders.createdAt));
  return c.json(list);
});
