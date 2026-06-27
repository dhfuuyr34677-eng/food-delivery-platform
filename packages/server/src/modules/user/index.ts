import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, users, addresses } from '../../db/index.js';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../utils/validator.js';
import { signToken } from '../../utils/jwt.js';
import { codeToSession } from '../../services/wechat.js';
import { ErrorCode } from '@fd/shared';

export const userRoutes = new Hono();

// ── Schemas ────────────────────────────────

const loginSchema = z.object({ code: z.string().min(1) });
const profileSchema = z.object({
  nickname: z.string().max(32).optional(),
  avatar: z.string().max(512).optional(),
  phone: z.string().max(20).optional(),
});
const addressSchema = z.object({
  contactName: z.string().min(1).max(32),
  phone: z.string().min(1).max(20),
  address: z.string().min(1).max(256),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  isDefault: z.boolean().optional(),
});

// ── POST /api/user/login/wechat ─────────────

userRoutes.post('/login/wechat', validate(loginSchema), async (c) => {
  const { code } = c.get('validated');
  const session = await codeToSession(code);

  // Find or create user
  let [user] = await db
    .select()
    .from(users)
    .where(eq(users.openid, session.openid));

  if (!user) {
    [user] = await db.insert(users).values({ openid: session.openid }).returning();
  }

  const token = await signToken({ sub: user.id, role: 'user' });

  return c.json({
    token,
    user: { id: user.id, nickname: user.nickname, avatar: user.avatar },
  });
});

// ── GET /api/user/profile ───────────────────

userRoutes.get('/profile', auth, async (c) => {
  const { sub } = c.get('auth');
  const [user] = await db.select().from(users).where(eq(users.id, sub));
  if (!user) return c.json({ code: ErrorCode.USER_NOT_FOUND }, 404);
  return c.json({
    id: user.id,
    nickname: user.nickname,
    avatar: user.avatar,
    phone: user.phone,
  });
});

// ── PUT /api/user/profile ───────────────────

userRoutes.put('/profile', auth, validate(profileSchema), async (c) => {
  const { sub } = c.get('auth');
  const data = c.get('validated');
  const [user] = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, sub))
    .returning();
  if (!user) return c.json({ code: ErrorCode.USER_NOT_FOUND }, 404);
  return c.json({
    id: user.id,
    nickname: user.nickname,
    avatar: user.avatar,
    phone: user.phone,
  });
});

// ── GET /api/user/addresses ─────────────────

userRoutes.get('/addresses', auth, async (c) => {
  const { sub } = c.get('auth');
  const list = await db
    .select()
    .from(addresses)
    .where(eq(addresses.userId, sub))
    .orderBy(addresses.createdAt);
  return c.json(list);
});

// ── POST /api/user/addresses ────────────────

userRoutes.post('/addresses', auth, validate(addressSchema), async (c) => {
  const { sub } = c.get('auth');
  const { contactName, phone, address, lat, lng, isDefault } = c.get('validated');

  // Limit 10 addresses per user
  const existing = await db
    .select()
    .from(addresses)
    .where(eq(addresses.userId, sub));
  if (existing.length >= 10) {
    return c.json({ code: ErrorCode.ADDRESS_LIMIT_EXCEEDED, message: '地址数量已达上限(10个)' }, 400);
  }

  // If this is default, clear others
  if (isDefault) {
    await db
      .update(addresses)
      .set({ isDefault: false })
      .where(eq(addresses.userId, sub));
  }

  const [row] = await db
    .insert(addresses)
    .values({
      userId: sub,
      contactName,
      phone,
      address,
      isDefault: isDefault ?? existing.length === 0,
    })
    .returning();

  // Set location via raw SQL (PostGIS)
  await db.execute(
    `UPDATE addresses SET location = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326) WHERE id = '${row.id}'`,
  );

  return c.json(row, 201);
});

// ── PUT /api/user/addresses/:id ─────────────

userRoutes.put('/addresses/:id', auth, validate(addressSchema), async (c) => {
  const { sub } = c.get('auth');
  const id = c.req.param('id');
  const { contactName, phone, address, lat, lng, isDefault } = c.get('validated');

  const [existing] = await db
    .select()
    .from(addresses)
    .where(and(eq(addresses.id, id), eq(addresses.userId, sub)));
  if (!existing) return c.json({ code: ErrorCode.ADDRESS_NOT_FOUND }, 404);

  if (isDefault) {
    await db
      .update(addresses)
      .set({ isDefault: false })
      .where(eq(addresses.userId, sub));
  }

  const [row] = await db
    .update(addresses)
    .set({ contactName, phone, address, isDefault })
    .where(eq(addresses.id, id))
    .returning();

  await db.execute(
    `UPDATE addresses SET location = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326) WHERE id = '${row.id}'`,
  );

  return c.json(row);
});

// ── DELETE /api/user/addresses/:id ──────────

userRoutes.delete('/addresses/:id', auth, async (c) => {
  const { sub } = c.get('auth');
  const id = c.req.param('id');

  const [existing] = await db
    .select()
    .from(addresses)
    .where(and(eq(addresses.id, id), eq(addresses.userId, sub)));
  if (!existing) return c.json({ code: ErrorCode.ADDRESS_NOT_FOUND }, 404);

  await db.delete(addresses).where(eq(addresses.id, id));
  return c.json({ success: true });
});
