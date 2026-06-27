import { Hono } from 'hono';
import { z } from 'zod';
import { eq, sql, and } from 'drizzle-orm';
import { db, shops, categories, products } from '../../db/index.js';
import { validateQuery } from '../../utils/validator.js';
import { ErrorCode } from '@fd/shared';

export const shopRoutes = new Hono();

// ── GET /api/shops ──────────────────────────
// Nearby shops search using PostGIS ST_DWithin

const shopsQuerySchema = z.object({
  lat: z.string().optional(),
  lng: z.string().optional(),
  radius: z.string().optional(), // meters, default 5000
});

shopRoutes.get('/', validateQuery(shopsQuerySchema), async (c) => {
  const { lat, lng, radius } = c.get('validatedQuery');
  const r = Number(radius) || 5000;

  let query = db.select().from(shops).where(eq(shops.status, 'active')).$dynamic();

  if (lat && lng) {
    // PostGIS spatial query: shops within radius
    query = query.where(
      sql`ST_DWithin(
        location::geography,
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        ${r}
      )`,
    );
  }

  const list = await query.orderBy(shops.createdAt);
  return c.json(list);
});

// ── GET /api/shops/nearby ────────────────────

shopRoutes.get('/nearby', validateQuery(shopsQuerySchema), async (c) => {
  const { lat, lng, radius } = c.get('validatedQuery');
  const r = Number(radius) || 5000;

  let query = db.select().from(shops).where(eq(shops.status, 'active')).$dynamic();

  if (lat && lng) {
    query = query.where(
      sql`ST_DWithin(
        location::geography,
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        ${r}
      )`,
    );
  }

  const list = await query.orderBy(shops.createdAt);
  return c.json(list);
});

// ── GET /api/shops/:id ──────────────────────

shopRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');

  const [shop] = await db.select().from(shops).where(eq(shops.id, id));
  if (!shop) return c.json({ code: ErrorCode.SHOP_NOT_FOUND }, 404);

  // Get categories with products
  const catList = await db
    .select()
    .from(categories)
    .where(eq(categories.shopId, id))
    .orderBy(categories.sortOrder);

  const productList = await db
    .select()
    .from(products)
    .where(and(eq(products.shopId, id), eq(products.isAvailable, true)))
    .orderBy(products.sortOrder);

  return c.json({ ...shop, categories: catList, products: productList });
});

// ── GET /api/shops/:id/products ─────────────

shopRoutes.get('/:id/products', async (c) => {
  const id = c.req.param('id');
  const list = await db
    .select()
    .from(products)
    .where(and(eq(products.shopId, id), eq(products.isAvailable, true)))
    .orderBy(products.sortOrder);
  return c.json(list);
});
