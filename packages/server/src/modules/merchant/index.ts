import { Hono } from 'hono';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { eq, and, sql, count, sum } from 'drizzle-orm';
import {
  db,
  shops,
  shopAdmins,
  categories,
  products,
  orders,
  settlements,
} from '../../db/index.js';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/role.js';
import { validate } from '../../utils/validator.js';
import { signToken } from '../../utils/jwt.js';
import { ErrorCode } from '@fd/shared';

export const merchantRoutes = new Hono();

// ── Schemas ────────────────────────────────

const registerSchema = z.object({
  shopName: z.string().min(1).max(64),
  address: z.string().max(256).optional(),
  phone: z.string().max(20).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  username: z.string().min(3).max(64),
  password: z.string().min(6).max(128),
});

const productSchema = z.object({
  name: z.string().min(1).max(64),
  image: z.string().max(512).optional(),
  price: z.number().int().positive(), // fen
  originalPrice: z.number().int().optional(),
  categoryId: z.string().uuid().optional(),
  sortOrder: z.number().int().optional(),
});

// ── POST /api/merchant/register ─────────────

merchantRoutes.post('/register', validate(registerSchema), async (c) => {
  const { shopName, address, phone, lat, lng, username, password } =
    c.get('validated');

  // Create shop
  const [shop] = await db
    .insert(shops)
    .values({
      name: shopName,
      address: address ?? '',
      phone: phone ?? '',
      status: 'pending',
    })
    .returning();

  // Set location if provided
  if (lat && lng) {
    await db.execute(
      `UPDATE shops SET location = ST_GeogFromText('POINT(${lng} ${lat})') WHERE id = '${shop.id}'`,
    );
  }

  // Create default category
  await db.insert(categories).values({
    shopId: shop.id,
    name: '默认分类',
    sortOrder: 0,
  });

  // Create admin account
  const passwordHash = await bcrypt.hash(password, 10);
  const [admin] = await db
    .insert(shopAdmins)
    .values({ username, passwordHash, shopId: shop.id })
    .returning();

  const token = await signToken({
    sub: admin.id,
    role: 'merchant',
    shopId: shop.id,
  });

  return c.json({ token, shop }, 201);
});

// ── POST /api/merchant/login ────────────────

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

merchantRoutes.post('/login', validate(loginSchema), async (c) => {
  const { username, password } = c.get('validated');
  const [admin] = await db
    .select()
    .from(shopAdmins)
    .where(eq(shopAdmins.username, username));
  if (!admin) {
    return c.json({ code: ErrorCode.MERCHANT_NOT_FOUND, message: '账号或密码错误' }, 401);
  }

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) {
    return c.json({ code: ErrorCode.MERCHANT_NOT_FOUND, message: '账号或密码错误' }, 401);
  }

  const token = await signToken({
    sub: admin.id,
    role: 'merchant',
    shopId: admin.shopId,
  });

  return c.json({ token, shopId: admin.shopId });
});

// ── Product CRUD (all require merchant auth) ─────────

merchantRoutes.get('/products', auth, requireRole('merchant'), async (c) => {
  const { shopId } = c.get('auth');
  const list = await db
    .select()
    .from(products)
    .where(eq(products.shopId, shopId!))
    .orderBy(products.sortOrder);
  return c.json(list);
});

merchantRoutes.post('/products', auth, requireRole('merchant'), validate(productSchema), async (c) => {
  const { shopId } = c.get('auth');
  const data = c.get('validated');
  const [product] = await db
    .insert(products)
    .values({ ...data, shopId: shopId! })
    .returning();
  return c.json(product, 201);
});

merchantRoutes.put('/products/:id', auth, requireRole('merchant'), validate(productSchema), async (c) => {
  const { shopId } = c.get('auth');
  const id = c.req.param('id');
  const data = c.get('validated');

  const [existing] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.shopId, shopId!)));
  if (!existing) return c.json({ code: ErrorCode.PRODUCT_NOT_FOUND }, 404);

  const [updated] = await db
    .update(products)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  return c.json(updated);
});

merchantRoutes.delete('/products/:id', auth, requireRole('merchant'), async (c) => {
  const { shopId } = c.get('auth');
  const id = c.req.param('id');

  await db
    .update(products)
    .set({ isAvailable: false })
    .where(and(eq(products.id, id), eq(products.shopId, shopId!)));
  return c.json({ success: true });
});

// ── Category CRUD ──────────────────────────

const categorySchema = z.object({
  name: z.string().min(1).max(32),
  sortOrder: z.number().int().optional(),
});

merchantRoutes.get('/categories', auth, requireRole('merchant'), async (c) => {
  const { shopId } = c.get('auth');
  const list = await db
    .select()
    .from(categories)
    .where(eq(categories.shopId, shopId!))
    .orderBy(categories.sortOrder);
  return c.json(list);
});

merchantRoutes.post('/categories', auth, requireRole('merchant'), validate(categorySchema), async (c) => {
  const { shopId } = c.get('auth');
  const data = c.get('validated');
  const [cat] = await db
    .insert(categories)
    .values({ ...data, shopId: shopId! })
    .returning();
  return c.json(cat, 201);
});

merchantRoutes.put('/categories/:id', auth, requireRole('merchant'), validate(categorySchema), async (c) => {
  const { shopId } = c.get('auth');
  const id = c.req.param('id');
  const data = c.get('validated');

  const [cat] = await db
    .update(categories)
    .set(data)
    .where(and(eq(categories.id, id), eq(categories.shopId, shopId!)))
    .returning();
  if (!cat) return c.json({ code: ErrorCode.CATEGORY_NOT_FOUND }, 404);
  return c.json(cat);
});

// ── GET /api/merchant/dashboard ─────────────

merchantRoutes.get('/dashboard', auth, requireRole('merchant'), async (c) => {
  const { shopId } = c.get('auth');

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [stats] = await db
    .select({
      totalOrders: count(),
      totalRevenue: sum(orders.totalAmount),
    })
    .from(orders)
    .where(
      and(
        eq(orders.shopId, shopId!),
        sql`${orders.createdAt} >= ${todayStart}`,
      ),
    );

  // Count by status
  const pendingCount = await db
    .select({ count: count() })
    .from(orders)
    .where(
      and(
        eq(orders.shopId, shopId!),
        eq(orders.status, 'pending'),
      ),
    );

  return c.json({
    todayOrders: Number(stats?.totalOrders ?? 0),
    todayRevenue: Number(stats?.totalRevenue ?? 0),
    pendingOrders: Number(pendingCount[0]?.count ?? 0),
  });
});

// ── GET /api/merchant/shop ──────────────────

merchantRoutes.get('/shop', auth, requireRole('merchant'), async (c) => {
  const { shopId } = c.get('auth');
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId!));
  if (!shop) return c.json({ code: ErrorCode.SHOP_NOT_FOUND }, 404);
  return c.json(shop);
});

// ── PUT /api/merchant/shop ──────────────────

const shopUpdateSchema = z.object({
  name: z.string().max(64).optional(),
  description: z.string().optional(),
  address: z.string().max(256).optional(),
  phone: z.string().max(20).optional(),
  logo: z.string().max(512).optional(),
});

merchantRoutes.put('/shop', auth, requireRole('merchant'), validate(shopUpdateSchema), async (c) => {
  const { shopId } = c.get('auth');
  const data = c.get('validated');
  const [shop] = await db
    .update(shops)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(shops.id, shopId!))
    .returning();
  return c.json(shop);
});

// ── GET /api/merchant/settlements ───────────

merchantRoutes.get('/settlements', auth, requireRole('merchant'), async (c) => {
  const { shopId } = c.get('auth');
  const list = await db
    .select()
    .from(settlements)
    .where(eq(settlements.shopId, shopId!))
    .orderBy(settlements.createdAt);
  return c.json(list);
});

